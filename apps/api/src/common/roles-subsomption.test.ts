import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { ROLES_SUBSUMES, rolesEndosses, roleSatisfait, type JwtPayload } from '@sm/contracts';
import { AuthGuard, ROLES } from './auth';
import { SessionAccessService } from './session-access';
import { EncaissementController } from '../modules/encaissement/encaissement.controller';
import { BillingIdentityController } from '../modules/billing/billing-identity.controller';
import { canReadPayroll } from '../modules/planning/payroll-access';
import { ROLES_LECTURE_FACTURATION } from '../modules/billing/tenant-session.guard';

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  `cogerant` PEUT TOUT CE QUE PEUT `gerant` — ET RIEN DE PLUS.            ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * La subsomption est une phrase courte avec une portée énorme : elle ouvre d'un
 * coup les 67 décorateurs `@Roles('owner', 'gerant')` de l'API. Ce qui la rend
 * défendable n'est pas le commentaire qui l'explique, c'est la SECONDE moitié —
 * la preuve qu'elle ne déborde pas.
 *
 * Ce fichier tient donc les deux bouts :
 *  · ce que `cogerant` ouvre, par la garde réelle et non par une reformulation ;
 *  · ce qu'il n'ouvre PAS, en lisant les métadonnées des CONTRÔLEURS EUX-MÊMES.
 *    Un `@Roles('owner')` retiré d'`EncaissementController` fait rougir ce test
 *    le jour même, alors qu'une liste de chaînes recopiée ici resterait verte.
 */

const RESTO = '65f000000000000000000001';

const compte = (role: string, sub = '65f0000000000000000000a1'): JwtPayload => ({
  sub,
  tenantId: RESTO,
  role: role as JwtPayload['role'],
  kind: 'user',
  userSessionVersion: 'v1',
  exp: 4_102_444_800,
});

const surTablette = (role: string): JwtPayload => ({
  sub: '65f0000000000000000000b1',
  tenantId: RESTO,
  role: role as JwtPayload['role'],
  kind: 'staff',
  staffSessionVersion: 'v1',
  deviceId: '65f0000000000000000000c1',
  deviceSessionVersion: 'v1',
  exp: 4_102_444_800,
});

/**
 * La garde RÉELLE, avec une autorité de session qui dit toujours oui : ce qui
 * est mesuré ici est le contrôle de RÔLE, pas la relecture du compte en base
 * (couverte par `auth.test.ts` et `session-access`).
 */
function garde(exiges: readonly string[] | undefined, payload: JwtPayload): AuthGuard {
  const jwt = { verifyAsync: async () => payload } as unknown as JwtService;
  const reflector = {
    getAllAndOverride: (key: string) => (key === ROLES ? exiges : undefined),
  } as unknown as Reflector;
  const sessions = {
    assertAllows: async () => {},
  } as unknown as SessionAccessService;
  return new AuthGuard(jwt, reflector, sessions);
}

const contexte = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: 'Bearer jeton' } }),
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

const ouvre = (exiges: readonly string[], role: string) =>
  garde(exiges, compte(role)).canActivate(contexte());

/** Les rôles exigés par un contrôleur, lus sur SA métadonnée. */
const rolesDe = (cible: object): unknown => Reflect.getMetadata(ROLES, cible);

describe('la règle de subsomption', () => {
  it('n’étend qu’un seul rôle, et seulement vers le code sur tablette', () => {
    // Une table qui grossirait sans qu'on s'en aperçoive transformerait la
    // subsomption en trappe. Elle est épinglée en entier.
    expect(ROLES_SUBSUMES).toEqual({ cogerant: ['gerant'] });
    expect(rolesEndosses('cogerant')).toEqual(['cogerant', 'gerant']);
  });

  it('laisse tous les autres rôles strictement inchangés', () => {
    for (const role of ['owner', 'sm_admin', 'comptable', 'gerant', 'caisse', 'cuisine']) {
      expect(rolesEndosses(role), role).toEqual([role]);
    }
  });

  it('ne fait rien quand le décorateur n’exige rien', () => {
    expect(roleSatisfait('cuisine', [])).toBe(true);
  });
});

describe('ce que la garde ouvre à un cogérant', () => {
  it('ouvre les 67 routes du gérant sans qu’un seul décorateur ait bougé', async () => {
    // La combinaison la plus répandue de l'API, telle quelle.
    await expect(ouvre(['owner', 'gerant'], 'cogerant')).resolves.toBe(true);
    await expect(ouvre(['owner', 'gerant', 'caisse'], 'cogerant')).resolves.toBe(true);
    await expect(ouvre(['owner', 'gerant', 'caisse', 'cuisine'], 'cogerant')).resolves.toBe(true);
    await expect(ouvre(['owner', 'gerant', 'cuisine'], 'cogerant')).resolves.toBe(true);
  });

  it('ne lui ouvre RIEN de ce qui est réservé au propriétaire seul', async () => {
    await expect(ouvre(['owner'], 'cogerant')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ne lui ouvre pas le back-office de l’équipe Snack Manager', async () => {
    await expect(ouvre(['sm_admin'], 'cogerant')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('n’ouvre rien de neuf à un porteur de code sur tablette', async () => {
    // La subsomption va dans UN sens : le compte endosse le rôle de tablette,
    // jamais l'inverse. Un `gerant` au PIN ne devient pas cogérant.
    const g = garde(['cogerant'], surTablette('gerant'));
    await expect(g.canActivate(contexte())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

/**
 * LES SURFACES QUI RESTENT AU PROPRIÉTAIRE — lues sur les contrôleurs réels.
 *
 * Trois d'entre elles portent `@Roles('owner')` ; les deux autres passent par
 * un garde dédié. Toutes disent la même chose : l'argent du restaurant reste au
 * compte qui porte le contrat.
 */
describe('ce qui reste fermé à tout ce qui n’est pas le propriétaire', () => {
  it('l’encaissement en ligne : le raccordement Stripe', async () => {
    expect(rolesDe(EncaissementController)).toEqual(['owner']);
    await expect(
      garde(['owner'], compte('cogerant')).canActivate(contexte()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      garde(['owner'], compte('comptable')).canActivate(contexte()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('l’identité de facturation : le SIRET imprimé sur les pièces', async () => {
    // Métadonnée de MÉTHODE : ce contrôleur ne porte pas de rôle sur sa classe.
    expect(rolesDe(BillingIdentityController.prototype.update)).toEqual(['owner']);
    await expect(
      garde(['owner'], compte('cogerant')).canActivate(contexte()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('les rémunérations : ni cogérant, ni comptable, ni session de tablette', () => {
    expect(canReadPayroll(compte('owner'))).toBe(true);
    expect(canReadPayroll(compte('cogerant'))).toBe(false);
    // Le comptable lit l'argent qui ENTRE, pas ce que gagne chaque salarié :
    // un coût horaire est une donnée personnelle, et son rôle a été arrêté sur
    // « statistiques, exports, factures, registre » — la paie n'y est pas.
    expect(canReadPayroll(compte('comptable'))).toBe(false);
    expect(canReadPayroll(surTablette('gerant'))).toBe(false);
  });

  it('l’abonnement et les factures : le propriétaire et son comptable, personne d’autre', () => {
    // Ce garde-là ne lit pas `@Roles` — c'est le seul, et c'est délibéré (il
    // survit à une suspension). Sa liste est donc épinglée à part.
    expect([...ROLES_LECTURE_FACTURATION]).toEqual(['owner', 'comptable']);
    expect(ROLES_LECTURE_FACTURATION).not.toContain('cogerant');
    expect(ROLES_LECTURE_FACTURATION).not.toContain('gerant');
  });
});
