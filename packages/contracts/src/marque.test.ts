import { describe, expect, it } from 'vitest';
import {
  ajusterJusquaAA,
  alpha,
  type Brand,
  brandColorDe,
  BrandSchema,
  BrandStrictSchema,
  contraste,
  COUPLES_CONTRASTE,
  DIRECTIONS,
  FONT_FALLBACKS,
  FONT_FAMILIES,
  FONT_SLUGS,
  hexVersRgb,
  lireMarque,
  logoPour,
  logoUrlDe,
  luminance,
  marqueDeRepli,
  marqueEffective,
  melanger,
  MONO_PAR_DEFAUT,
  PRESET_KEYS,
  ratioContraste,
  resoudreMarque,
  rgbVersHex,
  textePosableSur,
  TYPE_PAIR_KEYS,
  TYPE_PAIRS,
} from './marque';

describe('le contrat brand', () => {
  it('accepte une direction complète telle quelle', () => {
    for (const key of PRESET_KEYS) {
      expect(() => BrandSchema.parse(DIRECTIONS[key])).not.toThrow();
      expect(() => BrandStrictSchema.parse(DIRECTIONS[key])).not.toThrow();
    }
  });

  it('refuse une couleur qui n’est pas un hex à six chiffres', () => {
    const brasserie = DIRECTIONS.brasserie;
    const casse = { ...brasserie, palette: { ...brasserie.palette, accent: '#abc' } };
    expect(() => BrandSchema.parse(casse)).toThrow();
  });

  it('normalise la casse des hex à la frontière — une seule forme en aval', () => {
    const brasserie = DIRECTIONS.brasserie;
    const cri = { ...brasserie, palette: { ...brasserie.palette, accent: '  #E07A1F ' } };
    expect(BrandSchema.parse(cri).palette.accent).toBe('#e07a1f');
    for (const key of PRESET_KEYS) {
      for (const role of Object.values(DIRECTIONS[key].palette)) {
        expect(role, `${key}`).toBe(role.toLowerCase());
      }
    }
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
    const mauvaises = [
      'javascript:alert(1)',
      'data:image/svg+xml,<svg/>',
      'ftp://r2/l.png',
      'https:/r2.example/l.png', // un seul slash : pas une origine
    ];
    for (const mauvaise of mauvaises) {
      expect(() => BrandSchema.parse(avec(mauvaise)), mauvaise).toThrow();
    }
    expect(() => BrandSchema.parse(avec('https://r2.example/logo.png'))).not.toThrow();
    expect(() => BrandSchema.parse(avec('http://localhost:9000/logo.png'))).not.toThrow();
  });

  it('une clé inconnue est IGNORÉE à la lecture, REFUSÉE à l’écriture', () => {
    // Une clé additive apparue en base (script, version suivante) ne doit pas
    // faire disparaître l'identité d'un restaurant ; un corps de requête qui
    // en porte une est une tentative de mass assignment.
    const cas = [
      { ...DIRECTIONS.soleil, extra: 1 },
      { ...DIRECTIONS.soleil, palette: { ...DIRECTIONS.soleil.palette, extra: 1 } },
      {
        ...DIRECTIONS.soleil,
        logo: { ...DIRECTIONS.soleil.logo, mark: { light: null, dark: null, extra: 1 } },
      },
      { ...DIRECTIONS.soleil, type: { pair: 'soleil', extra: 1 } },
    ];
    for (const brut of cas) {
      const lu = BrandSchema.safeParse(brut);
      expect(lu.success).toBe(true);
      expect(lu.success && 'extra' in lu.data).toBe(false);
      expect(BrandStrictSchema.safeParse(brut).success).toBe(false);
    }
  });

  it('une clé absente vaut null à la lecture — `.lean()` ne pose aucun défaut Mongoose', () => {
    const { hero: _hero, preset: _preset, ...partiel } = DIRECTIONS.soleil;
    const lu = BrandSchema.parse({ ...partiel, logo: { mark: {}, lockup: {} } });
    expect(lu.hero).toBeNull();
    expect(lu.preset).toBeNull();
    expect(lu.logo.mark).toEqual({ light: null, dark: null });
    expect(lu.logo.lockup).toEqual({ light: null, dark: null });
  });

  it('les paires « prix en mono » déclarent une famille mono', () => {
    for (const key of TYPE_PAIR_KEYS) {
      const pair = TYPE_PAIRS[key];
      if (pair.prixMono) expect(pair.mono).toBeTruthy();
    }
  });

  it('les slugs déclarés sont exactement ceux que les paires utilisent', () => {
    // Un slug de trop = une famille chargée pour rien côté web ; un slug qui
    // manque = une police que next/font ne déclare jamais.
    expect([...FONT_FAMILIES]).toEqual([...FONT_SLUGS].sort());
    for (const slug of Object.keys(FONT_FALLBACKS)) {
      expect(FONT_FAMILIES, slug).toContain(slug);
    }
    expect(FONT_FAMILIES).toContain(MONO_PAR_DEFAUT);
  });
});

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
    const { couleur, ok } = ajusterJusquaAA('#E07A1F', ['#F6EBD9']);
    expect(ok).toBe(true);
    expect(ratioContraste(couleur, '#F6EBD9')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(couleur)).toBeLessThan(luminance('#E07A1F'));
  });

  it('ajuste un bordeaux sombre jusqu’à AA sur noir — en l’éclaircissant', () => {
    const { couleur } = ajusterJusquaAA('#7A2E2A', ['#0E1016']);
    expect(ratioContraste(couleur, '#0E1016')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(couleur)).toBeGreaterThan(luminance('#7A2E2A'));
  });

  it('ne touche pas à une couleur déjà AA', () => {
    expect(ajusterJusquaAA('#1F1A17', ['#F5EFE3'])).toEqual({ couleur: '#1f1a17', ok: true });
  });

  it('sur un fond gris moyen, essaie les DEUX pôles — et choisit le noir, pas le blanc', () => {
    // #808080 a une luminance ≈ 0,216 : sous le test naïf (> 0.5 ⇒ noir), on
    // partirait à tort vers le blanc et on plafonnerait sans jamais passer AA.
    const { couleur, ok } = ajusterJusquaAA('#9aa79e', ['#808080']);
    expect(ok).toBe(true);
    expect(ratioContraste(couleur, '#808080')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(couleur)).toBeLessThan(luminance('#9aa79e'));
  });

  it('satisfait le plus exigeant de PLUSIEURS fonds, jamais l’un puis l’autre', () => {
    // Nuit : le gris atténué passait sur le fond (4,63) et échouait sur la
    // carte (4,18) — c'est là qu'il est réellement posé.
    const { ground, surface } = DIRECTIONS.nuit.palette;
    const naif = ajusterJusquaAA('#807e7c', [ground]);
    expect(ratioContraste(naif.couleur, surface)).toBeLessThan(4.5);
    const deux = ajusterJusquaAA('#807e7c', [ground, surface]);
    expect(deux.ok).toBe(true);
    expect(ratioContraste(deux.couleur, ground)).toBeGreaterThanOrEqual(4.5);
    expect(ratioContraste(deux.couleur, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('dit NON quand deux fonds opposés rendent la promesse impossible', () => {
    // L'ancienne version rendait #ababab à 1,74:1 sur ce couple, sans signal.
    const impossible = ajusterJusquaAA('#9a9a9a', ['#e0e0e0', '#404040']);
    expect(impossible.ok).toBe(false);
    expect(
      Math.min(
        ratioContraste(impossible.couleur, '#e0e0e0'),
        ratioContraste(impossible.couleur, '#404040'),
      ),
    ).toBeLessThan(4.5);
  });

  it('dit NON au-delà de √21 — aucun pôle n’y arrive sur un fond médian', () => {
    // √21 ≈ 4,58 est le plafond garanti sur UN fond : à 7 (AAA) il n'y a plus
    // de nuance possible, et le pôle le moins mauvais gagne.
    expect(ajusterJusquaAA('#777777', ['#777777'], 7)).toEqual({ couleur: '#000000', ok: false });
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
  it('rend un verdict par couple déclaré, dans l’ordre, tous vrais sur une direction bien dessinée', () => {
    const v = contraste(DIRECTIONS.brasserie);
    expect(v.ok).toBe(true);
    expect(v.verdicts.map((x) => x.couple)).toEqual([...COUPLES_CONTRASTE]);
    for (const verdict of v.verdicts) {
      expect(verdict.seuil, verdict.couple).toBe(verdict.couple.startsWith('focus/') ? 3 : 4.5);
    }
  });

  it('propose la nuance la plus proche qui passe, et elle passe', () => {
    const pale = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' } };
    const v = contraste(pale);
    const raté = v.verdicts.find((x) => x.couple === 'ink/ground');
    expect(raté?.ok).toBe(false);
    expect(raté?.derive).toBe(false);
    expect(raté?.proposition).not.toBeNull();
    expect(ratioContraste(raté!.proposition!, pale.palette.ground)).toBeGreaterThanOrEqual(4.5);
  });

  it('un couple DÉRIVÉ ne porte jamais de proposition — personne ne peut poser inkMut', () => {
    const gris = { ...DIRECTIONS.marche, palette: { ...DIRECTIONS.marche.palette, ground: '#808080' } };
    for (const verdict of contraste(gris).verdicts) {
      if (verdict.derive) expect(verdict.proposition, verdict.couple).toBeNull();
      if (verdict.proposition !== null) {
        expect(ratioContraste(verdict.proposition, verdict.arriere)).toBeGreaterThanOrEqual(verdict.seuil);
      }
    }
  });

  it('juge EXACTEMENT ce que resoudreMarque émet — même dérivation, même valeur', () => {
    for (const key of PRESET_KEYS) {
      const vars = resoudreMarque(DIRECTIONS[key]).vars;
      const v = contraste(DIRECTIONS[key]);
      const avant = (couple: string) => v.verdicts.find((x) => x.couple === couple)?.avant;
      expect(avant('inkMut/ground'), key).toBe(vars['--cf-mut']);
      expect(avant('accentInk/ground'), key).toBe(vars['--cf-accent-ink']);
      expect(avant('focus/ground'), key).toBe(vars['--cf-focus']);
      expect(avant('greenInk/greenWash'), key).toBe(vars['--cf-green-t']);
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
      '--cf-btn',
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
      '--cf-shadow-2',
      '--cf-shadow-card',
      '--cf-shadow-drawer',
      '--cf-shadow-soft',
      '--cf-surface',
      '--cf-surface-2',
      '--cf-surface-3',
      '--cf-surface-6',
      '--cf-text',
      '--sm-ease',
      '--sm-t-fast',
      '--sm-t-med',
      '--sm-t-slow',
      '--sm-t-snap',
    ]);
  });

  it('dérive les filets depuis l’encre, pas depuis le blanc — un fond clair a des filets sombres', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-line']).toBe('rgba(31, 26, 23, 0.12)');
    expect(j.vars['--cf-line-2']).toBe('rgba(31, 26, 23, 0.06)');
    expect(j.vars['--cf-surface-3']).toBe('rgba(31, 26, 23, 0.03)');
  });

  it('la tuile ne porte JAMAIS la valeur du fond de page — même quand ground est plus sombre que surface', () => {
    // Brasserie, Atelier, Soleil : le fond de page est plus sombre que la
    // carte. Dérivée depuis `surface` seule, la tuile atterrissait à 1,03:1 du
    // fond et les chips de catégories s'effaçaient (DA §1). Le plancher est
    // posé à 1,08 : les six mesurent aujourd'hui de 1,10 (Marché sur sa carte)
    // à 1,29 (Nuit sur son fond), et l'ancien 1,03 tombe.
    for (const key of PRESET_KEYS) {
      const { ground, surface } = DIRECTIONS[key].palette;
      const s2 = resoudreMarque(DIRECTIONS[key]).vars['--cf-surface-2']!;
      expect(ratioContraste(s2, ground), `${key} tuile/fond`).toBeGreaterThanOrEqual(1.08);
      expect(ratioContraste(s2, surface), `${key} tuile/carte`).toBeGreaterThanOrEqual(1.08);
    }
  });

  it('accentInk est AA sur le fond, sur la carte ET sur son propre lavis', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface, accent } = DIRECTIONS[key].palette;
      const encre = resoudreMarque(DIRECTIONS[key]).vars['--cf-accent-ink']!;
      for (const fond of [ground, surface, melanger(ground, accent, 0.12), melanger(surface, accent, 0.12)]) {
        expect(ratioContraste(encre, fond), `${key} accentink sur ${fond}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('inkMut reste lisible sur TOUS les fonds réellement peints, dégradés compris', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface, ink } = DIRECTIONS[key].palette;
      const vars = resoudreMarque(DIRECTIONS[key]).vars;
      const mut = vars['--cf-mut']!;
      const s2 = vars['--cf-surface-2']!;
      const fonds = [
        ground,
        surface,
        s2,
        melanger(surface, ink, 0.05), // haut du dégradé de carte
        melanger(s2, ink, 0.045), // haut du dégradé d'élément
      ];
      for (const fond of fonds) {
        expect(ratioContraste(mut, fond), `${key} mut sur ${fond}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('les teintes texte des sémantiques passent AA sur le fond, la carte ET leur lavis', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface } = DIRECTIONS[key].palette;
      const vars = resoudreMarque(DIRECTIONS[key]).vars;
      for (const [aplat, teinte] of [
        ['--cf-green', '--cf-green-t'],
        ['--cf-red', '--cf-red-t'],
        ['--cf-amber', '--cf-amber-t'],
      ] as const) {
        const sem = vars[aplat]!;
        const t = vars[teinte]!;
        for (const fond of [ground, surface, melanger(ground, sem, 0.1), melanger(surface, sem, 0.1)]) {
          expect(ratioContraste(t, fond), `${key} ${teinte} sur ${fond}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('l’anneau de focus est opaque et atteint 3:1 sur le fond comme sur la carte', () => {
    for (const key of PRESET_KEYS) {
      const { ground, surface } = DIRECTIONS[key].palette;
      const focus = resoudreMarque(DIRECTIONS[key]).vars['--cf-focus']!;
      expect(focus, key).toMatch(/^#[0-9a-f]{6}$/);
      expect(ratioContraste(focus, ground), `${key} focus/fond`).toBeGreaterThanOrEqual(3);
      expect(ratioContraste(focus, surface), `${key} focus/carte`).toBeGreaterThanOrEqual(3);
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
    // Cinq crans distincts et croissants — plus de doublon sm/md ni de `lg + 4`.
    for (const vars of [net, rond]) {
      const echelle = ['--cf-r-xs', '--cf-r-sm', '--cf-r-md', '--cf-r', '--cf-r-lg'].map((k) =>
        parseInt(vars[k]!, 10),
      );
      expect(echelle).toEqual([...echelle].sort((a, b) => a - b));
      expect(new Set(echelle).size).toBe(5);
    }
    expect(net['--sm-t-fast']).toBe('240ms');
    expect(rond['--sm-t-fast']).toBe('140ms');
    // Le retour tactile est perçu en moins de 100 ms (DA §4) : un tiers de la base.
    expect(net['--sm-t-snap']).toBe('80ms');
    expect(rond['--sm-t-snap']).toBe('47ms');
    expect(rond['--sm-ease']).toContain('1.4');
  });

  it('les polices pointent sur les variables next/font, avec leur repli', () => {
    const j = resoudreMarque(DIRECTIONS.brasserie);
    expect(j.vars['--cf-font-display']).toBe('var(--police-fraunces), Georgia, "Times New Roman", serif');
    expect(j.vars['--cf-font-body']).toContain('var(--police-source-sans-3)');
    expect(j.prixMono).toBe(false);
    expect(resoudreMarque(DIRECTIONS.atelier).prixMono).toBe(true);
    expect(resoudreMarque(DIRECTIONS.atelier).vars['--cf-font-mono']).toContain('var(--police-jetbrains-mono)');
    // Une paire sans mono retombe sur la mono par défaut, jamais sur rien.
    expect(j.vars['--cf-font-mono']).toContain(`var(--police-${MONO_PAR_DEFAUT})`);
  });

  it('LES SIX DIRECTIONS PASSENT AA — une direction qui échoue ne se merge pas', () => {
    for (const key of PRESET_KEYS) {
      const v = contraste(DIRECTIONS[key]);
      expect(v.ok, `${key} : ${v.verdicts.filter((x) => !x.ok).map((x) => x.couple).join(', ')}`).toBe(true);
    }
  });
});

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

  it('un logoUrl legacy qui n’a jamais traversé le contrat est écarté', () => {
    // Sinon `logoPour` rendait ce `javascript:` en `src` de vitrine et d'icône
    // de manifeste : le repli doit produire un Brand que BrandSchema accepte.
    for (const mauvaise of ['javascript:alert(1)', 'data:image/png;base64,AA', 'pas une url']) {
      expect(marqueDeRepli('#2e9e4f', mauvaise).logo.mark.dark, mauvaise).toBeNull();
    }
    expect(BrandSchema.safeParse(marqueDeRepli('#2e9e4f', 'javascript:alert(1)')).success).toBe(true);
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

describe('lireMarque / marqueEffective', () => {
  it('rend brand tel quel quand il existe, sans repli', () => {
    const lu = lireMarque({ brand: DIRECTIONS.soleil, brandColor: '#000000' });
    expect(lu.brand).toEqual(DIRECTIONS.soleil);
    expect(lu.repli).toBeNull();
  });

  it('dit « absent » quand il n’y a rien à lire, et dérive du plat', () => {
    const lu = lireMarque({ brand: null, brandColor: '#2E9E4F' });
    expect(lu.repli).toBe('absent');
    expect(lu.brand.palette.accent).toBe('#2e9e4f');
  });

  it('dit « invalide » quand le document stocké échoue le contrat', () => {
    // Le repli était MUET : l'identité d'un restaurant disparaissait sur un
    // 200, sans journal. La cause remonte maintenant aux adaptateurs.
    const casse = { ...DIRECTIONS.soleil, shape: 'carre' };
    const lu = lireMarque({ brand: casse, brandColor: '#2E9E4F' });
    expect(lu.repli).toBe('invalide');
    expect(lu.brand.preset).toBe('nuit');
    expect(lu.brand.palette.accent).toBe('#2e9e4f');
  });

  it('lit un sous-document Mongoose hydraté comme un objet nu', () => {
    const hydrate = { toObject: () => DIRECTIONS.marche, $__parent: {}, save: () => undefined };
    expect(lireMarque({ brand: hydrate })).toEqual({ brand: DIRECTIONS.marche, repli: null });
  });

  it('un document sans `hero` rend LE MÊME masque qu’un document complet', () => {
    // `findById()` pose les défauts Mongoose, `.lean()` non : sans les
    // `.default(null)` du contrat, le même tenant rendait Soleil d'un côté et
    // Nuit de l'autre — deux identités pour un seul restaurant.
    const { hero: _hero, ...lean } = DIRECTIONS.soleil;
    expect(marqueEffective({ brand: lean, brandColor: '#2E9E4F' })).toEqual(DIRECTIONS.soleil);
  });

  it('marqueEffective est le raccourci de lireMarque', () => {
    const t = { brand: { ...DIRECTIONS.soleil, shape: 'carre' }, brandColor: '#2E9E4F' };
    expect(marqueEffective(t)).toEqual(lireMarque(t).brand);
  });
});

describe('les champs plats, dérivés du masque', () => {
  it('brandColor est l’accent', () => {
    expect(brandColorDe(DIRECTIONS.neon)).toBe('#d8f04a');
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
