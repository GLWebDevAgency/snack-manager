/**
 * Socle visuel de la caisse — « noir premium stratifié ».
 *
 * Trois niveaux de surface (fond / carte / élément), filets très fins,
 * typographie à fort contraste de graisse, accent parcimonieux.
 * Les couleurs FONCTIONNELLES (vert/rouge/ambre) viennent de `@sm/client-core`
 * et ne sont jamais personnalisées : un équipier qui change de restaurant doit
 * lire l'écran de la même façon.
 */
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { palette, radius } from '@sm/client-core';

/** Pile de polices : Inter si présente sur le poste, sinon la police système. */
export const FONT: string = Platform.select({
  web: 'Inter, "SF Pro Display", -apple-system, "Segoe UI", Roboto, system-ui, sans-serif',
  default: 'System',
}) as string;

export const DUR = { fast: 200, base: 260, slow: 340 } as const;

/** Espacements de la caisse (respiration : 12–16 px entre cartes). */
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const R = { ctrl: 8, card: 12, panel: 18, pill: 999 } as const;

/** Géométrie fixe du poste en paysage. */
export const RAIL_W = 108;
export const TICKET_W = 384;
export const TOPBAR_H = 66;

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

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Texte lisible sur l'accent. Un accent doré (#c9a15a) réclame du texte
 * sombre : le blanc y tombe à 2,4:1, très en dessous du seuil WCAG.
 */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.18 ? '#12100d' : '#ffffff';
}

export interface Brand {
  accent: string;
  onAccent: string;
  /** Teinte de fond très diluée, pour les états actifs. */
  tint: string;
  tintStrong: string;
  name: string;
  initial: string;
}

export function makeBrand(name: string, accentHex?: string | null): Brand {
  const accent = accentHex && /^#?[0-9a-fA-F]{3,8}$/.test(accentHex) ? accentHex : palette.gold;
  return {
    accent,
    onAccent: readableOn(accent),
    tint: withAlpha(accent, 0.12),
    tintStrong: withAlpha(accent, 0.22),
    name,
    initial: (name.trim()[0] ?? 'S').toUpperCase(),
  };
}

// ─── Ombres (elevation Android + shadow iOS/web) ───

export function shadow(level: 1 | 2 | 3): ViewStyle {
  const conf = {
    1: { h: 2, r: 8, o: 0.35, e: 2 },
    2: { h: 10, r: 24, o: 0.5, e: 8 },
    3: { h: 24, r: 56, o: 0.65, e: 20 },
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

// ─── Typographie ───

const tab: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = StyleSheet.create({
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

export const sheet = StyleSheet.create({
  /** Niveau 2 : carte posée sur le fond. */
  card: {
    backgroundColor: palette.surface,
    borderRadius: R.card,
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

export { palette, radius };
