import { loadOrderPwa } from '@/components/order/order-pwa';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const tenant = await loadOrderPwa(slug);
    if (!tenant) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const scope = `/r/${tenant.slug}/`;
    return Response.json({
      id: scope, name: `${tenant.name} · Commander`, short_name: tenant.name.slice(0, 30),
      description: `La carte et le suivi de vos commandes chez ${tenant.name}.`, lang: 'fr', dir: 'ltr',
      start_url: `${scope}carte`, scope, display: 'standalone',
      background_color: tenant.brand.palette.ground, theme_color: tenant.brand.palette.ground,
      icons: [192, 512].map((size) => ({ src: `${scope}icon.png?size=${size}`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any' })),
    }, { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=60, must-revalidate' } });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
