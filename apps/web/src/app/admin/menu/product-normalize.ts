import { mediasDuProduit, type MediaVue } from "@sm/contracts";
import type { Category, Product } from "./types";

/** Réponse brute de GET /menu, également utilisée par les rafraîchissements locaux. */
export type RawProduct = Partial<Omit<Product, "_id">> & { _id: string };
export type RawMenu = {
  categories?: (Partial<Omit<Category, "_id" | "products">> & {
    _id: string;
    products?: RawProduct[];
  })[];
  uncategorized?: RawProduct[];
  medias?: MediaVue[];
};

export const normProduct = (p: RawProduct, categoryId: string | null): Product => ({
  _id: String(p._id),
  categoryId,
  name: p.name ?? "",
  description: p.description ?? "",
  price: typeof p.price === "number" ? p.price : 0,
  variants: p.variants ?? [],
  optionGroups: p.optionGroups ?? [],
  medias: mediasDuProduit(p),
  photoUrl: typeof p.photoUrl === "string" ? p.photoUrl : null,
  tags: p.tags ?? [],
  isNew: p.isNew === true,
  outOfStock: p.outOfStock === true,
  outOfStockSource: p.outOfStockSource ?? null,
  order: typeof p.order === "number" ? p.order : 0,
  active: p.active !== false,
});
