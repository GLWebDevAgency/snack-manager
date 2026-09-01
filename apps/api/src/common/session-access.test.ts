import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_SUSPENDED_CODE,
  ACCOUNT_SUSPENDED_MESSAGE,
  type JwtPayload,
} from '@sm/contracts';
import type { Device, Staff, Tenant } from '@sm/db';
import { SessionAccessService } from './session-access';

const TENANT = '65f000000000000000000001';
const STAFF = '65f000000000000000000011';
const DEVICE = '65f000000000000000000021';

type State = {
  tenant: Record<string, unknown> | null;
  member: Record<string, unknown> | null;
  device: Record<string, unknown> | null;
};

function service(state: Partial<State> = {}): SessionAccessService {
  const current: State = {
    tenant: { account: { status: 'active' } },
    member: {
      _id: STAFF,
      tenantId: TENANT,
      role: 'caisse',
      active: true,
      sessionVersion: 'staff-v1',
    },
    device: {
      _id: DEVICE,
      tenantId: TENANT,
      paired: true,
      active: true,
      sessionVersion: 'device-v1',
    },
    ...state,
  };

  const tenants = {
    findById: () => ({ lean: async () => current.tenant }),
  } as unknown as Model<Tenant>;
  const staff = {
    findOne: () => ({ lean: async () => current.member }),
  } as unknown as Model<Staff>;
  const devices = {
    findOne: () => ({ lean: async () => current.device }),
  } as unknown as Model<Device>;
  return new SessionAccessService(tenants, staff, devices);
}

const owner = (tenantId: string | null = TENANT): JwtPayload => ({
  sub: '65f000000000000000000031',
  tenantId,
  role: 'owner',
  kind: 'user',
  exp: 4_102_444_800,
});

const staffSession = (patch: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: STAFF,
  tenantId: TENANT,
  role: 'caisse',
  kind: 'staff',
  staffSessionVersion: 'staff-v1',
  deviceId: DEVICE,
  deviceSessionVersion: 'device-v1',
  exp: 4_102_444_800,
  ...patch,
});

describe('autorité de session commune HTTP / WebSocket', () => {
  it('laisse travailler un tenant actif, historique ou parti', async () => {
    await expect(service().assertAllows(owner())).resolves.toBeUndefined();
    await expect(service({ tenant: {} }).assertAllows(owner())).resolves.toBeUndefined();
    await expect(
      service({ tenant: { account: { status: 'churned' } } }).assertAllows(owner()),
    ).resolves.toBeUndefined();
  });

  it('rend la suspension lisible avec le contrat attendu par le web', async () => {
    const error = await service({ tenant: { account: { status: 'suspended' } } })
      .assertAllows(owner())
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ForbiddenException);
    const response = (error as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(response.code).toBe(ACCOUNT_SUSPENDED_CODE);
    expect(response.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
  });

  it('refuse un tenant disparu ou un identifiant non castable', async () => {
    await expect(service({ tenant: null }).assertAllows(owner())).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service().assertAllows(owner('tenant-forgé'))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('conserve l’accès de l’équipe SM nécessaire à la réactivation', async () => {
    await expect(
      service({ tenant: { account: { status: 'suspended' } } }).assertAllows({
        sub: '65f000000000000000000099',
        tenantId: null,
        role: 'sm_admin',
        kind: 'user',
        exp: 4_102_444_800,
      }),
    ).resolves.toBeUndefined();
  });

  it('admet uniquement une session staff encore liée au rôle et à la tablette', async () => {
    await expect(service().assertAllows(staffSession())).resolves.toBeUndefined();

    await expect(
      service({ member: { role: 'cuisine', active: true, sessionVersion: 'staff-v1' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service({ member: { role: 'caisse', active: false, sessionVersion: 'staff-v1' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service({ member: { role: 'caisse', active: true, sessionVersion: 'staff-v2' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuse la tablette révoquée, réappairée ou désactivée', async () => {
    await expect(
      service({ device: { paired: false, active: true, sessionVersion: 'device-v1' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service({ device: { paired: true, active: false, sessionVersion: 'device-v1' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service({ device: { paired: true, active: true, sessionVersion: 'device-v2' } })
        .assertAllows(staffSession()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuse les anciens JWT staff non liés et force une nouvelle saisie du PIN', async () => {
    await expect(
      service().assertAllows({
        sub: STAFF,
        tenantId: TENANT,
        role: 'caisse',
        kind: 'staff',
        exp: 4_102_444_800,
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('refuse une session expirée même si Mongo répond encore favorablement', async () => {
    await expect(
      service().assertAllows({ ...owner(), exp: Math.floor(Date.now() / 1_000) - 1 }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('recontrôle exp après une lecture Mongo qui franchit l’échéance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
    try {
      let release!: () => void;
      const tenants = {
        findById: () => ({
          lean: () =>
            new Promise<Record<string, unknown>>((resolve) => {
              release = () => resolve({ account: { status: 'active' } });
            }),
        }),
      } as unknown as Model<Tenant>;
      const empty = { findOne: () => ({ lean: async () => null }) };
      const access = new SessionAccessService(
        tenants,
        empty as unknown as Model<Staff>,
        empty as unknown as Model<Device>,
      );
      const pending = access.assertAllows({
        ...owner(),
        exp: Math.floor(Date.now() / 1_000) + 1,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      release();

      await expect(pending).rejects.toThrow(UnauthorizedException);
    } finally {
      vi.useRealTimers();
    }
  });
});
