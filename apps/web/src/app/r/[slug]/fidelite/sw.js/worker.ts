/** Pure cache rules shared by the loyalty worker route and its tests. */
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

