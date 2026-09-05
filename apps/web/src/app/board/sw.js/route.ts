/**
 * LE SERVICE WORKER DE L'ÉCRAN DE SALLE — téléchargé une fois, rejoué sans réseau.
 *
 * Une clé HDMI accrochée au plafond redémarre après une coupure de courant
 * pendant que la box du restaurant met une minute à revenir. Le jeton et le
 * dernier contenu sont déjà sur l'appareil (`board-store.ts`) ; ce worker y
 * installe ce qui manquait : la COQUILLE (la page, ses scripts, ses feuilles,
 * ses polices) et les PHOTOS de la boucle. L'écran joue alors sans réseau, et
 * ne renouvelle que ce qui change.
 *
 * Deux caches, versionnés :
 *  · la coquille — `/board`, `/board/display` en réseau d'abord avec repli,
 *    `/_next/static/*` en cache d'abord (immuable par construction) ;
 *  · les médias — toute image, cache d'abord. Les réponses OPAQUES sont
 *    acceptées : une photo servie par l'API est une requête `no-cors` de
 *    `<img>`, et une réponse opaque se sert telle quelle. Les adresses de la
 *    médiathèque portent l'empreinte du contenu : une adresse connue ne
 *    change jamais, une photo changée est une adresse nouvelle.
 *
 * L'affichage commande le précache à chaque contenu frais par un message,
 * qui ajoute les adresses manquantes et PURGE celles qui ne sont plus dans
 * la boucle : le cache ne grandit pas avec l'histoire de la carte.
 *
 * Même montage que la carte de fidélité installable (`r/[slug]/fidelite/sw.js`).
 */

const VERSION_CACHE_ECRAN = 1;
const PORTEE = "/board";

export const NOMS_CACHES_ECRAN = {
  prefixe: "sm-board:",
  coquille: `sm-board:v${VERSION_CACHE_ECRAN}`,
  medias: `sm-board:media:v${VERSION_CACHE_ECRAN}`,
} as const;

/** L'appairage et l'affichage — les deux seules pages qu'un téléviseur ouvre. */
export function estCheminCoquilleEcran(pathname: string): boolean {
  const sans = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  return sans === PORTEE || sans === `${PORTEE}/display`;
}

/** Classifie la réponse finale après redirections, avant toute écriture cache. */
export function estReponseCoquilleEcranCacheable(
  response: Pick<Response, "ok" | "redirected" | "url" | "headers">,
  origin: string,
): boolean {
  if (!response.ok || response.redirected) return false;
  try {
    const url = new URL(response.url);
    const contentType = response.headers.get("Content-Type") ?? "";
    return (
      url.origin === origin &&
      estCheminCoquilleEcran(url.pathname) &&
      contentType.toLowerCase().startsWith("text/html")
    );
  } catch {
    return false;
  }
}

/** Les actifs `_next/static` référencés par une page ou une feuille — la règle du worker, testée ici. */
export function actifsReferences(texte: string): string[] {
  const found = new Set<string>();
  for (const m of texte.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) found.add(m[1]!);
  for (const m of texte.matchAll(/url\((?:"|')?(\/_next\/static\/[^)"']+)(?:"|')?\)/g)) found.add(m[1]!);
  return [...found];
}

export function GET(): Response {
  const source = `
const CACHE_SHELL = ${JSON.stringify(NOMS_CACHES_ECRAN.coquille)};
const CACHE_MEDIA = ${JSON.stringify(NOMS_CACHES_ECRAN.medias)};
const CACHE_PREFIX = ${JSON.stringify(NOMS_CACHES_ECRAN.prefixe)};
const SHELL_PATHS = ["/board", "/board/display"];

function shellPath(pathname) {
  const p = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  return SHELL_PATHS.includes(p) ? p : null;
}

function isCacheableShell(response) {
  if (!response.ok || response.redirected) return false;
  try {
    const url = new URL(response.url);
    const type = response.headers.get("Content-Type") || "";
    return url.origin === self.location.origin
      && shellPath(url.pathname) !== null
      && type.toLowerCase().startsWith("text/html");
  } catch {
    return false;
  }
}

// Les actifs que la page référence — scripts, feuilles, et les polices que
// les feuilles référencent. Lus dans le HTML mis en cache, ajoutés au cache dès
// l'installation : une clé qui s'éteint juste après son premier chargement
// redémarre quand même sans réseau, sans avoir eu à recharger la page une fois.
const ASSET_IN_HTML = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
const ASSET_IN_CSS = /url\((?:"|')?(\/_next\/static\/[^)"']+)(?:"|')?\)/g;

function assetsOf(text, pattern) {
  const found = new Set();
  let m;
  while ((m = pattern.exec(text)) !== null) found.add(m[1]);
  return [...found];
}

async function cacheAssets(paths) {
  const cache = await caches.open(CACHE_SHELL);
  await Promise.all(paths.map(async (p) => {
    if (await cache.match(p)) return;
    try {
      const response = await fetch(p);
      if (!response.ok) return;
      await cache.put(p, response.clone());
      if (p.endsWith(".css")) await cacheAssets(assetsOf(await response.text(), ASSET_IN_CSS));
    } catch {
      /* un actif manquant hors ligne se réessaie au prochain passage en ligne */
    }
  }));
}

async function fetchShell(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (isCacheableShell(response)) {
    const cache = await caches.open(CACHE_SHELL);
    await cache.put(path, response.clone());
    await cacheAssets(assetsOf(await response.clone().text(), ASSET_IN_HTML));
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(SHELL_PATHS.map((p) => fetchShell(p).catch(() => undefined)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_SHELL && name !== CACHE_MEDIA)
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// La coquille : le réseau d'abord — une version fraîche vaut mieux —, le cache
// en repli quand la box est éteinte.
async function shellNetworkFirst(path) {
  try {
    return await fetchShell(path);
  } catch {
    const cache = await caches.open(CACHE_SHELL);
    return (await cache.match(path)) || Response.error();
  }
}

// Les actifs adressés par empreinte : le cache d'abord, jamais périmés.
async function assetCacheFirst(request) {
  const cache = await caches.open(CACHE_SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Les photos : le cache d'abord, y compris les réponses opaques d'une autre
// origine — c'est l'API qui sert les médias, et une image demandée par <img>
// ne peut pas être lue, seulement affichée.
async function mediaCacheFirst(request) {
  const cache = await caches.open(CACHE_MEDIA);
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await cache.put(request.url, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    const path = shellPath(url.pathname);
    if (path) event.respondWith(shellNetworkFirst(path));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(assetCacheFirst(request));
    return;
  }
  if (request.destination === "image") {
    event.respondWith(mediaCacheFirst(request));
  }
});

// Le précache commandé par l'affichage : ajouter ce qui manque, purger ce qui
// n'est plus dans la boucle.
async function precache(urls) {
  const cache = await caches.open(CACHE_MEDIA);
  const wanted = new Set(urls);
  const present = new Set((await cache.keys()).map((r) => r.url));
  await Promise.all(
    urls.filter((u) => !present.has(u)).map((u) =>
      fetch(new Request(u, { mode: "no-cors", credentials: "omit" }))
        .then((response) => {
          if (response.ok || response.type === "opaque") return cache.put(u, response);
        })
        .catch(() => undefined),
    ),
  );
  await Promise.all([...present].filter((u) => !wanted.has(u)).map((u) => cache.delete(u)));
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "sm-board:precache" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === "string" && /^https?:\\/\\//.test(u));
  event.waitUntil(precache(urls));
});
`;

  return new Response(source.trimStart(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": PORTEE,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
