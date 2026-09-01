import { loadPublicLoyalty } from "@/components/loyalty/public-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });

  const base = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
  const cacheName = `sm-loyalty-${catalog.restaurant.slug}-v1`;
  const source = `
const CACHE_NAME = ${JSON.stringify(cacheName)};
const APP_PATH = ${JSON.stringify(base)};
const SAFE_ASSETS = new Set([
  APP_PATH,
  APP_PATH + "/",
  APP_PATH + "/manifest.webmanifest",
  APP_PATH + "/icon.svg",
]);
const PRIVATE_PATHS = new Set([
  APP_PATH + "/card-session",
  APP_PATH + "/card-qr",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add(APP_PATH))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(${JSON.stringify(`sm-loyalty-${catalog.restaurant.slug}-`)}) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(APP_PATH, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(APP_PATH)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Une réponse membre ou son QR est privée et reste hors de toute stratégie
  // du worker, y compris si une future navigation vise directement la route.
  if (PRIVATE_PATHS.has(url.pathname)) return;

  if (request.mode === "navigate" && url.pathname.startsWith(APP_PATH)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (SAFE_ASSETS.has(url.pathname) || url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
  }
});
`;

  return new Response(source.trimStart(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": base,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
