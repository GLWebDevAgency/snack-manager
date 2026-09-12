import { describe, expect, it } from 'vitest';
import { PALETTES, timerColor, TIMER_THRESHOLDS } from '@sm/client-core';
import { ratioContraste } from '@sm/contracts';
import { visualPalette } from './visual-palette';

describe('adaptateur visuel cuisine', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} garde les couleurs reconnues par la minuterie et les statuts`, () => {
      const original = { ...PALETTES[mode] };
      const p = visualPalette(mode);
      expect(p.green).toBe(timerColor(TIMER_THRESHOLDS.warn - 1));
      expect(p.amber).toBe(timerColor(TIMER_THRESHOLDS.warn));
      expect(p.red).toBe(timerColor(TIMER_THRESHOLDS.late));
      expect(p.gold).toBe(original.gold);
      expect(p.onAmber).toBe(original.onAmber);
      expect(PALETTES[mode]).toEqual(original);
      expect(Object.keys(p).sort()).toEqual(Object.keys(original).sort());
    });

    it(`${mode} garde les notes et minuteurs lisibles sur les surfaces opaques`, () => {
      const p = visualPalette(mode);
      for (const ink of ['text', 'mut', 'dimText', 'greenText', 'redText', 'amberText'] as const) {
        for (const background of ['bg', 'surface', 'surface2'] as const) {
          expect(ratioContraste(p[ink], p[background]), `${ink}/${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
