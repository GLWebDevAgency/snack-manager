import { catalogueMedias, featuredProductIdsOf, type CategoryFeaturedView } from "@sm/contracts";
import { normProduct, type RawMenu } from "./product-normalize";

/** Le GET ne remplace jamais la paire sélection/révision reçue au conflit.
 * Il actualise uniquement les informations affichées, sans toucher à la fiche
 * produit éventuellement ouverte derrière le dialogue. */
export async function recoverFeaturedConflict(current: CategoryFeaturedView, loadMenu: () => Promise<RawMenu>) {
  const selection: CategoryFeaturedView = {
    ...current,
    featuredProductIds: featuredProductIdsOf(current.featuredProductIds),
  };
  try {
    const menu = await loadMenu();
    const category = menu.categories?.find((c) => String(c._id) === current.categoryId);
    if (category) return {
      selection,
      details: {
        name: category.name ?? "",
        active: category.active !== false,
        products: (category.products ?? []).map((p) => normProduct(p, current.categoryId)),
        catalogue: catalogueMedias(menu.medias ?? []),
      },
    };
  } catch { /* La sélection reçue au 409 reste utilisable même sans catalogue. */ }
  return { selection, details: null };
}
