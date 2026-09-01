import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import type { DeviceKind, DeviceTelemetry } from '@sm/contracts';
import type { Device } from '@sm/db';

/**
 * Un appareil tel qu'il est stocké, SANS son jeton.
 *
 * L'omission est délibérée, comme sur les écrans de salle : le secret ne sort
 * du dépôt qu'au moment de l'appairage, par le seul chemin qui en a besoin. Un
 * champ absent du type ne peut pas se retrouver par mégarde dans une réponse
 * de back-office.
 */
export interface StoredDevice {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly kind: DeviceKind;
  readonly pairingCode: string | null;
  readonly pairingCodeExpiresAt: Date | null;
  readonly paired: boolean;
  readonly lastSeenAt: Date | null;
  readonly active: boolean;
  /** Version serveur de l'appairage, jamais exposée dans les vues publiques. */
  readonly sessionVersion: string;
  /** Télémétrie du dernier battement — vides tant qu'un client ne l'envoie pas. */
  readonly appVersion: string;
  readonly queueDepth: number | null;
  readonly lastError: string;
}

export interface NewDevice {
  readonly name: string;
  readonly kind: DeviceKind;
  readonly pairingCode: string;
  readonly pairingCodeExpiresAt: Date;
}

export interface DevicePatch {
  readonly name?: string;
  readonly kind?: DeviceKind;
  readonly active?: boolean;
}

type RawDevice = Device & { _id: unknown };

function toStored(raw: RawDevice): StoredDevice {
  return {
    id: String(raw._id),
    tenantId: String(raw.tenantId),
    name: String(raw.name ?? ''),
    kind: (raw.kind ?? 'pos') as DeviceKind,
    pairingCode: raw.pairingCode ?? null,
    pairingCodeExpiresAt: raw.pairingCodeExpiresAt ?? null,
    paired: raw.paired === true,
    lastSeenAt: raw.lastSeenAt ?? null,
    active: raw.active !== false,
    sessionVersion: String(raw.sessionVersion ?? '0'),
    appVersion: String(raw.appVersion ?? ''),
    queueDepth: typeof raw.queueDepth === 'number' ? raw.queueDepth : null,
    lastError: String(raw.lastError ?? ''),
  };
}

@Injectable()
export class DevicesRepository {
  constructor(@InjectModel('Device') private readonly devices: Model<Device>) {}

  async list(tenantId: string): Promise<StoredDevice[]> {
    const rows = await this.devices.find({ tenantId }).sort({ createdAt: -1 }).lean();
    return rows.map((r) => toStored(r as RawDevice));
  }

  async byId(tenantId: string, id: string): Promise<StoredDevice | null> {
    // Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou,
    // Mongoose lève une CastError et le client reçoit un 500 au lieu d'un 404.
    if (!Types.ObjectId.isValid(id)) return null;
    const raw = await this.devices.findOne({ _id: id, tenantId }).lean();
    return raw ? toStored(raw as RawDevice) : null;
  }

  async create(tenantId: string, device: NewDevice): Promise<StoredDevice> {
    const created = await this.devices.create({ ...device, tenantId });
    return toStored(created.toObject() as RawDevice);
  }

  async update(tenantId: string, id: string, patch: DevicePatch): Promise<StoredDevice | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const $set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) $set[key] = value;
    }
    // Type et activation changent les droits effectifs de l'appareil. Une
    // nouvelle version empêche un JWT antérieur de ressusciter après retour
    // à l'état actif.
    if (patch.kind !== undefined || patch.active !== undefined) {
      $set.sessionVersion = randomUUID();
    }
    const raw = await this.devices
      .findOneAndUpdate({ _id: id, tenantId }, { $set }, { new: true })
      .lean();
    return raw ? toStored(raw as RawDevice) : null;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.devices.deleteOne({ _id: id, tenantId });
    return res.deletedCount > 0;
  }

  /**
   * Repose un code d'appairage neuf.
   *
   * Remet aussi `paired` et `deviceToken` à zéro : régénérer un code, c'est
   * dire « cette tablette est à réinstaller ». L'ancien jeton doit cesser
   * d'ouvrir la caisse — c'est le seul geste qui protège une tablette volée.
   */
  async resetPairing(
    tenantId: string,
    id: string,
    code: string,
    expiresAt: Date,
  ): Promise<StoredDevice | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const raw = await this.devices
      .findOneAndUpdate(
        { _id: id, tenantId },
        {
          $set: {
            pairingCode: code,
            pairingCodeExpiresAt: expiresAt,
            paired: false,
            deviceToken: null,
            lastSeenAt: null,
            sessionVersion: randomUUID(),
          },
        },
        { new: true },
      )
      .lean();
    return raw ? toStored(raw as RawDevice) : null;
  }

  /**
   * Cherche un appareil par son code, TOUS établissements confondus : la
   * tablette qui s'appaire ne sait pas encore à quel restaurant elle
   * appartient — c'est précisément ce que le code lui apprend.
   */
  async findByPairingCode(code: string): Promise<StoredDevice | null> {
    const raw = await this.devices.findOne({ pairingCode: code }).lean();
    return raw ? toStored(raw as RawDevice) : null;
  }

  /**
   * Consomme le code et scelle l'appairage, en UNE écriture conditionnée au
   * code encore présent. Deux tablettes lancées sur le même code — cela arrive
   * quand on déballe la caisse et l'écran cuisine d'affilée — n'obtiennent
   * jamais deux jetons valides.
   */
  async claim(
    id: string,
    code: string,
    expectedKind: DeviceKind,
    deviceToken: string,
    at: Date,
  ): Promise<boolean> {
    const res = await this.devices.updateOne(
      // Le type participe à l'écriture conditionnelle : même si un autre
      // administrateur le change entre la lecture du code et ce claim, aucun
      // jeton de la mauvaise surface n'est délivré.
      { _id: id, pairingCode: code, kind: expectedKind },
      {
        $set: {
          pairingCode: null,
          pairingCodeExpiresAt: null,
          paired: true,
          deviceToken,
          lastSeenAt: at,
        },
      },
    );
    return res.modifiedCount > 0;
  }

  async findByDeviceToken(deviceToken: string): Promise<StoredDevice | null> {
    const raw = await this.devices.findOne({ deviceToken, paired: true }).lean();
    return raw ? toStored(raw as RawDevice) : null;
  }

  /**
   * Battement de cœur — source du « hors ligne depuis 12 min » du back-office,
   * et désormais de la télémétrie (version, file, dernière erreur). Sans
   * télémétrie (vieux client, corps vide), seule la date bouge : un battement
   * pauvre n'efface pas ce qu'un battement riche a appris.
   */
  async touch(id: string, at: Date, telemetry?: DeviceTelemetry): Promise<void> {
    await this.devices.updateOne(
      { _id: id },
      { $set: { lastSeenAt: at, ...(telemetry ?? {}) } },
    );
  }
}
