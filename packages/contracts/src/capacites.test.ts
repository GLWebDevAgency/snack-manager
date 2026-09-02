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
  aLaCapacite,
  capacitesEffectives,
  capaciteNonSouscriteMessage,
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
