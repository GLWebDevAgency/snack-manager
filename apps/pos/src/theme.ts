/**
 * Socle visuel de la caisse — surfaces RestoPilot, thèmes du poste conservés.
 *
 * Trois niveaux de surface (fond / carte / élément), filets très fins,
 * typographie à fort contraste de graisse, accent parcimonieux.
 * Les couleurs FONCTIONNELLES (vert/rouge/ambre) viennent de `@sm/client-core`
 * et ne sont jamais personnalisées : un équipier qui change de restaurant doit
 * lire l'écran de la même façon.
 */
import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { radius, type ColorTheme, type Palette } from '@sm/client-core';
import { radius as visualRadius, space as visualSpace, motion } from '@sm/design-tokens';
import { visualPalette } from './visual-palette';
import { ratioContraste } from '@sm/contracts';
import { BRAND_FONT } from '@sm/ui-native/brand';

const palette = visualPalette('dark');

/**
 * Variantes réservées au texte fonctionnel sur les surfaces sombres du POS.
 *
 * Le rouge métier reste celui du socle partagé pour les aplats, bordures et
 * repères. Sa variante claire atteint 7,3:1 sur `palette.surface` (contre
 * 4,1:1 pour le rouge métier) et garde donc les petits libellés d'alerte au
 * niveau AA, y compris sans graisse typographique.
 */
export function makeSemanticText(p: Palette) {
  return { danger: p.redText, positive: p.greenText, success: p.greenText, warning: p.amberText };
}
export const semanticText = makeSemanticText(palette);

/** Inter est embarquée et chargée par usePosFonts ; pile système en secours web. */
export const FONT = BRAND_FONT;

export const DUR = { fast: motion.state, base: motion.sheet, slow: 340 } as const;

/** Espacements de la caisse (respiration : 12–16 px entre cartes). */
export const S = { ...visualSpace, xl: visualSpace.xl, xxl: visualSpace.xxl } as const;

export const R = { ctrl: visualRadius.button, card: visualRadius.card, panel: visualRadius.sheet, pill: visualRadius.pill } as const;

/**
 * La géométrie du poste (rail, ticket, barre haute) n'est plus figée ici : elle
 * vit dans `layout.ts`, qui la calcule à partir de la fenêtre entre des bornes
 * documentées et redonne exactement les valeurs de la maquette (108 / 384 / 66)
 * sur la tablette de référence 1280 × 800. Toute dimension consommée par un
 * composant vient de `useLayout()`.
 */

// ─── Couleurs dérivées de l'accent tenant ───

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [201, 161, 90];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur translucide dérivée d'un hex (pas de color-mix en RN). */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Les deux encres de la caisse — un noir teinté, jamais le noir pur. */
const ENCRE_SOMBRE = '#12100d';
const ENCRE_CLAIRE = '#ffffff';

/**
 * Texte lisible sur l'accent. Un accent doré (#c9a15a) réclame du texte
 * sombre : le blanc y tombe à 2,4:1, très en dessous du seuil WCAG.
 *
 * Le choix se fait PAR CONTRASTE RÉEL, avec `ratioContraste` du contrat, et
 * non par une luminance recopiée ici comparée à un seuil : `0,18` était le
 * croisement du noir PUR et du blanc, alors que l'encre de la caisse est
 * `#12100d` — le vrai croisement est à 0,191, et la bande entre les deux
 * recevait l'encre la MOINS lisible des deux.
 */
export function readableOn(hex: string): string {
  return ratioContraste(ENCRE_SOMBRE, hex) >= ratioContraste(ENCRE_CLAIRE, hex)
    ? ENCRE_SOMBRE
    : ENCRE_CLAIRE;
}

export interface Brand {
  accent: string;
  onAccent: string;
  /** Teinte de fond très diluée, pour les états actifs. */
  tint: string;
  tintStrong: string;
  name: string;
  initial: string;
  logoUrl?: string | null;
}

export function makeBrand(name: string, accentHex?: string | null, logoUrl?: string | null): Brand {
  const accent = accentHex && /^#?[0-9a-fA-F]{3,8}$/.test(accentHex) ? accentHex : palette.gold;
  return {
    accent,
    onAccent: readableOn(accent),
    tint: withAlpha(accent, 0.12),
    tintStrong: withAlpha(accent, 0.22),
    name,
    initial: (name.trim()[0] ?? 'S').toUpperCase(),
    logoUrl,
  };
}

// ─── Ombres (elevation Android + shadow iOS/web) ───

function themedShadow(theme: ColorTheme, level: 1 | 2 | 3): ViewStyle {
  const conf = {
    1: { h: 4, r: 16, o: theme === 'light' ? 0.04 : 0.16, e: 2 },
    2: { h: 10, r: 24, o: theme === 'light' ? 0.14 : 0.5, e: 8 },
    3: { h: 24, r: 56, o: theme === 'light' ? 0.22 : 0.65, e: 20 },
  }[level];
  // Sur le web, react-native-web déprécie les props `shadow*` au profit de
  // `boxShadow` ; sur mobile on garde elevation (Android) + shadow (iOS).
  if (Platform.OS === 'web') {
    return { boxShadow: `0px ${conf.h}px ${conf.r}px rgba(0,0,0,${conf.o})` } as ViewStyle;
  }
  return {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: conf.h },
    shadowOpacity: conf.o,
    shadowRadius: conf.r,
    elevation: conf.e,
  };
}

export const shadow = (level: 1 | 2 | 3): ViewStyle => themedShadow('dark', level);

// ─── Typographie ───

const tab: TextStyle = { fontVariant: ['tabular-nums'] };

export const makeType = (palette: Palette) => StyleSheet.create({
  /** Grands nombres : prix, totaux, n° de retrait. */
  display: {
    fontFamily: FONT,
    color: palette.text,
    fontWeight: '800',
    letterSpacing: -0.6,
    ...tab,
  },
  h1: { fontFamily: FONT, color: palette.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  h2: { fontFamily: FONT, color: palette.text, fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  body: { fontFamily: FONT, color: palette.text, fontSize: 15, fontWeight: '500' },
  strong: { fontFamily: FONT, color: palette.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.1 },
  mut: { fontFamily: FONT, color: palette.mut, fontSize: 13, fontWeight: '500' },
  /** Intitulés de section : capitales espacées, discrètes. */
  eyebrow: {
    fontFamily: FONT,
    color: palette.mut,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  num: { fontFamily: FONT, color: palette.text, ...tab },
});

/** Chiffres alignés — obligatoire sur tout montant affiché en colonne. */
export const TABULAR: TextStyle = tab;

// ─── Surfaces ───

export const makeSheet = (palette: Palette, shadow: (level: 1 | 2 | 3) => ViewStyle) => StyleSheet.create({
  /** Niveau 2 : carte posée sur le fond. */
  card: {
    backgroundColor: palette.surface,
    borderRadius: R.card,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: palette.line2,
    overflow: 'hidden',
  },
  /** Niveau 3 : élément posé sur une carte. */
  inset: {
    backgroundColor: palette.surface2,
    borderRadius: R.ctrl,
    borderWidth: 1,
    borderColor: palette.line2,
  },
  /** Panneau modal. */
  panel: {
    backgroundColor: palette.surface,
    borderRadius: R.panel,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: palette.line,
    overflow: 'hidden',
    ...shadow(3),
  },
  hairline: { height: 1, backgroundColor: palette.line2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fill: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
});

/** Exports historiques pour les consommateurs pas encore sous provider. */
export const type = makeType(palette);
export const sheet = makeSheet(palette, shadow);

function makeTheme(theme: ColorTheme) {
  const palette = visualPalette(theme);
  const shadow = (level: 1 | 2 | 3) => themedShadow(theme, level);
  return { theme, palette, type: makeType(palette), sheet: makeSheet(palette, shadow), shadow, semanticText: makeSemanticText(palette) };
}

const ThemeContext = createContext(makeTheme('dark'));

/** Valeur locale au poste : aucune mutation de la palette partagée avec le KDS. */
export function ThemeProvider({ theme = 'dark', children }: { theme?: ColorTheme; children: ReactNode }) {
  const value = useMemo(() => makeTheme(theme), [theme]);
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
  return useContext(ThemeContext);
}

export { palette, radius };
export type { Palette, ColorTheme };
