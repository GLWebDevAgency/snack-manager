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
 * Rapproche `couleur` du pôle opposé à `fond` (noir sur fond clair, blanc sur
 * fond sombre) par pas de 1/200, jusqu'au seuil. Une couleur déjà conforme
 * revient telle quelle, en minuscules.
 */
export function ajusterJusquaAA(couleur: string, fond: string, seuil = WCAG_AA): string {
  const depart = couleur.toLowerCase();
  if (ratioContraste(depart, fond) >= seuil) return depart;
  const pole = luminance(fond) > 0.5 ? '#000000' : '#ffffff';
  for (let pas = 1; pas <= 200; pas += 1) {
    const candidat = melanger(depart, pole, pas / 200);
    if (ratioContraste(candidat, fond) >= seuil) return candidat;
  }
  return pole;
}
