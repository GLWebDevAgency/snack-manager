import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import type { Model } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_SUSPENDED_CODE, ACCOUNT_SUSPENDED_MESSAGE, type JwtPayload } from '@sm/contracts';
import type { Device, Staff, Tenant } from '@sm/db';
import { AuthGuard, IS_PUBLIC, ROLES } from './auth';
import { SessionAccessService } from './session-access';

/**
 * LE STATUT DE COMPTE AU GUARD.
 *
 * C'est le point le plus sensible du produit : un faux positif ferme un
 * restaurant en plein service, un faux négatif laisse travailler un compte
 * qu'on a coupé pour impayé. Les deux se testent ici, sans base ni serveur.
 */

const ACTIF = '65f000000000000000000001';
const SUSPENDU = '65f000000000000000000002';
const LEGACY = '65f000000000000000000003';
const DISPARU = '65f000000000000000000004';

/** Le parc tel que Mongo le rendrait — `legacy` n'a pas de champ `account`. */
const TENANTS: Record<string, Record<string, unknown>> = {
  [ACTIF]: { account: { status: 'active' } },
  [SUSPENDU]: { account: { status: 'suspended' } },
  // Tenant créé avant le champ : `.lean()` ne matérialise pas les défauts.
  [LEGACY]: {},
};

function makeGuard(tokens: Record<string, JwtPayload>, meta: Record<string, unknown> = {}) {
  const jwt = {
    verifyAsync: async (token: string) => {
      const payload = tokens[token];
      if (!payload) throw new Error('jeton invalide');
      return payload;
    },
  } as unknown as JwtService;

  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;

  const tenants = {
    findById: (id: unknown) => ({
      lean: async () => TENANTS[String(id)] ?? null,
    }),
  } as unknown as Model<Tenant>;

  const staff = {
    findOne: () => ({ lean: async () => null }),
  } as unknown as Model<Staff>;
  const devices = {
    findOne: () => ({ lean: async () => null }),
  } as unknown as Model<Device>;

  return new AuthGuard(jwt, reflector, new SessionAccessService(tenants, staff, devices));
}

function contextFor(token: string | null): ExecutionContext {
  const req = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    user: undefined as JwtPayload | undefined,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const gerant = (tenantId: string | null): JwtPayload => ({
  sub: 'user-1',
  tenantId,
  role: 'owner',
  kind: 'user',
  exp: 4_102_444_800,
});

const caissier = (tenantId: string): JwtPayload => ({
  sub: 'staff-1',
  tenantId,
  role: 'caisse',
  kind: 'staff',
  exp: 4_102_444_800,
});

const equipeSm = (tenantId: string | null = null): JwtPayload => ({
  sub: 'user-sm',
  tenantId,
  role: 'sm_admin',
  kind: 'user',
  exp: 4_102_444_800,
});

describe('Statut de compte au guard', () => {
  it('refuse le jeton d’un établissement suspendu, avec un message lisible', async () => {
    const guard = makeGuard({ jeton: gerant(SUSPENDU) });

    const error = await guard.canActivate(contextFor('jeton')).catch((e: unknown) => e);

    // Un gérant coupé pour impayé ne doit pas lire « Forbidden » : il doit
    // savoir qui appeler pour rouvrir.
    expect(error).toBeInstanceOf(ForbiddenException);
    const body = (error as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(body.message).toBe(ACCOUNT_SUSPENDED_MESSAGE);
    expect(body.message).toBe('Accès suspendu — contactez Snack Manager');
    // Le web s'appuie sur le code, pas sur la phrase : renvoyer le gérant vers
    // l'écran de connexion serait faux, ses identifiants sont bons.
    expect(body.code).toBe(ACCOUNT_SUSPENDED_CODE);
  });

  it('coupe aussi la caisse et la cuisine, pas seulement le back-office', async () => {
    // Un jeton de personnel (connexion par PIN) porte le même tenantId : la
    // suspension serait cosmétique si le service continuait d'encaisser.
    const guard = makeGuard({ jeton: caissier(SUSPENDU) });
    await expect(guard.canActivate(contextFor('jeton'))).rejects.toThrow(/Accès suspendu/);
  });

  it('laisse passer l’équipe Snack Manager, même sur un parc suspendu', async () => {
    // Sans cette exception, suspendre un client nous fermerait notre propre
    // back-office — celui d'où l'on rouvre son accès.
    const guard = makeGuard({ jeton: equipeSm() });
    await expect(guard.canActivate(contextFor('jeton'))).resolves.toBe(true);

    const rattache = makeGuard({ jeton: equipeSm(SUSPENDU) });
    await expect(rattache.canActivate(contextFor('jeton'))).resolves.toBe(true);
  });

  it('laisse travailler un établissement actif', async () => {
    const guard = makeGuard({ jeton: gerant(ACTIF) });
    await expect(guard.canActivate(contextFor('jeton'))).resolves.toBe(true);
  });

  it('n’enferme personne parce que le champ « account » n’existe pas encore', async () => {
    // Tous les tenants créés avant ce module sont dans ce cas. Un champ
    // manquant qui bloquerait l'accès fermerait le parc entier au déploiement.
    const guard = makeGuard({ jeton: gerant(LEGACY) });
    await expect(guard.canActivate(contextFor('jeton'))).resolves.toBe(true);
  });

  it('refuse un jeton dont l’établissement n’existe plus', async () => {
    const guard = makeGuard({ jeton: gerant(DISPARU) });
    await expect(guard.canActivate(contextFor('jeton'))).rejects.toThrow(UnauthorizedException);
  });

  it('refuse un tenantId forgé sans lever de CastError', async () => {
    // Sans le garde-fou, Mongoose renvoie un 500 sur un identifiant illisible.
    const guard = makeGuard({ jeton: gerant('pas-un-objectid') });
    await expect(guard.canActivate(contextFor('jeton'))).rejects.toThrow(UnauthorizedException);
  });

  it('ne touche pas aux routes publiques', async () => {
    // Le site de commande d'un restaurant suspendu doit se fermer avec un
    // message (cf. `publicOrderingState`), jamais tomber en 403 technique.
    const guard = makeGuard({}, { [IS_PUBLIC]: true });
    await expect(guard.canActivate(contextFor(null))).resolves.toBe(true);
  });

  it('exige toujours un jeton et un rôle autorisé', async () => {
    const nu = makeGuard({ jeton: gerant(ACTIF) });
    await expect(nu.canActivate(contextFor(null))).rejects.toThrow(UnauthorizedException);

    const interdit = makeGuard({ jeton: gerant(ACTIF) }, { [ROLES]: ['sm_admin'] });
    await expect(interdit.canActivate(contextFor('jeton'))).rejects.toThrow(ForbiddenException);

    const autorise = makeGuard({ jeton: equipeSm() }, { [ROLES]: ['sm_admin'] });
    await expect(autorise.canActivate(contextFor('jeton'))).resolves.toBe(true);
  });

  it('préfère le message de suspension au 403 muet du contrôle de rôle', async () => {
    // Un gérant suspendu qui tombe sur une route qui ne lui est pas destinée
    // doit quand même comprendre POURQUOI son compte ne répond plus.
    const guard = makeGuard({ jeton: gerant(SUSPENDU) }, { [ROLES]: ['sm_admin'] });
    await expect(guard.canActivate(contextFor('jeton'))).rejects.toThrow(/Accès suspendu/);
  });

  it('attache le payload à la requête pour les décorateurs', async () => {
    const guard = makeGuard({ jeton: gerant(ACTIF) });
    const ctx = contextFor('jeton');
    await guard.canActivate(ctx);
    expect(ctx.switchToHttp().getRequest<{ user?: JwtPayload }>().user?.tenantId).toBe(ACTIF);
  });
});
