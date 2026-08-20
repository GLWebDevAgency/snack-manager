import { describe, expect, it } from 'vitest';
import { buildComparison, type ClockedShiftRow } from './planning.compare';
import type { PlannedShiftRow, StaffRow } from './planning.compute';

const LUNDI = { y: 2026, m: 8, d: 17 };
/** Lundi 24 août 00:00 Paris — la semaine du 17 est close après cet instant. */
const FIN_DE_SEMAINE = new Date('2026-08-23T22:00:00.000Z');
const APRES = new Date('2026-08-25T09:00:00.000Z');

const ALI: StaffRow = { id: 'ali', name: 'Ali', role: 'cuisine', hourlyCostCents: 1_500 };
const SARA: StaffRow = { id: 'sara', name: 'Sara', role: 'caisse', hourlyCostCents: 1_200 };

const planned = (
  over: Partial<PlannedShiftRow> & Pick<PlannedShiftRow, 'id' | 'staffId' | 'date'>,
): PlannedShiftRow => ({
  start: '18:00',
  end: '23:00',
  position: 'polyvalent',
  note: '',
  status: 'publie',
  ...over,
});

/** Pointage réel : « 18:02 → 23:47 » en heure parisienne (UTC+2 en août). */
const clocked = (staffId: string, day: string, from: string, to: string | null): ClockedShiftRow => ({
  staffId,
  clockIn: new Date(`2026-08-${day}T${from}:00.000Z`),
  clockOut: to ? new Date(`2026-08-${day}T${to}:00.000Z`) : null,
});

const compare = (input: {
  planned: PlannedShiftRow[];
  clocked: ClockedShiftRow[];
  staff?: StaffRow[];
  now?: Date;
}) =>
  buildComparison({
    weekStart: LUNDI,
    planned: input.planned,
    clocked: input.clocked,
    staff: input.staff ?? [ALI, SARA],
    now: input.now ?? APRES,
    weekEndsAt: FIN_DE_SEMAINE,
  });

describe('Confrontation prévu / pointé', () => {
  it('met l’écart sous les yeux du gérant, en heures et en euros', () => {
    const result = compare({
      // Prévu : 5 h le lundi soir.
      planned: [planned({ id: '1', staffId: 'ali', date: '2026-08-17' })],
      // Pointé : 16:00Z → 22:00Z, soit 6 h — une heure de plus que prévu.
      clocked: [clocked('ali', '17', '16:00', '22:00')],
    });

    const ali = result.rows.find((r) => r.staffId === 'ali');
    expect(ali?.plannedHours).toBe(5);
    expect(ali?.actualHours).toBe(6);
    expect(ali?.deltaHours).toBe(1);
    expect(ali?.plannedCostCents).toBe(7_500);
    expect(ali?.actualCostCents).toBe(9_000);
    // Une heure de dérive par soir, cinq soirs par semaine : c'est exactement
    // l'argent que le gérant découvre en fin de mois au lieu de le décider.
    expect(ali?.deltaCostCents).toBe(1_500);
  });

  it('écarte les brouillons du prévu, sans les cacher', () => {
    const result = compare({
      planned: [
        planned({ id: '1', staffId: 'ali', date: '2026-08-17' }),
        // Jamais publié : l'équipe ne l'a pas vu, il n'a engagé personne.
        planned({ id: '2', staffId: 'ali', date: '2026-08-18', status: 'brouillon' }),
      ],
      clocked: [clocked('ali', '17', '16:00', '21:00')],
    });

    expect(result.rows.find((r) => r.staffId === 'ali')?.plannedHours).toBe(5);
    expect(result.draftHoursIgnored).toBe(5);
    expect(result.note).toContain('services PUBLIÉS');
  });

  it('reprend l’arrondi à la demi-heure de l’écran Pointages', () => {
    // 16:00Z → 21:40Z = 5 h 40, arrondi à 5,5 h ; 21:47Z = 5 h 47, arrondi à
    // 6 h. Le gérant doit retrouver EXACTEMENT le total lu sur l'écran
    // Pointages, sinon il croit à une erreur de notre part.
    const bas = compare({ planned: [], clocked: [clocked('ali', '17', '16:00', '21:40')] });
    expect(bas.rows[0]?.actualHours).toBe(5.5);

    const haut = compare({ planned: [], clocked: [clocked('ali', '17', '16:00', '21:47')] });
    expect(haut.rows[0]?.actualHours).toBe(6);
    expect(haut.note).toContain('demi-heure');
  });

  it('exclut les pointages encore ouverts du total, mais les signale', () => {
    const result = compare({
      planned: [planned({ id: '1', staffId: 'sara', date: '2026-08-17' })],
      clocked: [clocked('sara', '17', '16:00', null)],
    });

    const sara = result.rows.find((r) => r.staffId === 'sara');
    // Une arrivée sans départ n'a pas de durée : la compter serait inventer.
    expect(sara?.actualHours).toBe(0);
    expect(sara?.openShifts).toBe(1);
    expect(result.totals.openShifts).toBe(1);
  });

  it('remonte celui qui pointe sans jamais avoir été prévu', () => {
    const result = compare({
      planned: [],
      clocked: [clocked('sara', '19', '16:00', '22:00')],
    });
    const sara = result.rows.find((r) => r.staffId === 'sara');
    expect(sara?.plannedHours).toBe(0);
    expect(sara?.actualHours).toBe(6);
    expect(sara?.deltaHours).toBe(6);
  });

  it('classe les plus gros écarts en tête', () => {
    const result = compare({
      planned: [
        planned({ id: '1', staffId: 'ali', date: '2026-08-17' }),
        planned({ id: '2', staffId: 'sara', date: '2026-08-17' }),
      ],
      clocked: [
        clocked('ali', '17', '16:00', '21:30'), // +0,5 h
        clocked('sara', '17', '16:00', '23:00'), // +2 h
      ],
    });
    expect(result.rows.map((r) => r.staffId)).toEqual(['sara', 'ali']);
  });

  it('totalise heures et euros sur toute l’équipe', () => {
    const result = compare({
      planned: [
        planned({ id: '1', staffId: 'ali', date: '2026-08-17' }),
        planned({ id: '2', staffId: 'sara', date: '2026-08-17' }),
      ],
      clocked: [clocked('ali', '17', '16:00', '22:00'), clocked('sara', '17', '16:00', '21:00')],
    });

    expect(result.totals.plannedHours).toBe(10);
    expect(result.totals.actualHours).toBe(11);
    expect(result.totals.deltaHours).toBe(1);
    expect(result.totals.plannedCostCents).toBe(7_500 + 6_000);
    expect(result.totals.actualCostCents).toBe(9_000 + 6_000);
    expect(result.totals.deltaCostCents).toBe(1_500);
  });

  it('ne prétend pas chiffrer un salarié non tarifé', () => {
    const result = compare({
      planned: [planned({ id: '1', staffId: 'extra', date: '2026-08-17' })],
      clocked: [clocked('extra', '17', '16:00', '22:00')],
      staff: [{ id: 'extra', name: 'Yanis', role: 'caisse', hourlyCostCents: null }],
    });

    const extra = result.rows[0];
    expect(extra?.deltaHours).toBe(1);
    expect(extra?.plannedCostCents).toBeNull();
    expect(extra?.deltaCostCents).toBeNull();
    // Aucune ligne chiffrée : le total en euros dit « je ne sais pas », pas 0.
    expect(result.totals.deltaCostCents).toBeNull();
  });

  it('prévient quand la semaine n’est pas terminée', () => {
    const enCours = compare({
      planned: [],
      clocked: [],
      now: new Date('2026-08-19T12:00:00.000Z'),
    });
    expect(enCours.weekInProgress).toBe(true);

    const close = compare({ planned: [], clocked: [] });
    expect(close.weekInProgress).toBe(false);
  });

  it('nomme le membre supprimé plutôt que de perdre ses heures', () => {
    const result = compare({
      planned: [],
      clocked: [clocked('parti', '17', '16:00', '22:00')],
      staff: [],
    });
    expect(result.rows[0]?.staffName).toBe('Membre supprimé');
    expect(result.totals.actualHours).toBe(6);
  });
});
