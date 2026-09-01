import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const CIBLES = Object.freeze({
  local: Object.freeze({
    api: 'http://localhost:3001',
    site: 'http://localhost:3000',
    allowLocal: '1',
  }),
  staging: Object.freeze({
    api: 'https://api-staging-a5e8.up.railway.app',
    site: 'https://web-staging-6f5f.up.railway.app',
    allowLocal: '0',
  }),
  production: Object.freeze({
    api: 'https://api-production-8949.up.railway.app',
    site: 'https://web-production-99b58c.up.railway.app',
    allowLocal: '0',
  }),
});

/**
 * Valide la paire d'origines inlinée dans un build POS/KDS.
 *
 * Une seule source décide des couples autorisés. Deux variables valides prises
 * séparément ne suffisent pas : API staging + Web production reste un build
 * dangereux, notamment pour les QR fidélité.
 */
export function cibleBuildTerrain(env) {
  const api = env.EXPO_PUBLIC_API_URL?.trim();
  const site = env.EXPO_PUBLIC_SITE_URL?.trim();
  const allowLocal = env.EXPO_PUBLIC_ALLOW_LOCAL_API?.trim();

  for (const [nom, cible] of Object.entries(CIBLES)) {
    if (api === cible.api && site === cible.site && allowLocal === cible.allowLocal) {
      return nom;
    }
  }

  throw new Error(
    'Configuration terrain invalide : fournir une paire API/Web complète de local, staging ou production.',
  );
}

const executeDirectement =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (executeDirectement) {
  try {
    const cible = cibleBuildTerrain(process.env);
    console.log(`✓ Origines du build terrain verrouillées sur ${cible}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
