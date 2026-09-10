import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ svg: vi.fn() }));
vi.mock('../icon.svg/route', () => ({ GET: mocks.svg }));
import { GET } from './route';
const context = { params: Promise.resolve({ slug: 'restaurant' }) };
beforeEach(() => { mocks.svg.mockReset().mockImplementation(() => Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#123456"/></svg>', { headers: { 'Cache-Control': 'public, max-age=60' } }))); });
describe('icônes d’installation PNG réelles', () => {
  it.each([180, 192, 512])('produit un vrai PNG %s depuis le dessin de marque existant', async size => {
    const response = await GET(new Request(`https://restaurant.example/r/restaurant/icon.png?size=${size}`), context);
    expect(response.status).toBe(200); expect(response.headers.get('Content-Type')).toContain('image/png');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.readUInt32BE(16)).toBe(size); expect(buffer.readUInt32BE(20)).toBe(size);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
  });
  it('refuse une taille arbitraire sans charger de marque et propage son absence', async () => {
    expect((await GET(new Request('https://restaurant.example/r/restaurant/icon.png?size=99999'), context)).status).toBe(400); expect(mocks.svg).not.toHaveBeenCalled();
    mocks.svg.mockResolvedValue(new Response(null, { status: 404 }));
    expect((await GET(new Request('https://restaurant.example/r/restaurant/icon.png'), context)).status).toBe(404);
  });
});
