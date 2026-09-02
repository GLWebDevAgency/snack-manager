import { describe, expect, it } from 'vitest';
import {
  CAPACITES,
  CAPACITE_LABELS,
  CAPACITES_PAR_FORMULE,
  CAPACITES_PAR_OPTION,
  CAPACITES_SANS_FORMULE,
  CAPACITES_SANS_GARDE,
  DerogationCapaciteSchema,
  FORMULES,
  GESTES_DEROGATION,
  TenantCapaciteSchema,
  aLaCapacite,
  appliquerDerogation,
  capacitesEffectives,
  capaciteNonSouscriteMessage,
  detailCapacites,
  lireDerogations,
  souscrit,
  type Capacite,
  type Formule,
} from './capacites';
import { ADMIN_PLANS } from './admin';
import { PLANS } from './index';

/**
 * CE QUE LE RESTAURANT A PAYÉ — et ce que le code n'a pas le droit de deviner.
 *
 * Le catalogue n'est pas une invention de développeur : c'est la matrice
 * AFFICHÉE AUX PROSPECTS sur `/offres`, module par module, avec « Inclus » ou
 * « Non inclus ». Ces tests l'épinglent ligne à ligne, et c'est leur rôle
 * premier : une promesse commerciale qui bouge doit se voir dans un diff, et
 * une promesse qui bouge SANS que la page publique bouge doit faire rougir la
 * CI avant d'atteindre un client.
 */

describe('le catalogue des capacités', () => {
  it('porte les onze modules de la grille publiée, dans son ordre', () => {
    expect([...CAPACITES]).toEqual([
      'pos',
      'kds',
      'print',
      'offline',
      'bo',
      'menu',
      'planning',
      'stocks',
      'online',
      'loyalty',
      'priority',
    ]);
    // Autant de libellés que de capacités : une capacité livrée sans libellé
    // s'afficherait au restaurateur sous sa clé technique.
    expect(Object.keys(CAPACITE_LABELS).sort()).toEqual([...CAPACITES].sort());
    for (const c of CAPACITES) expect(CAPACITE_LABELS[c].trim()).not.toBe('');
  });

  it('ne nomme aucune formule dans ses clés ni dans ses libellés', () => {
    // Un nom de formule dans une clé de capacité serait la règle d'or brisée à
    // sa source : le reste du produit lirait « boost » sans le savoir.
    for (const capacite of CAPACITES) {
      for (const formule of FORMULES) {
        expect(capacite.toLowerCase()).not.toContain(formule);
        expect(CAPACITE_LABELS[capacite].toLowerCase()).not.toContain(formule);
      }
    }
  });

  it('ne connaît que les trois formules du produit', () => {
    // `FORMULES` est redéclarée ici pour éviter un cycle de modules, comme
    // `ADMIN_PLANS`. Les trois listes doivent rester la même.
    expect([...FORMULES]).toEqual([...PLANS]);
    expect([...FORMULES]).toEqual([...ADMIN_PLANS]);
  });

  /**
   * LA MATRICE, LIGNE À LIGNE — recopiée depuis la page publique.
   *
   * Volontairement écrite à plat plutôt que dérivée du catalogue : un test qui
   * recalcule ce qu'il vérifie ne vérifie rien. Ces trois listes sont celles
   * que lit un prospect ; si le catalogue s'en écarte, nous vendons autre
   * chose que ce que nous livrons.
   */
  it('applique exactement ce que la grille tarifaire promet', () => {
    expect([...CAPACITES_PAR_FORMULE.essentiel]).toEqual([
      'pos',
      'kds',
      'print',
      'offline',
      'bo',
      'menu',
    ]);
    expect([...CAPACITES_PAR_FORMULE.complet]).toEqual([
      'pos',
      'kds',
      'print',
      'offline',
      'bo',
      'menu',
      'planning',
      'stocks',
    ]);
    expect([...CAPACITES_PAR_FORMULE.boost]).toEqual([...CAPACITES]);
  });

  it('reste cumulative — « tout l’Essentiel, plus… »', () => {
    // C'est la phrase de la grille. Le jour où une formule cesserait d'inclure
    // la précédente, il faudra l'écrire à plat, et ce test le dira.
    const inclus = (f: Formule) => new Set<string>(CAPACITES_PAR_FORMULE[f]);
    for (const c of CAPACITES_PAR_FORMULE.essentiel) expect(inclus('complet').has(c)).toBe(true);
    for (const c of CAPACITES_PAR_FORMULE.complet) expect(inclus('boost').has(c)).toBe(true);
  });

  it('n’accorde AUCUNE capacité de formule à un client sans formule', () => {
    // « Atelier seul » : il n'a pas de colonne dans la grille, donc rien ne lui
    // a été promis. Ce qu'il a acheté à part lui revient par l'option.
    expect([...CAPACITES_SANS_FORMULE]).toEqual([]);
  });

  it('ne décrit dans le catalogue que des capacités qui existent', () => {
    const connues = new Set<string>(CAPACITES);
    for (const liste of Object.values(CAPACITES_PAR_FORMULE)) {
      for (const c of liste) expect(connues.has(c)).toBe(true);
    }
    for (const c of Object.values(CAPACITES_PAR_OPTION)) expect(connues.has(c)).toBe(true);
    for (const c of CAPACITES_SANS_GARDE) expect(connues.has(c)).toBe(true);
  });

  it('garde « support prioritaire » au catalogue sans en faire une garde', () => {
    // Un niveau de service HUMAIN : aucune route ne peut le vérifier, et la
    // grille tarifaire serait incomplète sans lui.
    expect([...CAPACITES_SANS_GARDE]).toEqual(['priority']);
  });
});

describe('la commande en ligne — par formule OU par option', () => {
  /**
   * Le résultat doit coïncider avec la règle de FACTURATION déjà en place
   * (`moduleFacture = onlineOrdering && plan !== 'boost'`, crm.ts) : le module
   * est compris dans Boost, et vendu 79 €/mois aux deux autres. Un client qui
   * paie doit l'avoir ; un client Boost qui ne le paie pas doit l'avoir aussi.
   */
  const cas: { plan: Formule; option: boolean; attendu: boolean }[] = [
    { plan: 'essentiel', option: false, attendu: false },
    { plan: 'essentiel', option: true, attendu: true },
    { plan: 'complet', option: false, attendu: false },
    { plan: 'complet', option: true, attendu: true },
    // Boost comprend le module SANS que le booléen soit posé — et c'est le cas
    // qui casserait en production si on l'oubliait : un client Boost n'a jamais
    // eu à cocher une option qu'il ne paie pas.
    { plan: 'boost', option: false, attendu: true },
    { plan: 'boost', option: true, attendu: true },
  ];

  for (const { plan, option, attendu } of cas) {
    it(`${plan} + option ${option} → commande en ligne ${attendu}`, () => {
      expect(aLaCapacite({ plan, onlineOrdering: option }, 'online')).toBe(attendu);
    });
  }

  it('rend le module au client SANS formule qui l’a acheté seul', () => {
    expect(aLaCapacite({ plan: null, onlineOrdering: true }, 'online')).toBe(true);
    expect(aLaCapacite({ plan: null, onlineOrdering: false }, 'online')).toBe(false);
  });

  it('n’ouvre rien sur une valeur qui n’est pas exactement `true`', () => {
    // Une lecture Mongo peut rendre `'true'`, `1`, ou le champ absent. Aucun de
    // ces trois n'est une souscription : le module se facture 79 € par mois.
    for (const valeur of ['true', 1, {}, null, undefined]) {
      expect(aLaCapacite({ plan: 'complet', onlineOrdering: valeur }, 'online')).toBe(false);
    }
  });
});

describe('les capacités effectives', () => {
  it('donne à la formule ce que le catalogue lui donne', () => {
    expect(capacitesEffectives({ plan: 'essentiel', onlineOrdering: false })).toEqual([
      ...CAPACITES_PAR_FORMULE.essentiel,
    ]);
    expect(capacitesEffectives({ plan: 'boost' })).toEqual([...CAPACITES]);
  });

  it('ferme bien ce que la grille vend « non inclus »', () => {
    // Le défaut que ce chantier répare : un client à 99 € disposait du
    // planning, des stocks, de la fidélité et de la commande en ligne.
    const essentiel = capacitesEffectives({ plan: 'essentiel' });
    for (const fermee of ['planning', 'stocks', 'online', 'loyalty'] as const) {
      expect(essentiel).not.toContain(fermee);
    }
    const complet = capacitesEffectives({ plan: 'complet' });
    expect(complet).toContain('planning');
    expect(complet).toContain('stocks');
    for (const fermee of ['online', 'loyalty'] as const) expect(complet).not.toContain(fermee);
  });

  it('rend les capacités dans l’ordre du catalogue, quoi qu’il arrive', () => {
    const brouillon = capacitesEffectives({
      plan: 'essentiel',
      derogationsCapacite: [
        { capacite: 'loyalty', sens: 'accordee', motif: 'geste', auteur: 'SM' },
        { capacite: 'online', sens: 'accordee', motif: 'geste', auteur: 'SM' },
      ],
    });
    expect(brouillon).toEqual(CAPACITES.filter((c) => brouillon.includes(c)));
  });
});

describe('les dérogations', () => {
  const geste = (capacite: Capacite, sens: 'accordee' | 'retiree') => ({
    capacite,
    sens,
    motif: 'reprise de son ancien logiciel',
    auteur: 'Équipe SM',
    le: '2026-09-02T10:00:00.000Z',
  });

  it('ouvre une capacité hors formule', () => {
    // C'est ce qui permet d'appliquer la grille sans casser un client qui
    // utilise depuis un an une fonction que sa formule ne couvre pas : une
    // ligne datée et motivée, plutôt qu'une formule changée qui fausserait sa
    // facture et le MRR du CRM.
    expect(aLaCapacite({ plan: 'essentiel' }, 'loyalty')).toBe(false);
    expect(
      aLaCapacite(
        { plan: 'essentiel', derogationsCapacite: [geste('loyalty', 'accordee')] },
        'loyalty',
      ),
    ).toBe(true);
  });

  it('ferme une capacité malgré la formule', () => {
    expect(
      aLaCapacite(
        { plan: 'boost', derogationsCapacite: [geste('loyalty', 'retiree')] },
        'loyalty',
      ),
    ).toBe(false);
  });

  it('fait toujours gagner le retrait, quel que soit l’ordre des lignes', () => {
    // Un octroi ancien ne ressuscite pas une capacité retirée parce qu'il a été
    // écrit après : on rend la capacité en RETIRANT la ligne de retrait.
    const dansUnSens = capacitesEffectives({
      plan: 'boost',
      derogationsCapacite: [geste('stocks', 'accordee'), geste('stocks', 'retiree')],
    });
    const dansLAutre = capacitesEffectives({
      plan: 'boost',
      derogationsCapacite: [geste('stocks', 'retiree'), geste('stocks', 'accordee')],
    });
    expect(dansUnSens).toEqual(dansLAutre);
    expect(dansUnSens).not.toContain('stocks');
  });

  it('exige un motif et un auteur — « je crois que c’était pour… » n’est pas une réponse', () => {
    const bonne = geste('online', 'accordee');
    expect(DerogationCapaciteSchema.safeParse(bonne).success).toBe(true);
    expect(DerogationCapaciteSchema.safeParse({ ...bonne, motif: '  ' }).success).toBe(false);
    expect(DerogationCapaciteSchema.safeParse({ ...bonne, auteur: '' }).success).toBe(false);
    expect(DerogationCapaciteSchema.safeParse({ ...bonne, capacite: 'inventee' }).success).toBe(
      false,
    );
    expect(DerogationCapaciteSchema.safeParse({ ...bonne, sens: 'peut-etre' }).success).toBe(false);
    // Une clé inattendue dans un corps de requête est une tentative, pas une
    // tolérance — même règle que partout ailleurs dans ces contrats.
    expect(DerogationCapaciteSchema.safeParse({ ...bonne, tenantId: 'x' }).success).toBe(false);
  });

  it('ignore une ligne illisible plutôt que de fermer un restaurant', () => {
    // Le parc historique et les reprises manuelles écrivent n'importe quoi. Une
    // ligne qu'on ne sait pas lire ne doit ni lever ni compter.
    const capacites = capacitesEffectives({
      plan: 'complet',
      derogationsCapacite: [null, 'retiree', { capacite: 'inconnue', sens: 'retiree' }, {}],
    });
    expect(capacites).toEqual([...CAPACITES_PAR_FORMULE.complet]);
  });
});

describe('la lecture d’un tenant réel', () => {
  it('ne casse jamais sur un document incomplet', () => {
    // `.lean()` ne matérialise pas les défauts, et le parc porte des tenants
    // créés avant chacun de ces champs. Le calcul décide si la vitrine d'un
    // restaurant prend des commandes ce soir : il rend une liste, toujours.
    expect(() => capacitesEffectives({})).not.toThrow();
    expect(capacitesEffectives({})).toEqual([]);
    expect(capacitesEffectives({ plan: 'inconnue' })).toEqual([]);
    expect(capacitesEffectives({ plan: null, derogationsCapacite: null })).toEqual([]);
  });

  it('répond aussi sur une liste déjà calculée', () => {
    expect(souscrit(['menu'], 'menu')).toBe(true);
    expect(souscrit(['menu'], 'online')).toBe(false);
    expect(souscrit(null, 'menu')).toBe(false);
    expect(souscrit(undefined, 'menu')).toBe(false);
  });
});

describe('le refus d’une capacité', () => {
  it('parle de l’abonnement, jamais d’une formule ni d’un droit', () => {
    const message = capaciteNonSouscriteMessage('online');
    // Le libellé PUBLIÉ, mot pour mot : le restaurateur doit reconnaître la
    // ligne qu'il a lue sur la grille avant de signer.
    expect(message).toContain(CAPACITE_LABELS.online);
    expect(message).toContain('abonnement');
    for (const formule of FORMULES) expect(message.toLowerCase()).not.toContain(formule);
    // Un manque de capacité n'est pas un manque de droit : le mot ne doit pas
    // apparaître, sous peine de faire chercher au gérant une case à cocher.
    expect(message.toLowerCase()).not.toContain('droit');
  });
});

// ─────────────────────────────────────────────────────────────
// Le geste de l'équipe — accorder, retirer, lever
// ─────────────────────────────────────────────────────────────

describe('le corps de la route de dérogation', () => {
  const corps = {
    capacite: 'loyalty' as const,
    geste: 'accordee' as const,
    motif: 'Pilote fidélité — vendue en Boost, tournée en Complet',
  };

  it('accepte les trois gestes, et eux seuls', () => {
    expect([...GESTES_DEROGATION]).toEqual(['accordee', 'retiree', 'levee']);
    for (const geste of GESTES_DEROGATION) {
      expect(TenantCapaciteSchema.safeParse({ ...corps, geste }).success).toBe(true);
    }
    expect(TenantCapaciteSchema.safeParse({ ...corps, geste: 'peut-etre' }).success).toBe(false);
  });

  it('exige un motif — sur les trois gestes, levée comprise', () => {
    // « Pourquoi cette fonction a-t-elle rouvert le 12 mars » est la même
    // question que « pourquoi a-t-elle fermé », et elle se pose aussi souvent.
    for (const geste of GESTES_DEROGATION) {
      expect(TenantCapaciteSchema.safeParse({ ...corps, geste, motif: '' }).success).toBe(false);
      expect(TenantCapaciteSchema.safeParse({ ...corps, geste, motif: '  ' }).success).toBe(false);
    }
  });

  it('refuse une capacité qui n’existe pas', () => {
    expect(TenantCapaciteSchema.safeParse({ ...corps, capacite: 'inventee' }).success).toBe(false);
  });

  it('n’accepte NI l’auteur NI la date depuis le client', () => {
    // Une exception commerciale se relit au litige : sa signature ne peut pas
    // venir de la même main que le geste. L'auteur vient du jeton, la date de
    // l'horloge du serveur.
    expect(TenantCapaciteSchema.safeParse({ ...corps, auteur: 'Un collègue' }).success).toBe(false);
    expect(
      TenantCapaciteSchema.safeParse({ ...corps, le: '2020-01-01T00:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('appliquer un geste sur les dérogations', () => {
  const signe = { auteur: 'sm@snackmanager.fr', le: '2026-09-02T10:00:00.000Z' };
  const existante = {
    capacite: 'stocks' as const,
    sens: 'retiree' as const,
    motif: 'litige en cours',
    auteur: 'sm@snackmanager.fr',
    le: '2026-06-01T08:00:00.000Z',
  };

  it('laisse UNE SEULE ligne par capacité — le geste remplace, il ne s’empile pas', () => {
    // Sans ce remplacement, accorder par-dessus un retrait ne rendrait rien :
    // le retrait l'emporte quel que soit l'ordre. L'opérateur verrait un geste
    // réussi et un écran qui ne bouge pas.
    const apres = appliquerDerogation([existante], {
      capacite: 'stocks',
      geste: 'accordee',
      motif: 'litige clos, fonction rendue',
      ...signe,
    });
    expect(apres).toHaveLength(1);
    expect(apres[0]!.sens).toBe('accordee');
    expect(aLaCapacite({ plan: 'complet', derogationsCapacite: apres }, 'stocks')).toBe(true);
  });

  it('lève une dérogation en la retirant, et rend la capacité à la formule', () => {
    const apres = appliquerDerogation([existante], {
      capacite: 'stocks',
      geste: 'levee',
      motif: 'posée par erreur sur le mauvais client',
      ...signe,
    });
    expect(apres).toEqual([]);
    expect(aLaCapacite({ plan: 'complet', derogationsCapacite: apres }, 'stocks')).toBe(true);
  });

  it('laisse intactes les dérogations des AUTRES capacités', () => {
    // Ce sont des exceptions commerciales distinctes, avec leur propre motif et
    // leur propre auteur : ce geste-ci n'en sait rien.
    const apres = appliquerDerogation([existante], {
      capacite: 'loyalty',
      geste: 'accordee',
      motif: 'pilote fidélité',
      ...signe,
    });
    expect(apres).toHaveLength(2);
    expect(apres.find((d) => d.capacite === 'stocks')).toEqual(existante);
  });

  it('signe la ligne posée avec l’auteur et la date qu’on lui donne', () => {
    const [ligne] = appliquerDerogation(null, {
      capacite: 'menu',
      geste: 'accordee',
      motif: 'client sans formule, doit éditer sa carte',
      ...signe,
    });
    expect(DerogationCapaciteSchema.safeParse(ligne).success).toBe(true);
    expect(ligne).toMatchObject({ capacite: 'menu', sens: 'accordee', ...signe });
  });

  it('lit une ligne stockée en base — `le` en Date, rendu en ISO', () => {
    const lues = lireDerogations([{ ...existante, le: new Date(existante.le) }]);
    expect(lues).toEqual([existante]);
    expect(lireDerogations([null, {}, { capacite: 'inconnue', sens: 'retiree' }])).toEqual([]);
  });
});

describe('d’où vient chaque capacité', () => {
  it('nomme la formule, l’option et la dérogation — trois gestes différents', () => {
    const detail = detailCapacites({
      plan: 'essentiel',
      onlineOrdering: true,
      derogationsCapacite: [
        { capacite: 'loyalty', sens: 'accordee', motif: 'pilote', auteur: 'sm', le: '2026-09-02' },
      ],
    });
    const de = (c: Capacite) => detail.find((d) => d.capacite === c)!;
    expect(de('pos')).toMatchObject({ acquise: true, origine: 'formule' });
    expect(de('online')).toMatchObject({ acquise: true, origine: 'option' });
    expect(de('loyalty')).toMatchObject({ acquise: true, origine: 'derogation' });
    // Ni vendue, ni accordée : « rien » est la réponse juste — pas une source
    // qu'on inventerait pour remplir la case.
    expect(de('planning')).toMatchObject({ acquise: false, origine: null });
  });

  it('montre la dérogation qui FERME une capacité, avec son motif', () => {
    const detail = detailCapacites({
      plan: 'boost',
      derogationsCapacite: [
        { capacite: 'online', sens: 'retiree', motif: 'litige', auteur: 'sm', le: '2026-09-02' },
      ],
    });
    const online = detail.find((d) => d.capacite === 'online')!;
    expect(online.acquise).toBe(false);
    expect(online.origine).toBe('derogation');
    expect(online.derogation?.motif).toBe('litige');
  });

  it('montre AUSSI une dérogation devenue sans effet — c’est elle qu’on lève', () => {
    // Une capacité comprise dans la formule et accordée en plus par un geste
    // ancien : l'origine reste « formule », mais la ligne doit apparaître,
    // sinon on ne peut pas la lever depuis l'écran.
    const detail = detailCapacites({
      plan: 'boost',
      derogationsCapacite: [
        { capacite: 'loyalty', sens: 'accordee', motif: 'geste', auteur: 'sm', le: '2026-09-02' },
      ],
    });
    const loyalty = detail.find((d) => d.capacite === 'loyalty')!;
    expect(loyalty).toMatchObject({ acquise: true, origine: 'formule' });
    expect(loyalty.derogation?.sens).toBe('accordee');
  });

  it('est le MIROIR exact de `capacitesEffectives`, jamais une seconde autorité', () => {
    for (const plan of [...FORMULES, null] as (Formule | null)[]) {
      for (const onlineOrdering of [false, true]) {
        const souscription = {
          plan,
          onlineOrdering,
          derogationsCapacite: [
            { capacite: 'stocks', sens: 'retiree', motif: 'm', auteur: 'a', le: '2026-09-02' },
            { capacite: 'menu', sens: 'accordee', motif: 'm', auteur: 'a', le: '2026-09-02' },
          ],
        };
        expect(
          detailCapacites(souscription)
            .filter((d) => d.acquise)
            .map((d) => d.capacite),
        ).toEqual([...capacitesEffectives(souscription)]);
      }
    }
  });

  it('rend TOUTE la matrice, y compris ce que le client n’a pas', () => {
    // C'est un écran de vente autant qu'un écran d'administration : « non
    // souscrit » est une information, la même que celle que le restaurateur
    // voit verrouillée dans sa navigation.
    expect(detailCapacites({ plan: null }).map((d) => d.capacite)).toEqual([...CAPACITES]);
    expect(detailCapacites({ plan: null }).every((d) => !d.acquise)).toBe(true);
  });
});
