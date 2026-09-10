import { CUSTOMER_LOYALTY_NOTICE_VERSION, CustomerLoyaltyRequestSchema, CustomerLoyaltyResponseSchema,
  type CustomerLoyaltyRequest, type CustomerLoyaltyResponse } from '@sm/contracts';
import { CustomerAccountHttpError, type CustomerAccountAccess, type CustomerAccountRequest } from './client';
import { sameOrderAccess } from './orders';

export type CustomerLoyaltyState = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'error';
  response: CustomerLoyaltyResponse | null; pendingJoin: boolean; message: string | null }>;
const EMPTY: CustomerLoyaltyState = { status: 'idle', response: null, pendingJoin: false, message: null };
type Join = Extract<CustomerLoyaltyRequest, { step: 'join' }>;
type Port = { access: CustomerAccountAccess; currentAccess: () => CustomerAccountAccess | null; request: CustomerAccountRequest;
  active: () => boolean; lock?: (job: () => Promise<void>) => Promise<void>; now?: () => number; uuid?: () => string };

/** Only the current screen retains a pending join. After remount, a protected
 * view reads the durable association before another explicit consent is offered.
 * No QR, profile, member, balance or consent is written to browser storage. */
export function createCustomerLoyaltyClient(port: Port) {
  const access = structuredClone(port.access), now = port.now ?? Date.now;
  let state = EMPTY, pending: Join | null = null, generation = 0, busy = false;
  let expiresAt = access.expiresAt;
  const listeners = new Set<() => void>();
  const publish = (next: CustomerLoyaltyState) => { state = next; listeners.forEach(listener => listener()); };
  const current = (run: number) => run === generation && port.active() && expiresAt > now() && sameOrderAccess(access, port.currentAccess());
  async function verify(run: number) {
    if (!current(run) || !port.request.selection) throw new CustomerAccountHttpError(401);
    const selected = await port.request.selection();
    if (!current(run) || !sameOrderAccess(access, selected ? { selection: selected, expiresAt: access.expiresAt } : null)) throw new CustomerAccountHttpError(401);
  }
  async function send(input: CustomerLoyaltyRequest) {
    if (busy || !port.active()) return;
    const request = CustomerLoyaltyRequestSchema.parse(input);
    busy = true; const run = ++generation;
    publish({ status: 'loading', response: null, pendingJoin: pending !== null, message: null });
    try {
      if (!port.lock) throw new CustomerAccountHttpError(409);
      await port.lock(() => verify(run));
      // Do not hold the account lock over HTTP: logout can revoke immediately.
      const raw = await port.request('loyalty', request, access.selection);
      await port.lock(() => verify(run));
      const result = CustomerLoyaltyResponseSchema.parse(raw);
      if (result.expiresAt <= now() || result.expiresAt > expiresAt
        || (result.state === 'card' && request.step !== 'card')) throw new CustomerAccountHttpError(502);
      if (!current(run)) return;
      expiresAt = result.expiresAt;
      pending = null;
      publish({ status: 'ready', response: result, pendingJoin: false, message: null });
    } catch (cause) {
      if (generation !== run || !port.active()) return;
      const status = cause instanceof CustomerAccountHttpError ? cause.status : 0;
      // A stale view must never regain a result (including an accepted join).
      if (!current(run)) pending = null;
      publish({ status: 'error', response: null, pendingJoin: pending !== null,
        message: status === 401 || status === 409 ? 'Votre accès a changé. Revenez à votre compte et actualisez-le avant de continuer.'
          : pending ? `Votre demande de carte n’est pas confirmée. ${status === 429 ? 'Trop de demandes. Patientez avant de reprendre cette même demande.' : 'Réessayez cette même demande pour en vérifier le résultat.'}`
            : status === 429 ? 'Trop de demandes. Patientez avant de réessayer.'
              : 'La fidélité ne peut pas être vérifiée pour le moment. Votre compte reste indépendant.' });
    } finally { if (generation === run) busy = false; }
  }
  return {
    load: () => pending ? send(pending) : send({ step: 'view' }),
    retry: () => pending ? send(pending) : send({ step: 'view' }),
    async join(accepted: boolean) {
      const response = state.response;
      if (!accepted || busy || pending || state.status !== 'ready' || !response
        || (response.state !== 'available' && response.state !== 'terms_changed') || !response.profileReady) return;
      pending = { step: 'join', operationId: (port.uuid ?? (() => crypto.randomUUID()))(), programId: response.program.id,
        rulesVersion: response.program.version, termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true };
      await send(pending);
    },
    card: () => state.status === 'ready' && state.response?.state === 'member' ? send({ step: 'card' }) : Promise.resolve(),
    hideCard: () => { if (state.response?.state === 'card') { const { qrToken: _qr, ...member } = state.response; void _qr;
      publish({ ...state, response: { ...member, state: 'member' } }); } },
    invalidate: () => { generation++; busy = false; pending = null; publish(EMPTY); },
    getSnapshot: () => state, getServerSnapshot: () => EMPTY,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
