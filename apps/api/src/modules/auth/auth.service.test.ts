import * as argon2 from 'argon2';
import type { JwtService } from '@nestjs/jwt';
import type { HydratedDocument, Model } from 'mongoose';
import type { Staff, Tenant, User } from '@sm/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, DUMMY_PASSWORD_HASH } from './auth.service';

vi.mock('argon2', () => ({
  argon2id: 2,
  hash: vi.fn(),
  needsRehash: vi.fn(),
  verify: vi.fn(),
}));

const PASSWORD = 'mot-de-passe-invalide';
const USER = {
  _id: 'user_1',
  email: 'gerant@example.com',
  name: 'Karim',
  role: 'owner',
  tenantId: 'tenant_1',
  passwordHash: '$argon2id$empreinte-reelle',
} as unknown as HydratedDocument<User>;

function harness(user: HydratedDocument<User> | null) {
  const findOne = vi.fn().mockResolvedValue(user);
  const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const signAsync = vi.fn().mockResolvedValue('jwt-signe');
  const service = new AuthService(
    { findOne, updateOne } as unknown as Model<User>,
    {} as Model<Staff>,
    {} as Model<Tenant>,
    { signAsync } as unknown as JwtService,
  );
  return { service, findOne, updateOne, signAsync };
}

const verify = vi.mocked(argon2.verify);
const hash = vi.mocked(argon2.hash);
const needsRehash = vi.mocked(argon2.needsRehash);

describe('AuthService.login — même coût de vérification', () => {
  beforeEach(() => {
    verify.mockReset();
    hash.mockReset();
    hash.mockResolvedValue('$argon2id$empreinte-renouvelee');
    needsRehash.mockReset();
    needsRehash.mockReturnValue(false);
  });

  it('vérifie une fois le hash factice quand le compte est inconnu', async () => {
    verify.mockResolvedValue(false);
    const { service, signAsync } = harness(null);

    await expect(
      service.login({ email: 'INCONNU@EXAMPLE.COM', password: PASSWORD }),
    ).rejects.toMatchObject({ message: 'Identifiants invalides', status: 401 });

    expect(verify).toHaveBeenCalledExactlyOnceWith(DUMMY_PASSWORD_HASH, PASSWORD);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('vérifie une fois le vrai hash puis rend exactement le même refus', async () => {
    verify.mockResolvedValue(false);
    const { service } = harness(USER);

    await expect(
      service.login({ email: USER.email, password: PASSWORD }),
    ).rejects.toMatchObject({ message: 'Identifiants invalides', status: 401 });

    expect(verify).toHaveBeenCalledExactlyOnceWith(USER.passwordHash, PASSWORD);
  });

  it("refuse toujours l'inconnu même si le vérificateur factice rend true", async () => {
    verify.mockResolvedValue(true);
    const { service, signAsync } = harness(null);
    await expect(
      service.login({ email: 'inconnu@example.com', password: PASSWORD }),
    ).rejects.toMatchObject({ status: 401 });
    expect(verify).toHaveBeenCalledOnce();
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('refuse un document présent sans empreinte même si le dummy rend true', async () => {
    verify.mockResolvedValue(true);
    const broken = { ...USER, passwordHash: undefined } as unknown as HydratedDocument<User>;
    const { service, signAsync } = harness(broken);
    await expect(
      service.login({ email: USER.email, password: PASSWORD }),
    ).rejects.toMatchObject({ status: 401 });
    expect(verify).toHaveBeenCalledExactlyOnceWith(DUMMY_PASSWORD_HASH, PASSWORD);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('paie le dummy puis rend le même 401 si une empreinte utilisateur est tronquée', async () => {
    needsRehash.mockImplementationOnce(() => {
      throw new Error('phc illisible');
    });
    verify.mockRejectedValueOnce(new Error('phc illisible')).mockResolvedValueOnce(false);
    const corrupt = {
      ...USER,
      passwordHash: '$argon2id$v=19$cassé',
    } as unknown as HydratedDocument<User>;
    const { service, signAsync } = harness(corrupt);

    await expect(
      service.login({ email: USER.email, password: PASSWORD }),
    ).rejects.toMatchObject({ message: 'Identifiants invalides', status: 401 });
    expect(verify).toHaveBeenNthCalledWith(1, corrupt.passwordHash, PASSWORD);
    expect(verify).toHaveBeenNthCalledWith(2, DUMMY_PASSWORD_HASH, PASSWORD);
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('conserve à l’identique le succès et normalise l’e-mail de recherche', async () => {
    verify.mockResolvedValue(true);
    const { service, findOne, signAsync } = harness(USER);

    await expect(
      service.login({ email: 'GERANT@EXAMPLE.COM', password: 'mot-de-passe-valide' }),
    ).resolves.toEqual({
      token: 'jwt-signe',
      user: {
        email: USER.email,
        name: USER.name,
        role: USER.role,
        tenantId: 'tenant_1',
      },
    });
    expect(findOne).toHaveBeenCalledWith({ email: 'gerant@example.com' });
    expect(verify).toHaveBeenCalledExactlyOnceWith(USER.passwordHash, 'mot-de-passe-valide');
    expect(signAsync).toHaveBeenCalledOnce();
  });

  it('rehash une ancienne cohorte après succès avec un compare-and-set', async () => {
    verify.mockResolvedValue(true);
    needsRehash.mockReturnValue(true);
    const { service, updateOne } = harness(USER);

    await service.login({ email: USER.email, password: 'mot-de-passe-valide' });

    expect(verify).toHaveBeenNthCalledWith(1, USER.passwordHash, 'mot-de-passe-valide');
    expect(verify).toHaveBeenNthCalledWith(2, DUMMY_PASSWORD_HASH, 'mot-de-passe-valide');
    expect(hash).toHaveBeenCalledWith('mot-de-passe-valide', {
      type: argon2.argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 4,
    });
    expect(updateOne).toHaveBeenCalledWith(
      { _id: USER._id, passwordHash: USER.passwordHash },
      { $set: { passwordHash: '$argon2id$empreinte-renouvelee' } },
    );
  });
});
