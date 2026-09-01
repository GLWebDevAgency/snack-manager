import { z } from 'zod';

/**
 * LE MASQUE D'IDENTITÉ — un restaurant, sa marque, notre squelette.
 *
 * Jusqu'ici, un tenant ne portait qu'un logo et une couleur d'accent : tout le
 * reste était la marque grise de Snack Manager. Sur les surfaces que voit le
 * CLIENT (vitrine, commande, fidélité, suivi), le restaurant porte désormais la
 * sienne — cinq couleurs stockées, tout le reste dérivé ici, en pur.
 *
 * Ce module n'importe que zod : il est consommé par l'API (qui rejoue le
 * contraste), par le web (qui pose les variables) et par la base (reprise).
 */

export const HEX = /^#[0-9a-fA-F]{6}$/;

export const BRAND_MODES = ['light', 'dark'] as const;
export const BrandModeSchema = z.enum(BRAND_MODES);
export type BrandMode = z.infer<typeof BrandModeSchema>;

export const BRAND_SHAPES = ['net', 'doux', 'rond'] as const;
export const BrandShapeSchema = z.enum(BRAND_SHAPES);
export type BrandShape = z.infer<typeof BrandShapeSchema>;

export const BRAND_MOTIONS = ['pose', 'vif'] as const;
export const BrandMotionSchema = z.enum(BRAND_MOTIONS);
export type BrandMotion = z.infer<typeof BrandMotionSchema>;

export const PRESET_KEYS = ['brasserie', 'neon', 'atelier', 'marche', 'nuit', 'soleil'] as const;
export const PresetKeySchema = z.enum(PRESET_KEYS);
export type PresetKey = z.infer<typeof PresetKeySchema>;

export const TYPE_PAIR_KEYS = [
  'brasserie', 'neon', 'atelier', 'marche', 'nuit', 'soleil',
  'editorial', 'moderne', 'classique', 'brut',
] as const;
export const TypePairKeySchema = z.enum(TYPE_PAIR_KEYS);
export type TypePairKey = z.infer<typeof TypePairKeySchema>;

const Hex = z.string().trim().regex(HEX, 'Couleur attendue au format #rrggbb');
/** URL interne d'image (R2) — jamais un lien externe sur un ticket. */
const ImageUrl = z.string().trim().url().max(500).nullable();

export const BrandPaletteSchema = z
  .object({
    ground: Hex,
    surface: Hex,
    ink: Hex,
    accent: Hex,
    onAccent: Hex,
  })
  .strict();
export type BrandPalette = z.infer<typeof BrandPaletteSchema>;

export const BrandSchema = z
  .object({
    mode: BrandModeSchema,
    palette: BrandPaletteSchema,
    type: z.object({ pair: TypePairKeySchema }).strict(),
    shape: BrandShapeSchema,
    motion: BrandMotionSchema,
    logo: z
      .object({
        mark: z.object({ light: ImageUrl, dark: ImageUrl }).strict(),
        lockup: z.object({ light: ImageUrl, dark: ImageUrl }).strict(),
      })
      .strict(),
    hero: ImageUrl,
    preset: PresetKeySchema.nullable(),
  })
  .strict();
export type Brand = z.infer<typeof BrandSchema>;

// ─────────────────────────────────────────────────────────────
// Les paires typographiques curatées — jamais une police libre
// ─────────────────────────────────────────────────────────────

/**
 * `display`/`body`/`mono` sont des SLUGS de famille : le web déclare chaque
 * famille via next/font avec la variable `--police-<slug>`, et le résolveur
 * émet `var(--police-<slug>), <repli>`. Les familles sont listées dans
 * FONT_FAMILIES pour que le web n'en oublie aucune.
 */
export type TypePair = {
  display: string;
  body: string;
  mono: string | null;
  /** Certaines paires posent les prix en mono — l'artisan, le brut. */
  prixMono: boolean;
  /** Le libellé montré dans l'éditeur (plan B). */
  label: string;
};

export const TYPE_PAIRS: Record<TypePairKey, TypePair> = {
  brasserie: { display: 'fraunces', body: 'source-sans-3', mono: null, prixMono: false, label: 'Fraunces · Source Sans' },
  neon: { display: 'bricolage-grotesque', body: 'archivo', mono: null, prixMono: false, label: 'Bricolage · Archivo' },
  atelier: { display: 'alegreya-sans', body: 'alegreya-sans', mono: 'jetbrains-mono', prixMono: true, label: 'Alegreya Sans · prix en mono' },
  marche: { display: 'outfit', body: 'manrope', mono: null, prixMono: false, label: 'Outfit · Manrope' },
  nuit: { display: 'cormorant-garamond', body: 'figtree', mono: null, prixMono: false, label: 'Cormorant · Figtree' },
  soleil: { display: 'nunito', body: 'nunito-sans', mono: null, prixMono: false, label: 'Nunito · Nunito Sans' },
  editorial: { display: 'playfair-display', body: 'source-sans-3', mono: null, prixMono: false, label: 'Playfair · Source Sans' },
  moderne: { display: 'familjen-grotesk', body: 'instrument-sans', mono: null, prixMono: false, label: 'Familjen · Instrument' },
  classique: { display: 'libre-baskerville', body: 'lato', mono: null, prixMono: false, label: 'Baskerville · Lato' },
  brut: { display: 'archivo-black', body: 'archivo', mono: 'jetbrains-mono', prixMono: true, label: 'Archivo Black · prix en mono' },
};

/** Toutes les familles à déclarer côté web — dérivé, jamais tenu à la main. */
export const FONT_FAMILIES: readonly string[] = Array.from(
  new Set(
    Object.values(TYPE_PAIRS).flatMap((p) => [p.display, p.body, ...(p.mono ? [p.mono] : [])]),
  ),
).sort();

/** Pile de repli par genre — ce que voit le client avant que la police arrive. */
export const FONT_FALLBACKS: Record<string, string> = {
  fraunces: 'Georgia, "Times New Roman", serif',
  'cormorant-garamond': 'Georgia, "Times New Roman", serif',
  'playfair-display': 'Georgia, "Times New Roman", serif',
  'libre-baskerville': 'Georgia, "Times New Roman", serif',
  'jetbrains-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};
const SANS_FALLBACK = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const fallbackDe = (slug: string): string => FONT_FALLBACKS[slug] ?? SANS_FALLBACK;

// ─────────────────────────────────────────────────────────────
// Six directions artistiques — des objets brand COMPLETS
// ─────────────────────────────────────────────────────────────

const sansLogos = { mark: { light: null, dark: null }, lockup: { light: null, dark: null } };

export const DIRECTIONS: Record<PresetKey, Brand> = {
  brasserie: {
    mode: 'light',
    palette: { ground: '#F5EFE3', surface: '#FFFDF8', ink: '#1F1A17', accent: '#7A2E2A', onAccent: '#FFF8F0' },
    type: { pair: 'brasserie' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'brasserie',
  },
  neon: {
    mode: 'dark',
    palette: { ground: '#0E1016', surface: '#171A23', ink: '#F3F1EC', accent: '#D8F04A', onAccent: '#0E1016' },
    type: { pair: 'neon' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'neon',
  },
  atelier: {
    mode: 'light',
    palette: { ground: '#F7F3EC', surface: '#FFFFFF', ink: '#2B2B2B', accent: '#A8482A', onAccent: '#FFF4EC' },
    type: { pair: 'atelier' }, shape: 'doux', motion: 'pose', logo: sansLogos, hero: null, preset: 'atelier',
  },
  marche: {
    mode: 'light',
    palette: { ground: '#FFFFFF', surface: '#F4F8F4', ink: '#1E4D2B', accent: '#23843F', onAccent: '#FFFFFF' },
    type: { pair: 'marche' }, shape: 'rond', motion: 'vif', logo: sansLogos, hero: null, preset: 'marche',
  },
  nuit: {
    mode: 'dark',
    palette: { ground: '#14151A', surface: '#1D1F26', ink: '#F0EBE1', accent: '#C9A15A', onAccent: '#1C1612' },
    type: { pair: 'nuit' }, shape: 'net', motion: 'pose', logo: sansLogos, hero: null, preset: 'nuit',
  },
  soleil: {
    mode: 'light',
    palette: { ground: '#F6EBD9', surface: '#FFF9F0', ink: '#1B2A4A', accent: '#E07A1F', onAccent: '#1B1206' },
    type: { pair: 'soleil' }, shape: 'doux', motion: 'vif', logo: sansLogos, hero: null, preset: 'soleil',
  },
};

export const PRESET_LABELS: Record<PresetKey, string> = {
  brasserie: 'Brasserie', neon: 'Néon', atelier: 'Atelier', marche: 'Marché', nuit: 'Nuit', soleil: 'Soleil',
};

// ─────────────────────────────────────────────────────────────
// La couleur en pur — WCAG 2.x, sans dépendance
// ─────────────────────────────────────────────────────────────

export const WCAG_AA = 4.5;

export type Rgb = readonly [number, number, number];

export function hexVersRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbVersHex([r, g, b]: Rgb): string {
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Luminance relative WCAG — canal linéarisé, pondéré. */
export function luminance(hex: string): number {
  const [r, g, b] = hexVersRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratioContraste(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [clair, sombre] = la >= lb ? [la, lb] : [lb, la];
  return (clair + 0.05) / (sombre + 0.05);
}

/** Interpolation linéaire en sRGB — suffisante pour des teintes et des filets. */
export function melanger(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexVersRgb(a);
  const [br, bg, bb] = hexVersRgb(b);
  return rgbVersHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = hexVersRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Rapproche `couleur` du noir OU du blanc, par pas de 1/200, jusqu'au seuil —
 * et retient celle des deux nuances qui l'atteint en le moins de pas (« la
 * nuance la plus proche qui passe »). Un simple test de luminance sur `fond`
 * (> 0.5 ⇒ noir) se trompe de pôle pour toute luminance entre ~0,18 et 0,5 —
 * le point de croisement réel du ratio WCAG — d'où l'essai des deux. Une
 * couleur déjà conforme revient telle quelle, en minuscules.
 */
export function ajusterJusquaAA(couleur: string, fond: string, seuil = WCAG_AA): string {
  const depart = couleur.toLowerCase();
  if (ratioContraste(depart, fond) >= seuil) return depart;
  const versPole = (pole: string): { candidat: string; pas: number } | null => {
    for (let pas = 1; pas <= 200; pas += 1) {
      const candidat = melanger(depart, pole, pas / 200);
      if (ratioContraste(candidat, fond) >= seuil) return { candidat, pas };
    }
    return null;
  };
  const versNoir = versPole('#000000');
  const versBlanc = versPole('#ffffff');
  if (versNoir && versBlanc) return versNoir.pas <= versBlanc.pas ? versNoir.candidat : versBlanc.candidat;
  if (versNoir) return versNoir.candidat;
  if (versBlanc) return versBlanc.candidat;
  // Ne devrait pas arriver pour seuil ≤ ~4.58 (AAA) : par honnêteté, le pôle le plus contrasté gagne.
  return ratioContraste('#000000', fond) >= ratioContraste('#ffffff', fond) ? '#000000' : '#ffffff';
}

// ─────────────────────────────────────────────────────────────
// Le résolveur — tout ce qui n'est pas stocké se calcule ici
// ─────────────────────────────────────────────────────────────

export type Verdict = {
  couple: string;
  avant: string;
  arriere: string;
  ratio: number;
  ok: boolean;
  /** La nuance la plus proche qui passe — `null` sinon (ça passe déjà, ou rien ne passe). */
  proposition: string | null;
};

/** Les dérivés dont dépend le contraste — calculés une fois, partagés. */
function derives(p: BrandPalette) {
  return {
    accentInk: ajusterJusquaAA(p.accent, p.ground),
    inkMut: ajusterJusquaAA(melanger(p.ink, p.ground, 0.5), p.ground),
  };
}

export function contraste(brand: Brand): { ok: boolean; verdicts: Verdict[] } {
  const p = brand.palette;
  const d = derives(p);
  const couples: [string, string, string][] = [
    ['ink/ground', p.ink, p.ground],
    ['ink/surface', p.ink, p.surface],
    ['onAccent/accent', p.onAccent, p.accent],
    ['accentInk/ground', d.accentInk, p.ground],
    ['inkMut/ground', d.inkMut, p.ground],
  ];
  const verdicts = couples.map(([couple, avant, arriere]): Verdict => {
    // Le seuil compare la valeur BRUTE — l'arrondi n'habille que le champ rapporté.
    const brut = ratioContraste(avant, arriere);
    const ratio = Math.round(brut * 100) / 100;
    const ok = brut >= WCAG_AA;
    if (ok) return { couple, avant, arriere, ratio, ok, proposition: null };
    const candidat = ajusterJusquaAA(avant, arriere);
    // Garde : `proposition` n'est jamais rendue si elle ne passe pas vraiment.
    const proposition = ratioContraste(candidat, arriere) >= WCAG_AA ? candidat : null;
    return { couple, avant, arriere, ratio, ok, proposition };
  });
  return { ok: verdicts.every((v) => v.ok), verdicts };
}

/** Rayons par forme — sm / md / lg ; la pilule ne change jamais. */
const RAYONS: Record<BrandShape, [number, number, number]> = {
  net: [2, 4, 6],
  doux: [6, 10, 14],
  rond: [12, 18, 24],
};

/** Durées (ms) base / entrée / fête, et courbe. */
const MOUVEMENTS: Record<BrandMotion, { base: number; entree: number; fete: number; ease: string }> = {
  pose: { base: 240, entree: 320, fete: 900, ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  vif: { base: 140, entree: 200, fete: 600, ease: 'cubic-bezier(0.3, 1.4, 0.4, 1)' },
};

/** Sémantiques fixes par mode — un « payé » est vert chez tout le monde. */
const SEMANTIQUES: Record<BrandMode, { green: string; red: string; amber: string }> = {
  dark: { green: '#3fae4a', red: '#c94b3f', amber: '#e0973f' },
  light: { green: '#2f8a3b', red: '#b7382e', amber: '#b8731f' },
};

export type JetonsMasque = {
  vars: Record<string, string>;
  colorScheme: BrandMode;
  prixMono: boolean;
};

const police = (slug: string): string => `var(--police-${slug}), ${fallbackDe(slug)}`;

export function resoudreMarque(brand: Brand): JetonsMasque {
  const p = {
    ground: brand.palette.ground.toLowerCase(),
    surface: brand.palette.surface.toLowerCase(),
    ink: brand.palette.ink.toLowerCase(),
    accent: brand.palette.accent.toLowerCase(),
    onAccent: brand.palette.onAccent.toLowerCase(),
  };
  const sombre = brand.mode === 'dark';
  const d = derives(p);
  const sem = SEMANTIQUES[brand.mode];
  const [rSm, rMd, rLg] = RAYONS[brand.shape];
  const m = MOUVEMENTS[brand.motion];
  const pair = TYPE_PAIRS[brand.type.pair];
  // Le texte posé sur une sémantique : noir ou blanc, par contraste réel.
  const sur = (fond: string) => (ratioContraste('#000000', fond) >= ratioContraste('#ffffff', fond) ? '#000000' : '#ffffff');
  const ombre = sombre ? 'rgba(0, 0, 0, 0.38)' : alpha(p.ink, 0.14);

  const vars: Record<string, string> = {
    // Neutres
    '--cf-bg': p.ground,
    '--cf-surface': p.surface,
    '--cf-surface-2': melanger(p.surface, p.ink, 0.04),
    '--cf-text': p.ink,
    '--cf-ink-soft': melanger(p.ink, p.ground, 0.25),
    '--cf-mut': d.inkMut,
    '--cf-line': alpha(p.ink, 0.12),
    '--cf-line-2': alpha(p.ink, 0.06),
    '--cf-surface-3': alpha(p.ink, 0.03),
    '--cf-surface-6': alpha(p.ink, 0.06),
    '--cf-white-50': alpha(p.ink, 0.5),
    '--cf-fill': sombre ? melanger(p.surface, p.ink, 0.06) : p.ink,
    '--cf-on-fill': sombre ? p.ink : p.ground,
    '--cf-btn-dark': sombre ? melanger(p.surface, p.ink, 0.1) : p.ink,
    // Accent
    '--cf-accent': p.accent,
    '--cf-accent-hover': melanger(p.accent, sombre ? '#ffffff' : '#000000', 0.08),
    '--cf-on-accent': p.onAccent,
    '--cf-accent-ink': d.accentInk,
    '--cf-accent-wash': alpha(p.accent, 0.12),
    '--cf-focus': alpha(p.accent, 0.6),
    // Sémantiques — fixes par mode, jamais la marque
    '--cf-green': sem.green,
    '--cf-red': sem.red,
    '--cf-amber': sem.amber,
    '--cf-green-t': ajusterJusquaAA(sem.green, p.ground),
    '--cf-red-t': ajusterJusquaAA(sem.red, p.ground),
    '--cf-amber-t': ajusterJusquaAA(sem.amber, p.ground),
    '--cf-on-green': sur(sem.green),
    '--cf-on-red': sur(sem.red),
    '--cf-on-amber': sur(sem.amber),
    // Surfaces composées — le voile suit l'encre, l'aplat suit la surface
    '--cf-card-gradient': `linear-gradient(180deg, ${alpha(p.ink, 0.05)} 0%, ${alpha(p.ink, 0)} 62%), linear-gradient(0deg, ${p.surface}, ${p.surface})`,
    '--cf-elev-gradient': `linear-gradient(180deg, ${alpha(p.ink, 0.045)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${melanger(p.surface, p.ink, 0.04)}, ${melanger(p.surface, p.ink, 0.04)})`,
    '--cf-elev-hover': `linear-gradient(180deg, ${alpha(p.ink, 0.07)} 0%, ${alpha(p.ink, 0)} 70%), linear-gradient(0deg, ${melanger(p.surface, p.ink, 0.08)}, ${melanger(p.surface, p.ink, 0.08)})`,
    // Ombres
    '--cf-shadow': `0 1px 0 ${ombre}, 0 10px 28px ${ombre}`,
    '--cf-shadow-2': `0 2px 0 ${ombre}, 0 16px 40px ${ombre}`,
    '--cf-shadow-soft': `0 12px 34px ${ombre}`,
    '--cf-shadow-card': `0 1px 0 ${ombre}, 0 10px 26px ${ombre}`,
    '--cf-shadow-accent': `0 0 0 1px ${p.accent}`,
    '--cf-shadow-drawer': `-1px 0 0 ${alpha(p.ink, 0.08)}, -26px 0 60px ${ombre}`,
    // Forme
    '--cf-r-xs': `${rSm}px`,
    '--cf-r-sm': `${rMd}px`,
    '--cf-r-md': `${rMd}px`,
    '--cf-r': `${rLg}px`,
    '--cf-r-lg': `${rLg + 4}px`,
    '--cf-r-pill': '999px',
    // Mouvement
    '--sm-ease': m.ease,
    '--sm-t-fast': `${m.base}ms`,
    '--sm-t-med': `${m.entree}ms`,
    '--sm-t-slow': `${m.fete}ms`,
    // Polices
    '--cf-font-display': police(pair.display),
    '--cf-font-body': police(pair.body),
    '--cf-font-mono': police(pair.mono ?? 'jetbrains-mono'),
  };
  return { vars, colorScheme: brand.mode, prixMono: pair.prixMono };
}

// ─────────────────────────────────────────────────────────────
// Le repli, le masque effectif, les champs plats
// ─────────────────────────────────────────────────────────────

const LAITON = '#c9a15a';

/**
 * Tant qu'un tenant n'a pas été repris (brand = null), il porte Nuit — la
 * direction la plus proche de l'identité Snack Manager — avec son accent et
 * son logo. Aucune surface ne casse avant la reprise.
 */
export function marqueDeRepli(
  brandColor: string | null | undefined,
  logoUrl: string | null | undefined,
): Brand {
  const nuit = DIRECTIONS.nuit;
  const brut = String(brandColor ?? '').trim().toLowerCase();
  const accent = ajusterJusquaAA(HEX.test(brut) ? brut : LAITON, nuit.palette.ground);
  const onAccent = ratioContraste('#000000', accent) >= ratioContraste('#ffffff', accent) ? '#000000' : '#ffffff';
  return {
    ...nuit,
    palette: { ...nuit.palette, accent, onAccent },
    logo: { mark: { light: null, dark: logoUrl ?? null }, lockup: { light: null, dark: null } },
    preset: 'nuit',
  };
}

export function marqueEffective(t: {
  brand?: unknown;
  brandColor?: string | null;
  logoUrl?: string | null;
}): Brand {
  // Le masque lu en base est une donnée de FORME non fiable : Mongoose infère
  // des clés optionnelles là où le contrat les veut présentes, et `type.pair`
  // en simple chaîne. Un seul adaptateur, ici — l'API ne caste jamais.
  const lu = BrandSchema.safeParse(t.brand ?? null);
  return lu.success && lu.data !== null ? lu.data : marqueDeRepli(t.brandColor, t.logoUrl);
}

/** Le contrat « logo + accent » des outils du personnel : dérivé, jamais stocké à part. */
export const brandColorDe = (b: Brand): string => b.palette.accent;

export function logoUrlDe(b: Brand): string | null {
  return b.logo.mark.dark ?? b.logo.mark.light ?? b.logo.lockup.dark ?? b.logo.lockup.light;
}

/** La déclinaison du mode ; sinon l'autre déclinaison ; sinon l'autre format. */
export function logoPour(b: Brand, format: 'mark' | 'lockup'): string | null {
  const autre = format === 'mark' ? 'lockup' : 'mark';
  const pref = b.mode === 'dark' ? 'dark' : 'light';
  const alt = pref === 'dark' ? 'light' : 'dark';
  return b.logo[format][pref] ?? b.logo[format][alt] ?? b.logo[autre][pref] ?? b.logo[autre][alt];
}
