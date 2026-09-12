import { describe, expect, it } from 'vitest';
import { cardWidth, catalogColumnsFor, columnsFor, computeLayout } from './layout';

describe('Densité du catalogue', () => {
  it('offre trois grandes cartes sur le comptoir de référence du handoff', () => {
    const layout = computeLayout(1512, 982);
    const available = layout.width - layout.ticketW - layout.gridPad * 2;
    expect(catalogColumnsFor(available, layout, 'comfortable')).toBe(3);
    expect(cardWidth(available, 3, layout.gridGap)).toBeGreaterThan(280);
  });

  it('garde la densité historique disponible sur toutes les dispositions', () => {
    for (const width of [390, 768, 1024, 1280, 1512, 1920]) {
      const layout = computeLayout(width, 900);
      for (const available of [width - 32, width - layout.ticketW - layout.railW - 32]) {
        expect(catalogColumnsFor(available, layout, 'compact')).toBe(columnsFor(available, layout));
      }
    }
  });

  it('conserve des prix lisibles en portrait et ne dépasse jamais la grille', () => {
    for (const width of [320, 390, 768, 820, 1024, 1512, 1920]) {
      const layout = computeLayout(width, 982);
      const available = width - (layout.compact ? 0 : layout.ticketW) - layout.gridPad * 2;
      const cols = catalogColumnsFor(available, layout, 'comfortable');
      const card = cardWidth(available, cols, layout.gridGap);
      expect(cols).toBeGreaterThanOrEqual(2);
      expect(card).toBeGreaterThanOrEqual(128);
      expect(card * cols + layout.gridGap * (cols - 1)).toBeCloseTo(available);
    }
  });
});
