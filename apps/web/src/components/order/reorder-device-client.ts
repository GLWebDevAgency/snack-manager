import { GuestOrderReorderResponseSchema, type GuestOrderReorderResponse } from '@sm/contracts';
import type { MenuCategory, Site } from './api';
import { indexMenu, type CartApi } from './cart';
import type { ReceivedCheckoutAttempt } from './checkout-attempt';
import { previewReorder } from '../customer-account/reorder-preview';

type Snapshot = { response: GuestOrderReorderResponse; site: Site; preview: ReturnType<typeof previewReorder> };
export type DeviceReorderState = Readonly<{ status: 'idle' | 'loading' | 'ready' | 'adding' | 'done' | 'error'; snapshot: Snapshot | null; message: string | null }>;
const EMPTY: DeviceReorderState = { status: 'idle', snapshot: null, message: null };
type Port = { slug: string; receipt: ReceivedCheckoutAttempt; active: () => boolean;
  readReceipts: () => Promise<ReceivedCheckoutAttempt[]>; loadSource: () => Promise<unknown>; loadSite: () => Promise<Site | null>;
  hasUnresolvedCheckout: () => Promise<boolean>; onCatalogVerified?: (categories: MenuCategory[]) => void };
class ReceiptUnavailable extends Error {}
class OrderingPaused extends Error {}

/** A guest capability supplies a volatile review. Only the existing durable
 * cart append port may write; there is no order-creation or payment port. */
export function createDeviceReorderClient(port: Port) {
  const receipt = structuredClone(port.receipt);
  let state = EMPTY, generation = 0, busy = false;
  const listeners = new Set<() => void>();
  const publish = (next: DeviceReorderState) => { state = next; listeners.forEach(listener => listener()); };
  const current = (run: number) => generation === run && port.active();
  async function verify(run: number) {
    if (!current(run) || receipt.tenant !== port.slug || receipt.provenance?.kind === 'account') throw new ReceiptUnavailable();
    const rows = await port.readReceipts();
    if (!current(run) || !rows.some(row => row.provenance?.kind !== 'account' && row.tenant === port.slug
      && row.origin === receipt.origin && row.clientId === receipt.clientId
      && row.receipt.orderId === receipt.receipt.orderId && row.receipt.trackingToken === receipt.receipt.trackingToken)) throw new ReceiptUnavailable();
  }
  async function snapshot(run: number): Promise<Snapshot> {
    await verify(run);
    const [raw, site] = await Promise.all([port.loadSource(), port.loadSite()]);
    await verify(run);
    const response = GuestOrderReorderResponseSchema.parse(raw);
    if (response.tenantSlug !== port.slug || response.orderId !== receipt.receipt.orderId || !site || site.tenant.slug !== port.slug) throw new ReceiptUnavailable();
    if (site.ordering.paused) throw new OrderingPaused();
    port.onCatalogVerified?.(site.categories);
    await verify(run);
    return { response, site, preview: previewReorder(response.lines, indexMenu(site.categories)) };
  }
  function fail(run: number, cause: unknown) {
    if (!current(run)) return;
    publish({ status: 'error', snapshot: null, message: cause instanceof ReceiptUnavailable
      ? 'Ce raccourci n’est plus disponible sur cet appareil. Revenez à vos commandes ou au menu.'
      : cause instanceof OrderingPaused ? 'Le restaurant a suspendu la commande en ligne. Votre panier n’a pas été modifié.'
        : 'La reprise n’a pas pu être vérifiée. Aucun article n’a été ajouté. Réessayez ou revenez au menu.' });
  }
  async function load() {
    if (busy || !port.active()) return;
    busy = true; const run = ++generation;
    publish({ status: 'loading', snapshot: null, message: null });
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
      const added = await append(fresh.preview.lines, async () => {
        await verify(run);
        const unresolved = await port.hasUnresolvedCheckout();
        await verify(run);
        return !unresolved && current(run);
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
