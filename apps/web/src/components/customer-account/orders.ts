import { CustomerOrderDetailRequestSchema, CustomerOrdersQuerySchema, type CustomerOrderDetail, type CustomerOrdersPage, type CustomerOrdersQuery } from '@sm/contracts';
import { CustomerAccountHttpError, type CustomerAccountAccess, type CustomerAccountRequest, type CustomerAccountSelection } from './client';
import { parseCustomerOrderDetail, parseCustomerOrdersPage } from './orders-response';

export type CustomerOrdersState = Readonly<{
  status: 'idle' | 'loading' | 'ready' | 'error'; filter: CustomerOrdersQuery['filter'];
  orders: CustomerOrdersPage['orders']; nextCursor: CustomerOrdersPage['nextCursor'];
  orderId: string | null; detail: CustomerOrderDetail | null; message: string | null;
  expiresAt: number | null;
}>;
const EMPTY: CustomerOrdersState = { status: 'idle', filter: 'all', orders: [], nextCursor: null, orderId: null, detail: null, message: null, expiresAt: null };
export function sameOrderAccess(a: CustomerAccountAccess | null, b: CustomerAccountAccess | null) {
  return !!a && !!b && a.expiresAt === b.expiresAt && sameSelection(a.selection, b.selection);
}
function sameSelection(a: CustomerAccountSelection | null, b: CustomerAccountSelection | null) {
  return !!a && !!b && a.browserRef === b.browserRef && a.publication.expectedOperationId === b.publication.expectedOperationId
    && a.publication.expectedCheckId === b.publication.expectedCheckId;
}
type Port = { access: CustomerAccountAccess; request: CustomerAccountRequest; active: () => boolean;
  lock?: (job: () => Promise<void>) => Promise<void>; now?: () => number };

/** Read-only. No private order is copied into the guest checkout journal,
 * local shortcuts, URL or persistent browser storage. */
export function createCustomerOrdersClient(port: Port) {
  const access = structuredClone(port.access), now = port.now ?? Date.now;
  let authorisedUntil = access.expiresAt;
  let state = EMPTY, generation = 0, busy = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CustomerOrdersState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const current = (run: number) => generation === run && port.active() && authorisedUntil > now();
  function invalidate() { generation++; busy = false; publish({ ...EMPTY }); }
  async function verify() {
    if (!port.active() || authorisedUntil <= now() || !port.request.selection
      || !sameSelection(access.selection, await port.request.selection())) throw new CustomerAccountHttpError(401);
  }
  async function read(action: 'orders' | 'order-detail', body: CustomerOrdersQuery | { orderId: string }, append = false) {
    if (busy || !port.active()) return;
    busy = true; const run = ++generation;
    publish({ status: 'loading', message: null, detail: null, orderId: action === 'order-detail' ? (body as { orderId: string }).orderId : null,
      ...(action === 'orders' ? { filter: (body as CustomerOrdersQuery).filter, ...(append ? {} : { orders: [], nextCursor: null }) } : {}) });
    try {
      if (!port.lock) throw new CustomerAccountHttpError(409);
      await port.lock(async () => {
        if (!current(run)) throw new CustomerAccountHttpError(401);
        await verify(); if (!current(run)) return;
        const raw = await port.request(action, body, access.selection);
        await verify(); if (!current(run)) return;
        if (action === 'orders') {
          const page = parseCustomerOrdersPage(raw, body as CustomerOrdersQuery, now(), authorisedUntil);
          const orders = append ? [...state.orders, ...page.orders] : page.orders;
          if (new Set(orders.map(row => row._id)).size !== orders.length) throw new CustomerAccountHttpError(502);
          authorisedUntil = page.expiresAt;
          publish({ status: 'ready', orders, nextCursor: page.nextCursor, expiresAt: authorisedUntil });
        } else {
          const response = parseCustomerOrderDetail(raw, (body as { orderId: string }).orderId, now(), authorisedUntil);
          authorisedUntil = response.expiresAt;
          publish({ status: 'ready', detail: response.order, expiresAt: authorisedUntil });
        }
      });
    } catch (cause) {
      if (generation !== run || !port.active()) return;
      const status = cause instanceof CustomerAccountHttpError ? cause.status : 0;
      publish({ status: 'error', orders: [], nextCursor: null, detail: null,
        message: status === 401 || status === 409 ? 'Votre accès a changé. Revenez à votre compte et actualisez-le avant de continuer.'
          : status === 404 ? 'Cette commande ne peut pas être consultée depuis ce compte. Revenez à la liste ou contactez le restaurant.'
            : status === 429 ? 'Trop de demandes. Patientez avant de réessayer.'
              : 'La lecture n’a pas abouti. Réessayez : aucun état de commande ou de paiement ne peut être confirmé pour le moment.' });
    } finally { if (generation === run) busy = false; }
  }
  return { invalidate,
    load: (filter: CustomerOrdersQuery['filter'] = state.filter) => read('orders', CustomerOrdersQuerySchema.parse({ filter, limit: 8, cursor: null })),
    more: () => state.nextCursor ? read('orders', CustomerOrdersQuerySchema.parse({ filter: state.filter, limit: 8, cursor: state.nextCursor }), true) : Promise.resolve(),
    open: (orderId: string) => read('order-detail', CustomerOrderDetailRequestSchema.parse({ orderId })),
    back: () => { generation++; busy = false; publish({ orderId: null, detail: null, status: state.orders.length ? 'ready' : 'idle', message: null }); },
    getSnapshot: () => state, getServerSnapshot: () => EMPTY,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
