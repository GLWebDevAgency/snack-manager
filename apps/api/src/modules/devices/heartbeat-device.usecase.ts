import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  isAccessBlocked,
  type DeviceHeartbeatResult,
  type DeviceTelemetry,
} from '@sm/contracts';
import { CLOCK, type Clock } from './devices.tokens';
import { requirePairedDevice } from './device-access';
import { DevicesRepository } from './devices.repository';
import { toDeviceIdentity } from './devices.view';
import { TenantBrandRepository } from './tenant-brand.repository';

/**
 * CAS D'USAGE — battement de cœur d'une caisse ou d'un écran cuisine.
 *
 * Il rend deux services à la fois, et c'est voulu :
 *
 *  1. il date le dernier signe de vie, seule source du « hors ligne depuis
 *     12 min » du back-office. Une caisse muette en plein service est le seul
 *     incident qui coûte de l'argent à la minute ;
 *  2. il renvoie la marque à jour. Renommer l'établissement ou changer son
 *     accent depuis le back-office se voit sur la tablette au battement
 *     suivant, sans réappairage — la charte vit côté serveur, pas dans une
 *     constante recompilée.
 */
@Injectable()
export class HeartbeatDevice {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly devices: DevicesRepository,
    private readonly tenants: TenantBrandRepository,
  ) {}

  async execute(
    deviceToken: string | null,
    telemetry?: DeviceTelemetry,
  ): Promise<DeviceHeartbeatResult> {
    const device = await requirePairedDevice(this.devices, deviceToken);
    const now = this.clock.now();

    await this.devices.touch(device.id, now, telemetry);

    const [tenant, status] = await Promise.all([
      this.tenants.byId(device.tenantId),
      this.tenants.accountStatus(device.tenantId),
    ]);
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    return {
      ok: true,
      at: now.toISOString(),
      tenant,
      device: toDeviceIdentity(device),
      // Volontairement `true` ou absent, jamais `false` : la caisse d'un client
      // à jour ne transporte rien de plus à chaque battement.
      //
      // Statut STOCKÉ : seule la suspension compte pour une tablette, et
      // `statutEffectif` ne joue qu'entre essai et actif — deux états qui
      // n'ont jamais suspendu personne.
      ...(isAccessBlocked(status) ? { suspended: true } : {}),
    };
  }
}
