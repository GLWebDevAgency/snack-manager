import type { JwtService } from '@nestjs/jwt';
import type { Model } from 'mongoose';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import type { Staff } from '@sm/db';
import { DevicePinLogin } from './device-pin-login.usecase';
import {
  FakeDevicesRepository,
  FakeTenantBrandRepository,
  storedDevice,
} from './devices.fakes';

const TENANT = '65f000000000000000000001';
const STAFF = '65f000000000000000000011';
const DEVICE = '65f000000000000000000021';

describe('session PIN liée à la tablette', () => {
  it('signe les deux versions nécessaires à une révocation immédiate', async () => {
    const pinHash = await argon2.hash('1234');
    const staff = {
      find: async () => [
        {
          _id: STAFF,
          tenantId: TENANT,
          name: 'Nadia',
          role: 'caisse',
          active: true,
          pinHash,
          sessionVersion: 'staff-v7',
        },
      ],
    } as unknown as Model<Staff>;
    const devices = new FakeDevicesRepository();
    devices.seed(
      storedDevice({ id: DEVICE, tenantId: TENANT, sessionVersion: 'device-v4' }),
      'device-token',
    );
    const jwt = {
      signAsync: vi.fn().mockResolvedValue('staff-jwt'),
    } as unknown as JwtService;
    const login = new DevicePinLogin(
      staff,
      devices.asRepository(),
      new FakeTenantBrandRepository().asRepository(),
      jwt,
    );

    await login.execute('device-token', '1234');

    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: STAFF,
      tenantId: TENANT,
      role: 'caisse',
      kind: 'staff',
      staffSessionVersion: 'staff-v7',
      deviceId: DEVICE,
      deviceSessionVersion: 'device-v4',
    });
  });
});
