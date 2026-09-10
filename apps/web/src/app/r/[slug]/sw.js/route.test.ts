import { createContext, Script } from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrderPwa } from '@/components/order/order-pwa';
import { GET, orderWorkerSource } from './route';

vi.mock('@/components/order/order-pwa', () => ({ loadOrderPwa: vi.fn() }));

const origin = 'https://commande.example.test';
const target = '/r/recette/commandes';
function windowClient(url: string) {
  return { url, navigate: vi.fn(async () => {}), focus: vi.fn(async () => {}) };
}
function worker(windows: ReturnType<typeof windowClient>[] = []) {
  const handlers = new Map<string, (event: unknown) => void>();
  const show = vi.fn(async () => {}), open = vi.fn(async () => {});
  const claim = vi.fn(async () => {}), skip = vi.fn(async () => {});
  const context = createContext({ URL, self: {
    location: { origin },
    addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    skipWaiting: skip, registration: { showNotification: show },
    clients: { claim, matchAll: vi.fn(async () => windows), openWindow: open },
  } });
  // Execute exactly the script returned to browsers. No network, browser push
  // provider or cache is supplied to this fixture.
  new Script(orderWorkerSource('recette')).runInContext(context, { timeout: 1_000 });
  async function emit(name: string, properties: Record<string, unknown> = {}) {
    let work: Promise<unknown> | undefined;
    handlers.get(name)?.({ ...properties, waitUntil: (pending: Promise<unknown>) => { work = pending; } });
    await work;
  }
  return { handlers, show, open, claim, skip, emit };
}

beforeEach(() => { vi.mocked(loadOrderPwa).mockReset(); });
describe('service worker de commande — destination et état du navigateur', () => {
  it('sert seulement la portée du restaurant vérifié, sans cache HTTP', async () => {
    // This route uses the verified identity's slug; brand validation belongs to
    // loadOrderPwa and is deliberately outside this worker unit test.
    vi.mocked(loadOrderPwa).mockResolvedValue({ slug: 'recette' } as Awaited<ReturnType<typeof loadOrderPwa>>);
    const response = await GET(new Request(origin + '/r/recette/sw.js'), { params: Promise.resolve({ slug: 'recette' }) });
    expect(loadOrderPwa).toHaveBeenCalledWith('recette'); expect(response.status).toBe(200);
    expect(response.headers.get('Service-Worker-Allowed')).toBe('/r/recette/');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('javascript');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe(orderWorkerSource('recette'));
  });
  it.each(['absent', 'unavailable'] as const)('ne publie pas de worker si le restaurant est %s', async cause => {
    if (cause === 'absent') vi.mocked(loadOrderPwa).mockResolvedValue(null);
    else vi.mocked(loadOrderPwa).mockRejectedValue(new Error('identity unavailable'));
    const response = await GET(new Request(origin + '/r/recette/sw.js'), { params: Promise.resolve({ slug: 'recette' }) });
    expect(response.status).toBe(cause === 'absent' ? 404 : 503); expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(response.headers.get('Service-Worker-Allowed')).toBeNull();
  });
  it('ne prend en charge aucun fetch ni cache des commandes ou preuves privées', async () => {
    const f = worker(); expect([...f.handlers.keys()].sort()).toEqual(['activate', 'install', 'notificationclick', 'push']);
    await f.emit('install'); await f.emit('activate'); expect(f.skip).toHaveBeenCalledOnce(); expect(f.claim).toHaveBeenCalledOnce();
  });
  it('ignore une destination ou une preuve reçue dans le payload push', async () => {
    const f = worker(); const json = vi.fn(() => ({ title: 'Invoqué', path: 'https://outside.test/?t=secret', trackingToken: 'private-proof' }));
    await f.emit('push', { data: { json } });
    expect(json).not.toHaveBeenCalled(); expect(f.show).toHaveBeenCalledOnce();
    expect(f.show.mock.calls[0]).toEqual(['Votre commande est prête', expect.objectContaining({ data: { path: target }, icon: '/r/recette/icon.png?size=192' })]);
    expect(JSON.stringify(f.show.mock.calls)).not.toMatch(/private-proof|outside\.test|secret/);
  });
  it('focalise la fenêtre Commandes sans recharger le checkout ou son brouillon ouverts', async () => {
    const active = windowClient(origin + target), f = worker([active]); const close = vi.fn();
    await f.emit('notificationclick', { notification: { close, data: { path: '/t/unknown?t=secret' } } });
    expect(close).toHaveBeenCalledOnce(); expect(active.focus).toHaveBeenCalledOnce();
    expect(active.navigate).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled();
  });
  it('ne réutilise pas une fenêtre d’un autre restaurant ou d’une autre origine', async () => {
    const otherTenant = windowClient(origin + '/r/autre/commandes');
    const otherOrigin = windowClient('https://outside.test' + target);
    const currentCheckout = windowClient(origin + '/r/recette/carte');
    const f = worker([otherTenant, otherOrigin, currentCheckout]);
    await f.emit('notificationclick', { notification: { close: vi.fn() } });
    expect(f.open).toHaveBeenCalledExactlyOnceWith(origin + target);
    for (const client of [otherTenant, otherOrigin, currentCheckout]) { expect(client.focus).not.toHaveBeenCalled(); expect(client.navigate).not.toHaveBeenCalled(); }
  });
});
