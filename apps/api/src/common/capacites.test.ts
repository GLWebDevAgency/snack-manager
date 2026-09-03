import 'reflect-metadata';
import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Reflector } from '@nestjs/core';
import type { Model } from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  CAPACITES_PAR_FORMULE,
  CAPACITE_NON_SOUSCRITE_CODE,
  type JwtPayload,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import {
  CAPACITES_REQUISES,
  Capacites,
  CapaciteGuard,
  CapacitesService,
  SOUSCRIPTION_FIELDS,
} from './capacites';
import { EncaissementController } from '../modules/encaissement/encaissement.controller';
import { ROLES } from './auth';

/**
 * LA GARDE DE CAPACITÉ — le second axe, testé sans base ni serveur.
 *
 * Ce qui se joue ici n'est pas seulement « ouvre / n'ouvre pas ». C'est la
 * DISTINCTION entre les deux refus : un manque de droit est une porte close,
 * un manque de capacité est une proposition commerciale. Les confondre donne
 * à un propriétaire le message d'un employé — ou, pire, laisse croire à un
 * problème de compte là où il n'y a qu'une ligne d'abonnement.
 */

const RESTO = '65f000000000000000000001';
const DISPARU = '65f000000000000000000002';

/** Le parc tel que Mongo le rendrait — `.lean()`, donc sans défaut matérialisé. */
const TENANTS: Record<string, Record<string, unknown>> = {
  // Formule d'entrée, sans le module vendu à part.
  [RESTO]: { plan: 'essentiel', onlineOrdering: false },
};

function modele(parc = TENANTS): Model<Tenant> {
  return {
    findById: (id: unknown, projection?: unknown) => ({
      lean: async () => {
        // La projection est vérifiée ici plutôt que dans un test à part : une
        // garde qui lirait le tenant ENTIER à chaque requête ferait payer à
        // toutes les routes le prix de trois champs.
        expect(projection).toEqual(SOUSCRIPTION_FIELDS);
        return parc[String(id)] ?? null;
      },
    }),
  } as unknown as Model<Tenant>;
}

function garde(meta: Record<string, unknown>, parc = TENANTS): CapaciteGuard {
  const reflector = {
    getAllAndOverride: (key: string) => meta[key],
  } as unknown as Reflector;
  return new CapaciteGuard(reflector, new CapacitesService(modele(parc)));
}

function contexte(user: JwtPayload | undefined): ExecutionContext {
  const req = { headers: {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

const proprietaire = (tenantId: string | null): JwtPayload => ({
  sub: '65f000000000000000000011',
  tenantId,
  role: 'owner',
  kind: 'user',
  exp: 4_102_444_800,
});

describe('la garde de capacité', () => {
  it('laisse passer une route qui n’exige rien', async () => {
    // La très grande majorité des routes. Elle doit alors coûter ZÉRO lecture :
    // le modèle ci-dessous lèverait si on l'interrogeait.
    const sansModele = new CapaciteGuard(
      { getAllAndOverride: () => undefined } as unknown as Reflector,
      new CapacitesService({
        findById: () => {
          throw new Error('aucune lecture ne doit avoir lieu');
        },
      } as unknown as Model<Tenant>),
    );
    await expect(sansModele.canActivate(contexte(proprietaire(RESTO)))).resolves.toBe(true);
  });

  it('ouvre ce que la formule comprend', async () => {
    const g = garde({ [CAPACITES_REQUISES]: ['menu'] });
    await expect(g.canActivate(contexte(proprietaire(RESTO)))).resolves.toBe(true);
  });

  it('refuse ce qui n’est pas souscrit — et le dit comme une offre, pas comme un droit', async () => {
    const g = garde({ [CAPACITES_REQUISES]: ['online'] });
    const refus = await g
      .canActivate(contexte(proprietaire(RESTO)))
      .then(() => null)
      .catch((e: unknown) => e);

    expect(refus).toBeInstanceOf(ForbiddenException);
    const corps = (refus as ForbiddenException).getResponse() as Record<string, unknown>;
    // Le CODE est ce que le front compare : le libellé français se retouchera.
    expect(corps.code).toBe(CAPACITE_NON_SOUSCRITE_CODE);
    expect(corps.capacite).toBe('online');
    // Le message nomme la fonction et dit à qui parler. Il ne parle NI de
    // droit — ce n'en est pas un — NI de formule : le code ne les connaît pas.
    expect(String(corps.message)).toContain('abonnement');
    expect(String(corps.message)).not.toMatch(/droit|essentiel|complet|boost/i);
  });

  it('exige TOUTES les capacités demandées, pas une seule', async () => {
    const g = garde({ [CAPACITES_REQUISES]: ['menu', 'online'] });
    await expect(g.canActivate(contexte(proprietaire(RESTO)))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rend la capacité à qui a souscrit l’option', async () => {
    const g = garde({ [CAPACITES_REQUISES]: ['online'] }, {
      [RESTO]: { plan: 'essentiel', onlineOrdering: true },
    });
    await expect(g.canActivate(contexte(proprietaire(RESTO)))).resolves.toBe(true);
  });

  it('rend la capacité à qui l’a par dérogation', async () => {
    // Le geste commercial : la fonction est ouverte hors formule, avec un
    // motif et un auteur. C'est ce qui permet d'appliquer la grille sans
    // couper un client qui utilise la fonction depuis un an.
    const g = garde({ [CAPACITES_REQUISES]: ['online'] }, {
      [RESTO]: {
        plan: 'essentiel',
        onlineOrdering: false,
        derogationsCapacite: [
          {
            capacite: 'online',
            sens: 'accordee',
            motif: 'reprise de son ancien logiciel',
            auteur: 'Équipe SM',
          },
        ],
      },
    });
    await expect(g.canActivate(contexte(proprietaire(RESTO)))).resolves.toBe(true);
  });

  it('refuse un porteur de jeton sans établissement', async () => {
    // Un compte d'équipe SM (`tenantId: null`) ou une route publique annotée
    // par erreur : une capacité n'a rien à dire à qui n'a pas de restaurant.
    const g = garde({ [CAPACITES_REQUISES]: ['menu'] });
    await expect(g.canActivate(contexte(proprietaire(null)))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(g.canActivate(contexte(undefined))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ne déguise pas une base incohérente en proposition commerciale', async () => {
    // `AuthGuard` vient de vérifier l'existence du tenant : son absence ici est
    // une anomalie. La traiter comme « il n'a rien souscrit » afficherait au
    // restaurateur une offre pour masquer un défaut.
    const g = garde({ [CAPACITES_REQUISES]: ['menu'] }, { [DISPARU]: undefined as never });
    await expect(g.canActivate(contexte(proprietaire(RESTO)))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('la lecture des capacités d’un établissement', () => {
  it('rend exactement ce que le catalogue accorde à la formule', async () => {
    const service = new CapacitesService(modele());
    await expect(service.pourTenant(RESTO)).resolves.toEqual([
      ...CAPACITES_PAR_FORMULE.essentiel,
    ]);
  });
});

/**
 * LE DÉCORATEUR POSE SON PROPRE GARDE — sinon il ne fait RIEN.
 *
 * Une métadonnée sans garde est parfaitement lisible et parfaitement inerte :
 * le genre de configuration qui a l'air juste et ne protège rien. La même
 * faute avait déjà laissé `EncaissementController` sans contrôle de rôle
 * pendant des mois — le garde global ne filtre que si l'annotation existe.
 */
describe('le décorateur de capacité', () => {
  it('déclare la capacité ET installe le garde qui la vérifie', () => {
    @Capacites('online')
    class Route {}

    expect(Reflect.getMetadata(CAPACITES_REQUISES, Route)).toEqual(['online']);
    expect(Reflect.getMetadata(GUARDS_METADATA, Route)).toContain(CapaciteGuard);
  });

  it('garde le raccordement Stripe derrière la commande en ligne, SANS toucher au rôle', () => {
    // Les deux axes cohabitent sur ce contrôleur, et c'est le seul du produit
    // à les porter tous les deux : `@Roles('owner')` dit qui a le droit,
    // `@Capacites('online')` dit ce que l'établissement a payé. Un
    // raccordement Stripe n'existe que pour encaisser des commandes en ligne.
    expect(Reflect.getMetadata(CAPACITES_REQUISES, EncaissementController)).toEqual(['online']);
    expect(Reflect.getMetadata(GUARDS_METADATA, EncaissementController)).toContain(CapaciteGuard);
    // Le contrôle de rôle n'a pas bougé : ajouter un axe ne doit pas en
    // effacer un autre.
    expect(Reflect.getMetadata(ROLES, EncaissementController)).toEqual(['owner']);
  });
});
