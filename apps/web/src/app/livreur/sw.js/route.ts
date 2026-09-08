import { DELIVERY_OFFLINE_HTML } from "../delivery-offline";

/** No CacheStorage, private app shell, background sync or optimistic mission replay. */
export function GET() {
  const source = `
const OFFLINE_HTML = ${JSON.stringify(DELIVERY_OFFLINE_HTML)};
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || (url.pathname !== "/livreur" && url.pathname !== "/livreur/")) return;
  event.respondWith(fetch(request).catch(() => new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  })));
});
`;
  return new Response(source.trimStart(), { headers: {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Service-Worker-Allowed": "/livreur",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'",
  } });
}
