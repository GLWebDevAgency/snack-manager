import { createElement } from 'react';
import { ImageResponse } from 'next/og';
import { GET as svgIcon } from '../icon.svg/route';
import { normaliserLogoDansSvg } from './normaliser-logo';

/** Même vrai logo et mêmes garde-fous que l'icône SVG ; raster pour les lanceurs. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const requested = Number(new URL(request.url).searchParams.get('size') ?? 512);
  if (![180, 192, 512].includes(requested)) return new Response(null, { status: 400 });
  const source = await svgIcon(request, context);
  if (!source.ok) return source;
  try {
    const svg = await normaliserLogoDansSvg(await source.text());
    const image = new ImageResponse(createElement('img', { src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, width: requested, height: requested }), {
      width: requested, height: requested,
      headers: { 'Cache-Control': source.headers.get('Cache-Control') ?? 'no-store', 'X-Content-Type-Options': 'nosniff' },
    });
    // Consommer ici rend une panne de décodage/rastérisation explicite avant le 200.
    return new Response(await image.arrayBuffer(), { headers: image.headers });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
}
