import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { Shift, Staff } from '@sm/db';
import { StaffService } from './staff.service';

const TENANT = '65f000000000000000000001';
const STAFF = '65f000000000000000000011';

describe('révocation des sessions du personnel', () => {
  it('change la version et publie après une désactivation', async () => {
    let written: Record<string, unknown> | undefined;
    const staff = {
      findOneAndUpdate: (_filter: unknown, update: { $set: Record<string, unknown> }) => {
        written = update.$set;
        return {
          lean: async () => ({
            _id: STAFF,
            tenantId: TENANT,
            name: 'Nadia',
            role: 'caisse',
            active: false,
            pinHash: 'hash',
            sessionVersion: update.$set.sessionVersion,
          }),
        };
      },
    } as unknown as Model<Staff>;
    const shifts = {
      updateMany: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    } as unknown as Model<Shift>;
    const revocations = { staff: vi.fn().mockResolvedValue(undefined) };
    const service = new StaffService(staff, shifts, revocations as never);

    const result = await service.update(TENANT, STAFF, { active: false });

    expect(written?.sessionVersion).toEqual(expect.any(String));
    expect(written?.sessionVersion).not.toBe('0');
    expect(revocations.staff).toHaveBeenCalledWith(TENANT, STAFF);
    expect(result).not.toHaveProperty('sessionVersion');
  });

  it('publie avant une éventuelle erreur de clôture du shift', async () => {
    const staff = {
      findOneAndUpdate: (_filter: unknown, update: { $set: Record<string, unknown> }) => ({
        lean: async () => ({
          _id: STAFF,
          tenantId: TENANT,
          name: 'Nadia',
          role: 'caisse',
          active: false,
          pinHash: 'hash',
          sessionVersion: update.$set.sessionVersion,
        }),
      }),
    } as unknown as Model<Staff>;
    const shifts = {
      updateMany: vi.fn().mockRejectedValue(new Error('pointage indisponible')),
    } as unknown as Model<Shift>;
    const revocations = { staff: vi.fn().mockResolvedValue(undefined) };
    const service = new StaffService(staff, shifts, revocations as never);

    await expect(service.update(TENANT, STAFF, { active: false })).rejects.toThrow(
      /pointage indisponible/,
    );
    expect(revocations.staff).toHaveBeenCalledWith(TENANT, STAFF);
  });
});
