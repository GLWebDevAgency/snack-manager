import { loadOrderPwa } from '@/components/order/order-pwa';

import { orderWorkerSource } from './worker';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const tenant = await loadOrderPwa(slug);
    if (!tenant) return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(orderWorkerSource(tenant.slug), { headers: {
      'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store',
      'Service-Worker-Allowed': `/r/${tenant.slug}/`, 'X-Content-Type-Options': 'nosniff',
    } });
  } catch { return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
