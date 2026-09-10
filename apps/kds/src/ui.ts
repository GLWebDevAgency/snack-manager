/** Tokens du KDS : présentation thémable, couleurs de statut fixes. */
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { PALETTES, palette, radius, space, TOUCH_MIN } from '@sm/client-core';
import { ratioContraste } from '@sm/contracts';
import type { KdsTheme } from './prefs';
import { BRAND_FONT } from '@sm/ui-native/brand';

export { palette, radius, space, TOUCH_MIN };

/** Inter est embarquée par le socle UI ; aucune police distante au démarrage. */
export const FONT = BRAND_FONT;
export const SETTINGS_TRIGGER_ID = 'kds-settings-trigger';
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

const elevate = (css: string, native: { color: string; opacity: number; radius: number; y: number; elevation: number }): ViewStyle =>
  Platform.OS === 'web' ? ({ boxShadow: css } as ViewStyle) : {
    shadowColor: native.color, shadowOpacity: native.opacity, shadowRadius: native.radius,
    shadowOffset: { width: 0, height: native.y }, elevation: native.elevation,
  };

function buildUi(theme: KdsTheme) {
  const light = theme === 'light';
  const palette = PALETTES[theme];
  const surface = {
    bg: palette.bg, card: palette.surface, el: palette.surface2,
    el2: light ? '#e6e4df' : '#242424', column: light ? '#e4e3df' : '#0c0c0c',
  };
  const hair = palette.line;
  const hair2 = palette.line2;
  const ink = {
    onRed: light ? '#b8362b' : '#ff8b7b',
    onAmber: light ? '#9a5b12' : '#f2b56d',
    onGreen: light ? '#267e31' : '#6ecf78',
    onDark: '#ffffff',
    dim: light ? '#6b6b6b' : '#9a9a9a',
    dimmer: light ? '#6e6e6e' : '#858585',
  };
  const shadow = {
    card: light
      ? elevate('0 2px 8px rgba(0,0,0,.08)', { color: '#000', opacity: 0.08, radius: 8, y: 2, elevation: 2 })
      : elevate('0 1px 0 rgba(0,0,0,.35), 0 10px 26px rgba(0,0,0,.45)', { color: '#000', opacity: 0.45, radius: 14, y: 8, elevation: 6 }),
    panel: light
      ? elevate('0 24px 56px rgba(0,0,0,.22)', { color: '#000', opacity: 0.22, radius: 28, y: 24, elevation: 10 })
      : elevate('0 1px 0 rgba(0,0,0,.4), 0 18px 44px rgba(0,0,0,.5)', { color: '#000', opacity: 0.5, radius: 22, y: 12, elevation: 10 }),
    alert: elevate('0 0 0 1px rgba(201,75,63,.55), 0 0 34px rgba(201,75,63,.30)', { color: palette.red, opacity: 0.55, radius: 18, y: 0, elevation: 12 }),
  };
  const base: TextStyle = { fontFamily: FONT, color: palette.text };
  const type = StyleSheet.create({
    hero: { ...base, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 36, ...tabular },
    clock: { ...base, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, ...tabular },
    title: { ...base, fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
    item: { ...base, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, lineHeight: 20 },
    qty: { ...base, fontSize: 17, fontWeight: '800', letterSpacing: -0.4, ...tabular },
    body: { ...base, fontSize: 13.5, fontWeight: '500', color: ink.dim, lineHeight: 18 },
    micro: { ...base, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: ink.dim },
    action: { ...base, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  });
  return { theme, palette, surface, hair, hair2, ink, shadow, type, FONT, tabular, radius, space, TOUCH_MIN, scrim: palette.scrim };
}

export type Ui = ReturnType<typeof buildUi>;
const UI_CACHE: Partial<Record<KdsTheme, Ui>> = {};

/** Deux objets immuables par convention ; aucun style n'est recréé au tic des minuteurs. */
export function makeUi(theme: KdsTheme = 'dark'): Ui {
  return UI_CACHE[theme] ?? (UI_CACHE[theme] = buildUi(theme));
}

/** Compatibilité : les consommateurs existants conservent la présentation sombre. */
export const { surface, hair, hair2, ink, shadow, type } = makeUi('dark');

// ─────────────────────────────────────────────────────────────
// Couleurs par statut — sémantique fixe, jamais personnalisée
// ─────────────────────────────────────────────────────────────

/**
 * Le référentiel SM Dark pose : vert = prêt/positif · rouge = nouveau/urgent ·
 * ambre = en préparation. On l'applique littéralement aux trois colonnes, ce qui
 * a deux vertus : la sémantique est identique sur tous les comptes, et l'accent
 * de marque reste disponible pour les seules actions primaires.
 *
 * Ces aplats restent les mêmes dans les thèmes sombre et clair.
 */
export const STATUS_TONE = {
  new: {
    bg: palette.red,
    fg: '#ffffff',
    badge: 'rgba(255,255,255,0.24)',
    label: 'Nouveau',
    short: 'Nouveau',
  },
  preparing: {
    bg: palette.amber,
    fg: palette.onAmber,
    badge: 'rgba(28,22,18,0.20)',
    label: 'En préparation',
    /** Mode téléphone : « En préparation » ne tient pas dans un onglet de 80 px. */
    short: 'En prépa',
  },
  ready: {
    bg: palette.green,
    fg: '#08120a',
    badge: 'rgba(0,0,0,0.20)',
    label: 'Prêt',
    short: 'Prêt',
  },
} as const;

export type BoardStatus = keyof typeof STATUS_TONE;

export const BOARD_STATUSES: BoardStatus[] = ['new', 'preparing', 'ready'];

/** Libellé du bouton qui fait avancer la commande. */
export const ADVANCE_LABEL: Record<BoardStatus, string> = {
  new: 'Accepter',
  preparing: 'Marquer prête',
  ready: 'En attente de prise en charge',
};

/** État vide, formulé par colonne (plus utile qu'un tiret générique). */
export const EMPTY_COPY: Record<BoardStatus, { title: string; hint: string }> = {
  new: { title: 'Aucune nouvelle commande', hint: 'Le prochain ticket sonnera ici.' },
  preparing: { title: 'Rien en préparation', hint: 'Acceptez un ticket pour le lancer.' },
  ready: { title: 'Aucune commande prête', hint: 'Les plats prêts attendent ici leur prise en charge.' },
};

// ─────────────────────────────────────────────────────────────
// Canaux
// ─────────────────────────────────────────────────────────────

export const CHANNEL_LABEL: Record<string, string> = {
  pos: 'Comptoir',
  online: 'En ligne',
  phone: 'Téléphone',
};

export const CHANNEL_FILTERS = [
  { key: 'all', label: 'Tous' },
  { key: 'pos', label: 'Comptoir' },
  { key: 'online', label: 'En ligne' },
  { key: 'phone', label: 'Téléphone' },
] as const;

export type ChannelFilter = (typeof CHANNEL_FILTERS)[number]['key'];

export const TYPE_LABEL: Record<string, string> = {
  surplace: 'Sur place',
  emporter: 'À emporter',
  pickup: 'Retrait',
  delivery: 'Livraison',
};

// ─────────────────────────────────────────────────────────────
// Outils couleur
// ─────────────────────────────────────────────────────────────

function channels(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim();
  const full = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return [255, 255, 255];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Les deux encres de l'écran de cuisine — un noir teinté, jamais le noir pur. */
const ENCRE_SOMBRE = '#0b0a08';
const ENCRE_CLAIRE = '#ffffff';

/**
 * Encre lisible sur un aplat donné. Indispensable : l'accent vient du tenant,
 * et du texte blanc sur un accent doré (#c9a15a → 2,4:1) serait illisible sous
 * les néons.
 *
 * Le choix se fait PAR CONTRASTE RÉEL, avec `ratioContraste` du contrat.
 * C'était une luminance recopiée ici comparée à un seuil : le seuil 0,179 est
 * bien le croisement du noir PUR et du blanc, mais l'encre de cet écran est
 * `#0b0a08` — le croisement y est ailleurs, et une cinquième copie de WCAG
 * dans le dépôt finit toujours par diverger de la sienne d'un dixième.
 */
export function contrastOn(background: string): string {
  return ratioContraste(ENCRE_SOMBRE, background) >= ratioContraste(ENCRE_CLAIRE, background)
    ? ENCRE_SOMBRE
    : ENCRE_CLAIRE;
}

/** `#c9a15a` + 0.14 → `rgba(201,161,90,0.14)` — voiles et fonds teintés. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = channels(hex);
  return `rgba(${r},${g},${b},${a})`;
}
