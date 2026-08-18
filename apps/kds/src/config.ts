import { Platform } from 'react-native';

/**
 * Configuration de l'appareil cuisine.
 *
 * En production l'URL d'API et le slug du restaurant sont figés à
 * l'approvisionnement de la tablette. En développement web, on accepte une
 * surcharge par paramètre d'URL (`?api=http://localhost:3001&tenant=classfood`),
 * mémorisée ensuite pour survivre aux rechargements de Metro.
 */

const DEFAULT_API = 'https://api-production-8949.up.railway.app';
const DEFAULT_TENANT = 'classfood';

function override(key: 'api' | 'tenant'): string | null {
  if (Platform.OS !== 'web') return null;
  const storeKey = `sm.kds.cfg.${key}`;
  try {
    const fromQuery = new URL(globalThis.location.href).searchParams.get(key);
    if (fromQuery) {
      globalThis.localStorage?.setItem(storeKey, fromQuery);
      return fromQuery;
    }
    return globalThis.localStorage?.getItem(storeKey) ?? null;
  } catch {
    return null;
  }
}

export const API_URL = override('api') ?? DEFAULT_API;
export const TENANT_SLUG = override('tenant') ?? DEFAULT_TENANT;

/** Rafraîchissement du tableau (le temps réel WebSocket viendra en complément). */
export const POLL_MS = 5000;

/** Rappel sonore tant qu'un ticket reste dans « Nouveau ». */
export const REMINDER_MS = 60000;

/** En dessous : mode téléphone (onglets au lieu de colonnes). */
export const PHONE_MAX_WIDTH = 820;

/**
 * En dessous : barre haute allégée. Les trois compteurs colorés cèdent la place
 * (les en-têtes de colonnes portent déjà le même chiffre) ; le total « Actives »,
 * l'horloge et l'état réseau restent toujours visibles.
 */
export const COMPACT_MAX_WIDTH = 1380;

// ─── Clés de stockage local ───
export const KEY_SESSION = 'sm.kds.session.v1';
export const KEY_BOARD = 'sm.kds.board.v1';
export const KEY_DELIVERED = 'sm.kds.delivered.v1';
export const KEY_PREFS = 'sm.kds.prefs.v1';
