import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { dessinerIconeLogo } from '@/components/loyalty/icone-carte';
import { normaliserLogoDansSvg } from './normaliser-logo';

describe('normalisation du raster embarqué dans le seul PNG de commande', () => {
  it('borne le raster à512px en gardant son ratio et le dessin SVG autour', async () => {
    const image = await sharp({ create: { width: 2048, height: 1024, channels: 4, background: { r: 240, g: 20, b: 30, alpha: 0.5 } } }).webp({ lossless: true }).toBuffer();
    const uri = `data:image/webp;base64,${image.toString('base64')}`;
    const source = dessinerIconeLogo(DIRECTIONS.nuit, uri)!;
    const normalized = await normaliserLogoDansSvg(source);
    const nextUri = /href="([^"]+)"/.exec(normalized)![1]!;
    expect(nextUri.startsWith('data:image/png;base64,')).toBe(true);
    expect(normalized.replace(nextUri, uri)).toBe(source);
    const metadata = await sharp(Buffer.from(nextUri.split(',')[1]!, 'base64')).metadata();
    expect(metadata).toMatchObject({ width: 512, height: 256, format: 'png', hasAlpha: true });
    expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
  });
  it('n’agrandit pas artificiellement un petit logo et refuse plusieurs images', async () => {
    const image = await sharp({ create: { width: 64, height: 44, channels: 3, background: '#f0141e' } }).jpeg().toBuffer();
    const source = dessinerIconeLogo(DIRECTIONS.nuit, `data:image/jpeg;base64,${image.toString('base64')}`)!;
    const normalized = await normaliserLogoDansSvg(source);
    const encoded = /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(normalized)![1]!;
    expect(await sharp(Buffer.from(encoded, 'base64')).metadata()).toMatchObject({ width: 64, height: 44 });
    await expect(normaliserLogoDansSvg(source.replace('</svg>', '<image href="data:image/png;base64,eA=="/></svg>'))).rejects.toThrow();
  });
});
