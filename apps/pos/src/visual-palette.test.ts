import { describe, expect, it } from 'vitest';
import { PALETTES } from '@sm/client-core';
import { ratioContraste } from '@sm/contracts';
import { visualPalette } from './visual-palette';

describe('adaptateur visuel POS', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`${mode} conserve les rôles fonctionnels et ne mute pas le thème partagé`, () => {
      const original = { ...PALETTES[mode] };
      const adapted = visualPalette(mode);
      for (const key of ['red', 'green', 'amber', 'gold', 'onAmber'] as const) {
        expect(adapted[key]).toBe(original[key]);
      }
      expect(Object.keys(adapted).sort()).toEqual(Object.keys(original).sort());
      expect(PALETTES[mode]).toEqual(original);
      expect(adapted).not.toBe(PALETTES[mode]);
    });

    it(`${mode} permet de lire les messages, prix et états sur chaque surface`, () => {
      const p = visualPalette(mode);
      for (const ink of ['text', 'mut', 'dimText', 'greenText', 'redText', 'amberText'] as const) {
        for (const background of ['bg', 'surface', 'surface2', 'railBg', 'footBg'] as const) {
          expect(ratioContraste(p[ink], p[background]), `${ink}/${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
