/**
 * Frontiere de confiance de l'ecran cuisine.
 *
 * Cette origine recoit le jeton d'appareil, les JWT du personnel et la socket
 * temps reel. Elle ne peut donc pas etre choisie par une URL visitee ou par le
 * stockage du navigateur. Les seules valeurs distantes autorisees sont nos
 * deux API exploitees ; localhost doit etre volontairement ouvert dans un
 * build de developpement.
 */

export const PRODUCTION_API_ORIGIN = 'https://api-production-8949.up.railway.app';
export const STAGING_API_ORIGIN = 'https://api-staging-a5e8.up.railway.app';
export const LOCAL_API_ORIGIN = 'http://localhost:3001';

const TRUSTED_REMOTE_ORIGINS = new Set([PRODUCTION_API_ORIGIN, STAGING_API_ORIGIN]);

export interface LegacyApiOverrideStore {
  removeItem(key: string): void;
}

export const LEGACY_API_OVERRIDE_KEY = 'sm.kds.cfg.api';

/** Supprime uniquement l'ancienne origine mutable, sans toucher a l'appairage. */
export function purgeLegacyApiOverride(store: LegacyApiOverrideStore | undefined): void {
  store?.removeItem(LEGACY_API_OVERRIDE_KEY);
}

/**
 * Resout une origine API compilee dans l'application.
 *
 * Une valeur fournie mais invalide est une erreur de deploiement : retomber
 * sur la production pourrait melanger silencieusement deux environnements.
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

  throw new Error(`Origine API KDS non autorisee : ${parsed.origin}`);
}
