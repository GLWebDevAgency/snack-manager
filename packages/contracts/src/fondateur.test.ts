import { describe, expect, it } from 'vitest';
import {
  EMPTY_SERVICES,
  FOUNDER_DISCOUNT_MONTHS,
  FOUNDER_DISCOUNT_RATE,
  MODULE_ORDERING_CENTS,
  abonnementMensuelCents,
  offreClient,
  SOCIAL_CADENCE_CENTS,
  chiffrageFondateur,
  finRemiseFondateur,
  prixFondateurCents,
  proposalCents,
  remiseFondateurActive,
  remiseFondateurCents,
  remiseFondateurContrat,
} from './crm';

/**
 * L'OFFRE FONDATEUR — dix places à moitié prix, pendant un an.
 *
 * Le drapeau `founderSeat` existait depuis le début et ne changeait AUCUN
 * prix : le CRM promettait « 10 places à tarif gelé à vie » dans son bandeau,
 * et pas une ligne de code ne l'appliquait. La promesse était donc invérifiable
 * — et un client fondateur payait le tarif public sans que personne s'en
 * aperçoive.
 *
 * La règle arrêtée le 27/08/2026 remplace le gel à vie : **−50 % pendant douze
 * mois**, sur TOUT le premier contrat — formule, module, mise en service,
 * ponctuels de l'Atelier et mensuels. Ce qui est ajouté après le contrat
 * initial se paie plein tarif, et au bout de douze mois le client bascule au
 * tarif public sans qu'on ait un geste à faire.
 *
 * La remise est une couche COMMERCIALE posée sur la grille, jamais mêlée à
 * elle : `proposalCents` continue de dire le tarif public, `chiffrageFondateur`
 * dit ce que ce client-là paiera. Deux fonctions, deux responsabilités — et
 * une grille qu'on peut réviser sans toucher aux remises accordées.
 */

describe('le prix fondateur', () => {
  it('c’est la moitié, et la moitié se dit sans calcul', () => {
    expect(FOUNDER_DISCOUNT_RATE).toBe(0.5);
    expect(prixFondateurCents(15_900)).toBe(7_950);
    expect(prixFondateurCents(MODULE_ORDERING_CENTS)).toBe(3_950);
  });

  it('arrondit au centime, et le demi-centime va au client', () => {
    // Aucun prix de la grille n'est impair aujourd'hui, mais une révision
    // future le sera, et une facture ne se règle pas en demi-centimes.
    // Le sens de l'arrondi n'est pas indifférent : `Money.percent`, dans le
    // domaine, arrondit déjà en faveur du client. Deux primitives de remise
    // qui penchent en sens contraire produisent deux totaux pour une offre.
    expect(remiseFondateurCents(9_999)).toBe(5_000);
    expect(prixFondateurCents(9_999)).toBe(4_999);
    expect(prixFondateurCents(1)).toBe(0);
    expect(Number.isInteger(prixFondateurCents(14_901))).toBe(true);
  });

  it('la remise et le prix remisé se recomposent toujours', () => {
    // La propriété qui interdit le centime perdu, quel que soit l'arrondi.
    for (const cents of [0, 1, 9_999, 14_901, 15_900, 23_800, 7]) {
      expect(prixFondateurCents(cents) + remiseFondateurCents(cents)).toBe(cents);
    }
  });

  it('zéro reste zéro — on ne fabrique pas une remise sur rien', () => {
    expect(prixFondateurCents(0)).toBe(0);
  });
});

describe('la durée de la remise', () => {
  it('douze mois après la signature, jour pour jour', () => {
    expect(FOUNDER_DISCOUNT_MONTHS).toBe(12);
    expect(finRemiseFondateur(new Date('2026-08-27T10:00:00.000Z')).toISOString()).toBe(
      '2027-08-27T10:00:00.000Z',
    );
  });

  it('un 29 février signe jusqu’au 28 février suivant — jamais le 1er mars', () => {
    // Le décalage naïf d'un mois en JavaScript déborde sur le mois suivant.
    // Une remise qui dure un jour de trop est un cadeau ; un jour de moins,
    // une réclamation.
    expect(finRemiseFondateur(new Date('2028-02-29T09:00:00.000Z')).toISOString()).toBe(
      '2029-02-28T09:00:00.000Z',
    );
  });

  it('court jusqu’à la dernière seconde, puis s’arrête', () => {
    const fin = '2027-08-27T10:00:00.000Z';
    expect(remiseFondateurActive(fin, new Date('2027-08-27T09:59:59.000Z'))).toBe(true);
    expect(remiseFondateurActive(fin, new Date('2027-08-27T10:00:00.000Z'))).toBe(false);
    expect(remiseFondateurActive(fin, new Date('2027-08-28T00:00:00.000Z'))).toBe(false);
  });

  it('sans date de fin, il n’y a pas de remise — jamais « à vie » par défaut', () => {
    // Un client sans place fondateur porte `null`. Traiter l'absence comme
    // une remise sans terme est exactement le défaut qu'on répare.
    expect(remiseFondateurActive(null, new Date())).toBe(false);
    expect(remiseFondateurActive(undefined, new Date())).toBe(false);
  });
});

describe('le chiffrage d’un fondateur', () => {
  const contrat = {
    plan: 'complet' as const,
    onlineOrdering: true,
    services: { ...EMPTY_SERVICES, siteVitrine: true, presenceInternet: true, reseauxSociaux: 'hebdo' as const },
  };

  it('la moitié sur TOUT : le logiciel, les services et les ponctuels', () => {
    const publie = proposalCents(contrat);
    const fondateur = chiffrageFondateur(publie);
    expect(fondateur.monthlyCents).toBe(prixFondateurCents(publie.monthlyCents));
    expect(fondateur.servicesMonthlyCents).toBe(prixFondateurCents(publie.servicesMonthlyCents));
    expect(fondateur.setupOnceCents).toBe(prixFondateurCents(publie.setupOnceCents));
  });

  it('le site internet est remisé lui aussi — c’est tout le devis, pas le seul logiciel', () => {
    const publie = proposalCents({ plan: null, onlineOrdering: false, services: { ...EMPTY_SERVICES, siteVitrine: true } });
    expect(chiffrageFondateur(publie).setupOnceCents).toBe(prixFondateurCents(publie.setupOnceCents));
    expect(chiffrageFondateur(publie).setupOnceCents).toBeGreaterThan(0);
  });

  it('les chiffres d’un Complet avec module et réseaux, en clair', () => {
    const fondateur = chiffrageFondateur(proposalCents(contrat));
    // 159 + 79 = 238 € publics → 119 € ; présence 69 + hebdo 149 = 218 € → 109 €.
    expect(fondateur.monthlyCents).toBe(11_900);
    expect(fondateur.servicesMonthlyCents).toBe(prixFondateurCents(6_900 + SOCIAL_CADENCE_CENTS.hebdo));
  });

  it('ne touche pas au chiffrage public : les deux coexistent', () => {
    const publie = proposalCents(contrat);
    const avant = { ...publie };
    chiffrageFondateur(publie);
    expect(publie).toEqual(avant);
  });
});

/**
 * CE QUE LE FONDATEUR PAIE VRAIMENT CHAQUE MOIS.
 *
 * `abonnementMensuelCents` est la source unique du montant récurrent : elle
 * alimente le MRR de la fiche, la facture par défaut, la projection
 * d'échéance et l'écran du restaurateur. Elle doit donc rendre le montant
 * FACTURÉ, remise comprise — sinon chaque appelant devrait penser à la
 * remise, et l'un d'eux l'oublierait.
 *
 * Pour afficher le tarif public à côté (« 238 € — vous payez 119 € »), on
 * l'appelle sans date de fin : l'absence de remise est un cas normal, pas une
 * exception.
 */
describe('abonnementMensuelCents et la remise fondateur', () => {
  const contrat = {
    plan: 'complet' as const,
    onlineOrdering: true,
    atelier: { ...EMPTY_SERVICES, presenceInternet: true },
  };
  const PUBLIC = 15_900 + MODULE_ORDERING_CENTS + 6_900;
  const REMISE = remiseFondateurContrat(contrat);
  /** Le client tel qu'il sort de la conversion : droit, terme ET montant. */
  const fondateur = offreClient({
    ...contrat,
    founderUntil: '2027-08-27T10:00:00.000Z',
    founderDiscountCents: REMISE,
  });
  const PENDANT = new Date('2027-01-15T00:00:00.000Z');

  it('sans place fondateur, c’est le tarif public', () => {
    expect(abonnementMensuelCents(offreClient(contrat))).toBe(PUBLIC);
  });

  it('pendant les douze mois, c’est la moitié', () => {
    // Vérifié contre la grille, PAS contre `prixFondateurCents(PUBLIC)` : se
    // comparer à la même fonction laisserait passer toute erreur symétrique.
    expect(REMISE).toBe(7_950 + 3_950 + 3_450);
    expect(abonnementMensuelCents(fondateur, PENDANT)).toBe(15_350);
  });

  it('le treizième mois, il bascule au tarif public sans qu’on fasse un geste', () => {
    expect(abonnementMensuelCents(fondateur, new Date('2027-08-28T00:00:00.000Z'))).toBe(PUBLIC);
  });

  it('une date de fin absente ne vaut jamais « remise à vie »', () => {
    expect(abonnementMensuelCents(offreClient({ ...contrat, founderUntil: null }))).toBe(PUBLIC);
  });

  /**
   * L'INVARIANT LE PLUS COÛTEUX DE TOUTE LA FACTURATION.
   *
   * La remise a été vendue sur « ce qu'on signe aujourd'hui ». Tant qu'elle
   * était un pourcentage appliqué à l'offre courante, un fondateur qui montait
   * en gamme au onzième mois obtenait la moitié sur sa nouvelle offre — et le
   * CRM offre précisément un bouton pour changer d'offre en un clic.
   *
   * Ces trois tests sont la raison d'être du montant figé. S'ils tombent, la
   * remise est redevenue un pourcentage et l'entreprise perd de l'argent en
   * silence, sans qu'aucun écran ne l'indique.
   */
  it('ce qui est ajouté APRÈS la signature se paie plein tarif', () => {
    const apres = offreClient({
      ...contrat,
      atelier: { ...EMPTY_SERVICES, presenceInternet: true, reseauxSociaux: 'hebdo' },
      founderUntil: '2027-08-27T10:00:00.000Z',
      founderDiscountCents: REMISE,
    });
    const ajoute = SOCIAL_CADENCE_CENTS.hebdo;
    expect(abonnementMensuelCents(apres, PENDANT)).toBe(15_350 + ajoute);
  });

  it('monter en gamme ne relance pas la remise', () => {
    const monte = offreClient({
      ...contrat,
      plan: 'boost',
      founderUntil: '2027-08-27T10:00:00.000Z',
      founderDiscountCents: REMISE,
    });
    // Boost comprend le module : le public passe de 30 700 à 26 800, et la
    // remise reste celle du contrat signé — 15 350, pas la moitié de 26 800.
    expect(abonnementMensuelCents(monte, PENDANT)).toBe(26_800 - REMISE);
    expect(abonnementMensuelCents(monte, PENDANT)).not.toBe(prixFondateurCents(26_800));
  });

  it('rétrograder sous la remise ne fabrique jamais un avoir', () => {
    const minuscule = offreClient({
      plan: null,
      onlineOrdering: false,
      atelier: { ...EMPTY_SERVICES, presenceInternet: true },
      founderUntil: '2027-08-27T10:00:00.000Z',
      founderDiscountCents: REMISE,
    });
    // 6 900 dûs, 15 350 de remise : zéro, jamais un négatif que la
    // facturation lirait comme une somme à rendre.
    expect(abonnementMensuelCents(minuscule, PENDANT)).toBe(0);
  });
});

