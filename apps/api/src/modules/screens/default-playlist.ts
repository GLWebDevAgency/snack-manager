import {
  PROMO_SCENE_DURATION_MS,
  SCENE_DURATION_DEFAULT_MS,
  type ScreenScene,
} from '@sm/contracts';
import type { BoardCategory, BoardProduct } from './menu-board.repository';

/**
 * La playlist qu'un écran reçoit sans que personne ne l'ait configuré.
 *
 * C'est l'argument de vente du Menu Board : la carte EXISTE déjà en base. Le
 * restaurateur branche une clé HDMI, saisit un code à six caractères, et son
 * menu tourne. S'il fallait composer des scènes à la main avant d'obtenir une
 * image, l'écran resterait noir chez la moitié des clients.
 *
 * Il peut évidemment réordonner ensuite : cette fonction ne fixe que le premier
 * état, jamais l'état courant.
 */
export function buildDefaultPlaylist(
  categories: readonly BoardCategory[],
  products: readonly BoardProduct[],
): ScreenScene[] {
  const populated = new Set(
    products.map((p) => p.categoryId).filter((id): id is string => id !== null),
  );

  /**
   * Les offres ouvrent la boucle — c'est ce qu'on veut faire lire en premier à
   * quelqu'un qui hésite encore dans la file.
   *
   * La scène ne cite aucune promotion : elle sera résolue aux offres ACTIVES au
   * moment de l'affichage, et purement omise s'il n'y en a aucune. Elle est
   * donc posée d'office, y compris sur un restaurant qui n'a encore rien créé —
   * sinon la première promo de sa vie n'apparaîtrait sur aucun écran.
   */
  const scenes: ScreenScene[] = [
    {
      kind: 'promo',
      categoryId: null,
      productIds: [],
      title: 'Offres du moment',
      durationMs: PROMO_SCENE_DURATION_MS,
    },
  ];

  // Une catégorie vide n'a rien à montrer : elle ferait un écran blanc de dix
  // secondes au milieu de la boucle.
  for (const category of categories) {
    if (!populated.has(category.id)) continue;
    scenes.push({
      kind: 'category',
      categoryId: category.id,
      productIds: [],
      title: category.name,
      durationMs: SCENE_DURATION_DEFAULT_MS,
    });
  }

  return scenes;
}
