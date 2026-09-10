import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Site, MenuProduct } from '../order/api';
import type { CartApi } from '../order/cart';
import type { CustomerAccountAccess, CustomerAccountRequest } from './client';
import { createReorderClient } from './reorder-client';

const id = 'a'.repeat(24), productId = 'b'.repeat(24);
function fixture() {
  let now = Date.now(), active = true, unresolved = false;
  const access: CustomerAccountAccess = { expiresAt: now + 60_000, selection: { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } } };
  let current: CustomerAccountAccess | null = access;
  const response = { orderId: id, number: 42, expiresAt: access.expiresAt,
    lines: [{ productId, name: 'Kebab', variantKey: null, variantName: null, qty: 1, unitPrice: 800, options: [], removed: [] }] };
  const product: MenuProduct = { id: productId, name: 'Kebab', description: '', price: 850, fromPrice: 850,
    variants: [], groups: [], supplements: [], removables: [], tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: false };
  const site = { tenant: { slug: 'classfood' }, categories: [{ id: 'menu', name: 'Menu', products: [product] }], ordering: { paused: false, message: null } } as Site;
  const request = Object.assign(vi.fn(async () => structuredClone(response)), { selection: vi.fn(async () => current?.selection ?? null) }) as unknown as CustomerAccountRequest;
  const loadSite = vi.fn(async () => structuredClone(site));
  const catalog = vi.fn<(categories: Site['categories']) => void>();
  const append = vi.fn<CartApi['appendIfUnchanged']>(async (_lines, allowed) => allowed());
  const client = createReorderClient({ slug: 'classfood', orderId: id, access, currentAccess: () => current, active: () => active,
    request, loadSite, onCatalogVerified: catalog, hasUnresolvedCheckout: async () => unresolved, lock: async job => job(), now: () => now });
  return { client, catalog, access, response, site, product, request, loadSite, append,
    revoke: () => { current = null; }, switch: () => { current = { ...access, selection: { ...access.selection, browserRef: randomUUID() } }; },
    expire: () => { now += 60_001; }, pause: () => { active = false; client.invalidate(); }, pending: () => { unresolved = true; } };
}
describe('réachat privé — aperçu puis ajout explicite, sans création de commande', () => {
  it('lit sans persister ; confirme après une nouvelle lecture du compte et du menu', async () => {
    const f = fixture(); await f.client.load();
    expect(f.client.getSnapshot().status).toBe('ready'); expect(f.append).not.toHaveBeenCalled();
    expect(await f.client.confirm(f.append)).toBe(true);
    expect(f.request).toHaveBeenCalledTimes(2); expect(f.loadSite).toHaveBeenCalledTimes(2);
    expect(f.request).toHaveBeenLastCalledWith('order-reorder', { orderId: id }, f.access.selection);
    expect(f.append).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot()).toMatchObject({ status: 'done', snapshot: null });
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).toHaveBeenCalledTimes(1);
  });
  it('synchronise la carte avant l’aperçu puis revérifie la publication privée', async () => {
    const f = fixture(); await f.client.load(); expect(f.catalog).toHaveBeenCalledWith(f.site.categories);
    f.catalog.mockImplementationOnce(() => f.revoke());
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ status: 'error', snapshot: null });
  });
  it.each(['price', 'stock', 'selection'] as const)('requiert une nouvelle confirmation si %s change', async fault => {
    const f = fixture(); await f.client.load();
    if (fault === 'price') f.product.price = 1000;
    if (fault === 'stock') f.product.outOfStock = true;
    if (fault === 'selection') f.product.variants = [{ key: 'new', name: 'Nouveau', price: 850 }];
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot().message).toContain('La carte vient de changer');
  });
  it.each(['revoke', 'switch', 'expire', 'pause'] as const)('ne copie rien après %s', async fault => {
    const f = fixture(); await f.client.load(); f[fault]();
    expect(await f.client.confirm(f.append)).toBe(false); expect(f.append).not.toHaveBeenCalled();
    expect(f.client.getSnapshot().snapshot).toBeNull();
  });
  it('relit l’autorisation à l’intérieur du verrou panier et refuse la perte d’accès en attente', async () => {
    const f = fixture(); await f.client.load();
    const append = vi.fn<CartApi['appendIfUnchanged']>(async (_lines, allowed) => { f.revoke(); return allowed(); });
    expect(await f.client.confirm(append)).toBe(false);
    expect(f.client.getSnapshot().snapshot).toBeNull();
  });
  it('masque l’aperçu si le panier absorbe un refus du journal alors que le profil React est encore ancien', async () => {
    const f = fixture(); await f.client.load();
    const append = vi.fn<CartApi['appendIfUnchanged']>(async (_lines, allowed) => {
      // Another tab changes IDB before React receives its notification. The
      // storage adapter reports false rather than propagating authority errors.
      vi.mocked(f.request.selection!).mockResolvedValue({ ...f.access.selection, browserRef: randomUUID() });
      try { return await allowed(); } catch { return false; }
    });
    expect(await f.client.confirm(append)).toBe(false);
    expect(f.client.getSnapshot()).toMatchObject({ status: 'error', snapshot: null });
    expect(f.client.getSnapshot().message).toContain('Votre accès a changé');
  });
  it('ne débloque pas une tentative de commande incertaine en ajoutant les anciennes lignes', async () => {
    const f = fixture(); await f.client.load(); f.pending();
    expect(await f.client.confirm(f.append)).toBe(false);
    expect(f.client.getSnapshot().status).toBe('ready');
  });
  it('conserve l’aperçu et explique un panier concurrent ou un ajout non confirmé', async () => {
    const f = fixture(); await f.client.load(); f.append.mockResolvedValue(false);
    expect(await f.client.confirm(f.append)).toBe(false);
    expect(f.client.getSnapshot().message).toContain('L’ajout n’a pas été confirmé');
  });
  it('jette une réponse privée tardive après changement d’identité, sans mise en cache', async () => {
    const f = fixture(); let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(f.request).mockImplementation(async () => { await deferred; return f.response; });
    const reading = f.client.load(); await vi.waitFor(() => expect(f.request).toHaveBeenCalled());
    f.switch(); release(); await reading;
    expect(f.client.getSnapshot().snapshot).toBeNull(); expect(f.append).not.toHaveBeenCalled();
  });
  it.each(['wrong-order', 'expired', 'secret', 'foreign-menu', 'paused'] as const)('refuse une projection %s', async fault => {
    const f = fixture();
    if (fault === 'wrong-order') f.response.orderId = 'c'.repeat(24);
    if (fault === 'expired') f.response.expiresAt = Date.now() - 1;
    if (fault === 'secret') Object.assign(f.response, { recoveryProof: 'never-project-this' });
    if (fault === 'foreign-menu') f.site.tenant.slug = 'foreign';
    if (fault === 'paused') f.site.ordering.paused = true;
    await f.client.load(); expect(f.client.getSnapshot().snapshot).toBeNull();
    expect(f.append).not.toHaveBeenCalled(); expect(JSON.stringify(f.client.getSnapshot())).not.toContain('never-project-this');
  });
});
