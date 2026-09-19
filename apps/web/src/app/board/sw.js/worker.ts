/** Pure cache rules shared by the screen worker route and its tests. */
const VERSION_CACHE_ECRAN = 1;
export const PORTEE = "/board";

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

export const ASSET_IN_HTML = /(?:src|href)="(\/_next\/static\/[^"]+)"/g;
export const ASSET_IN_CSS = /url\((?:"|')?(\/_next\/static\/[^)"']+)(?:"|')?\)/g;

/** Les actifs `_next/static` référencés par une page ou une feuille — la règle du worker, testée ici. */
export function actifsReferences(texte: string): string[] {
  const found = new Set<string>();
  for (const m of texte.matchAll(ASSET_IN_HTML)) found.add(m[1]!);
  for (const m of texte.matchAll(ASSET_IN_CSS)) found.add(m[1]!);
  return [...found];
}

