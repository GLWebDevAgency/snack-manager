/**
 * Socle visuel du KDS — « noir premium stratifié ».
 *
 * Le noyau partagé (`@sm/client-core/theme`) fournit la palette fonctionnelle
 * et les rayons ; ce module ajoute la couche d'expression propre à l'écran
 * cuisine : hiérarchie de surfaces, ombres, échelle typographique, et les
 * quelques nuances « texte sur fond sombre » qui manquent à la palette de base.
 *
 * Règles tenues ici :
 *  - trois niveaux de surface (fond #000 · carte #111 · élément #1a1a1a) ;
 *  - jamais deux surfaces adjacentes de même valeur → une bordure très fine
 *    (`hair` / `hair2`) sépare toujours deux plans ;
 *  - l'accent de marque ne sert qu'aux actions primaires et aux états actifs ;
 *  - les couleurs fonctionnelles (vert/rouge/ambre) ne sont JAMAIS
 *    personnalisables : un cuisinier qui change d'établissement lit l'écran
 *    de la même façon.
 */
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { palette, radius, space, TOUCH_MIN } from '@sm/client-core';
import { ratioContraste } from '@sm/contracts';

export { palette, radius, space, TOUCH_MIN };

// ─────────────────────────────────────────────────────────────
// Surfaces & traits
// ─────────────────────────────────────────────────────────────

export const surface = {
  /** Plan 0 — le fond de l'app. */
  bg: palette.bg, // #000
  /** Plan 1 — cartes, barres, panneaux. */
  card: palette.surface, // #111
  /** Plan 2 — éléments posés sur une carte (case n°, chips, boutons). */
  el: palette.surface2, // #1a1a1a
  /** Plan 3 — élément survolé/enfoncé, tag de variante. */
  el2: '#242424',
  /** Colonne : légèrement au-dessus du fond, en dessous des cartes. */
  column: '#0c0c0c',
} as const;

export const hair = palette.line; // rgba(255,255,255,.1)
export const hair2 = palette.line2; // rgba(255,255,255,.06)

/**
 * Rouges/ambres « texte » : les couleurs fonctionnelles pleines servent aux
 * aplats ; posées en texte sur du noir elles tombent sous 4,5:1. Ces variantes
 * éclaircies gardent la même lecture sémantique avec un contraste conforme.
 */
export const ink = {
  onRed: '#ff8b7b',
  onAmber: '#f2b56d',
  /** 6,5:1 sur #111 — options, libellés secondaires. */
  dim: '#9a9a9a',
  /** 5,2:1 sur #111 — le gris le plus sombre encore conforme AA en petit corps. */
  dimmer: '#858585',
} as const;

// ─────────────────────────────────────────────────────────────
// Ombres — elevation (Android) + shadow* / boxShadow (iOS & web)
// ─────────────────────────────────────────────────────────────

/**
 * Web et natif n'ont pas la même syntaxe d'ombre, et react-native-web déprécie
 * désormais les props `shadow*` : on émet donc l'une OU l'autre, jamais les deux.
 */
const elevate = (
  css: string,
  native: { color: string; opacity: number; radius: number; y: number; elevation: number },
): ViewStyle =>
  Platform.OS === 'web'
    ? ({ boxShadow: css } as ViewStyle)
    : {
        shadowColor: native.color,
        shadowOpacity: native.opacity,
        shadowRadius: native.radius,
        shadowOffset: { width: 0, height: native.y },
        elevation: native.elevation,
      };

export const shadow = {
  card: elevate('0 1px 0 rgba(0,0,0,.35), 0 10px 26px rgba(0,0,0,.45)', {
    color: '#000',
    opacity: 0.45,
    radius: 14,
    y: 8,
    elevation: 6,
  }),
  panel: elevate('0 1px 0 rgba(0,0,0,.4), 0 18px 44px rgba(0,0,0,.5)', {
    color: '#000',
    opacity: 0.5,
    radius: 22,
    y: 12,
    elevation: 10,
  }),
  /** Halo d'alerte : une carte en retard doit se voir de l'autre bout de la cuisine. */
  alert: elevate('0 0 0 1px rgba(201,75,63,.55), 0 0 34px rgba(201,75,63,.30)', {
    color: palette.red,
    opacity: 0.55,
    radius: 18,
    y: 0,
    elevation: 12,
  }),
} as const;

// ─────────────────────────────────────────────────────────────
// Typographie
// ─────────────────────────────────────────────────────────────

/**
 * Inter si la machine l'a, sinon la police système (SF Pro / Roboto / Segoe).
 * Volontairement PAS de chargement réseau : un écran de cuisine doit démarrer
 * identique avec ou sans internet.
 */
export const FONT = Platform.select({
  web: "Inter, -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, system-ui, sans-serif",
  default: undefined,
});

/** Chiffres à chasse fixe — obligatoire sur tout nombre qui change (minuteurs, horloge). */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

const base: TextStyle = { fontFamily: FONT, color: palette.text };

export const type = StyleSheet.create({
  /** Numéro de retrait, gros compteurs. */
  hero: { ...base, fontSize: 34, fontWeight: '900', letterSpacing: -1, lineHeight: 36, ...tabular },
  /** Minuteur de carte, horloge. */
  clock: { ...base, fontSize: 22, fontWeight: '800', letterSpacing: -0.5, ...tabular },
  /** Titres de panneau / barre. */
  title: { ...base, fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },
  /** Nom d'article. */
  item: { ...base, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, lineHeight: 20 },
  /** Quantité « 2× ». */
  qty: { ...base, fontSize: 17, fontWeight: '800', letterSpacing: -0.4, ...tabular },
  /** Corps secondaire — options, méta. */
  body: { ...base, fontSize: 13.5, fontWeight: '500', color: ink.dim, lineHeight: 18 },
  /** Micro-libellé sous un compteur. */
  micro: { ...base, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: ink.dim },
  /** Libellé de bouton. */
  action: { ...base, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
});

// ─────────────────────────────────────────────────────────────
// Couleurs par statut — sémantique fixe, jamais personnalisée
// ─────────────────────────────────────────────────────────────

/**
 * Le référentiel SM Dark pose : vert = prêt/positif · rouge = nouveau/urgent ·
 * ambre = en préparation. On l'applique littéralement aux trois colonnes, ce qui
 * a deux vertus : la sémantique est identique sur tous les comptes, et l'accent
 * de marque reste disponible pour les seules actions primaires.
 *
 * Écart assumé avec la maquette, qui peignait « Nouveau » à l'accent du tenant
 * et « En préparation » au doré de la landing (#c9a15a) : sur un tenant dont
 * l'accent EST #c9a15a (Class'Food), les deux colonnes devenaient indiscernables.
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
