import type { Scenography, ScreenContent, ScreenProduct, ScreenScenePayload } from "@sm/contracts";

const COUNTS: Partial<Record<Scenography, number>> = {
  affiche: 1, halo: 1, premiere: 2,
  galerie: 3, panorama: 3, decoupe: 2,
  editorial: 3, colonne: 3, manifeste: 1,
  contour: 2, aurore: 1, prisme: 3, ruban: 2,
};

function uniqueAvailable(products: ScreenProduct[]): ScreenProduct[] {
  return [...new Map(products.filter((product) => !product.outOfStock).map((product) => [product.id, product])).values()];
}

/** Illustration de la composition, avec les objets produit de la vraie carte et leurs prix intacts. */
export function galleryPreviewScene(content: ScreenContent | null, scenography: Scenography): ScreenScenePayload | null {
  const first = content?.scenes[0] ?? null;
  const count = COUNTS[scenography];
  if (!content || !first || !count) return first;
  const curated = uniqueAvailable(content.scenes.filter((scene) => scene.kind === "featured").flatMap((scene) => scene.products));
  const fallback = uniqueAvailable(content.scenes.flatMap((scene) => scene.products))
    .sort((a, b) => Number(!!b.photoUrl) - Number(!!a.photoUrl));
  const products = (curated.length ? curated : fallback).slice(0, count);
  if (!products.length) return first;
  return {
    ...first, id: `gallery:${scenography}`, kind: "featured",
    title: products.length === 1 ? products[0]!.name : "La sélection",
    subtitle: null, products, promos: [], nextOpening: null,
  };
}
