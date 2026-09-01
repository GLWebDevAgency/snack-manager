import { describe, expect, it } from 'vitest';
import { BrandSchema, DIRECTIONS, PRESET_KEYS, TYPE_PAIRS, TYPE_PAIR_KEYS } from './marque';

describe('le contrat brand', () => {
  it('accepte une direction complète telle quelle', () => {
    for (const key of PRESET_KEYS) {
      expect(() => BrandSchema.parse(DIRECTIONS[key])).not.toThrow();
    }
  });

  it('refuse une couleur qui n’est pas un hex à six chiffres', () => {
    const brasserie = DIRECTIONS.brasserie;
    const casse = { ...brasserie, palette: { ...brasserie.palette, accent: '#abc' } };
    expect(() => BrandSchema.parse(casse)).toThrow();
  });

  it('refuse une paire typographique hors de la liste curatée', () => {
    const casse = { ...DIRECTIONS.nuit, type: { pair: 'comic-sans' } };
    expect(() => BrandSchema.parse(casse)).toThrow();
  });

  it('chaque direction pointe sur une paire qui existe', () => {
    for (const key of PRESET_KEYS) {
      expect(TYPE_PAIR_KEYS).toContain(DIRECTIONS[key].type.pair);
      expect(DIRECTIONS[key].preset).toBe(key);
    }
  });

  it('les paires « prix en mono » déclarent une famille mono', () => {
    for (const key of TYPE_PAIR_KEYS) {
      const pair = TYPE_PAIRS[key];
      if (pair.prixMono) expect(pair.mono).toBeTruthy();
    }
  });
});

import { ajusterJusquaAA, alpha, luminance, melanger, ratioContraste, rgbVersHex, hexVersRgb } from './marque';

describe('la couleur en pur', () => {
  it('aller-retour hex ↔ rgb sans perte', () => {
    expect(hexVersRgb('#C9A15A')).toEqual([201, 161, 90]);
    expect(rgbVersHex([201, 161, 90])).toBe('#c9a15a');
  });

  it('le contraste blanc/noir vaut 21, et il est symétrique', () => {
    expect(ratioContraste('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(ratioContraste('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('la luminance du blanc est 1, celle du noir 0', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBeCloseTo(0, 5);
  });

  it('mélanger à 0 rend la première, à 1 la seconde, à 0,5 le milieu', () => {
    expect(melanger('#000000', '#ffffff', 0)).toBe('#000000');
    expect(melanger('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(melanger('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('alpha rend un rgba() posable en CSS', () => {
    expect(alpha('#1f1a17', 0.12)).toBe('rgba(31, 26, 23, 0.12)');
  });

  it('ajuste un safran clair jusqu’à AA sur sable — en l’assombrissant', () => {
    const ajuste = ajusterJusquaAA('#E07A1F', '#F6EBD9');
    expect(ratioContraste(ajuste, '#F6EBD9')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ajuste)).toBeLessThan(luminance('#E07A1F'));
  });

  it('ajuste un bordeaux sombre jusqu’à AA sur noir — en l’éclaircissant', () => {
    const ajuste = ajusterJusquaAA('#7A2E2A', '#0E1016');
    expect(ratioContraste(ajuste, '#0E1016')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(ajuste)).toBeGreaterThan(luminance('#7A2E2A'));
  });

  it('ne touche pas à une couleur déjà AA', () => {
    expect(ajusterJusquaAA('#1F1A17', '#F5EFE3')).toBe('#1f1a17');
  });
});
