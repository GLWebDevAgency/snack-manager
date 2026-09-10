import { featuredProductIdsOf } from "@sm/contracts";
import { normProduct, type RawMenu } from "../menu/product-normalize";
import type { MenuData, Product } from "../menu/types";
export type PresentationDraft = { photoKind: "cutout" | "cover"; popularOverride: boolean | null };
export function presentationOf(product: Product): PresentationDraft { return { photoKind: product.photoKind ?? "cutout", popularOverride: product.popularOverride ?? null }; }
/** Aucun prix, option, stock ou média ne peut être renvoyé par ce réglage. */
export function presentationPatch(product: Product, next: PresentationDraft): Partial<PresentationDraft> {
  const before = presentationOf(product);
  return { ...(next.photoKind !== before.photoKind ? { photoKind: next.photoKind } : {}), ...(next.popularOverride !== before.popularOverride ? { popularOverride: next.popularOverride } : {}) };
}
export function menuForPresentation(raw: RawMenu): MenuData {
  return { categories: (raw.categories ?? []).map(category => ({ _id: String(category._id), name: category.name ?? "", order: category.order ?? 0, active: category.active !== false,
    featuredProductIds: featuredProductIdsOf(category.featuredProductIds), featuredRevision: category.featuredRevision ?? 0,
    products: (category.products ?? []).map(product => normProduct(product, String(category._id))) })), uncategorized: (raw.uncategorized ?? []).map(product => normProduct(product, null)), medias: raw.medias ?? [] };
}

export type StoredPresentation = { base: PresentationDraft; draft: PresentationDraft; at: number };
const isPresentation = (value: unknown): value is PresentationDraft => !!value && typeof value === 'object'
  && ['cutout', 'cover'].includes((value as PresentationDraft).photoKind)
  && ((value as PresentationDraft).popularOverride === null || typeof (value as PresentationDraft).popularOverride === 'boolean');
export function readPresentationDrafts(raw: string | null, now = Date.now()): Record<string, StoredPresentation> {
  try { const value = JSON.parse(raw ?? '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, StoredPresentation] => {
      const draft = entry[1] as StoredPresentation | null;
      return !!draft && isPresentation(draft.base) && isPresentation(draft.draft) && Number.isFinite(draft.at) && draft.at <= now && now - draft.at < 8 * 60 * 60 * 1000;
    }));
  } catch { return {}; }
}
