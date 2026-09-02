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

  it('refuse une URL de logo qui n’est pas http(s) — un `javascript:` finirait en src', () => {
    const avec = (url: string) => ({
      ...DIRECTIONS.nuit,
      logo: { ...DIRECTIONS.nuit.logo, mark: { light: null, dark: url } },
    });
    for (const mauvaise of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'ftp://r2/l.png']) {
      expect(() => BrandSchema.parse(avec(mauvaise)), mauvaise).toThrow();
    }
    expect(() => BrandSchema.parse(avec('https://r2.example/logo.png'))).not.toThrow();
    expect(() => BrandSchema.parse(avec('http://localhost:9000/logo.png'))).not.toThrow();
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

  it('sur un fond gris moyen, essaie les DEUX pôles — et choisit le noir, pas le blanc', () => {
    // #808080 a une luminance ≈ 0,216 : sous le test naïf (> 0.5 ⇒ noir), on
    // partirait à tort vers le blanc et on plafonnerait sans jamais passer AA.
    const ajuste = ajusterJusquaAA('#9aa79e', '#808080');
    expect(ratioContraste(ajuste, '#808080')).toBeGreaterThanOrEqual(4.5);
  });
});

import { ajusterJusquaAASurDeux, contraste, resoudreMarque, textePosableSur } from './marque';

describe('les deux outils partagés du résolveur', () => {
  it('ajusterJusquaAASurDeux satisfait le plus exigeant des deux fonds', () => {
    // Nuit : le gris atténué passait sur le fond (4,63) et échouait sur la
    // carte (4,18) — c'est là qu'il est réellement posé.
    const { ground, surface } = DIRECTIONS.nuit.palette;
    const naif = ajusterJusquaAA('#807e7c', ground);
    expect(ratioContraste(naif, surface)).toBeLessThan(4.5);
    const deux = ajusterJusquaAASurDeux('#807e7c', ground, surface);
    expect(ratioContraste(deux, ground)).toBeGreaterThanOrEqual(4.5);
    expect(ratioContraste(deux, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('textePosableSur tranche par contraste réel, pas par seuil de luminance', () => {
    expect(textePosableSur('#c9a15a')).toBe('#000000');
    expect(textePosableSur('#1a1a1a')).toBe('#ffffff');
    // #808080 : luminance 0,216 — un seuil naïf « > 0,5 ⇒ noir » choisirait le
    // blanc, qui n'y atteint que 3,95:1 quand le noir en fait 5,32.
    expect(textePosableSur('#808080')).toBe('#000000');
  });
});

describe('contraste(brand)', () => {
  it('donne six verdicts, tous vrais, sur une direction bien dessinée', () => {
    const v = contraste(DIRECTIONS.brasserie);
    expect(v.ok).toBe(true);
    expect(v.verdicts).toHaveLength(6);
    expect(v.verdicts.map((x) => x.couple)).toEqual([
      'ink/ground', 'ink/surface', 'onAccent/accent', 'accentInk/ground',
      'inkMut/ground', 'inkMut/surface',
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

  it('sur un fond gris moyen (#808080), chaque proposition passe vraiment, ou est null', () => {
    const gris = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ground: '#808080' } };
    const v = contraste(gris);
    for (const verdict of v.verdicts) {
      if (!verdict.ok) {
        expect(verdict.proposition === null || ratioContraste(verdict.proposition, verdict.arriere) >= 4.5).toBe(true);
      }
    }
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

  it('émet exactement le jeu de variables attendu — aucune oubliée, aucune ajoutée', () => {
    const j = resoudreMarque(DIRECTIONS.nuit);
    expect(Object.keys(j.vars).sort()).toEqual([
      '--cf-accent',
      '--cf-accent-hover',
      '--cf-accent-ink',
      '--cf-accent-wash',
      '--cf-amber',
      '--cf-amber-t',
      '--cf-bg',
      '--cf-btn-dark',
      '--cf-card-gradient',
      '--cf-elev-gradient',
      '--cf-elev-hover',
      '--cf-fill',
      '--cf-focus',
      '--cf-font-body',
      '--cf-font-display',
      '--cf-font-mono',
      '--cf-green',
      '--cf-green-t',
      '--cf-ink-soft',
      '--cf-line',
      '--cf-line-2',
      '--cf-mut',
      '--cf-on-accent',
      '--cf-on-amber',
      '--cf-on-fill',
      '--cf-on-green',
      '--cf-on-red',
      '--cf-r',
      '--cf-r-lg',
      '--cf-r-md',
      '--cf-r-pill',
      '--cf-r-sm',
      '--cf-r-xs',
      '--cf-red',
      '--cf-red-t',
      '--cf-scrim',
      '--cf-shadow',
      '--cf-shadow-2',
      '--cf-shadow-accent',
      '--cf-shadow-card',
      '--cf-shadow-drawer',
      '--cf-shadow-soft',
      '--cf-surface',
      '--cf-surface-2',
      '--cf-surface-3',
      '--cf-surface-6',
      '--cf-text',
      '--cf-white-50',
      '--sm-ease',
      '--sm-t-fast',
      '--sm-t-med',
      '--sm-t-slow',
    ]);
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

  it('inkMut reste lisible sur le fond ET sur la carte — le texte atténué vit dans les deux', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface } = DIRECTIONS[key].palette;
      const j = resoudreMarque(DIRECTIONS[key]);
      expect(ratioContraste(j.vars['--cf-mut']!, ground), `${key} sur ground`).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(j.vars['--cf-mut']!, surface), `${key} sur surface`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('les teintes texte des sémantiques passent AA sur le fond ET sur la carte', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface } = DIRECTIONS[key].palette;
      const j = resoudreMarque(DIRECTIONS[key]);
      for (const jeton of ['--cf-green-t', '--cf-red-t', '--cf-amber-t'] as const) {
        expect(ratioContraste(j.vars[jeton]!, ground), `${key} ${jeton} sur ground`).toBeGreaterThanOrEqual(4.5);
        expect(ratioContraste(j.vars[jeton]!, surface), `${key} ${jeton} sur surface`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('le voile s’assombrit toujours — jamais le fond, qui l’éclaircirait sur un masque clair', () => {
    expect(resoudreMarque(DIRECTIONS.nuit).vars['--cf-scrim']).toBe('rgba(0, 0, 0, 0.72)');
    // Soleil : l'encre marine du restaurant à 45 %, pas son sable.
    expect(resoudreMarque(DIRECTIONS.soleil).vars['--cf-scrim']).toBe('rgba(27, 42, 74, 0.45)');
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

import { Brand, brandColorDe, logoPour, logoUrlDe, marqueDeRepli, marqueEffective } from './marque';

describe('le repli — un tenant sans brand a quand même un masque', () => {
  it('part de Nuit, prend l’accent du tenant, calcule onAccent', () => {
    const b = marqueDeRepli('#2E9E4F', 'https://r2.example/logo.png');
    expect(b.preset).toBe('nuit');
    expect(b.palette.accent).toBe('#2e9e4f');
    expect(ratioContraste(b.palette.onAccent, b.palette.accent)).toBeGreaterThanOrEqual(4.5);
    expect(b.logo.mark.dark).toBe('https://r2.example/logo.png');
    expect(contraste(b).ok).toBe(true);
  });

  it('un accent invalide retombe sur le laiton', () => {
    expect(marqueDeRepli('rouge', null).palette.accent).toBe('#c9a15a');
    expect(marqueDeRepli(null, null).palette.accent).toBe('#c9a15a');
  });

  it('l’accent reste le sien — c’est accentInk qui porte l’AA', () => {
    // Spec §8.1 : `accent = brandColor`. Un anthracite est un bouton
    // parfaitement lisible (son `onAccent` est blanc) ; c'est seulement
    // l'accent posé en TEXTE qui doit être éclairci, et `accentInk` — dérivé,
    // jamais stocké — s'en charge. Réécrire l'accent stocké rendrait au
    // restaurateur une couleur qu'il n'a pas choisie.
    const b = marqueDeRepli('#1a1a1a', null);
    expect(b.palette.accent).toBe('#1a1a1a');
    expect(contraste(b).ok).toBe(true);
  });
});

describe('marqueEffective', () => {
  it('rend brand tel quel quand il existe', () => {
    expect(marqueEffective({ brand: DIRECTIONS.soleil, brandColor: '#000000' })).toEqual(DIRECTIONS.soleil);
  });
  it('sinon dérive du plat', () => {
    expect(marqueEffective({ brand: null, brandColor: '#2E9E4F' }).palette.accent).toBe('#2e9e4f');
  });
  it('un brand malformé (paire typo hors liste) retombe sur le repli', () => {
    const casse = { ...DIRECTIONS.soleil, type: { pair: 'comic-sans' } };
    const m = marqueEffective({ brand: casse, brandColor: '#2E9E4F' });
    expect(m.preset).toBe('nuit');
    expect(m.palette.accent).toBe('#2e9e4f');
  });
  it('un document partiel retombe sur le repli plutôt que de casser', () => {
    // Ce que Mongoose peut produire pour un document écrit à la main : une
    // clé requise-mais-nullable (`hero`) purement ABSENTE, pas à `null`. Un
    // document réellement écrit par le schéma porte toujours `hero: null` —
    // seul un document partiel ou mal formé tombe ici.
    const { hero: _hero, ...sansHero } = DIRECTIONS.soleil;
    const m = marqueEffective({ brand: sansHero, brandColor: '#2E9E4F' });
    expect(m.preset).toBe('nuit');
  });
});

describe('les champs plats, dérivés du masque', () => {
  it('brandColor est l’accent', () => {
    expect(brandColorDe(DIRECTIONS.neon)).toBe('#D8F04A');
  });
  it('logoUrl préfère la marque sombre, puis claire, puis l’horizontale', () => {
    const b: Brand = { ...DIRECTIONS.nuit, logo: { mark: { light: 'l', dark: null }, lockup: { light: null, dark: 'ld' } } };
    expect(logoUrlDe(b)).toBe('l');
    expect(logoUrlDe({ ...b, logo: { mark: { light: null, dark: null }, lockup: { light: null, dark: 'ld' } } })).toBe('ld');
    expect(logoUrlDe(DIRECTIONS.nuit)).toBeNull();
  });
  it('logoPour suit le mode, avec repli', () => {
    const clair: Brand = { ...DIRECTIONS.brasserie, logo: { mark: { light: null, dark: 'md' }, lockup: { light: 'll', dark: null } } };
    expect(logoPour(clair, 'mark')).toBe('md');   // pas de clair → le sombre du même format
    expect(logoPour(clair, 'lockup')).toBe('ll');
    expect(logoPour({ ...clair, logo: { mark: { light: null, dark: null }, lockup: { light: 'll', dark: null } } }, 'mark')).toBe('ll'); // → l'autre format
  });
});
