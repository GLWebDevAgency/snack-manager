/**
 * Frontiere de confiance de la caisse.
 *
 * Cette origine recoit le jeton d'appareil, les JWT du personnel et toutes
 * les ecritures de vente. Elle appartient donc au BUILD : ni l'URL visitee,
 * ni le stockage du navigateur ne peuvent la choisir.
 */

export const PRODUCTION_API_ORIGIN = 'https://api-production-8949.up.railway.app';
export const STAGING_API_ORIGIN = 'https://api-staging-a5e8.up.railway.app';
export const LOCAL_API_ORIGIN = 'http://localhost:3001';

const TRUSTED_REMOTE_ORIGINS = new Set([PRODUCTION_API_ORIGIN, STAGING_API_ORIGIN]);

export interface LegacyApiOverrideStore {
  removeItem(key: string): void;
}

export const LEGACY_API_OVERRIDE_KEY = 'sm.apiUrl';

/** Supprime uniquement l'ancienne origine mutable, sans toucher a l'appairage. */
export function purgeLegacyApiOverride(store: LegacyApiOverrideStore | undefined): void {
  store?.removeItem(LEGACY_API_OVERRIDE_KEY);
}

/**
 * Resout une origine API compilee dans l'application.
 *
 * Une valeur absente ou invalide est une erreur de deploiement. Retomber sur
 * la production depuis un build de staging melangerait deux environnements.
 */
export function resolveApiOrigin(
  configuredOrigin: string | undefined,
  allowLocalhost = false,
): string {
  const candidate = configuredOrigin?.trim();
  if (!candidate) {
    throw new Error('EXPO_PUBLIC_API_URL doit designer explicitement une origine API.');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_API_URL doit etre une origine API absolue autorisee.');
  }

  const isBareOrigin =
    parsed.username === '' &&
    parsed.password === '' &&
    (parsed.pathname === '' || parsed.pathname === '/') &&
    parsed.search === '' &&
    parsed.hash === '';

  if (!isBareOrigin) {
    throw new Error('EXPO_PUBLIC_API_URL ne doit contenir ni identifiants, ni chemin, ni parametres.');
  }

  if (TRUSTED_REMOTE_ORIGINS.has(parsed.origin)) return parsed.origin;
  if (allowLocalhost && parsed.origin === LOCAL_API_ORIGIN) return LOCAL_API_ORIGIN;

  throw new Error(`Origine API POS non autorisee : ${parsed.origin}`);
}
