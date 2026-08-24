import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { JwtPayload } from '@sm/contracts';
import type { Lead, Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import type { AdminService } from './admin.service';
import { ConversionService, generatePassword } from './conversion.service';

/**
 * SIGNER — le geste complet, vérifié pièce par pièce : le tenant naît en
 * essai daté, le compte gérant naît haché, le lead se marque, le journal
 * s'écrit, et le mot de passe ne sort qu'UNE fois. Les doublures suivent la
 * règle maison : elles ne savent faire QUE ce que le service appelle.
 */

const NOW = new Date('2026-08-24T12:00:00.000Z');
const LEAD_ID = new Types.ObjectId().toHexString();
const ACTOR: JwtPayload = { sub: new Types.ObjectId().toHexString(), tenantId: null, role: 'sm_admin' } as JwtPayload;

const leadDoc = () => ({
  _id: new Types.ObjectId(LEAD_ID),
  restaurantName: 'Chez Nicolas',
  stage: 'proposition',
  founderSeatReserved: true,
});

function build(over: {
  slugTaken?: boolean;
  emailTaken?: boolean;
  userCreateFails?: boolean;
  lead?: ReturnType<typeof leadDoc> | null;
} = {}) {
  const tenantId = new Types.ObjectId();
  const leads = {
    findById: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.lead === undefined ? leadDoc() : over.lead) }),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const tenants = {
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.slugTaken ? { _id: 'x' } : null) }),
    create: vi.fn().mockImplementation((doc: Record<string, unknown>) => Promise.resolve({ _id: tenantId, ...doc })),
    deleteOne: vi.fn().mockResolvedValue({}),
  };
  const users = {
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.emailTaken ? { _id: 'u' } : null) }),
    create: over.userCreateFails
      ? vi.fn().mockRejectedValue(new Error('duplicate key'))
      : vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const hasher: SecretHasher = {
    providerName: 'fake',
    hash: vi.fn().mockImplementation((s: string) => Promise.resolve(`empreinte(${s})`)),
    verify: vi.fn().mockResolvedValue(true),
  };
  const admin = {
    recordTenantCreation: vi.fn().mockResolvedValue({}),
    recordOwnerReset: vi.fn().mockResolvedValue({}),
  };
  const service = new ConversionService(
    leads as unknown as Model<Lead>,
    tenants as unknown as Model<Tenant>,
    users as unknown as Model<User>,
    hasher,
    admin as unknown as AdminService,
  );
  return { service, leads, tenants, users, admin, tenantId };
}

const BODY = {
  slug: 'chez-nicolas',
  ownerEmail: 'Nicolas@Exemple.fr',
  ownerName: 'Nicolas',
  plan: 'complet' as const,
  founderSeat: true,
};

describe('Mot de passe généré', () => {
  it('trois groupes de quatre, alphabet sans ambiguïté', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(password).not.toMatch(/[01loi]/);
  });

  it('déterministe sous un tirage imposé — c’est bien le tirage qui décide', () => {
    expect(generatePassword(() => 0)).toBe('aaaa-aaaa-aaaa');
  });
});

describe('Convertir un lead en restaurant', () => {
  it('crée le tenant en essai daté, le compte haché, marque le lead, journalise', async () => {
    const { service, leads, tenants, users, admin, tenantId } = build();
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);

    // Le tenant : essai de 30 jours, échéance POSÉE, place fondateur portée.
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.slug).toBe('chez-nicolas');
    expect(tenant.name).toBe('Chez Nicolas');
    expect(tenant.founderSeat).toBe(true);
    expect(tenant.account.status).toBe('trial');
    expect(tenant.account.trialEndsAt).toEqual(new Date('2026-09-23T12:00:00.000Z'));

    // Le compte : e-mail abaissé, jamais le mot de passe en clair.
    const user = users.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(user.email).toBe('nicolas@exemple.fr');
    expect(user.role).toBe('owner');
    // C'est la SORTIE DU HACHEUR qui est stockée, jamais le mot de passe nu
    // (la doublure encapsule exprès : l'égalité prouve le passage par hash()).
    expect(user.passwordHash).toBe(`empreinte(${result.password})`);
    expect(user.passwordHash).not.toBe(result.password);

    // Le lead : signé, la réservation s'éteint (la place vit sur le tenant).
    const update = leads.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(update.$set).toMatchObject({ stage: 'signe', founderSeatReserved: false });
    expect(update.$push.touches.note).toContain('chez-nicolas');

    expect(admin.recordTenantCreation).toHaveBeenCalledWith(
      ACTOR,
      String(tenantId),
      expect.objectContaining({ slug: 'chez-nicolas', ownerEmail: 'nicolas@exemple.fr' }),
    );
    expect(result.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(result.trialEndsAt).toBe('2026-09-23T12:00:00.000Z');
  });

  it('refuse un slug déjà pris, un e-mail déjà connu, un lead fantôme', async () => {
    await expect(build({ slugTaken: true }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      ConflictException,
    );
    await expect(build({ emailTaken: true }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      ConflictException,
    );
    await expect(build({ lead: null }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('supprime le tenant orphelin si le compte gérant échoue', async () => {
    const { service, tenants } = build({ userCreateFails: true });
    await expect(service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow('duplicate key');
    expect(tenants.deleteOne).toHaveBeenCalledOnce();
  });
});

describe('Réinitialiser le mot de passe gérant', () => {
  it('fabrique, hache, journalise — et rend le mot de passe une fois', async () => {
    const { service, users, admin } = build();
    const owner = { _id: new Types.ObjectId(), email: 'gerant@exemple.fr' };
    users.findOne.mockReturnValue({ lean: () => Promise.resolve(owner) });

    const tenantId = new Types.ObjectId().toHexString();
    const result = await service.resetOwnerPassword(ACTOR, tenantId);

    expect(result.ownerEmail).toBe('gerant@exemple.fr');
    expect(result.password).toMatch(/^[a-z2-9]{4}-/);
    const update = users.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(update.$set.passwordHash).toBe(`empreinte(${result.password})`);
    expect(admin.recordOwnerReset).toHaveBeenCalledWith(ACTOR, tenantId, 'gerant@exemple.fr');
  });

  it('404 sans compte gérant', async () => {
    const { service, users } = build();
    users.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(service.resetOwnerPassword(ACTOR, new Types.ObjectId().toHexString())).rejects.toThrow(
      NotFoundException,
    );
  });
});
