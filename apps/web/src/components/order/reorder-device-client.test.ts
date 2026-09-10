import { describe, expect, it, vi } from 'vitest';
import type { MenuProduct, Site } from './api';
import type { CartApi } from './cart';
import type { ReceivedCheckoutAttempt } from './checkout-attempt';
import { createDeviceReorderClient } from './reorder-device-client';

const product: MenuProduct = { id: 'a'.repeat(24), name: 'Menu', description: '', price: 900, fromPrice: 900, variants: [], groups: [], supplements: [], removables: [], tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: false };
const receipt: ReceivedCheckoutAttempt = { v: 1, tenant: 'recette', origin: 'https://commande.test', clientId: 'original', cartFingerprint: 'a'.repeat(64), createdAt: 1000, updatedAt: 1000, state: 'received', receipt: { orderId: 'b'.repeat(24), trackingToken: 'guest-capability', number: 12 } };
const source = { tenantSlug: 'recette', orderId: receipt.receipt.orderId, number: 12,
  lines: [{ productId: product.id, name: 'Ancien nom', variantKey: null, variantName: null, qty: 2, unitPrice: 800, options: [], removed: [] }] };
function fixture() {
  let rows = [receipt], active = true;
  const site = { tenant: { slug: 'recette' }, ordering: { paused: false }, categories: [{ id: 'cat', name: 'Menus', products: [structuredClone(product)] }] } as Site;
  const loadSource = vi.fn(async () => structuredClone(source));
  const loadSite = vi.fn(async () => site);
  const catalog = vi.fn<(categories: Site['categories']) => void>();
  const pending = vi.fn(async () => false);
  const append = vi.fn<CartApi['appendIfUnchanged']>(async (_lines, allowed) => allowed());
  const client = createDeviceReorderClient({ slug: 'recette', receipt, active: () => active,
    onCatalogVerified: catalog, readReceipts: async () => rows, loadSource, loadSite, hasUnresolvedCheckout: pending });
  return { client, catalog, append, pending, loadSite, loadSource, site, forget: () => { rows = []; }, pause: () => { active = false; },
    replace: (next: ReceivedCheckoutAttempt) => { rows = [next]; } };
}
describe('recommander depuis un reçu invité', () => {
  it('attend la confirmation, relit le menu et conserve prix actuel et anciennes quantités, sans anciennes notes', async () => {
    const f = fixture(); await f.client.load();
    expect(f.client.getSnapshot().snapshot?.preview.subtotal).toBe(1800); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot().snapshot?.preview.entries[0].priceChanged).toBe(true);
    expect(await f.client.confirm(f.append)).toBe(true); expect(f.loadSource).toHaveBeenCalledTimes(2);
    expect(f.append.mock.calls[0][0][0]).toMatchObject({ qty: 2, unitPrice: 900, name: 'Menu', note: null });
    expect(f.client.getSnapshot().status).toBe('done');
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).toHaveBeenCalledTimes(1);
  });
  it('partage la carte vérifiée puis relit le reçu après cette synchronisation', async () => {
    const f = fixture(); await f.client.load(); expect(f.catalog).toHaveBeenCalledWith(f.site.categories);
    f.catalog.mockImplementationOnce(() => f.forget());
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ status: 'error', snapshot: null });
  });
  it('demande une nouvelle confirmation après changement de prix, puis ajoute une seule fois', async () => {
    const f = fixture(); await f.client.load(); f.site.categories[0].products[0].price = 1000;
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot().snapshot?.preview.subtotal).toBe(2000);
    expect(f.client.getSnapshot().message).toMatch(/carte vient de changer/);
    expect(await f.client.confirm(f.append)).toBe(true); expect(f.append).toHaveBeenCalledTimes(1);
  });
  it('refuse après oubli du reçu, changement de jeton ou provenance privée', async () => {
    for (const change of [(f: ReturnType<typeof fixture>) => f.forget(), (f: ReturnType<typeof fixture>) => f.replace({ ...receipt, receipt: { ...receipt.receipt, trackingToken: 'replaced' } }),
      (f: ReturnType<typeof fixture>) => f.replace({ ...receipt, provenance: { kind: 'account' } as never })]) {
      const f = fixture(); await f.client.load(); change(f);
      expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled(); expect(f.client.getSnapshot().snapshot).toBeNull();
    }
  });
  it('écarte une réponse retardée si le reçu est oublié pendant la lecture', async () => {
    const f = fixture(); let release!: (value: typeof source) => void;
    f.loadSource.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const loading = f.client.load(); await vi.waitFor(() => expect(release).toBeTypeOf('function')); f.forget(); release(source); await loading;
    expect(f.client.getSnapshot().snapshot).toBeNull(); expect(f.client.getSnapshot().status).toBe('error');
  });
  it('garde la barrière C01 dans le callback atomique du panier', async () => {
    const f = fixture(); await f.client.load(); f.pending.mockResolvedValue(true);
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.client.getSnapshot().status).toBe('ready');
    expect(f.client.getSnapshot().message).toMatch(/demande en attente/);
  });
  it('revérifie le reçu après attente du contrôle C01, avant toute publication', async () => {
    const f = fixture(); await f.client.load(); f.pending.mockImplementationOnce(async () => { f.forget(); return false; });
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.client.getSnapshot().snapshot).toBeNull();
  });
  it('refuse une réponse d’un autre ordre ou restaurant et une carte en pause', async () => {
    for (const change of [(f: ReturnType<typeof fixture>) => f.loadSource.mockResolvedValue({ ...source, orderId: 'c'.repeat(24) }),
      (f: ReturnType<typeof fixture>) => f.loadSource.mockResolvedValue({ ...source, tenantSlug: 'autre' }),
      (f: ReturnType<typeof fixture>) => { f.site.ordering.paused = true; }]) {
      const f = fixture(); change(f); await f.client.load(); expect(f.client.getSnapshot().status).toBe('error'); expect(f.append).not.toHaveBeenCalled();
    }
  });
  it('annonce les références manquantes et ne substitue jamais un article homonyme', async () => {
    const f = fixture(); f.loadSource.mockResolvedValue({ ...source, lines: [{ ...source.lines[0], productId: 'f'.repeat(24) }] }); await f.client.load();
    expect(f.client.getSnapshot().snapshot?.preview.lines).toEqual([]);
    expect(f.client.getSnapshot().snapshot?.preview.entries[0].reason).toMatch(/plus proposé/);
    expect(await f.client.confirm(f.append)).toBe(false);
  });
  it('ignore un second clic pendant l’append et ne restaure pas un écran quitté', async () => {
    const f = fixture(); await f.client.load(); let release!: (value: boolean) => void;
    f.append.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const adding = f.client.confirm(f.append); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await f.client.confirm(f.append)).toBe(false); f.pause(); f.client.invalidate(); release(true); await adding;
    expect(f.append).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot()).toMatchObject({ status: 'idle', snapshot: null });
  });
});
