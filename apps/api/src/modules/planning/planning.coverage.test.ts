import type { StatsHeatmapCell } from '@sm/contracts';
import { describe, expect, it } from 'vitest';
import { buildCoverage } from './planning.coverage';
import type { PlannedShiftRow } from './planning.compute';

const LUNDI = { y: 2026, m: 8, d: 17 }; // lundi 17 août 2026 → samedi = 2026-08-22

const shift = (
  over: Partial<PlannedShiftRow> & Pick<PlannedShiftRow, 'id' | 'staffId' | 'date'>,
): PlannedShiftRow => ({
  start: '18:00',
  end: '23:00',
  position: 'polyvalent',
  note: '',
  status: 'brouillon',
  ...over,
});

/**
 * Heatmap telle que `StatsService.heatmap` la rend : cumul de trente jours,
 * par jour ISO et par heure. Le samedi soir chargé reprend les ordres de
 * grandeur réellement observés sur le tenant de staging.
 */
function heatmap(entries: Record<number, Record<number, number>>): StatsHeatmapCell[] {
  const cells: StatsHeatmapCell[] = [];
  for (let day = 1; day <= 7; day++) {
    for (let hour = 11; hour <= 23; hour++) {
      cells.push({ day, hour, orders: entries[day]?.[hour] ?? 0 });
    }
  }
  return cells;
}

/** Samedi (jour 6) : midi tranquille, soir très chargé — 129 commandes à 20 h sur 30 j. */
const SAMEDI_CHARGE = heatmap({
  6: { 11: 21, 12: 51, 13: 33, 18: 34, 19: 113, 20: 129, 21: 54, 22: 4 },
});

const blockOf = (coverage: ReturnType<typeof buildCoverage>, date: string, service: string) =>
  coverage.blocks.find((b) => b.date === date && b.service === service);

describe('Adéquation du planning au volume attendu', () => {
  it('reprend le diviseur du tableau de bord : 30 jours = 4 occurrences du même jour', () => {
    const coverage = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: SAMEDI_CHARGE });
    const soir = blockOf(coverage, '2026-08-22', 'soir');

    // (34 + 113 + 129 + 54 + 4) / 4 = 83,5 → 84 commandes attendues.
    expect(soir?.expectedOrders).toBe(84);
    // Heure de pointe : 129 / 4 ≈ 32 commandes.
    expect(soir?.expectedPeakHourOrders).toBe(32);
  });

  it('dit clairement qu’aucun service n’est prévu sur un créneau chargé', () => {
    const coverage = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: SAMEDI_CHARGE });
    const soir = blockOf(coverage, '2026-08-22', 'soir');

    expect(soir?.verdict).toBe('sans-service');
    expect(soir?.peoplePlanned).toBe(0);
    expect(soir?.window).toBeNull();
    expect(soir?.message).toBe(
      'Samedi soir : aucun service prévu pour un volume attendu de 84 commandes.',
    );
  });

  it('constate le sous-effectif sur le repère du tableau de bord', () => {
    // Au-delà de 25 commandes sur l'heure de pointe, le tableau de bord annonce
    // « 2 en cuisine + 1 comptoir ». Deux personnes posées : on le CONSTATE.
    const coverage = buildCoverage({
      weekStart: LUNDI,
      heatmap: SAMEDI_CHARGE,
      shifts: [
        shift({ id: '1', staffId: 'ali', date: '2026-08-22' }),
        shift({ id: '2', staffId: 'sara', date: '2026-08-22' }),
      ],
    });
    const soir = blockOf(coverage, '2026-08-22', 'soir');

    expect(soir?.peoplePlanned).toBe(2);
    expect(soir?.referencePeople).toBe(3);
    expect(soir?.verdict).toBe('sous-effectif');
    expect(soir?.window).toEqual({ start: '18:00', end: '23:00' });
    expect(soir?.message).toContain('2 personnes prévues');
    expect(soir?.message).toContain('≈ 84 commandes attendues');
    expect(soir?.message).toContain('repère du tableau de bord');
  });

  it('constate aussi le sur-effectif — le creux du midi coûte aussi cher', () => {
    const coverage = buildCoverage({
      weekStart: LUNDI,
      heatmap: SAMEDI_CHARGE,
      shifts: [
        shift({ id: '1', staffId: 'ali', date: '2026-08-22', start: '11:00', end: '15:00' }),
        shift({ id: '2', staffId: 'sara', date: '2026-08-22', start: '11:00', end: '15:00' }),
        shift({ id: '3', staffId: 'yanis', date: '2026-08-22', start: '11:00', end: '15:00' }),
        shift({ id: '4', staffId: 'lea', date: '2026-08-22', start: '11:00', end: '15:00' }),
      ],
    });
    const midi = blockOf(coverage, '2026-08-22', 'midi');

    // (21 + 51 + 33) / 4 ≈ 26 commandes, pointe à 51/4 ≈ 13 → repère : 2.
    expect(midi?.expectedOrders).toBe(26);
    expect(midi?.referencePeople).toBe(2);
    expect(midi?.peoplePlanned).toBe(4);
    expect(midi?.verdict).toBe('sur-effectif');
  });

  /**
   * LE VOLUME ATTENDU NE DÉPEND PAS DE QUI EST POSÉ.
   *
   * Il se calculait sur les heures COUVERTES, et l'inversion était pernicieuse :
   * samedi soir sans personne annonçait « aucun service prévu pour ≈ 68
   * commandes attendues » ; le gérant posait UNE personne de 20 h à 21 h, la
   * demande retombait aux 32 commandes de cette heure-là, et le bloc passait au
   * vert. Le trou de 18 h à 20 h et de 21 h à 23 h avait disparu de l'écran —
   * l'indicateur s'était aligné sur le planning au lieu de le juger.
   *
   * La demande est une donnée du RESTAURANT : ce que la clientèle commande sur
   * l'amplitude du service, que quelqu'un soit là ou non. Les heures couvertes
   * mesurent la réponse à cette demande ; elles ne la définissent pas.
   */
  it('ne rétrécit PAS avec l’amplitude posée — sinon poser quelqu’un efface le trou', () => {
    const coverage = buildCoverage({
      weekStart: LUNDI,
      heatmap: SAMEDI_CHARGE,
      shifts: [shift({ id: '1', staffId: 'ali', date: '2026-08-22', start: '20:00', end: '21:00' })],
    });
    const soir = blockOf(coverage, '2026-08-22', 'soir');

    // Le volume du SOIR entier, pas celui de l'heure couverte.
    const sansPersonne = blockOf(
      buildCoverage({ weekStart: LUNDI, heatmap: SAMEDI_CHARGE, shifts: [] }),
      '2026-08-22',
      'soir',
    );
    expect(soir?.expectedOrders).toBe(sansPersonne?.expectedOrders);
    expect(soir?.expectedOrders).toBeGreaterThan(32);

    // Et la fenêtre affichée reste celle du service posé : c'est elle qui dit
    // au gérant ce qu'il a réellement couvert.
    expect(soir?.window).toEqual({ start: '20:00', end: '21:00' });
  });

  it('se tait quand aucun volume n’est attendu', () => {
    const coverage = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: SAMEDI_CHARGE });
    const lundiMidi = blockOf(coverage, '2026-08-17', 'midi');

    expect(lundiMidi?.verdict).toBe('sans-volume');
    expect(lundiMidi?.referencePeople).toBe(0);
    expect(lundiMidi?.message).toContain('aucun volume attendu');
  });

  it('avoue l’absence d’historique au lieu d’inventer une prévision', () => {
    const vide = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: heatmap({}) });
    expect(vide.hasForecast).toBe(false);
    expect(vide.blocks.every((b) => b.expectedOrders === 0)).toBe(true);

    const rempli = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: SAMEDI_CHARGE });
    expect(rempli.hasForecast).toBe(true);
  });

  it('formule des constats, jamais des ordres', () => {
    const coverage = buildCoverage({
      weekStart: LUNDI,
      heatmap: SAMEDI_CHARGE,
      shifts: [shift({ id: '1', staffId: 'ali', date: '2026-08-22' })],
    });
    // La décision reste au gérant : lui seul connaît ses contrats et ses extras.
    const injonctions = /vous devez|il faut|ajoutez|retirez|embauchez|supprimez/i;
    for (const block of coverage.blocks) {
      expect(block.message).not.toMatch(injonctions);
    }
    expect(coverage.disclaimer).toContain('ils ne décident pas');
  });

  it('couvre les quatorze créneaux de la semaine, dans l’ordre', () => {
    const coverage = buildCoverage({ weekStart: LUNDI, shifts: [], heatmap: SAMEDI_CHARGE });
    expect(coverage.blocks).toHaveLength(14);
    expect(coverage.week).toBe('2026-08-17');
    expect(coverage.weekEnd).toBe('2026-08-23');
    expect(coverage.blocks[0]?.label).toBe('Lundi');
    expect(coverage.blocks[0]?.service).toBe('midi');
    expect(coverage.blocks[13]?.label).toBe('Dimanche');
    expect(coverage.blocks[13]?.service).toBe('soir');
  });
});
