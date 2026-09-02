import { Money } from '@sm/domain';
import { SCENE_MAX_LINES, type ScreenProduct, type ScreenPromo } from '@sm/contracts';
import type { BoardProduct, BoardPromo } from './menu-board.repository';

/**
 * Mise en forme du contenu affiché.
 *
 * Tous les libellés sont calculés ICI, jamais sur l'écran : une clé HDMI à
 * 30 € posée en hauteur n'a personne pour s'apercevoir qu'elle formate un prix
 * autrement que la caisse. L'écran reçoit des chaînes prêtes à peindre.
 */

/** « 9,50 € » sans le symbole — borne basse d'une fourchette. */
function bareAmount(cents: number): string {
  return Money.fromCents(cents).format().replace(/\s*€$/, '');
}

/**
 * Prix affiché d'un produit.
 *
 * Un produit à variantes (« Tacos M / L / XL ») n'a pas UN prix : afficher
 * celui de la plus petite taille serait mensonger, afficher les trois ferait
 * trois lignes. On annonce donc la fourchette — « 8,50 – 12,00 € » — qui est
 * exactement ce qu'un client lit sur une ardoise.
 */
export function priceOf(product: BoardProduct): {
  min: number;
  max: number;
  label: string;
} {
  const prices = product.variantPrices.length > 0 ? product.variantPrices : [product.priceCents];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const label = min === max ? Money.fromCents(min).format() : `${bareAmount(min)} – ${Money.fromCents(max).format()}`;
  return { min, max, label };
}

export function toScreenProduct(product: BoardProduct): ScreenProduct {
  const price = priceOf(product);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    priceLabel: price.label,
    priceCents: price.min,
    priceMaxCents: price.max,
    photoUrl: product.photoUrl,
    // Transporté jusqu'à la clé HDMI : c'est elle qui recadre en 16:9, et
    // c'est donc elle qui a besoin de savoir où est le plat sur la photo.
    photoPoint: product.photoPoint,
    isNew: product.isNew,
    // Marqué, jamais retiré : un produit qui disparaît de l'écran laisse penser
    // qu'il n'existe pas, et le client le redemande au comptoir. Grisé et
    // barré, il fait gagner la question.
    outOfStock: product.outOfStock,
  };
}

/** « −20 % », « −2,50 € », « Offert ». */
export function promoLabel(promo: BoardPromo): string {
  if (promo.kind === 'percent') return `−${promo.value} %`;
  if (promo.kind === 'amount') return `−${Money.fromCents(promo.value).format()}`;
  return 'Offert';
}

export function toScreenPromo(promo: BoardPromo): ScreenPromo {
  return {
    id: promo.id,
    title: promo.name,
    description: promo.description,
    label: promoLabel(promo),
  };
}

/**
 * Découpe une catégorie trop longue en pages successives.
 *
 * On lit l'écran debout, à deux ou quatre mètres : au-delà de huit lignes, la
 * typographie descend sous le seuil de lecture. La carte de Class'Food compte
 * des catégories de quinze produits — sans découpage, elles seraient
 * illisibles, ce qui reviendrait à ne rien afficher.
 *
 * Les pages sont ÉQUILIBRÉES (17 produits ⇒ 6 · 6 · 5, pas 8 · 8 · 1) : une
 * dernière page presque vide au milieu d'une boucle se remarque immédiatement.
 */
export function paginate<T>(items: readonly T[], maxPerPage = SCENE_MAX_LINES): T[][] {
  if (items.length === 0) return [];
  const pages = Math.ceil(items.length / maxPerPage);
  const size = Math.ceil(items.length / pages);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size) as T[]);
  }
  return chunks;
}
