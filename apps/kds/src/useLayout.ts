/**
 * `useLayout()` — la seule source de vérité des dimensions du KDS.
 *
 * Le KDS tourne sur un parc hétérogène : tablette 10" posée sur le passe,
 * tablette 13", écran 24" accroché au mur, téléphone du gérant en dépannage.
 * Aucune de ces cibles ne doit être « la maquette rétrécie » : le rail, les
 * colonnes, les paddings ET la typographie se recalculent à partir de la
 * fenêtre, entre des bornes documentées dans `config.ts`.
 *
 * Un composant ne compare JAMAIS une largeur lui-même : il lit `layout`.
 *
 * Deux échelles sont exposées, et c'est volontaire :
 *  - `fs()`  — texte de lecture rapprochée (noms d'articles, options, méta) ;
 *  - `far()` — texte lu à 2-4 m (n° de retrait, minuteur, « SANS OIGNONS »,
 *              en-têtes de colonne). Il grossit plus vite, parce que c'est lui
 *              qui décide si l'écran sert à quelque chose depuis le piano.
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { TOUCH_MIN } from '@sm/client-core';
import {
  ACTION_MIN_HEIGHT,
  ALLDAY_MIN_SCREEN,
  ALLDAY_PANEL,
  COLUMN_COMFORT_WIDTH,
  DENSE_TOOLBAR_MAX_WIDTH,
  FAR_BOOST,
  SCALE_MAX,
  SCALE_REF_SHORT,
  SCALE_SPAN,
  TABS_MAX_WIDTH,
} from './config';

export interface Layout {
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait';

  /** Écran étroit : une seule liste et des onglets par statut. */
  compact: boolean;
  /** Colonnes de statut rendues côte à côte (3 sur tablette, 1 en onglets). */
  cols: number;
  /** Largeur estimée d'une colonne — sert aux arbitrages, pas au rendu (flex). */
  colW: number;
  /** Largeur du panneau « À lancer ». 0 = replié faute de place. */
  allDayW: number;
  /** Barre haute allégée : les compteurs par statut cèdent la place. */
  denseToolbar: boolean;

  /** Facteur typographique borné [1 ; 1,5]. */
  scale: number;
  /** Espacement entre colonnes / cartes. */
  gap: number;
  /** Marge du plateau. */
  pad: number;
  /** Hauteur d'un bouton d'action — jamais sous 56 px, plus haut sur grand écran. */
  actionH: number;
  /** Cible tactile minimale — jamais sous 44 px (gants, écran gras). */
  touch: number;

  /** Taille de texte courante, mise à l'échelle. */
  fs(size: number): number;
  /** Taille de texte « lu de loin », sur-amplifiée. */
  far(size: number): number;

  /** Identité de palier — clé de cache des feuilles de style dérivées. */
  key: string;
}

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

/** Demi-pixel : assez fin pour une progression douce, sans sous-pixel absurde. */
const half = (value: number) => Math.round(value * 2) / 2;

/**
 * Calcul pur — testable et utilisable hors React (le hook n'en est que
 * l'emballage mémoïsé).
 */
export function computeLayout(width: number, height: number): Layout {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const short = Math.min(w, h);
  const compact = w < TABS_MAX_WIDTH;

  // 1) Échelle « classe d'appareil », dérivée du petit côté.
  const byDevice = clamp(1 + (short - SCALE_REF_SHORT) / SCALE_SPAN, 1, SCALE_MAX);

  // 2) Place disponible, estimée avec cette échelle provisoire.
  const probePad = Math.round(clamp(14 * byDevice, 12, 26));
  const probeGap = Math.round(clamp(12 * byDevice, 10, 20));

  // Le panneau « À lancer » se replie EN PREMIER : les colonnes priment.
  const allDayW =
    compact || w < ALLDAY_MIN_SCREEN
      ? 0
      : Math.round(clamp(w * ALLDAY_PANEL.ratio, ALLDAY_PANEL.min, ALLDAY_PANEL.max));

  const cols = compact ? 1 : 3;
  const stage = w - probePad * 2 - (allDayW > 0 ? allDayW + probeGap : 0);
  const colW = Math.max(0, (stage - probeGap * (cols - 1)) / cols);

  // 3) Une colonne étroite ne peut pas porter une typo agrandie : sur un grand
  //    écran en portrait, c'est la colonne qui commande, pas la diagonale.
  const byColumn = clamp(colW / COLUMN_COMFORT_WIDTH, 1, SCALE_MAX);
  const scale = Math.round(Math.min(byDevice, byColumn) * 100) / 100;

  const pad = Math.round(clamp(14 * scale, 12, 26));
  const gap = Math.round(clamp(12 * scale, 10, 20));
  const farScale = 1 + (scale - 1) * FAR_BOOST;

  // Largeur de colonne définitive, une fois marges et gouttières arrêtées.
  const finalStage = w - pad * 2 - (allDayW > 0 ? allDayW + gap : 0);
  const finalColW = Math.max(0, (finalStage - gap * (cols - 1)) / cols);

  return {
    width: w,
    height: h,
    orientation: h > w ? 'portrait' : 'landscape',
    compact,
    cols,
    colW: Math.round(finalColW),
    allDayW,
    // Le seuil vaut pour l'échelle de référence : une barre dont tout le
    // contenu a grossi de 28 % réclame d'autant plus de largeur pour tenir.
    denseToolbar: w < DENSE_TOOLBAR_MAX_WIDTH * scale,
    scale,
    gap,
    pad,
    actionH: Math.max(ACTION_MIN_HEIGHT, Math.round(ACTION_MIN_HEIGHT * scale)),
    touch: Math.max(TOUCH_MIN, Math.round(TOUCH_MIN * scale)),
    fs: (size: number) => half(size * scale),
    far: (size: number) => half(size * farScale),
    key: `${scale}${compact ? 'c' : 'w'}`,
  };
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => computeLayout(width, height), [width, height]);
}

/**
 * Fabrique de feuille de style dépendante de l'échelle, mémoïsée par palier.
 *
 * `StyleSheet.create` n'est appelé qu'une fois par valeur d'échelle rencontrée
 * (au plus une cinquantaine de paliers), pas à chaque rendu de carte : une
 * colonne de vingt tickets qui bat à la seconde ne recrée aucun style.
 */
export function scaledStyles<T>(build: (layout: Layout) => T): (layout: Layout) => T {
  const cache = new Map<string, T>();
  return (layout: Layout): T => {
    const hit = cache.get(layout.key);
    if (hit) return hit;
    const made = build(layout);
    cache.set(layout.key, made);
    return made;
  };
}
