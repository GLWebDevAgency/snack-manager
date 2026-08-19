import type { Clock } from '@sm/domain';
import type { DeviceTenantBrand } from '@sm/contracts';
import type {
  DevicePatch,
  DevicesRepository,
  NewDevice,
  StoredDevice,
} from './devices.repository';
import type { TenantBrandRepository } from './tenant-brand.repository';

/**
 * Doublures de test des appareils de terrain.
 *
 * Les cas d'usage ne dépendent que d'un dépôt, d'un modèle de lecture de la
 * marque et d'une horloge : l'expiration d'un code à un quart d'heure et
 * l'usage unique se vérifient en millisecondes, sans Mongo et sans attendre.
 */

/** Horloge figée — sans elle, l'expiration d'un code est intestable. */
export class TestClock implements Clock {
  constructor(private instant = new Date('2026-08-19T10:00:00Z')) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date | string): void {
    this.instant = new Date(instant);
  }

  advanceMinutes(minutes: number): void {
    this.instant = new Date(this.instant.getTime() + minutes * 60_000);
  }
}

export const CLASSFOOD_BRAND: DeviceTenantBrand = {
  slug: 'classfood',
  name: "Class'Food",
  brandColor: '#c9a15a',
  logoUrl: null,
};

export function storedDevice(patch: Partial<StoredDevice> = {}): StoredDevice {
  return {
    id: 'device-1',
    tenantId: '65f000000000000000000001',
    name: 'Caisse comptoir',
    kind: 'pos',
    pairingCode: null,
    pairingCodeExpiresAt: null,
    paired: true,
    lastSeenAt: null,
    active: true,
    ...patch,
  };
}

/** Dépôt en mémoire — mêmes garanties d'unicité que la version Mongo. */
export class FakeDevicesRepository {
  private readonly rows = new Map<string, StoredDevice>();
  private readonly tokens = new Map<string, string>(); // jeton → id d'appareil
  private sequence = 0;

  seed(device: StoredDevice, deviceToken?: string): StoredDevice {
    this.rows.set(device.id, device);
    if (deviceToken) this.tokens.set(deviceToken, device.id);
    return device;
  }

  async list(tenantId: string): Promise<StoredDevice[]> {
    return [...this.rows.values()].filter((d) => d.tenantId === tenantId);
  }

  async byId(tenantId: string, id: string): Promise<StoredDevice | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async create(tenantId: string, device: NewDevice): Promise<StoredDevice> {
    const created = storedDevice({
      id: `device-${++this.sequence}`,
      tenantId,
      name: device.name,
      kind: device.kind,
      pairingCode: device.pairingCode,
      pairingCodeExpiresAt: device.pairingCodeExpiresAt,
      paired: false,
    });
    this.rows.set(created.id, created);
    return created;
  }

  async update(tenantId: string, id: string, patch: DevicePatch): Promise<StoredDevice | null> {
    const row = await this.byId(tenantId, id);
    if (!row) return null;
    const updated: StoredDevice = { ...row };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) Object.assign(updated, { [key]: value });
    }
    this.rows.set(id, updated);
    return updated;
  }

  async remove(tenantId: string, id: string): Promise<boolean> {
    const row = await this.byId(tenantId, id);
    if (!row) return false;
    this.rows.delete(id);
    return true;
  }

  async resetPairing(
    tenantId: string,
    id: string,
    code: string,
    expiresAt: Date,
  ): Promise<StoredDevice | null> {
    const row = await this.byId(tenantId, id);
    if (!row) return null;
    // Régénérer révoque l'ancien jeton : c'est tout l'intérêt du geste.
    for (const [token, deviceId] of this.tokens) {
      if (deviceId === id) this.tokens.delete(token);
    }
    const updated: StoredDevice = {
      ...row,
      pairingCode: code,
      pairingCodeExpiresAt: expiresAt,
      paired: false,
      lastSeenAt: null,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async findByPairingCode(code: string): Promise<StoredDevice | null> {
    return [...this.rows.values()].find((d) => d.pairingCode === code) ?? null;
  }

  async claim(id: string, code: string, deviceToken: string, at: Date): Promise<boolean> {
    const row = this.rows.get(id);
    // Même condition que l'écriture Mongo : le code doit être ENCORE posé.
    if (!row || row.pairingCode !== code) return false;
    this.rows.set(id, {
      ...row,
      pairingCode: null,
      pairingCodeExpiresAt: null,
      paired: true,
      lastSeenAt: at,
    });
    this.tokens.set(deviceToken, id);
    return true;
  }

  async findByDeviceToken(deviceToken: string): Promise<StoredDevice | null> {
    const id = this.tokens.get(deviceToken);
    const row = id ? this.rows.get(id) : undefined;
    return row?.paired ? row : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, lastSeenAt: at });
  }

  asRepository(): DevicesRepository {
    return this as unknown as DevicesRepository;
  }
}

/** Modèle de lecture en mémoire de l'identité visuelle du restaurant. */
export class FakeTenantBrandRepository {
  constructor(private brand: DeviceTenantBrand | null = CLASSFOOD_BRAND) {}

  set(brand: DeviceTenantBrand | null): void {
    this.brand = brand;
  }

  async byId(): Promise<DeviceTenantBrand | null> {
    return this.brand;
  }

  asRepository(): TenantBrandRepository {
    return this as unknown as TenantBrandRepository;
  }
}
