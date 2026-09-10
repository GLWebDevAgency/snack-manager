/**
 * Vue « Menu & prix » (spec backoffice-restaurant §7) — types partagés.
 * Tous les montants circulent en CENTIMES (int).
 */

import type { MediaVue } from "@sm/contracts";

export type Variant = { key: string; name: string; price: number };

/**
 * Les groupes d'options, tels que la carte les sert.
 *
 * Le type les ignorait, et `normProduct` les jetait : le back-office ne les
 * voyait littéralement jamais, alors que `ProductCreateSchema` les accepte
 * pleinement depuis le premier jour. On reprend les types des contrats plutôt
 * que d'en redéclarer des approximations — deux définitions du même objet
 * finissent par diverger sur le champ qu'on utilise le moins.
 */
export type { OptionChoice, OptionGroup, PerVariantRule } from "@sm/contracts";

export type Product = {
  _id: string;
  /** null = « Non rattaché » (orphelin après suppression de catégorie). */
  categoryId: string | null;
  name: string;
  description: string;
  /** Centimes — ignoré côté client si `variants` non vide. */
  price: number;
  variants: Variant[];
  /**
   * ATTENTION : la carte RETIRE le groupe réservé « supplements » de cette
   * liste — il fait foi sur le prix côté serveur et s'expose ailleurs. Le
   * renvoyer tel quel en écriture l'effacerait ; le service le réinjecte, mais
   * n'ajoutez jamais un chemin qui compte dessus sans le savoir.
   */
  optionGroups: import("@sm/contracts").OptionGroup[];
  /**
   * Les photos du plat, DANS L'ORDRE — la première est la principale.
   *
   * Des identifiants et non des adresses : les médias voyagent à plat, à la
   * racine de `GET /menu` (`MenuData.medias`), parce que trois galettes qui
   * partagent le cliché du panneau mural ne doivent pas le faire transiter
   * trois fois. L'adresse, le point d'intérêt et le texte alternatif se
   * cherchent dans ce catalogue.
   *
   * Cette liste ne part JAMAIS dans le correctif du produit : elle a sa
   * propre route (`PUT /products/:id/medias`), qui attache et réordonne d'un
   * seul geste.
   */
  medias: string[];
  /**
   * `photoUrl` tel que l'API le rend — un champ DÉRIVÉ, jamais écrivable.
   *
   * Il ne sert plus qu'à une chose : les dix-neuf plats du pilote, dont la
   * photo est un fichier versionné dans le paquet web et non un média. On le
   * garde donc en lecture, et `photoUrlDe` le prend en repli quand aucune
   * référence ne résout.
   */
  photoUrl: string | null;
  photoKind?: "cutout" | "cover";
  popularOverride?: boolean | null;
  popular?: boolean;
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  /** 'manual' = coupé à la main · 'ingredient' = cascade rupture ingrédient. */
  outOfStockSource: "manual" | "ingredient" | null;
  order: number;
  active: boolean;
};

export type Category = {
  _id: string;
  name: string;
  order: number;
  active: boolean;
  products: Product[];
  featuredProductIds?: string[];
  featuredRevision?: number;
};

/**
 * La carte du back-office, plus le CATALOGUE DES MÉDIAS, à plat.
 *
 * Les photos sont à la racine et pas dans chaque produit : un même cliché sert
 * plusieurs plats, et l'écran qui veut son point d'intérêt ou son texte
 * alternatif le trouve au même endroit quelle que soit la surface.
 */
export type MenuData = {
  categories: Category[];
  uncategorized: Product[];
  medias: MediaVue[];
};

/** `GET /medias` — déclarée avec le reste de la médiathèque, jamais deux fois. */
export type { Mediatheque } from "@/components/mediatheque/photos";

/** Sentinelle de sélection pour la rangée spéciale « Non rattachés ». */
export const UNCAT = "__uncat__";

/** Prix effectif (centimes) : min des variantes, sinon prix de base. */
export const effectivePrice = (p: Product): number =>
  p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.price)) : p.price;

/** Prix « à définir » (bandeau §7.1) : prix effectif nul. */
export const isPriceToDefine = (p: Product): boolean => effectivePrice(p) === 0;

/** 890 → « 8,90 » pour l'input prix ; 0 → chaîne vide (état « à définir »). */
export const priceToInput = (cents: number): string =>
  cents > 0 ? (cents / 100).toFixed(2).replace(".", ",") : "";

/**
 * Saisie libre (« 8,90 », « 8.9 », « 8,90 € ») → centimes.
 * Chaîne vide → 0 (retour à « à définir ») ; illisible → null.
 */
export function inputToCents(raw: string): number | null {
  const clean = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
  if (!clean) return 0;
  const n = Number.parseFloat(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
