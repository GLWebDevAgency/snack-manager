import { DEVICE_KIND_LABELS, DEVICE_OFFLINE_AFTER_MS } from '@sm/contracts';
import type { DeviceIdentity, DeviceView } from '@sm/contracts';
import type { StoredDevice } from './devices.repository';

/**
 * Forme renvoyée au back-office.
 *
 * Elle porte déjà l'état rédigé (« Hors ligne depuis 12 min ») plutôt qu'un
 * horodatage brut à interpréter côté web : la seule question que se pose un
 * gérant devant cette page est « ma caisse tourne-t-elle ? », et il ne doit pas
 * avoir à faire une soustraction pour y répondre.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** « 12 min », « 3 h », « 2 j » — l'unité qui se lit d'un coup d'œil. */
function sinceLabel(elapsedMs: number): string {
  if (elapsedMs < HOUR_MS) return `${Math.max(1, Math.floor(elapsedMs / MINUTE_MS))} min`;
  if (elapsedMs < 2 * DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} h`;
  return `${Math.floor(elapsedMs / DAY_MS)} j`;
}

/** Identité minimale renvoyée à l'appareil lui-même. */
export function toDeviceIdentity(device: StoredDevice): DeviceIdentity {
  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    kindLabel: DEVICE_KIND_LABELS[device.kind],
  };
}

export function toDeviceView(device: StoredDevice, now: Date): DeviceView {
  const elapsed = device.lastSeenAt ? now.getTime() - device.lastSeenAt.getTime() : null;
  const online = device.paired && elapsed !== null && elapsed <= DEVICE_OFFLINE_AFTER_MS;

  let statusLabel: string;
  if (!device.paired) statusLabel = "En attente d'appairage";
  else if (elapsed === null) statusLabel = 'Jamais connecté';
  else if (online) statusLabel = 'En ligne';
  else statusLabel = `Hors ligne depuis ${sinceLabel(elapsed)}`;

  return {
    id: device.id,
    name: device.name,
    kind: device.kind,
    kindLabel: DEVICE_KIND_LABELS[device.kind],
    paired: device.paired,
    // Le code disparaît de la vue dès l'appairage : il ne sert plus à rien et
    // n'a aucune raison de continuer à circuler.
    pairing:
      device.pairingCode && device.pairingCodeExpiresAt
        ? {
            code: device.pairingCode,
            expiresAt: device.pairingCodeExpiresAt.toISOString(),
            expired: device.pairingCodeExpiresAt.getTime() <= now.getTime(),
          }
        : null,
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    online,
    statusLabel,
    active: device.active,
  };
}
