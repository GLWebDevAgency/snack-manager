/**
 * Moteur de mise en page de la caisse — « tablette-first, mais multi-supports ».
 *
 * Le parc d'un snack indépendant est hétérogène : tablette 10" posée sur le
 * comptoir (1280 × 800, la RÉFÉRENCE), tablette 12–13" (2000 × 1200), grand
 * écran de comptoir 24" (1920 × 1080) parfois mural, et le téléphone du gérant
 * en dépannage. Les largeurs figées de la maquette (rail 108, ticket 384,
 * canevas 1280 × 830) laissaient l'interface minuscule au centre d'un 24" et
 * étouffaient la grille produits sur une 10".
 *
 * Ce module est le SEUL endroit qui décide d'une dimension. Il est pur (aucune
 * dépendance à react-native) pour rester testable ; le hook `useLayout()` du
 * module voisin l'alimente avec `useWindowDimensions()`.
 *
 * ─── Seuils retenus, et pourquoi ───────────────────────────────────────────
 *
 * • COMPACT_W = 900 px. En dessous, rail + ticket + grille ne cohabitent plus :
 *   même en resserrant le ticket à sa borne basse (340) et le rail à 88, il ne
 *   reste que ~440 px de grille, soit deux cartes étriquées. Sous ce seuil le
 *   ticket devient donc un panneau escamotable, avec une barre d'accès
 *   permanente (« Ticket · N articles · total ») et l'encaissement carte à
 *   portée d'un seul geste. 900 correspond aussi à une 10" en portrait (820) et
 *   à toute la famille téléphone, qui basculent ensemble.
 *
 * • Rail : 8,5 % de la largeur, borné 88…148 (72 sous 700 px de large, où
 *   chaque pixel compte). À 1280 la formule redonne exactement 108 px, la
 *   valeur de la maquette : la référence ne bouge pas.
 *
 * • Ticket : 30 % de la largeur, borné 340…460. À 1280 → 384 px, là encore la
 *   valeur d'origine. La borne haute évite qu'un 24" transforme le ticket en
 *   colonne de journal ; la borne basse garde deux boutons d'encaissement
 *   côte à côte avec des cibles ≥ 44 px.
 *
 * • Colonnes : jamais un nombre fixe, toujours déduit de la largeur UTILE
 *   (après rail et ticket) et d'une carte idéale de ~190 px (la maquette en
 *   fait 180 à 1280). Bornes 2…3 en compact, 2…5 jusqu'à 1500 px, 2…6 au-delà :
 *   sur un 24" on veut plus de produits visibles, pas des cartes étirées.
 *
 * • Échelle typographique : suit la DIAGONALE de l'écran (un 24" se lit de plus
 *   loin), amortie par un exposant 0,35 et bornée 0,94…1,18. La diagonale, et
 *   non la largeur, parce qu'un 1920 × 1080 et un 1920 × 600 ne se lisent pas
 *   de la même distance. Un plafond supplémentaire dépendant de la hauteur
 *   empêche un écran large mais court de grossir jusqu'à se tronquer.
 *   À 1280 × 800 l'échelle vaut exactement 1 : aucune régression sur la cible.
 *
 * • Cibles tactiles : `touch()` ne descend JAMAIS sous TOUCH_MIN (44 px), quelle
 *   que soit l'échelle. Contrainte d'accessibilité et de gants, pas une
 *   préférence — c'est un plancher, l'échelle ne peut que l'augmenter.
 */
import { TOUCH_MIN } from '@sm/client-core';

/** Tablette Android 10" en paysage : la cible de référence du poste. */
export const REFERENCE = { width: 1280, height: 800 } as const;

/** Sous cette largeur, le ticket ne tient plus à côté de la grille. */
export const COMPACT_W = 900;

/** Bornes du panneau ticket (le pied doit garder deux boutons ≥ 44 px). */
export const TICKET_MIN = 340;
export const TICKET_MAX = 460;

/** Bornes du rail de catégories. */
export const RAIL_MIN = 88;
export const RAIL_MAX = 148;
/** Sous 700 px de large (téléphone), le rail cède quelques pixels à la grille. */
export const RAIL_MIN_TIGHT = 72;

/** Largeur « idéale » d'une carte produit à l'échelle 1 (maquette : 180). */
export const IDEAL_CARD = 190;

/** Bornes de l'échelle typographique. */
export const SCALE_MIN = 0.94;
export const SCALE_MAX = 1.18;

/** Plancher absolu de taille de texte : rien d'utile en service en dessous. */
const FONT_FLOOR = 12;

export type Orientation = 'landscape' | 'portrait';
/** Classe d'écran, pour les rares décisions non métriques. */
export type ScreenClass = 'phone' | 'tablet' | 'large' | 'wall';

export interface Layout {
  width: number;
  height: number;
  orientation: Orientation;
  screen: ScreenClass;
  /** Largeur < 900 px : ticket escamotable, colonnes réduites. */
  compact: boolean;
  /** Rail des catégories (zone B). */
  railW: number;
  /** Ticket (zone D) — largeur du panneau ancré, ou du tiroir en compact. */
  ticketW: number;
  /** Barre haute (zone A) — sa rangée principale. */
  topbarH: number;
  /** Colonnes de la grille produits, estimées sur la largeur utile. */
  cols: number;
  minCols: number;
  maxCols: number;
  gridGap: number;
  gridPad: number;
  /** Hauteur commune des cartes produit (toutes identiques, quelle que soit la ligne). */
  cardH: number;
  /** Facteur typographique borné. */
  scale: number;
  /** Taille de texte adaptée, jamais sous 12 px. */
  fs: (px: number) => number;
  /** Espacement adapté (amorti : on ne dilate pas autant que le texte). */
  sp: (px: number) => number;
  /** Cible tactile adaptée, jamais sous TOUCH_MIN. */
  touch: (px?: number) => number;
  /** Largeur d'une modale bornée à l'écran. */
  modal: (preferred: number) => number;
}

function clamp(min: number, v: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Interpolation d'une échelle sur la diagonale, amortie puis bornée. */
function diagonalScale(width: number, height: number): number {
  const diag = Math.hypot(width, height);
  const ref = Math.hypot(REFERENCE.width, REFERENCE.height);
  const raw = (diag / ref) ** 0.35;
  // Un écran court (barre haute + grille + pied) ne peut pas grossir autant
  // qu'un écran haut : le plafond suit la hauteur disponible.
  const heightCap = height >= 900 ? SCALE_MAX : height >= 760 ? 1.06 : 1;
  return Math.round(clamp(SCALE_MIN, raw, Math.min(SCALE_MAX, heightCap)) * 100) / 100;
}

/**
 * Nombre de colonnes pour une largeur de grille RÉELLEMENT mesurée (après
 * déduction du rail, du ticket et des marges). La grille se mesure elle-même :
 * c'est la seule valeur qui ne peut pas être devinée.
 */
export function columnsFor(gridWidth: number, layout: Layout): number {
  if (gridWidth <= 0) return layout.cols;
  const ideal = IDEAL_CARD * layout.scale;
  const raw = Math.round((gridWidth + layout.gridGap) / (ideal + layout.gridGap));
  return clamp(layout.minCols, raw, layout.maxCols);
}

/** Largeur d'une carte pour un nombre de colonnes donné. */
export function cardWidth(gridWidth: number, cols: number, gap: number): number {
  if (gridWidth <= 0 || cols <= 0) return 0;
  return (gridWidth - gap * (cols - 1)) / cols;
}

export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const orientation: Orientation = h > w ? 'portrait' : 'landscape';
  const compact = w < COMPACT_W;
  const screen: ScreenClass = w < 700 ? 'phone' : w < 1500 ? 'tablet' : w < 1900 ? 'large' : 'wall';

  const scale = diagonalScale(w, h);
  // L'espacement suit l'échelle de moitié : sur un 24" on veut plus de contenu
  // lisible, pas seulement plus de vide.
  const spaceScale = 1 + (scale - 1) * 0.6;

  const fs = (px: number): number => {
    const v = Math.round(px * scale * 2) / 2;
    // En réduction, on ne descend jamais un texte utile sous 12 px.
    return scale >= 1 ? v : Math.max(v, Math.min(px, FONT_FLOOR));
  };
  const sp = (px: number): number => Math.max(2, Math.round(px * spaceScale));
  const touch = (px: number = TOUCH_MIN): number => Math.max(TOUCH_MIN, Math.round(px * spaceScale));

  // `floor` et non `round` : à 1280 la formule doit rendre 108 tout rond, la
  // valeur de la maquette.
  const railW = clamp(w < 700 ? RAIL_MIN_TIGHT : RAIL_MIN, Math.floor(w * 0.085), RAIL_MAX);
  const ticketW = compact
    ? // Tiroir : large mais jamais collé aux bords, sinon on ne voit plus ce
      // qu'on quitte et le geste de fermeture n'a plus de prise.
      clamp(300, w - sp(64), TICKET_MAX)
    : clamp(TICKET_MIN, Math.round(w * 0.3), TICKET_MAX);

  const gridGap = sp(12);
  const gridPad = sp(16);
  const minCols = 2;
  const maxCols = compact ? 3 : w >= 1500 ? 6 : 5;

  const usable = w - railW - (compact ? 0 : ticketW) - gridPad * 2;
  const ideal = IDEAL_CARD * scale;
  const cols = clamp(minCols, Math.round((usable + gridGap) / (ideal + gridGap)), maxCols);

  return {
    width: w,
    height: h,
    orientation,
    screen,
    compact,
    railW,
    ticketW,
    topbarH: clamp(60, Math.round(66 * spaceScale), 84),
    cols,
    minCols,
    maxCols,
    gridGap,
    gridPad,
    cardH: clamp(104, Math.round(108 * spaceScale), 150),
    scale,
    fs,
    sp,
    touch,
    modal: (preferred: number) => Math.max(280, Math.min(Math.round(preferred * spaceScale), w - sp(32))),
  };
}
