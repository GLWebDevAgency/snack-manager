import { describe, expect, it } from 'vitest';
import { EMPTY_SERVICES, MODULE_ORDERING_CENTS, PLAN_MRR_CENTS } from '@sm/contracts';
import { repriseFondateur } from './backfill-founder';

/**
 * LA REPRISE DES FONDATEURS D'AVANT.
 *
 * Le CRM a porté pendant des mois une promesse de « tarif gelé à vie » que rien
 * n'appliquait. Le 27/08/2026 elle est devenue « moitié prix pendant douze
 * mois », avec deux champs pour la porter — et les clients déjà au parc n'ont ni
 * l'un ni l'autre : leur écran leur affiche « Fondateur — moitié prix » à côté
 * d'un montant plein tarif.
 *
 * Cette décision touche à de vrais montants sur de vrais clients. Elle est
 * testée AVANT d'être lancée, ce qu'un script mêlé à Mongo ne permet pas.
 */

const NOW = new Date('2026-08-28T12:00:00.000Z');

describe('la reprise d’un fondateur', () => {
  it('date la remise depuis la SIGNATURE, pas depuis aujourd’hui', () => {
    const r = repriseFondateur({ createdAt: new Date('2026-03-15T09:00:00.000Z') }, NOW);
    expect(r.until.toISOString().slice(0, 10)).toBe('2027-03-15');
    expect(r.eteinte).toBe(false);
  });

  it('fige la remise sur l’offre du client — composante par composante', () => {
    const r = repriseFondateur(
      {
        createdAt: NOW,
        plan: 'complet',
        onlineOrdering: true,
        atelier: { ...EMPTY_SERVICES, presenceInternet: true },
      },
      NOW,
    );
    // La moitié de chaque composante, comme le devis la remise ligne à ligne.
    expect(r.remise).toBe(
      Math.ceil(PLAN_MRR_CENTS.complet / 2) + Math.ceil(MODULE_ORDERING_CENTS / 2) + 3_450,
    );
  });

  it('signale une remise DÉJÀ ÉTEINTE plutôt que de la prolonger en douce', () => {
    // Un fondateur signé il y a plus de douze mois : sa remise est finie.
    // La prolonger est une décision commerciale, pas une migration.
    const r = repriseFondateur({ createdAt: new Date('2025-01-10T00:00:00.000Z') }, NOW);
    expect(r.eteinte).toBe(true);
  });

  /**
   * L'IDEMPOTENCE EST LA GARANTIE LA PLUS IMPORTANTE DE CE SCRIPT.
   *
   * Un second passage qui recalculerait la remise sur l'offre COURANTE
   * relancerait exactement le défaut que le montant figé existe pour empêcher :
   * un fondateur qui a monté en gamme depuis sa signature verrait sa remise
   * suivre sa nouvelle offre.
   */
  it('ne recalcule JAMAIS un champ déjà posé', () => {
    const r = repriseFondateur(
      {
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        founderUntil: new Date('2026-12-31T00:00:00.000Z'),
        founderDiscountCents: 7_950,
        // Offre entre-temps augmentée : elle ne doit RIEN changer.
        plan: 'boost',
        onlineOrdering: true,
      },
      NOW,
    );
    expect(r.remise).toBe(7_950);
    expect(r.until.toISOString().slice(0, 10)).toBe('2026-12-31');
  });

  it('un tenant sans date de création part d’aujourd’hui, plutôt que de n’exister jamais', () => {
    const r = repriseFondateur({}, NOW);
    expect(r.signeLe).toEqual(NOW);
    expect(r.until.toISOString().slice(0, 10)).toBe('2027-08-28');
  });

  it('un client sans formule ni service n’a rien à remiser', () => {
    const r = repriseFondateur({ createdAt: NOW, plan: null, atelier: null }, NOW);
    expect(r.remise).toBe(0);
  });
});
