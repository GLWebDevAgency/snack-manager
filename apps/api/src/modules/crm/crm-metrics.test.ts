import { describe, expect, it } from 'vitest';
import {
  clientHealth,
  daysSince,
  founderSeatsRemaining,
  isOpenLeadStage,
  nextLeadStage,
  previousLeadStage,
  CLIENT_RISK_DAYS,
  FOUNDER_SEATS_TOTAL,
  LEAD_PIPELINE,
  LEAD_STAGES,
  LEAD_STAGE_LABELS,
  LeadUpdateSchema,
  MODULE_ORDERING_CENTS,
  MODULE_ORDERING_SETUP_CENTS,
  PLAN_MRR_CENTS,
  YEARLY_MONTHS_BILLED,
  yearlyCents,
} from '@sm/contracts';
import { buildSeedLeads, SEED_LEADS } from './crm.seed';

const DAY_MS = 86_400_000;
const NOW = new Date('2026-08-19T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS);

describe('Étapes du pipeline', () => {
  it('avance jusqu’à « signé » puis s’arrête', () => {
    expect(nextLeadStage('nouveau')).toBe('contacte');
    expect(nextLeadStage('proposition')).toBe('signe');
    expect(nextLeadStage('signe')).toBeNull();
  });

  it('recule jusqu’à « nouveau » puis s’arrête', () => {
    expect(previousLeadStage('signe')).toBe('proposition');
    expect(previousLeadStage('nouveau')).toBeNull();
  });

  it('traite « perdu » comme une sortie de route, pas comme une étape', () => {
    // Un lead perdu ne « progresse » pas : il se rouvre à la main, en le
    // reposant sur une étape choisie. L'avancer d'un cran n'a aucun sens.
    expect(nextLeadStage('perdu')).toBeNull();
    expect(previousLeadStage('perdu')).toBeNull();
    expect(LEAD_PIPELINE).not.toContain('perdu');
  });

  it('compte comme « en cours » tout sauf signé et perdu', () => {
    expect(LEAD_STAGES.filter(isOpenLeadStage)).toEqual([
      'nouveau',
      'contacte',
      'demo',
      'proposition',
    ]);
  });

  it('nomme les six étapes en français', () => {
    for (const stage of LEAD_STAGES) {
      expect(LEAD_STAGE_LABELS[stage], stage).toMatch(/\S/);
    }
  });
});

describe('Santé d’un restaurant client', () => {
  it('classe « à risque » un client sans commande depuis 7 jours', () => {
    expect(clientHealth(daysAgo(CLIENT_RISK_DAYS), NOW)).toBe('risque');
    expect(clientHealth(daysAgo(30), NOW)).toBe('risque');
  });

  it('classe « à risque » un client qui n’a jamais commandé', () => {
    // Jamais démarré ou arrêté depuis longtemps : dans les deux cas, un appel.
    expect(clientHealth(null, NOW)).toBe('risque');
  });

  it('classe « à suivre » entre 2 et 6 jours de silence', () => {
    expect(clientHealth(daysAgo(2), NOW)).toBe('attention');
    expect(clientHealth(daysAgo(6), NOW)).toBe('attention');
  });

  it('classe « bonne » un client qui a encaissé hier', () => {
    expect(clientHealth(daysAgo(1), NOW)).toBe('ok');
    expect(clientHealth(NOW, NOW)).toBe('ok');
  });

  it('ne renvoie jamais un nombre de jours négatif', () => {
    // Horloge d'un appareil en avance : la dernière commande peut être datée
    // du futur. « il y a −1 jour » n'a pas de sens à l'écran.
    expect(daysSince(new Date(NOW.getTime() + 3 * DAY_MS), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
  });
});

describe('Places fondateur', () => {
  it('décompte les places sur les 10 du programme', () => {
    expect(founderSeatsRemaining(0)).toBe(FOUNDER_SEATS_TOTAL);
    expect(founderSeatsRemaining(3)).toBe(7);
  });

  it('ne descend pas sous zéro si on a survendu', () => {
    expect(founderSeatsRemaining(12)).toBe(0);
  });
});

describe('MRR estimé', () => {
  it('chiffre les trois formules en centimes', () => {
    // Convention monorepo : jamais d'euros flottants en base ni en transit.
    for (const cents of Object.values(PLAN_MRR_CENTS)) {
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBeGreaterThan(0);
    }
    // LE SEUL LITTÉRAL LÉGITIME DE TOUTE LA FACTURATION : la formule pivot,
    // recopiée ici exprès pour qu'une révision de grille passe par une
    // relecture humaine. Partout ailleurs, l'attente se DÉRIVE de la table.
    // Grille arrêtée par le fondateur le 21/08/2026.
    expect(PLAN_MRR_CENTS.complet).toBe(15_900);
  });

  it('reste dans la fourchette officielle 99–199 €/mois', () => {
    // Un plan chiffré hors fourchette fausserait tout le MRR affiché en HQ
    // sans qu'aucun écran ne le signale.
    for (const cents of Object.values(PLAN_MRR_CENTS)) {
      expect(cents).toBeGreaterThanOrEqual(9_900);
      expect(cents).toBeLessThanOrEqual(19_900);
    }
  });

  /**
   * L'ÉCART QUI FAIT CHOISIR BOOST — vérifié, pas espéré.
   *
   * La carte tarifaire raconte une soustraction : Complet plus le module de
   * commande en ligne coûtent plus cher que Boost, qui les comprend. Ces
   * chiffres-là sont annoncés au prospect ; si quelqu'un remonte Complet ou
   * baisse Boost sans y penser, l'argument s'inverse en silence et la page
   * continue de promettre une économie qui n'existe plus.
   */
  it('garde Boost moins cher que Complet plus le module', () => {
    const attele = PLAN_MRR_CENTS.complet + MODULE_ORDERING_CENTS;
    expect(attele).toBeGreaterThan(PLAN_MRR_CENTS.boost);

    // Le premier mois porte en plus la mise en service, comprise dans Boost.
    const premierMois = attele + MODULE_ORDERING_SETUP_CENTS - PLAN_MRR_CENTS.boost;
    const moisSuivants = attele - PLAN_MRR_CENTS.boost;
    expect(premierMois).toBe(9_400); // 94 €
    expect(moisSuivants).toBe(3_900); // 39 € par mois

    // Sur un an d'abonnement mensuel : 2 911 € contre 2 388 €.
    expect(premierMois + 11 * moisSuivants).toBe(52_300); // 523 €
  });

  /**
   * DEUX MOIS OFFERTS : douze mois payés dix, et le montant annuel se DÉDUIT
   * toujours du mensuel. Deux grilles saisies à la main finiraient par
   * diverger, et c'est la moins relue qui partirait en facture.
   */
  it('déduit l’engagement annuel du mensuel, sans seconde grille', () => {
    expect(YEARLY_MONTHS_BILLED).toBe(10);
    expect(yearlyCents(PLAN_MRR_CENTS.essentiel)).toBe(99_000); // 990 €
    expect(yearlyCents(PLAN_MRR_CENTS.complet)).toBe(159_000); // 1 590 €
    expect(yearlyCents(PLAN_MRR_CENTS.boost)).toBe(199_000); // 1 990 €

    for (const cents of Object.values(PLAN_MRR_CENTS)) {
      // Deux mois offerts, donc exactement deux mensualités économisées.
      expect(12 * cents - yearlyCents(cents)).toBe(2 * cents);
    }
  });
});

describe('Mise à jour partielle d’un lead', () => {
  it('n’invente aucune valeur pour les champs absents', () => {
    // Le piège : `LeadCreateSchema.partial()` réinjecte les `.default()`, donc
    // un simple ajout de note remettait l'étape à « nouveau » et vidait le
    // contact. Le schéma d'update doit rester littéralement vide.
    expect(LeadUpdateSchema.parse({})).toEqual({});
    expect(LeadUpdateSchema.parse({ notes: 'rappelé' })).toEqual({ notes: 'rappelé' });
  });

  it('ne touche que la clé de contact fournie', () => {
    expect(LeadUpdateSchema.parse({ contact: { phone: '06 00 00 00 00' } })).toEqual({
      contact: { phone: '06 00 00 00 00' },
    });
  });
});

describe('Amorce du pipeline', () => {
  it('couvre les six étapes avec des prospects de la région', () => {
    const stages = new Set(SEED_LEADS.map((l) => l.stage));
    expect(stages.size).toBeGreaterThanOrEqual(5);
    expect(SEED_LEADS.length).toBeGreaterThanOrEqual(8);
  });

  it('date chaque lead avant sa première relance', () => {
    // Sinon la fiche affiche un prospect « créé aujourd'hui » relancé il y a
    // six semaines — et l'historique devient illisible.
    for (const lead of buildSeedLeads(NOW)) {
      for (const touch of lead.touches) {
        expect(touch.at.getTime(), lead.restaurantName).toBeGreaterThan(
          lead.createdAt.getTime(),
        );
      }
      expect(lead.updatedAt.getTime()).toBeGreaterThanOrEqual(lead.createdAt.getTime());
    }
  });

  it('ne réserve une place fondateur que sur des leads encore vivants', () => {
    for (const lead of SEED_LEADS) {
      if (lead.stage === 'perdu') expect(lead.founderSeatReserved).toBe(false);
    }
  });
});
