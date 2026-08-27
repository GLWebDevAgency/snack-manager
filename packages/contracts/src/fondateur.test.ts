import { describe, expect, it } from 'vitest';
import {
  EMPTY_SERVICES,
  FOUNDER_DISCOUNT_MONTHS,
  FOUNDER_DISCOUNT_RATE,
  MODULE_ORDERING_CENTS,
  abonnementMensuelCents,
  SOCIAL_CADENCE_CENTS,
  chiffrageFondateur,
  finRemiseFondateur,
  prixFondateurCents,
  proposalCents,
  remiseFondateurActive,
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

  it('arrondit au centime, jamais à la fraction', () => {
    // Aucun prix de la grille n'est impair aujourd'hui, mais une révision
    // future le sera, et une facture ne se règle pas en demi-centimes.
    expect(prixFondateurCents(9_999)).toBe(5_000);
    expect(prixFondateurCents(1)).toBe(1);
    expect(Number.isInteger(prixFondateurCents(14_901))).toBe(true);
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
  const client = {
    plan: 'complet' as const,
    onlineOrdering: true,
    atelier: { ...EMPTY_SERVICES, presenceInternet: true },
  };
  const PUBLIC = 15_900 + MODULE_ORDERING_CENTS + 6_900;

  it('sans place fondateur, c’est le tarif public', () => {
    expect(abonnementMensuelCents(client)).toBe(PUBLIC);
  });

  it('pendant les douze mois, c’est la moitié', () => {
    expect(
      abonnementMensuelCents(
        { ...client, founderUntil: '2027-08-27T10:00:00.000Z' },
        new Date('2027-01-15T00:00:00.000Z'),
      ),
    ).toBe(prixFondateurCents(PUBLIC));
  });

  it('le treizième mois, il bascule au tarif public sans qu’on fasse un geste', () => {
    expect(
      abonnementMensuelCents(
        { ...client, founderUntil: '2027-08-27T10:00:00.000Z' },
        new Date('2027-08-28T00:00:00.000Z'),
      ),
    ).toBe(PUBLIC);
  });

  it('une date de fin absente ne vaut jamais « remise à vie »', () => {
    expect(abonnementMensuelCents({ ...client, founderUntil: null })).toBe(PUBLIC);
  });
});
