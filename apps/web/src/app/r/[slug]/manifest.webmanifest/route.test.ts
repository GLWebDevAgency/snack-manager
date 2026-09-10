import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { GET } from './route';
const request = new Request('https://restaurant.example/r/restaurant/manifest.webmanifest');
const context = (slug = 'restaurant') => ({ params: Promise.resolve({ slug }) });
const tenant = { slug: 'restaurant', name: 'Restaurant', brand: DIRECTIONS.soleil };
const fetcher = vi.fn();
beforeEach(() => { fetcher.mockReset().mockResolvedValue(Response.json(tenant)); vi.stubGlobal('fetch', fetcher); });
afterEach(() => vi.unstubAllGlobals());
describe('manifest de commande propre au restaurant', () => {
  it('démarre sur la carte publique dans son scope exact avec des icônes raster', async () => {
    const result = await GET(request, context()); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ id: '/r/restaurant/', scope: '/r/restaurant/', start_url: '/r/restaurant/carte', display: 'standalone',
      name: 'Restaurant · Commander', theme_color: DIRECTIONS.soleil.palette.ground,
      icons: [192, 512].map(size => ({ src: `/r/restaurant/icon.png?size=${size}`, type: 'image/png', sizes: `${size}x${size}` })) });
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/\/public\/tenants\/restaurant$/), expect.objectContaining({ cache: 'no-store', redirect: 'error' }));
  });
  it.each([404, 500])('ne cache pas une identité indisponible (%s)', async status => {
    fetcher.mockResolvedValue(new Response(null, { status })); const result = await GET(request, context());
    expect(result.status).toBe(status === 404 ? 404 : 503); expect(result.headers.get('Cache-Control')).toBe('no-store');
  });
  it('refuse un autre restaurant et un slug traversant les chemins', async () => {
    fetcher.mockResolvedValue(Response.json({ ...tenant, slug: 'other' })); expect((await GET(request, context())).status).toBe(503);
    fetcher.mockClear(); expect((await GET(request, context('../other'))).status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
  });
});
