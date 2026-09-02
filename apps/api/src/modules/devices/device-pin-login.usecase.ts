import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import * as argon2 from 'argon2';
import {
  ACCOUNT_SUSPENDED_MESSAGE,
  isAccessBlocked,
  type DevicePinSession,
  type JwtPayload,
} from '@sm/contracts';
import type { Staff } from '@sm/db';
import { requirePairedDevice } from './device-access';
import { DevicesRepository } from './devices.repository';
import { toDeviceIdentity } from './devices.view';
import { TenantBrandRepository } from './tenant-brand.repository';

/**
 * CAS D'USAGE — ouverture de service par PIN, DEPUIS un appareil appairé.
 *
 * C'est le pivot de tout ce module. L'ancienne connexion de la caisse
 * demandait `{ tenantSlug, pin }` : l'établissement venait donc du CORPS de la
 * requête, c'est-à-dire du client, c'est-à-dire d'une constante compilée dans
 * l'application (`TENANT_SLUG = 'classfood'`). Un seul restaurant servi, et un
 * slug devinable comme seule barrière.
 *
 * Ici l'établissement est déduit du jeton d'appareil et de lui seul. La
 * tablette ne peut pas demander à ouvrir un service ailleurs, même en
 * tâtonnant : elle n'a aucun moyen de nommer un autre restaurant.
 *
 * L'ancienne route `POST /auth/pin { tenantSlug, pin }` reste en place et
 * inchangée : rien de ce qui tourne aujourd'hui ne casse.
 */
@Injectable()
export class DevicePinLogin {
  constructor(
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    private readonly devices: DevicesRepository,
    private readonly tenants: TenantBrandRepository,
    private readonly jwt: JwtService,
  ) {}

  async execute(deviceToken: string | null, pin: string): Promise<DevicePinSession> {
    const device = await requirePairedDevice(this.devices, deviceToken);

    // Abonnement suspendu : on refuse D'OUVRIR le service, avant même de
    // regarder le PIN. Le jeton d'appareil ne passe pas par le guard global —
    // sans ce contrôle ici, une caisse déjà installée continuerait d'encaisser
    // pour un client qu'on a coupé, ce qui viderait la suspension de son sens.
    // L'équipe lit le motif réel : elle est du côté du restaurant, c'est elle
    // qui préviendra le gérant.
    //
    // STATUT STOCKÉ, et c'est suffisant : `statutEffectif` ne transforme qu'un
    // essai en actif, deux statuts auxquels `isAccessBlocked` répond faux. La
    // dérivation ne changerait donc rien ici — et un essai échu ne doit surtout
    // pas fermer une caisse en plein service.
    if (isAccessBlocked(await this.tenants.accountStatus(device.tenantId))) {
      throw new ForbiddenException(ACCOUNT_SUSPENDED_MESSAGE);
    }

    const tenant = await this.tenants.byId(device.tenantId);
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    // Le PIN est haché : il faut le comparer membre par membre. L'équipe d'un
    // snack tient sur les doigts d'une main, la boucle est sans conséquence.
    const members = await this.staff.find({ tenantId: device.tenantId, active: true });
    for (const member of members) {
      if (await argon2.verify(member.pinHash, pin)) {
        const payload: JwtPayload = {
          sub: String(member._id),
          tenantId: device.tenantId,
          role: member.role,
          kind: 'staff',
          staffSessionVersion: String(member.sessionVersion ?? '0'),
          deviceId: device.id,
          deviceSessionVersion: device.sessionVersion,
        };
        return {
          token: await this.jwt.signAsync(payload),
          staff: { name: member.name, role: member.role },
          tenant,
          device: toDeviceIdentity(device),
        };
      }
    }
    throw new UnauthorizedException('PIN invalide');
  }
}
