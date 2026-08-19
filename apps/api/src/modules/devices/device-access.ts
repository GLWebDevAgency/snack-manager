import { UnauthorizedException } from '@nestjs/common';
import { DEVICE_TOKEN_HEADER } from '@sm/contracts';
import type { DevicesRepository, StoredDevice } from './devices.repository';

/**
 * Authentification d'un appareil de terrain.
 *
 * La tablette n'a ni compte ni mot de passe : son jeton EST son identité, et
 * c'est lui qui porte le tenant. Aucune route appareil n'accepte donc de
 * `tenantId` ni de `tenantSlug` — une caisse ne peut pas encaisser pour le
 * restaurant d'à côté, même en tâtonnant.
 *
 * Un appareil DÉSACTIVÉ est refusé comme un appareil inconnu : c'est le geste
 * qu'on fait quand une tablette disparaît, il doit couper l'accès sans
 * attendre qu'on pense aussi à régénérer son code.
 */
export async function requirePairedDevice(
  repository: DevicesRepository,
  deviceToken: string | null | undefined,
): Promise<StoredDevice> {
  if (!deviceToken) {
    throw new UnauthorizedException(
      "Cet appareil n'est pas appairé. Saisissez le code fourni par le back-office.",
    );
  }
  const device = await repository.findByDeviceToken(deviceToken);
  if (!device || !device.active) {
    throw new UnauthorizedException(
      "Cet appareil n'est plus reconnu. Appairez-le à nouveau depuis « Caisses & cuisine ».",
    );
  }
  return device;
}

/**
 * Jeton lu dans l'en-tête, à défaut dans le corps.
 *
 * L'en-tête est la voie normale (un secret n'a rien à faire dans un journal
 * d'accès) ; le corps reste accepté parce que la file hors ligne de la caisse
 * rejoue des requêtes JSON persistées telles quelles.
 */
export function readDeviceToken(
  headers: Record<string, string | string[] | undefined>,
  bodyToken?: string,
): string | null {
  const raw = headers[DEVICE_TOKEN_HEADER];
  const fromHeader = Array.isArray(raw) ? raw[0] : raw;
  return fromHeader?.trim() || bodyToken?.trim() || null;
}
