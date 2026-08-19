import { SCREEN_OFFLINE_AFTER_MS, SCREEN_ORIENTATION_LABELS, SCREEN_THEME_LABELS } from '@sm/contracts';
import type { ScreenView } from '@sm/contracts';
import type { StoredScreen } from './screens.repository';

/**
 * Forme renvoyée au back-office.
 *
 * Elle porte déjà l'état lisible (« Hors ligne depuis 20 min ») plutôt qu'un
 * horodatage brut à interpréter côté web. Un écran muet est le seul incident
 * possible sur ce produit : le gérant doit le voir sans faire de soustraction.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** « 20 min », « 3 h », « 2 j » — l'unité qui se lit d'un coup d'œil. */
function sinceLabel(elapsedMs: number): string {
  if (elapsedMs < HOUR_MS) return `${Math.max(1, Math.floor(elapsedMs / MINUTE_MS))} min`;
  if (elapsedMs < 2 * DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} h`;
  return `${Math.floor(elapsedMs / DAY_MS)} j`;
}

export function toScreenView(screen: StoredScreen, now: Date): ScreenView {
  const elapsed = screen.lastSeenAt ? now.getTime() - screen.lastSeenAt.getTime() : null;
  const online = screen.paired && elapsed !== null && elapsed <= SCREEN_OFFLINE_AFTER_MS;

  let statusLabel: string;
  if (!screen.paired) statusLabel = "En attente d'appairage";
  else if (elapsed === null) statusLabel = 'Jamais connecté';
  else if (online) statusLabel = 'En ligne';
  else statusLabel = `Hors ligne depuis ${sinceLabel(elapsed)}`;

  return {
    id: screen.id,
    name: screen.name,
    orientation: screen.orientation,
    orientationLabel: SCREEN_ORIENTATION_LABELS[screen.orientation],
    theme: screen.theme,
    themeLabel: SCREEN_THEME_LABELS[screen.theme],
    playlist: screen.playlist,
    sceneCount: screen.playlist.length,
    paired: screen.paired,
    // Le code disparaît de la vue dès l'appairage : il ne sert plus à rien et
    // n'a aucune raison de continuer à circuler.
    pairing:
      screen.pairingCode && screen.pairingCodeExpiresAt
        ? {
            code: screen.pairingCode,
            expiresAt: screen.pairingCodeExpiresAt.toISOString(),
            expired: screen.pairingCodeExpiresAt.getTime() <= now.getTime(),
          }
        : null,
    lastSeenAt: screen.lastSeenAt ? screen.lastSeenAt.toISOString() : null,
    online,
    statusLabel,
    active: screen.active,
  };
}
