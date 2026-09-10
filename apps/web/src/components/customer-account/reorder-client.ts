import type { CustomerOrderReorderResponse } from '@sm/contracts';
import type { MenuCategory, Site } from '../order/api';
import { indexMenu, type CartApi } from '../order/cart';
import { CustomerAccountHttpError, type CustomerAccountAccess, type CustomerAccountRequest } from './client';
import { sameOrderAccess } from './orders';
import { parseCustomerOrderReorder } from './orders-response';
import { previewReorder } from './reorder-preview';

type Snapshot = { response: CustomerOrderReorderResponse; site: Site; preview: ReturnType<typeof previewReorder> };
export type ReorderState = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'adding' | 'done' | 'error'; snapshot: Snapshot | null; message: string | null }>;
const EMPTY: ReorderState = { status: 'idle', snapshot: null, message: null };
type Port = { slug: string; orderId: string; access: CustomerAccountAccess; currentAccess: () => CustomerAccountAccess | null;
  active: () => boolean; request: CustomerAccountRequest; loadSite: () => Promise<Site | null>;
  onCatalogVerified?: (categories: MenuCategory[]) => void;
  hasUnresolvedCheckout: () => Promise<boolean>; lock: (job: () => Promise<void>) => Promise<void>; now?: () => number };

/** Private reads remain volatile. A confirmed import is a NEW local basket,
 * never an adoption of order identity or authority. No creation/payment port. */
export function createReorderClient(port: Port) {
  const access = structuredClone(port.access), now = port.now ?? Date.now;
  let state = EMPTY, generation = 0, busy = false;
  const listeners = new Set<() => void>();
  const publish = (next: ReorderState) => { state = next; listeners.forEach(listener => listener()); };
  const current = (run: number) => generation === run && port.active() && access.expiresAt > now() && sameOrderAccess(access, port.currentAccess());
  async function verify(run: number) {
    if (!current(run) || !port.request.selection) throw new CustomerAccountHttpError(401);
    const selected = await port.request.selection();
    if (!current(run) || !sameOrderAccess(access, selected ? { selection: selected, expiresAt: access.expiresAt } : null)) throw new CustomerAccountHttpError(401);
  }
  async function snapshot(run: number): Promise<Snapshot> {
    await port.lock(() => verify(run));
    // Network waits never hold the account lock: logout remains available.
    const [raw, site] = await Promise.all([port.request('order-reorder', { orderId: port.orderId }, access.selection), port.loadSite()]);
    await port.lock(() => verify(run));
    const response = parseCustomerOrderReorder(raw, port.orderId, now(), access.expiresAt);
    if (!site || site.tenant.slug !== port.slug) throw new CustomerAccountHttpError(503);
    if (site.ordering.paused) throw new CustomerAccountHttpError(423);
    port.onCatalogVerified?.(site.categories);
    await port.lock(() => verify(run));
    return { response, site, preview: previewReorder(response.lines, indexMenu(site.categories)) };
  }
  function fail(run: number, cause: unknown) {
    if (generation !== run || !port.active()) return;
    const status = cause instanceof CustomerAccountHttpError ? cause.status : 0;
    publish({ status: 'error', snapshot: null, message: status === 401 || status === 409
      ? 'Votre accès a changé. Revenez à votre compte avant de recommencer.' : status === 423
        ? 'Le restaurant a suspendu la commande en ligne. Votre panier n’a pas été modifié.'
        : 'La reprise n’a pas pu être vérifiée. Aucun article n’a été ajouté. Réessayez ou revenez au menu.' });
  }
  async function load() {
    if (busy || !port.active()) return;
    busy = true; const run = ++generation; publish({ status: 'loading', snapshot: null, message: null });
    try { const value = await snapshot(run); if (current(run)) publish({ status: 'ready', snapshot: value, message: null }); }
    catch (cause) { fail(run, cause); }
    finally { if (generation === run) busy = false; }
  }
  async function confirm(append: CartApi['appendIfUnchanged']) {
    if (busy || state.status !== 'ready' || !state.snapshot?.preview.lines.length) return false;
    const shown = state.snapshot;
    busy = true; const run = ++generation; publish({ ...state, status: 'adding', message: null });
    try {
      const fresh = await snapshot(run);
      if (!current(run)) return false;
      if (JSON.stringify(fresh.preview) !== JSON.stringify(shown.preview)) {
        publish({ status: 'ready', snapshot: fresh, message: 'La carte vient de changer. Vérifiez ce nouvel aperçu avant de confirmer.' }); return false;
      }
      let added = false;
      await port.lock(async () => {
        await verify(run);
        added = await append(fresh.preview.lines, async () => {
          await verify(run);
          const unresolved = await port.hasUnresolvedCheckout();
          await verify(run);
          return !unresolved && current(run) && fresh.response.expiresAt > now();
        });
        // Storage can absorb its callback's refusal and return false while
        // React still holds the former access. Never republish that snapshot
        // without sampling the durable publication again after the adapter.
        await verify(run);
        if (fresh.response.expiresAt <= now()) throw new CustomerAccountHttpError(401);
      });
      if (current(run)) publish(added ? { status: 'done', snapshot: null, message: 'Les articles sont ajoutés à votre panier. Aucune commande n’a encore été envoyée.' }
        : { status: 'ready', snapshot: fresh, message: 'L’ajout n’a pas été confirmé. Vérifiez votre panier et toute demande en attente avant de réessayer.' });
      return added;
    } catch (cause) { fail(run, cause); return false; }
    finally { if (generation === run) busy = false; }
  }
  return { load, confirm, invalidate: () => { generation++; busy = false; publish(EMPTY); },
    getSnapshot: () => state, getServerSnapshot: () => EMPTY,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}
