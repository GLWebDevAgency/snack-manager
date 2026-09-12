import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { DIRECTIONS } from '@sm/contracts';
import { dessinerIconeLogo } from '@/components/loyalty/icone-carte';
const mocks = vi.hoisted(() => ({ svg: vi.fn() }));
vi.mock('../icon.svg/route', () => ({ GET: mocks.svg }));
import { GET } from './route';
const context = { params: Promise.resolve({ slug: 'restaurant' }) };
async function logo(format: 'png' | 'jpeg' | 'webp') {
  const width = 96, height = 64, pixels = Buffer.alloc(width * height * 4);
  // Two distinct blocks on transparency: checking file headers or background
  // colours alone would pass even if the renderer silently drops the logo.
  for (let y = 12; y < 52; y++) for (let x = 8; x < 88; x++) {
    if (x >= 40 && x < 56) continue;
    const offset = (y * width + x) * 4, color = x < 40 ? [240, 20, 30, 255] : [20, 40, 240, 255];
    pixels.set(color, offset);
  }
  const image = sharp(pixels, { raw: { width, height, channels: 4 } });
  return format === 'jpeg' ? image.flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer()
    : format === 'webp' ? image.webp({ lossless: true }).toBuffer() : image.png().toBuffer();
}

async function colorAreas(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0, blue = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset]! > 180 && data[offset + 1]! < 70 && data[offset + 2]! < 80) red++;
    if (data[offset]! < 70 && data[offset + 1]! < 90 && data[offset + 2]! > 180) blue++;
  }
  const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { red, blue, width: info.width, height: info.height, center: [...data.subarray(center, center + 3)] };
}
beforeEach(() => { mocks.svg.mockReset().mockImplementation(() => Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#123456"/></svg>', { headers: { 'Cache-Control': 'public, max-age=60' } }))); });
afterEach(() => vi.unstubAllGlobals());
describe('icônes d’installation PNG réelles', () => {
  describe.each(['png', 'jpeg', 'webp'] as const)('le logo %s est effectivement dessiné', format => {
    it.each([180, 192, 512])('garde ses deux couleurs et son cadrage à %spx', async size => {
      const bytes = await logo(format);
      const source = dessinerIconeLogo(DIRECTIONS.nuit, `data:image/${format};base64,${bytes.toString('base64')}`);
      mocks.svg.mockResolvedValue(new Response(source, { headers: { 'Cache-Control': 'public, max-age=60, must-revalidate' } }));
      const response = await GET(new Request(`https://restaurant.example/r/restaurant/icon.png?size=${size}`), context);
      expect(response.status).toBe(200);
      const areas = await colorAreas(Buffer.from(await response.arrayBuffer()));
      expect(areas.width).toBe(size); expect(areas.height).toBe(size);
      expect(areas.red).toBeGreaterThan(size * size * 0.03);
      expect(areas.blue).toBeGreaterThan(size * size * 0.03);
      // The mark keeps its surrounding safe area rather than filling the icon.
      expect(areas.red + areas.blue).toBeLessThan(size * size * 0.5);
      if (format !== 'jpeg') expect(Math.max(...areas.center)).toBeLessThan(100); // transparent gap keeps the brand's dark ground
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, must-revalidate');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
  });
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
  it.each([
    'https://outside.example/logo.webp',
    'file:///etc/passwd',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:image/webp;base64,bm90IGFuIGltYWdl',
    `data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000000000000', 'hex').toString('base64')}`,
    `data:image/png;base64,${Buffer.alloc(96 * 1024 + 1).toString('base64')}`,
  ])('ne sert ni carré vide caché ni ressource distante pour un logo invalide %#', async href => {
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    mocks.svg.mockResolvedValue(new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><image href="${href}" width="512" height="512"/></svg>`));
    const response = await GET(new Request('https://restaurant.example/r/restaurant/icon.png?size=180'), context);
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff'); expect(await response.text()).toBe('');
    expect(network).not.toHaveBeenCalled();
  });
  it.each([{ width: 4097, height: 1 }, { width: 2049, height: 2049 }])('borne les dimensions décodées malgré un petit PNG compressé : %o', async dimensions => {
    const image = await sharp({ create: { ...dimensions, channels: 3, background: '#f0141e' } }).png().toBuffer();
    expect(image.length).toBeLessThan(96 * 1024);
    mocks.svg.mockResolvedValue(new Response(dessinerIconeLogo(DIRECTIONS.nuit, `data:image/png;base64,${image.toString('base64')}`)));
    const response = await GET(new Request('https://restaurant.example/r/restaurant/icon.png'), context);
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store'); expect(await response.text()).toBe('');
  });
  it('préserve un repli volontaire sans image et son interdiction de mise en cache', async () => {
    mocks.svg.mockResolvedValue(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#123456"/></svg>', { headers: { 'Cache-Control': 'no-store' } }));
    const response = await GET(new Request('https://restaurant.example/r/restaurant/icon.png'), context);
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
