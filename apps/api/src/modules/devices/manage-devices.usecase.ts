import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  PAIRING_CODE_TTL_MS,
  type DeviceCreate,
  type DeviceUpdate,
  type DeviceView,
} from '@sm/contracts';
import { CLOCK, type Clock } from './devices.tokens';
import { generatePairingCode } from '../screens/pairing-code';
import { DevicesRepository } from './devices.repository';
import { toDeviceView } from './devices.view';
import { SessionRevocationPublisher } from '../../common/session-revocation';

/**
 * CAS D'USAGE — le back-office des appareils (rôles owner / gérant).
 *
 * Le `tenantId` vient TOUJOURS du token : un gérant ne peut ni lister, ni
 * renommer, ni surtout régénérer le code d'appairage de la caisse d'un
 * confrère.
 *
 * Le générateur de code est celui des écrans de salle, importé tel quel :
 * même alphabet sans I/O/0/1, même tirage `node:crypto`. Un second générateur
 * finirait par diverger du premier, et c'est le genre d'écart qu'on ne
 * remarque qu'au premier code devinable.
 */
@Injectable()
export class ManageDevices {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly repository: DevicesRepository,
    @Optional() private readonly revocations?: SessionRevocationPublisher,
  ) {}

  async list(tenantId: string): Promise<DeviceView[]> {
    const now = this.clock.now();
    const devices = await this.repository.list(tenantId);
    return devices.map((d) => toDeviceView(d, now));
  }

  async get(tenantId: string, id: string): Promise<DeviceView> {
    const device = await this.repository.byId(tenantId, id);
    if (!device) throw new NotFoundException('Appareil introuvable');
    return toDeviceView(device, this.clock.now());
  }

  /**
   * Création : l'appareil naît AVEC son code, prêt à saisir. Le gérant est
   * debout devant sa tablette neuve au moment où il clique ; lui demander une
   * seconde action pour obtenir le code serait un aller-retour de trop.
   */
  async create(tenantId: string, dto: DeviceCreate): Promise<DeviceView> {
    const now = this.clock.now();
    const created = await this.repository.create(tenantId, {
      name: dto.name,
      kind: dto.kind,
      pairingCode: generatePairingCode(),
      pairingCodeExpiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    });
    return toDeviceView(created, now);
  }

  async update(tenantId: string, id: string, dto: DeviceUpdate): Promise<DeviceView> {
    const updated = await this.repository.update(tenantId, id, dto);
    if (!updated) throw new NotFoundException('Appareil introuvable');
    if (dto.active !== undefined || dto.kind !== undefined) {
      await this.revocations?.device(tenantId, id);
    }
    return toDeviceView(updated, this.clock.now());
  }

  async remove(tenantId: string, id: string): Promise<{ deleted: true }> {
    const removed = await this.repository.remove(tenantId, id);
    if (!removed) throw new NotFoundException('Appareil introuvable');
    await this.revocations?.device(tenantId, id);
    return { deleted: true };
  }

  /**
   * Nouveau code d'appairage.
   *
   * Deux usages, un seul geste : le code a expiré pendant qu'on déballait la
   * tablette, ou l'appareil a été perdu — dans ce second cas l'ancien jeton
   * doit cesser d'ouvrir la caisse, ce dont le dépôt se charge.
   */
  async regenerateCode(tenantId: string, id: string): Promise<DeviceView> {
    const now = this.clock.now();
    const updated = await this.repository.resetPairing(
      tenantId,
      id,
      generatePairingCode(),
      new Date(now.getTime() + PAIRING_CODE_TTL_MS),
    );
    if (!updated) throw new NotFoundException('Appareil introuvable');
    await this.revocations?.device(tenantId, id);
    return toDeviceView(updated, now);
  }
}
