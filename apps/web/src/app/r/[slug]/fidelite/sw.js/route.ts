import { loadPublicLoyalty } from "@/components/loyalty/public-api";

const VERSION_CACHE_FIDELITE = 2;

export function nomsCachesFidelite(slug: string): {
  actuel: string;
  prefixe: string;
  ancienV1: string;
} {
  // `:` n'appartient pas aux slugs. L'encodage garde cette frontière vraie
  // même face à une donnée amont inattendue.
  const portee = encodeURIComponent(slug);
  return {
    actuel: `sm-loyalty:${portee}:v${VERSION_CACHE_FIDELITE}`,
    prefixe: `sm-loyalty:${portee}:`,
    ancienV1: `sm-loyalty-${slug}-v1`,
  };
}

export function estCacheFideliteObsolete(nom: string, slug: string): boolean {
  const caches = nomsCachesFidelite(slug);
  return (
    nom !== caches.actuel &&
    (nom === caches.ancienV1 || nom.startsWith(caches.prefixe))
  );
}

export function estCheminCoquilleFidelite(
  pathname: string,
  appPath: string,
): boolean {
  return pathname === appPath || pathname === `${appPath}/`;
}

/** Classifie la réponse finale après redirections, avant toute écriture cache. */
export function estReponseCoquilleFideliteCacheable(
  response: Pick<Response, "ok" | "redirected" | "url" | "headers">,
  appPath: string,
  origin: string,
): boolean {
  if (!response.ok || response.redirected) return false;
  try {
    const responseUrl = new URL(response.url);
    const contentType = response.headers.get("Content-Type") ?? "";
    return (
      responseUrl.origin === origin &&
      estCheminCoquilleFidelite(responseUrl.pathname, appPath) &&
      contentType.toLowerCase().startsWith("text/html")
    );
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const catalog = await loadPublicLoyalty(slug).catch(() => null);
  if (!catalog) return new Response(null, { status: 404 });

  const base = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
  const cachesFidelite = nomsCachesFidelite(catalog.restaurant.slug);
  const source = `
const CACHE_NAME = ${JSON.stringify(cachesFidelite.actuel)};
const CACHE_PREFIX = ${JSON.stringify(cachesFidelite.prefixe)};
const LEGACY_CACHE_NAME = ${JSON.stringify(cachesFidelite.ancienV1)};
const APP_PATH = ${JSON.stringify(base)};
const SAFE_ASSETS = new Set([
  APP_PATH + "/manifest.webmanifest",
  APP_PATH + "/icon.svg",
]);
const PRIVATE_PATHS = new Set([
  APP_PATH + "/card-session",
  APP_PATH + "/card-qr",
]);

function isAppShellPath(pathname) {
  return pathname === APP_PATH || pathname === APP_PATH + "/";
}

function isCacheableAppShell(response) {
  if (!response.ok || response.redirected) return false;
  try {
    const responseUrl = new URL(response.url);
    const contentType = response.headers.get("Content-Type") || "";
    return responseUrl.origin === self.location.origin
      && isAppShellPath(responseUrl.pathname)
      && contentType.toLowerCase().startsWith("text/html");
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    fetchAndCacheAppShell(APP_PATH)
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && (name === LEGACY_CACHE_NAME || name.startsWith(CACHE_PREFIX)))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function fetchAndCacheAppShell(request) {
  const response = await fetch(request);
  // Ne jamais remplacer le shell par une redirection, une réponse privée ou
  // un payload non HTML, même si le serveur répond avec un statut 2xx.
  if (isCacheableAppShell(response)) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(APP_PATH, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    return await fetchAndCacheAppShell(request);
  } catch {
    // Ne jamais prendre le shell homonyme d'un autre restaurant ou d'une
    // ancienne version : le repli est borné au cache courant.
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(APP_PATH)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
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

  // Seules les deux écritures de la racine publique alimentent le shell.
  // Aucune sous-route (présente ou future) ne doit pouvoir l'écraser.
  if (request.mode === "navigate" && isAppShellPath(url.pathname)) {
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
