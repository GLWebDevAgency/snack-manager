import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model } from 'mongoose';
import type { User } from '@sm/db';
import type { JwtPayload } from '@sm/contracts';
import * as argon2 from 'argon2';
import { OwnerReauthentication } from './owner-reauthentication.service';

vi.mock('argon2', () => ({ verify: vi.fn(), argon2id: 2 }));
const actor: JwtPayload = { sub: 'owner1', tenantId: 'tenant1', kind: 'user', role: 'owner' };
beforeEach(() => vi.mocked(argon2.verify).mockReset());

describe('owner financial confirmation without HR', () => {
  it('checks the tenant-scoped owner password without consulting staff', async () => {
    const findOne = vi.fn(() => ({ lean: async () => ({ passwordHash: 'hash' }) }));
    vi.mocked(argon2.verify).mockResolvedValue(true);
    await new OwnerReauthentication({ findOne } as unknown as Model<User>).verify(actor, 'password');
    expect(findOne).toHaveBeenCalledWith({ _id: 'owner1', tenantId: 'tenant1', role: 'owner', active: { $ne: false } });
    expect(argon2.verify).toHaveBeenCalledWith('hash', 'password');
  });
  it('rejects a staff session before reading credentials', async () => {
    const findOne = vi.fn();
    await expect(new OwnerReauthentication({ findOne } as unknown as Model<User>)
      .verify({ ...actor, kind: 'staff', role: 'gerant' }, 'password')).rejects.toThrow('propriétaire');
    expect(findOne).not.toHaveBeenCalled();
  });
  it('rejects a deleted or moved owner even if a comparison succeeds', async () => {
    vi.mocked(argon2.verify).mockResolvedValue(true);
    await expect(new OwnerReauthentication({ findOne: () => ({ lean: async () => null }) } as unknown as Model<User>)
      .verify(actor, 'password')).rejects.toThrow('incorrect');
  });
});
