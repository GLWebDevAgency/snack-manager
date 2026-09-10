import { loadOrderPwa } from '@/components/order/order-pwa';

export function orderWorkerSource(slug: string): string {
  const scope = `/r/${encodeURIComponent(slug)}/`;
  return `const SCOPE=${JSON.stringify(scope)};
const TARGET=SCOPE+'commandes';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Aucun fetch handler, aucun cache : tickets, comptes et preuves restent au réseau.
self.addEventListener('push',event=>{
  event.waitUntil(self.registration.showNotification('Votre commande est prête',{
    body:'Consultez le suivi de votre commande.',tag:'sm-order-ready',
    icon:SCOPE+'icon.png?size=192',data:{path:TARGET}
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(TARGET,self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      const url=new URL(client.url);
      if(url.origin===self.location.origin&&url.pathname===TARGET){
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
`;
}

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
