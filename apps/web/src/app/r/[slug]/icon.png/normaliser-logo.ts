import sharp from 'sharp';
import { detecterImage } from '@sm/contracts';
import { POIDS_MAX_LOGO } from '@/components/loyalty/logo-incorpore';

const MAX_SIDE = 4096;
const MAX_PIXELS = 4 * 1024 * 1024;
const PNG_SIDE = 512;
const MAX_SOURCE_BYTES = Math.ceil(POIDS_MAX_LOGO * 4 / 3) + 16 * 1024;
const MAX_PNG_BYTES = PNG_SIDE * PNG_SIDE * 4 + 64 * 1024;

/**
 * Only accepts the trusted SVG constructed by the sibling icon.svg handler.
 * Its embedded bytes already passed logoIncorpore's origin/size/download guards.
 * Next's SVG rasterizer silently omits embedded WebP. Decode the one raster to
 * a bounded PNG before handing the unchanged drawing to that renderer.
 * This helper does not fetch URLs, parse uploaded SVG or alter the public SVG.
 */
export async function normaliserLogoDansSvg(svg: string): Promise<string> {
  if (Buffer.byteLength(svg) > MAX_SOURCE_BYTES) throw new Error('Icon source too large');
  const images = [...svg.matchAll(/<image\b[^>]*>/g)];
  if (images.length === 0) return svg;
  if (images.length !== 1) throw new Error('Unexpected icon images');
  const href = /\bhref="([^"]*)"/.exec(images[0]![0])?.[1];
  const encoded = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(href ?? '');
  if (!encoded || encoded[2]!.length > Math.ceil(POIDS_MAX_LOGO / 3) * 4) throw new Error('Invalid icon raster');
  const bytes = Buffer.from(encoded[2]!, 'base64');
  if (!bytes.length || bytes.length > POIDS_MAX_LOGO || bytes.toString('base64') !== encoded[2]
    || detecterImage(bytes) !== encoded[1]) throw new Error('Invalid icon raster');

  const raster = sharp(bytes, { limitInputPixels: MAX_PIXELS, limitInputChannels: 4, failOn: 'warning', pages: 1 });
  try {
    const metadata = await raster.metadata();
    if (!metadata.width || !metadata.height || metadata.width > MAX_SIDE || metadata.height > MAX_SIDE
      || metadata.width * metadata.height > MAX_PIXELS) throw new Error('Icon raster dimensions exceeded');
    const png = await raster.resize({ width: PNG_SIDE, height: PNG_SIDE, fit: 'inside', withoutEnlargement: true })
      .png().timeout({ seconds: 2 }).toBuffer();
    if (png.length > MAX_PNG_BYTES) throw new Error('Icon raster output too large');
    return svg.replace(href!, `data:image/png;base64,${png.toString('base64')}`);
  } finally { raster.destroy(); }
}
