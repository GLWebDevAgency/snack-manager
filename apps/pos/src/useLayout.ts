/**
 * Point d'entrée React du moteur de mise en page.
 *
 * `useLayout()` est le seul consommateur de `useWindowDimensions` de la caisse :
 * toute décision de dimension (rail, ticket, colonnes, échelle, mode compact,
 * orientation) descend d'ici, jamais d'une condition dispersée dans un écran.
 * Le calcul est mémorisé sur la taille de fenêtre — une rotation ou un
 * redimensionnement recalcule, un simple rendu non.
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { computeLayout, type Layout } from './layout';

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return useMemo(() => computeLayout(width, height), [height, width]);
}

export { columnsFor, cardWidth, computeLayout, COMPACT_W, REFERENCE } from './layout';
export type { Layout, Orientation, ScreenClass } from './layout';
