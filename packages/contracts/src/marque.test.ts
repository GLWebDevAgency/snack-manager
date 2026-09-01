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

import { contraste, resoudreMarque } from './marque';

describe('contraste(brand)', () => {
  it('donne cinq verdicts, tous vrais, sur une direction bien dessinée', () => {
    const v = contraste(DIRECTIONS.brasserie);
    expect(v.ok).toBe(true);
    expect(v.verdicts).toHaveLength(5);
    expect(v.verdicts.map((x) => x.couple)).toEqual([
      'ink/ground', 'ink/surface', 'onAccent/accent', 'accentInk/ground', 'inkMut/ground',
    ]);
  });

  it('propose la nuance la plus proche qui passe, et elle passe', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    const v = contraste(pale);
    const raté = v.verdicts.find((x) => x.couple === 'ink/ground');
    expect(raté?.ok).toBe(false);
    expect(raté?.proposition).not.toBeNull();
    expect(ratioContraste(raté!.proposition!, pale.palette.ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resoudreMarque(brand)', () => {
  it('pose les cinq rôles et le mode', () => {
    const j = resoudreMarque(DIRECTIONS.neon);
    expect(j.colorScheme).toBe('dark');
    expect(j.vars['--cf-bg']).toBe('#0e1016');
    expect(j.vars['--cf-surface']).toBe('#171a23');
    expect(j.vars['--cf-text']).toBe('#f3f1ec');
    expect(j.vars['--cf-accent']).toBe('#d8f04a');
    expect(j.vars['--cf-on-accent']).toBe('#0e1016');
  });

  it('dérive les filets depuis l’encre, pas depuis le blanc — un fond clair a des filets sombres', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-line']).toBe('rgba(31, 26, 23, 0.12)');
    expect(j.vars['--cf-line-2']).toBe('rgba(31, 26, 23, 0.06)');
    expect(j.vars['--cf-surface-3']).toBe('rgba(31, 26, 23, 0.03)');
  });

  it('accentInk est AA sur le fond même quand l’accent ne l’est pas', () => {
    const j = resoudreMarque(DIRECTIONS.soleil);
    expect(ratioContraste(j.vars['--cf-accent-ink']!, '#F6EBD9')).toBeGreaterThanOrEqual(4.5);
  });

  it('inkMut reste lisible : ramené à AA si le mélange descend trop bas', () => {
    for (const key of PRESET_KEYS) {
      const j = resoudreMarque(DIRECTIONS[key]);
      expect(ratioContraste(j.vars['--cf-mut']!, DIRECTIONS[key].palette.ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('les couleurs sémantiques ne sont jamais la marque', () => {
    const a = resoudreMarque(DIRECTIONS.neon).vars;
    const b = resoudreMarque(DIRECTIONS.nuit).vars;
    expect(a['--cf-green']).toBe(b['--cf-green']); // même mode → mêmes sémantiques
    expect(a['--cf-green']).not.toBe(a['--cf-accent']);
  });

  it('la forme et le mouvement deviennent des variables', () => {
    const net = resoudreMarque(DIRECTIONS.brasserie).vars;
    const rond = resoudreMarque(DIRECTIONS.neon).vars;
    expect(net['--cf-r-md']).toBe('4px');
    expect(rond['--cf-r-md']).toBe('18px');
    expect(net['--sm-t-fast']).toBe('240ms');
    expect(rond['--sm-t-fast']).toBe('140ms');
    expect(rond['--sm-ease']).toContain('1.4');
  });

  it('les polices pointent sur les variables next/font, avec leur repli', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-font-display']).toBe('var(--police-fraunces), Georgia, "Times New Roman", serif');
    expect(j.vars['--cf-font-body']).toContain('var(--police-source-sans-3)');
    expect(j.prixMono).toBe(false);
    expect(resoudreMarque(DIRECTIONS.atelier).prixMono).toBe(true);
    expect(resoudreMarque(DIRECTIONS.atelier).vars['--cf-font-mono']).toContain('var(--police-jetbrains-mono)');
  });

  it('LES SIX DIRECTIONS PASSENT AA — une direction qui échoue ne se merge pas', () => {
    for (const key of PRESET_KEYS) {
      const v = contraste(DIRECTIONS[key]);
      expect(v.ok, `${key} : ${v.verdicts.filter((x) => !x.ok).map((x) => x.couple).join(', ')}`).toBe(true);
    }
  });
});
