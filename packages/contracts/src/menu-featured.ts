import { z } from 'zod';

/** Une sélection commune aux écrans de salle et à la commande en ligne. */
export const FEATURED_PRODUCTS_MAX = 3;
export const FeaturedProductIdsSchema = z.array(z.string().regex(/^[a-f\d]{24}$/i, 'Produit invalide'))
  .max(FEATURED_PRODUCTS_MAX, 'Choisissez au plus trois produits par catégorie')
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, 'Un produit ne peut être sélectionné deux fois');
export const CategoryFeaturedUpdateSchema = z.object({
  productIds: FeaturedProductIdsSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type CategoryFeaturedUpdate = z.infer<typeof CategoryFeaturedUpdateSchema>;
export interface CategoryFeaturedView {
  categoryId: string;
  featuredProductIds: string[];
  featuredRevision: number;
}

/** Lecture défensive des anciennes catégories ; la disponibilité se résout ensuite. */
export function featuredProductIdsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).filter((id) => id.length > 0))].slice(0, FEATURED_PRODUCTS_MAX);
}
