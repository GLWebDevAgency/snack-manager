import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ACCOUNT_SUSPENDED_CODE,
  ACCOUNT_SUSPENDED_MESSAGE,
  isAccessBlocked,
  type JwtPayload,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Device, Staff, Tenant, User } from '@sm/db';

type UserSessionRow = {
  tenantId?: unknown;
  role?: unknown;
  sessionVersion?: unknown;
};

type StaffSessionRow = {
  tenantId: unknown;
  role: unknown;
  active?: boolean;
  sessionVersion?: unknown;
};

type DeviceSessionRow = {
  tenantId: unknown;
  paired?: boolean;
  active?: boolean;
  sessionVersion?: unknown;
};

const sessionVersion = (value: unknown): string => String(value ?? '0');
const tenantRef = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/**
 * Autorité de session commune aux requêtes HTTP et aux rooms WebSocket.
 *
 * Un JWT prouve qu'une session a été émise ; il ne prouve pas que le salarié,
 * la tablette ou l'abonnement sont ENCORE autorisés. Cette lecture commune
 * empêche les deux transports de diverger au prochain ajout de règle.
 */
@Injectable()
export class SessionAccessService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Staff') private readonly staff: Model<Staff>,
    @InjectModel('Device') private readonly devices: Model<Device>,
    @InjectModel('User') private readonly users: Model<User>,
  ) {}

  async assertAllows(user: JwtPayload): Promise<void> {
    if (user.kind !== 'user' && user.kind !== 'staff') throw new UnauthorizedException();
    this.assertNotExpired(user);

    if (user.kind === 'user') {
      await this.assertUserSessionAllows(user);
      // L'équipe Snack Manager doit pouvoir rouvrir un client suspendu depuis
      // son back-office. La version du compte vient toutefois d'être relue :
      // cette exception métier ne ressuscite jamais un ancien JWT.
      if (user.role === 'sm_admin') return;
    }

    if (!user.tenantId || !Types.ObjectId.isValid(user.tenantId)) {
      throw new UnauthorizedException();
    }

    await this.assertTenantAllows(user.tenantId);

    if (user.kind === 'staff') await this.assertStaffDeviceAllows(user);
    // L'expiration peut tomber pendant les lectures Mongo. Le contrôle final
    // empêche leur résultat, pourtant valide à leur départ, d'autoriser une
    // requête ou une émission après `exp`.
    this.assertNotExpired(user);
  }

  /**
   * Valide l'identité utilisateur sans lire l'état commercial du tenant.
   *
   * Cette frontière publique sert à l'unique route de facturation qui reste
   * accessible à un owner suspendu. Elle conserve la révocation du compte tout
   * en laissant `assertAllows` porter la règle d'abonnement générale.
   */
  async assertUserSessionAllows(user: JwtPayload): Promise<void> {
    if (user.kind !== 'user') throw new UnauthorizedException();
    this.assertNotExpired(user);
    await this.assertUserRecordAllows(user);
    this.assertNotExpired(user);
  }

  private assertNotExpired(user: JwtPayload): void {
    if (!Number.isFinite(user.exp) || user.exp! * 1_000 <= Date.now()) {
      throw new UnauthorizedException();
    }
  }

  private async assertTenantAllows(tenantId: string): Promise<void> {
    const tenant = await this.tenants
      .findById(tenantId, { 'account.status': 1 })
      .lean<{ account?: { status?: TenantAccountStatus } } | null>();

    if (!tenant) throw new UnauthorizedException();

    // L'absence du champ vaut « actif » pour le parc historique. Seul le
    // statut explicitement suspendu bloque ; trial et churned restent ouverts.
    // ── POURQUOI LE STATUT STOCKÉ SUFFIT ICI ──
    //
    // `statutEffectif` (@sm/contracts) ne transforme QU'UN essai en actif, et
    // `isAccessBlocked` répond faux aux deux : la dérivation ne changerait donc
    // aucune décision de cette garde, tout en obligeant à ouvrir la projection
    // sur `account.trialEndsAt` — un champ que la fiche des tenants tient
    // délibérément hors de portée des surfaces de terrain (cf. `TENANT_FIELDS`,
    // tenants.service). Une garde d'ACCÈS lit le statut stocké ; ce sont les
    // surfaces qui FACTURENT ou qui AFFICHENT qui lisent l'effectif.
    if (isAccessBlocked(tenant.account?.status)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: ACCOUNT_SUSPENDED_MESSAGE,
        code: ACCOUNT_SUSPENDED_CODE,
      });
    }
  }

  private async assertUserRecordAllows(user: JwtPayload): Promise<void> {
    if (
      !Types.ObjectId.isValid(user.sub) ||
      typeof user.userSessionVersion !== 'string'
    ) {
      // Les JWT antérieurs à la version de session sont volontairement fermés :
      // une reconnexion unique les remplace par un jeton révocable.
      throw new UnauthorizedException();
    }

    const stored = await this.users
      .findById(user.sub, { tenantId: 1, role: 1, sessionVersion: 1 })
      .lean<UserSessionRow | null>();

    if (
      !stored ||
      stored.role !== user.role ||
      tenantRef(stored.tenantId) !== user.tenantId ||
      sessionVersion(stored.sessionVersion) !== user.userSessionVersion
    ) {
      throw new UnauthorizedException();
    }
  }

  private async assertStaffDeviceAllows(user: JwtPayload): Promise<void> {
    if (
      !Types.ObjectId.isValid(user.sub) ||
      !user.deviceId ||
      !Types.ObjectId.isValid(user.deviceId) ||
      typeof user.staffSessionVersion !== 'string' ||
      typeof user.deviceSessionVersion !== 'string'
    ) {
      // Jeton staff antérieur à la liaison appareil : une seule nouvelle
      // saisie du PIN le remplace par un jeton révocable.
      throw new UnauthorizedException();
    }

    const [member, device] = await Promise.all([
      this.staff
        .findOne(
          { _id: user.sub, tenantId: user.tenantId },
          { role: 1, active: 1, sessionVersion: 1, tenantId: 1 },
        )
        .lean<StaffSessionRow | null>(),
      this.devices
        .findOne(
          { _id: user.deviceId, tenantId: user.tenantId },
          { paired: 1, active: 1, sessionVersion: 1, tenantId: 1 },
        )
        .lean<DeviceSessionRow | null>(),
    ]);

    if (
      !member ||
      member.active === false ||
      member.role !== user.role ||
      sessionVersion(member.sessionVersion) !== user.staffSessionVersion
    ) {
      throw new UnauthorizedException();
    }

    if (
      !device ||
      device.active === false ||
      device.paired !== true ||
      sessionVersion(device.sessionVersion) !== user.deviceSessionVersion
    ) {
      throw new UnauthorizedException();
    }
  }
}
