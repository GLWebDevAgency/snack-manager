import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { EncaissementService, raccordementRompu } from './encaissement.service';
import type { StripeCompte, StripeConnectClient } from './stripe-connect.client';

/**
 * CE QUE CES TESTS PROTÈGENT, ET CHACUN VAUT UNE PANNE RÉELLE :
 *
 *  · l'argent d'un restaurant ne doit JAMAIS pouvoir être encaissé sur le
 *    compte de la plateforme — un éditeur qui encaisse pour autrui exerce
 *    illégalement un service de paiement (sanction pénale, pas fiscale) ;
 *  · Stripe est SEUL juge de la capacité à encaisser : nos drapeaux ne sont
 *    qu'une recopie, et une recopie périmée doit fermer, jamais ouvrir ;
 *  · une plateforme non configurée ne casse rien — le comptoir continue.
 */

const TENANT = new Types.ObjectId();
const NOW = new Date('2026-08-25T12:00:00.000Z');

const compteStripe = (over: Partial<StripeCompte> = {}): StripeCompte => ({
  id: 'acct_resto1',
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  ...over,
});

function build(
  over: {
    tenant?: Record<string, unknown> | null;
    client?: Partial<StripeConnectClient> & { disponible?: () => Promise<boolean> };
  } = {},
) {
  const doc =
    over.tenant === undefined
      ? { _id: TENANT, name: 'Chez Nicolas', billing: { email: 'nicolas@exemple.fr' }, encaissement: null }
      : over.tenant;

  const tenants = {
    findById: vi.fn().mockReturnValue({ lean: () => Promise.resolve(doc) }),
    updateOne: vi.fn().mockResolvedValue({}),
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(doc) }),
  };

  // La doublure ne sait faire QUE ce que le service appelle — règle maison.
  const client = {
    creerCompte: vi.fn().mockResolvedValue(compteStripe({ charges_enabled: false, details_submitted: false, payouts_enabled: false })),
    lireCompte: vi.fn().mockResolvedValue(compteStripe()),
    creerLien: vi.fn().mockResolvedValue({ url: 'https://connect.stripe.com/setup/x', expires_at: 1787000000 }),
    disponible: vi.fn().mockResolvedValue(true),
    ...over.client,
  };

  const service = new EncaissementService(
    tenants as unknown as Model<Tenant>,
    client as unknown as StripeConnectClient,
    { retourUrl: 'https://app.snackmanager.fr/admin/encaissement' },
  );
  return { service, tenants, client };
}

describe('la fiche d’encaissement', () => {
  it('sans compte raccordé : « absent », et le comptoir reste la voie', async () => {
    const { service } = build();
    const fiche = await service.ficheDe(String(TENANT));
    expect(fiche.etat).toBe('absent');
    expect(fiche.peutEncaisser).toBe(false);
    expect(fiche.raison).toMatch(/comptoir/i);
    expect(fiche.compte).toBeNull();
  });

  it('compte actif : « actif », sans raison à afficher', async () => {
    const { service } = build({
      tenant: {
        _id: TENANT,
        encaissement: {
          accountId: 'acct_resto1',
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          raccordeLe: NOW,
          synchroniseLe: NOW,
        },
      },
    });
    const fiche = await service.ficheDe(String(TENANT));
    expect(fiche.etat).toBe('actif');
    expect(fiche.peutEncaisser).toBe(true);
    expect(fiche.raison).toBeNull();
  });

  it('plateforme non configurée : la fiche le dit, et n’invite pas à un raccordement qui échouerait', async () => {
    const { service } = build({ client: { disponible: vi.fn().mockResolvedValue(false) } });
    const fiche = await service.ficheDe(String(TENANT));
    expect(fiche.disponible).toBe(false);
    expect(fiche.peutEncaisser).toBe(false);
  });

  it('établissement inconnu : 404, jamais une fiche vide qui mentirait', async () => {
    const { service } = build({ tenant: null });
    await expect(service.ficheDe(String(TENANT))).rejects.toThrow(NotFoundException);
  });
});

describe('le raccordement', () => {
  it('crée le compte à la première demande, le réutilise ensuite', async () => {
    const { service, client, tenants } = build();
    const lien = await service.demarrerRaccordement(String(TENANT));

    expect(client.creerCompte).toHaveBeenCalledWith('nicolas@exemple.fr');
    expect(lien.url).toContain('connect.stripe.com');
    // Le compte est écrit AVANT de rendre le lien : si le restaurateur ferme
    // l'onglet, on ne recrée pas un second compte à sa prochaine visite.
    //
    // Écriture du sous-document ENTIER, jamais par chemins pointés : le champ
    // porte `default: null`, et MongoDB refuse de creuser un `null`
    // (PathNotViable) — le raccordement échouait pour tout nouveau client.
    const set = tenants.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(set.$set.encaissement.accountId).toBe('acct_resto1');
    expect(set.$set.encaissement.chargesEnabled).toBe(false);
  });

  it('compte déjà créé : aucun second compte, seulement un nouveau lien', async () => {
    const { service, client } = build({
      tenant: {
        _id: TENANT,
        encaissement: {
          accountId: 'acct_deja',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          raccordeLe: NOW,
          synchroniseLe: NOW,
        },
      },
    });
    await service.demarrerRaccordement(String(TENANT));
    expect(client.creerCompte).not.toHaveBeenCalled();
    expect(client.creerLien).toHaveBeenCalledWith(
      'acct_deja',
      expect.stringContaining('/admin/encaissement'),
      expect.stringContaining('/admin/encaissement'),
    );
  });

  it('plateforme non configurée : refus explicite, pas une erreur technique', async () => {
    const { service } = build({ client: { disponible: vi.fn().mockResolvedValue(false) } });
    await expect(service.demarrerRaccordement(String(TENANT))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('la synchronisation des drapeaux', () => {
  it('recopie ce que dit Stripe — lui seul décide', async () => {
    const { service, tenants } = build({
      tenant: {
        _id: TENANT,
        encaissement: {
          accountId: 'acct_resto1',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          raccordeLe: NOW,
          synchroniseLe: NOW,
        },
      },
      client: { lireCompte: vi.fn().mockResolvedValue(compteStripe()) },
    });

    await service.synchroniser('acct_resto1', NOW);
    const set = tenants.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(set.$set.encaissement.chargesEnabled).toBe(true);
    expect(set.$set.encaissement.synchroniseLe).toEqual(NOW);
    // La date d'ENGAGEMENT du restaurateur ne se réécrit pas à chaque
    // synchronisation — c'est un fait daté, pas un horodatage technique.
    expect(set.$set.encaissement.raccordeLe).toEqual(NOW);
  });

  it('drapeaux absents chez Stripe : on FERME, on n’ouvre pas', async () => {
    // Une réponse partielle ne doit jamais valoir autorisation d'encaisser.
    const { service, tenants } = build({
      tenant: {
        _id: TENANT,
        encaissement: { accountId: 'acct_resto1', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, raccordeLe: NOW, synchroniseLe: NOW },
      },
      client: { lireCompte: vi.fn().mockResolvedValue({ id: 'acct_resto1' }) },
    });
    await service.synchroniser('acct_resto1', NOW);
    const set = tenants.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(set.$set.encaissement.chargesEnabled).toBe(false);
  });

  it('compte inconnu de notre parc : ignoré sans lever — un webhook ne doit pas rejouer en boucle', async () => {
    const { service, tenants } = build({ tenant: null });
    await expect(service.synchroniser('acct_fantome', NOW)).resolves.toBeUndefined();
    expect(tenants.updateOne).not.toHaveBeenCalled();
  });
});

describe('le compte sur lequel encaisser — l’interface étroite du module', () => {
  it('rend l’identifiant quand Stripe autorise l’encaissement', async () => {
    const { service } = build({
      tenant: {
        _id: TENANT,
        encaissement: { accountId: 'acct_resto1', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, raccordeLe: NOW, synchroniseLe: NOW },
      },
    });
    expect(await service.compteActifDe(String(TENANT))).toBe('acct_resto1');
  });

  it('rend null dès que Stripe n’autorise pas — JAMAIS le compte de la plateforme', async () => {
    const { service } = build({
      tenant: {
        _id: TENANT,
        encaissement: { accountId: 'acct_resto1', chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: true, raccordeLe: NOW, synchroniseLe: NOW },
      },
    });
    expect(await service.compteActifDe(String(TENANT))).toBeNull();
    // Sans compte du tout non plus : le paiement en ligne se ferme.
    expect(await build().service.compteActifDe(String(TENANT))).toBeNull();
  });

  it('identifiant d’établissement invalide : null, sans lever', async () => {
    const { service } = build();
    expect(await service.compteActifDe('pas-un-id')).toBeNull();
  });
});

describe('le câblage Nest — un contrôleur non déclaré est une route 404 silencieuse', () => {
  it('les DEUX webhooks Stripe sont déclarés dans le module de commande', async () => {
    // `StripeWebhookController` ne l'était pas : la route /public/stripe/webhook
    // répondait 404 en production et les commandes payées en ligne restaient
    // « en attente » sans le moindre message. Ce test empêche la récidive —
    // pour les deux webhooks, celui de la plateforme et celui des comptes
    // connectés (charges directes).
    const { OrderingModule } = await import('../ordering/ordering.module');
    const { StripeWebhookController } = await import('../ordering/stripe-webhook.controller');
    const { StripeConnectWebhookController } = await import(
      '../ordering/stripe-connect-webhook.controller'
    );
    const declares = Reflect.getMetadata('controllers', OrderingModule) as unknown[];
    expect(declares).toContain(StripeWebhookController);
    expect(declares).toContain(StripeConnectWebhookController);
  });

  it(
    'l’application déclare le module d’encaissement SANS passer par `ordering`',
    async () => {
      // Les routes `/encaissement/*` répondaient par transitivité seulement :
      // `OrderingModule` importe ce module pour savoir sur quel compte encaisser,
      // et Nest enregistre au passage ses contrôleurs. Le jour où cette
      // dépendance se déplace, le raccordement disparaît du back-office en
      // silence — des 404 sur les routes qui décident où va l'argent.
      // Ce test charge volontairement tout AppModule à froid. Sous `pnpm verify`,
      // les builds Next et les autres suites tournent en parallèle : son budget
      // est donc local et explicite, sans relever le délai de tous les tests.
      const { AppModule } = await import('../../app.module');
      const { EncaissementModule } = await import('./encaissement.module');
      const importes = Reflect.getMetadata('imports', AppModule) as unknown[];
      expect(importes).toContain(EncaissementModule);
    },
    15_000,
  );
});

describe('le cloisonnement du contrôleur', () => {
  it('réserve TOUTES les routes au compte gérant — jamais une tablette au PIN', async () => {
    // Raccorder crée une entité bancaire au nom de l'établissement et rend un
    // lien où l'on saisit un IBAN : un équipier au comptoir pourrait y
    // déclarer SES coordonnées. Le garde global ne filtre que si l'annotation
    // existe — son absence serait une porte ouverte, pas un oubli anodin.
    const { EncaissementController } = await import('./encaissement.controller');
    expect(Reflect.getMetadata('roles', EncaissementController)).toEqual(['owner']);
  });
});

describe('le restaurateur nous débranche', () => {
  const raccorde = {
    _id: TENANT,
    encaissement: {
      accountId: 'acct_resto1',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      raccordeLe: NOW,
      synchroniseLe: NOW,
    },
  };

  it('ferme l’encaissement — sinon les drapeaux resteraient « actif » pour toujours', async () => {
    // `account.application.deauthorized` est le SEUL événement émis quand le
    // restaurateur révoque l'accès : plus aucun `account.updated` ne suivra.
    const { service, tenants } = build({ tenant: raccorde });
    await service.revoquer('acct_resto1', NOW);
    const set = tenants.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(set.$set.encaissement.chargesEnabled).toBe(false);
    // L'identifiant est conservé : la reprise du raccordement reste possible.
    expect(set.$set.encaissement.accountId).toBe('acct_resto1');
  });

  it('Stripe REFUSE l’accès : on ferme, sinon le drapeau resterait « actif » pour toujours', async () => {
    const { service, tenants } = build({
      tenant: raccorde,
      client: {
        lireCompte: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('permission_error'), {
            type: 'StripePermissionError',
          })),
      },
    });
    // Ne lève pas : un webhook en erreur serait rejoué trois jours durant, et
    // le bouton « vérifier » du gérant tomberait en 500 sans qu'il comprenne.
    await expect(service.synchroniser('acct_resto1', NOW)).resolves.toBeUndefined();
    const set = tenants.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(set.$set.encaissement.chargesEnabled).toBe(false);
  });

  /**
   * LE CAS QUE LE TEST PRÉCÉDENT CONFONDAIT AVEC LE PREMIER.
   *
   * Une panne passagère chez Stripe n'est pas une décision du restaurateur.
   * Fermer sur une absence de réponse coupait la commande en ligne de tous les
   * restaurants dont un webhook passait pendant l'incident — et rien ne la
   * rouvrait tant que le gérant ne cliquait pas « vérifier ».
   */
  it('Stripe NE RÉPOND PAS : on ne touche à rien, l’encaissement reste ouvert', async () => {
    const { service, tenants } = build({
      tenant: raccorde,
      client: {
        lireCompte: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('socket hang up'), {
            type: 'StripeConnectionError',
          })),
      },
    });
    await expect(service.synchroniser('acct_resto1', NOW)).resolves.toBeUndefined();
    // AUCUNE écriture : les drapeaux d'hier valent mieux qu'une fermeture
    // fondée sur une absence de réponse.
    expect(tenants.updateOne).not.toHaveBeenCalled();
  });

  it('une erreur ILLISIBLE ne ferme rien non plus', async () => {
    const { service, tenants } = build({
      tenant: raccorde,
      client: { lireCompte: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await expect(service.synchroniser('acct_resto1', NOW)).resolves.toBeUndefined();
    expect(tenants.updateOne).not.toHaveBeenCalled();
  });
});

/**
 * UN COMPTE RÉVOQUÉ ET UNE PANNE STRIPE NE SE TRAITENT PAS PAREIL.
 *
 * `lireChezStripe` rendait `null` dans les deux cas, et les deux fermaient
 * l'encaissement. Un incident passager chez Stripe coupait donc la commande en
 * ligne de tous les restaurants dont un webhook passait pendant la panne — et
 * rien ne la rouvrait tant que le gérant ne cliquait pas « vérifier ».
 *
 * Le commentaire du code l'écrivait sans le voir : « Stripe ne répond pas, OU le
 * restaurateur nous a débranchés ».
 */
describe('lire une erreur Stripe', () => {
  it('reconnaît un raccordement rompu', () => {
    // Ce que Stripe renvoie quand le restaurateur nous a retiré l'accès.
    expect(raccordementRompu({ type: 'StripePermissionError' })).toBe(true);
    expect(raccordementRompu({ type: 'StripeInvalidRequestError' })).toBe(true);
    expect(raccordementRompu({ code: 'account_invalid' })).toBe(true);
    expect(raccordementRompu({ statusCode: 403 })).toBe(true);
    expect(raccordementRompu({ statusCode: 404 })).toBe(true);
  });

  it('ne prend PAS une panne pour une révocation', () => {
    // Réseau coupé, 500 chez Stripe, quota dépassé : le compte n'y est pour
    // rien, et fermer l'encaissement de tout un parc serait la mauvaise
    // décision prise sur une absence de réponse.
    expect(raccordementRompu({ type: 'StripeConnectionError' })).toBe(false);
    expect(raccordementRompu({ type: 'StripeAPIError', statusCode: 500 })).toBe(false);
    expect(raccordementRompu({ type: 'StripeRateLimitError', statusCode: 429 })).toBe(false);
    expect(raccordementRompu({ statusCode: 502 })).toBe(false);
  });

  it('devant l’inconnu, ne conclut PAS à la rupture', () => {
    // Une erreur qu'on ne sait pas lire n'est pas une preuve de révocation.
    // Ne rien changer est le choix sûr : les drapeaux d'hier valent mieux
    // qu'une fermeture fondée sur une incompréhension.
    for (const inconnu of [null, undefined, new Error('boom'), {}, 'texte', 42]) {
      expect(raccordementRompu(inconnu)).toBe(false);
    }
  });
});

/**
 * UN DÉBRANCHEMENT NE DOIT PAS ÊTRE DÉFINITIF.
 *
 * L'identifiant du compte est conservé à la révocation — c'est voulu, il permet
 * de reprendre. Mais si le restaurateur nous a retiré l'accès, Stripe refuse de
 * nous ouvrir une page sur CE compte : on réessayait donc éternellement le même,
 * et le gérant lisait « réessayez dans un instant » devant un geste qui ne
 * marcherait jamais. Le restaurant ne pouvait plus jamais encaisser en ligne.
 */
describe('se rebrancher après un débranchement', () => {
  const lien = { url: 'https://connect.stripe.com/setup/x', expires_at: 1_800_000_000 };
  /** Un restaurant déjà raccordé — c'est le cas qui pose problème. */
  const raccorde = {
    _id: TENANT,
    encaissement: {
      accountId: 'acct_resto1',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      raccordeLe: NOW,
      synchroniseLe: NOW,
    },
  };

  it('repart sur un compte NEUF quand l’ancien nous est refusé', async () => {
    const creerLien = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('permission'), { type: 'StripePermissionError' }),
      )
      .mockResolvedValueOnce(lien);
    const creerCompte = vi.fn().mockResolvedValue(compteStripe({ id: 'acct_neuf' }));
    const { service } = build({ tenant: raccorde, client: { creerLien, creerCompte } });

    await expect(service.demarrerRaccordement(String(TENANT))).resolves.toMatchObject({ url: lien.url });
    // Le second essai porte sur le compte neuf, pas sur celui qu'on a perdu.
    expect(creerCompte).toHaveBeenCalledTimes(1);
    expect(creerLien.mock.calls[1]![0]).toBe('acct_neuf');
  });

  it('ne fabrique PAS de compte sur une panne passagère', async () => {
    // Un compte Stripe de plus à chaque incident réseau serait un parc de
    // comptes fantômes, et une facture chez Stripe.
    const creerLien = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('socket'), { type: 'StripeConnectionError' }));
    const creerCompte = vi.fn();
    const { service } = build({ tenant: raccorde, client: { creerLien, creerCompte } });

    await expect(service.demarrerRaccordement(String(TENANT))).rejects.toThrow(/réessayez/);
    expect(creerCompte).not.toHaveBeenCalled();
  });
});
