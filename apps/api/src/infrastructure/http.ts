/**
 * Petites aides HTTP partagées par les adaptateurs sortants.
 *
 * Volontairement minuscule : dès qu'on met un « client HTTP maison » entre
 * l'adaptateur et `fetch`, on perd la lisibilité de la requête réellement
 * envoyée — et c'est justement ce qu'on relit quand une intégration casse.
 */

/** `fetch` injectable : les tests remplacent le réseau sans serveur factice. */
export type Fetch = typeof globalThis.fetch;

/** Message exploitable pour la journalisation, quelle que soit la forme du rejet. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lit un corps JSON sans jamais faire échouer l'appelant sur le corps lui-même.
 *
 * Une passerelle qui renvoie une page HTML d'erreur 502 est un cas ORDINAIRE en
 * production ; `response.json()` lèverait alors un « Unexpected token < » qui ne
 * dit rien à personne. On préfère `null` et un message construit sur le statut.
 */
export async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** « HTTP 401 Unauthorized » — repère suffisant dans un journal d'incident. */
export function httpStatusLabel(response: Response): string {
  return `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
}
