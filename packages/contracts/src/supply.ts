import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Contexte SUPPLY — DTO zod + types de réponse.
// Prix et coûts TOUJOURS en centimes (int). Les quantités de stock
// sont des nombres décimaux (unité de base : kg, l ou pièce).
//
// ⚠️ Les listes ci-dessous sont le MIROIR des pgEnum de
// packages/supply/src/schema.ts (contracts ne peut pas dépendre de
// @sm/supply : drizzle/pg n'ont rien à faire dans le bundle web).
// Toute évolution doit être répercutée des deux côtés.
// ─────────────────────────────────────────────────────────────

/** Les 14 allergènes à déclaration obligatoire (UE 1169/2011 « INCO »). */
export const ALLERGENS = [
  'gluten',
  'crustaces',
  'oeufs',
  'poissons',
  'arachides',
  'soja',
  'lait',
  'fruits_a_coque',
  'celeri',
  'moutarde',
  'sesame',
  'sulfites',
  'lupin',
  'mollusques',
] as const;
export const AllergenSchema = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof AllergenSchema>;

/** Libellés français d'affichage des allergènes. */
export const ALLERGEN_LABELS: Record<Allergen, string> = {
  gluten: 'Gluten',
  crustaces: 'Crustacés',
  oeufs: 'Œufs',
  poissons: 'Poissons',
  arachides: 'Arachides',
  soja: 'Soja',
  lait: 'Lait',
  fruits_a_coque: 'Fruits à coque',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
};

/** Unité de base d'un ingrédient : le coût est exprimé par unité de base. */
export const BASE_UNITS = ['kg', 'l', 'pcs'] as const;
export const BaseUnitSchema = z.enum(BASE_UNITS);
export type BaseUnit = z.infer<typeof BaseUnitSchema>;

/** Unité d'une ligne de recette (convertie vers l'unité de base : g→kg, ml→l). */
export const MEASURE_UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
export const MeasureUnitSchema = z.enum(MEASURE_UNITS);
export type MeasureUnit = z.infer<typeof MeasureUnitSchema>;

export const STORAGE_MODES = ['sec', 'frais', 'congele'] as const;
export const StorageModeSchema = z.enum(STORAGE_MODES);
export type StorageMode = z.infer<typeof StorageModeSchema>;

export const INGREDIENT_CATEGORIES = [
  'viande',
  'volaille',
  'poisson',
  'fromage',
  'legume',
  'feculent',
  'pain',
  'sauce',
  'epicerie',
  'dessert',
  'boisson',
  'emballage',
  'autre',
] as const;
export const IngredientCategorySchema = z.enum(INGREDIENT_CATEGORIES);
export type IngredientCategory = z.infer<typeof IngredientCategorySchema>;

// ─────────────────────────────────────────────────────────────
// Modificateurs pilotés par la recette
//
// La caisse et la commande en ligne ne proposent QUE ce que la recette
// contient : « sans tomate » n'apparaît que sur un produit dont la recette
// porte de la tomate. Le gérant ne ressaisit aucun modificateur produit par
// produit — c'est la nomenclature (contexte supply) qui pilote la carte.
// ─────────────────────────────────────────────────────────────

/**
 * Catégories retirables par défaut : ce qu'un client demande couramment de
 * retirer. Pain, viande principale, féculents et emballage n'en sont pas —
 * les retirer changerait le produit, pas sa garniture.
 */
export const REMOVABLE_DEFAULT_CATEGORIES = ['legume', 'fromage', 'sauce'] as const;

/** Défaut appliqué à la création d'un ingrédient quand `removable` n'est pas transmis. */
export function isRemovableByDefault(category: IngredientCategory): boolean {
  return (REMOVABLE_DEFAULT_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Clé de groupe RÉSERVÉE aux suppléments payants.
 *
 * Elle n'est jamais saisie par le gérant : le groupe est projeté depuis la
 * recette et le catalogue d'ingrédients, et c'est lui qui fait autorité sur le
 * prix à la création de commande.
 */
export const SUPPLEMENT_GROUP_KEY = 'supplements';
export const SUPPLEMENT_GROUP_NAME = 'Suppléments';

/**
 * Ordre d'affichage des suppléments au comptoir : d'abord ce qui se vend le
 * plus vite (fromages, œuf, miel), puis charcuterie et viandes, enfin les
 * légumes. À catégorie égale, du moins cher au plus cher.
 */
export const SUPPLEMENT_CATEGORY_ORDER = [
  'fromage',
  'epicerie',
  'volaille',
  'viande',
  'poisson',
  'legume',
  'sauce',
  'feculent',
  'pain',
  'dessert',
  'boisson',
  'autre',
  'emballage',
] as const;

/** Retrait proposé : « sans salade », « sans oignons ». Ne change pas le prix. */
export interface MenuRemovable {
  /** Clé stable envoyée dans `removed` à la création de commande. */
  key: string;
  /** Libellé affiché (`displayName` de l'ingrédient, sinon son nom). */
  label: string;
}

/** Supplément payant proposé : le prix vient de PostgreSQL, jamais du client. */
export interface MenuSupplement {
  /** Clé stable envoyée comme `choiceKey` du groupe « supplements ». */
  key: string;
  label: string;
  /** Prix du supplément en centimes, ajouté au prix unitaire de la ligne. */
  priceCents: number;
  category: IngredientCategory;
}

/** Les deux blocs dérivés de la recette, joints à chaque produit du menu. */
export interface ProductModifiers {
  removables: MenuRemovable[];
  supplements: MenuSupplement[];
}

/** Tous les types de mouvement existants (`sale` est généré par le système). */
export const STOCK_MOVEMENT_TYPES = ['purchase', 'sale', 'waste', 'count'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Types de mouvement créables via l'API. */
export const MOVEMENT_INPUT_TYPES = ['purchase', 'waste', 'count'] as const;
export const MovementInputTypeSchema = z.enum(MOVEMENT_INPUT_TYPES);
export type MovementInputType = z.infer<typeof MovementInputTypeSchema>;

// ─────────────────────────────────────────────────────────────
// Ingrédients
// ─────────────────────────────────────────────────────────────

export const IngredientCreateSchema = z.object({
  name: z.string().min(1).max(120),
  category: IngredientCategorySchema.default('autre'),
  unit: BaseUnitSchema.default('kg'),
  allergens: z.array(AllergenSchema).default([]),
  /** Coût d'achat par unité de base — centimes / kg, / l ou / pièce. */
  costPerUnitCents: z.number().int().nonnegative().default(0),
  /** Stock courant en unité de base (ensuite piloté par /supply/movements). */
  currentStock: z.number().nonnegative().default(0),
  /** Seuil de réassort — alerte « à commander » quand stock < seuil. */
  parLevel: z.number().nonnegative().default(0),
  storage: StorageModeSchema.default('sec'),
  /** Absent = défaut par catégorie (`isRemovableByDefault`). */
  removable: z.boolean().optional(),
  /** Renseigné = l'ingrédient est proposé en supplément payant. `null` = non proposé. */
  supplementPriceCents: z.number().int().nonnegative().nullable().optional(),
  /** Libellé court pour la caisse et le ticket (« Oignons »). */
  displayName: z.string().min(1).max(60).nullable().optional(),
});
export type IngredientCreate = z.infer<typeof IngredientCreateSchema>;

/**
 * Mise à jour PARTIELLE — surtout pas `IngredientCreateSchema.partial()`.
 *
 * `.partial()` rend les champs facultatifs mais CONSERVE leurs `.default()`
 * (cf. la même régression corrigée sur les produits) : un PATCH
 * `{ supplementPriceCents: 100 }` ressortait de la validation avec
 * `currentStock: 0, costPerUnitCents: 0, allergens: []` et écrasait le stock
 * réel, le coût matière et les allergènes de l'ingrédient.
 *
 * Ici aucun champ ne porte de valeur par défaut : ce qui n'est pas transmis
 * n'est pas modifié.
 */
export const IngredientUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  category: IngredientCategorySchema.optional(),
  unit: BaseUnitSchema.optional(),
  allergens: z.array(AllergenSchema).optional(),
  costPerUnitCents: z.number().int().nonnegative().optional(),
  currentStock: z.number().nonnegative().optional(),
  parLevel: z.number().nonnegative().optional(),
  storage: StorageModeSchema.optional(),
  removable: z.boolean().optional(),
  supplementPriceCents: z.number().int().nonnegative().nullable().optional(),
  displayName: z.string().min(1).max(60).nullable().optional(),
});
export type IngredientUpdate = z.infer<typeof IngredientUpdateSchema>;

/** Rupture ingrédient — déclenche la cascade vers les produits Mongo. */
export const IngredientOutSchema = z.object({ isOut: z.boolean() });
export type IngredientOut = z.infer<typeof IngredientOutSchema>;

export const BrandCreateSchema = z.object({
  name: z.string().min(1).max(120),
  preferred: z.boolean().default(false),
  notes: z.string().max(300).optional(),
});
export type BrandCreate = z.infer<typeof BrandCreateSchema>;

/**
 * Mise à jour PARTIELLE — surtout pas `BrandCreateSchema.partial()`.
 *
 * `.partial()` rend les champs facultatifs mais CONSERVE leurs `.default()`.
 * `preferred` porte `.default(false)` : une requête qui ne l'envoie pas se
 * verrait donc réécrire à `false` par la validation elle-même. Corriger le nom
 * d'une marque aurait silencieusement retiré son statut de marque préférée, et
 * le gérant l'aurait découvert à la commande suivante, au mauvais prix.
 *
 * C'est le défaut EXACT qui avait effacé les prix et les groupes d'options de
 * trois produits (cf. `ProductUpdateSchema`). On écrit donc les champs à la
 * main, sans aucune valeur par défaut.
 */
export const BrandUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  preferred: z.boolean().optional(),
  notes: z.string().max(300).optional(),
});
export type BrandUpdate = z.infer<typeof BrandUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// Fournisseurs & catalogue
// ─────────────────────────────────────────────────────────────

export const SupplierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  email: z.email().optional(),
  /** Conditions de règlement (ex. « 30 j fin de mois »). */
  paymentTerms: z.string().max(200).optional(),
  /** Jours de livraison (ex. « mar, ven »). */
  deliveryDays: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});
export type SupplierCreate = z.infer<typeof SupplierCreateSchema>;

/**
 * Écrit à la main pour la même raison que `BrandUpdateSchema`.
 *
 * `SupplierCreateSchema` ne porte aujourd'hui aucun `.default()`, donc
 * `.partial()` serait inoffensif — MAIS il s'armerait tout seul le jour où
 * quelqu'un ajoute une valeur par défaut à la création, sans que rien ne le
 * signale. Le défaut ne se verrait qu'en production, sur un champ écrasé.
 */
export const SupplierUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  /**
   * La chaîne VIDE est admise : c'est ainsi qu'on efface une adresse.
   *
   * `z.email()` seul la refusait, et l'écran contournait le refus en
   * n'envoyant simplement pas le champ — l'ancienne adresse survivait donc à
   * son effacement, et revenait à l'écran au rechargement. Un contact qui a
   * changé restait joignable à la mauvaise adresse.
   */
  email: z.union([z.email(), z.literal('')]).optional(),
  paymentTerms: z.string().max(200).optional(),
  deliveryDays: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  active: z.boolean().optional(),
});
export type SupplierUpdate = z.infer<typeof SupplierUpdateSchema>;

export const SupplierItemCreateSchema = z.object({
  ingredientId: z.uuid(),
  brandId: z.uuid().optional(),
  sku: z.string().max(80).optional(),
  /** Conditionnement : quantité par colis en unité de base (ex. 10 kg). */
  packQty: z.number().positive(),
  /** Prix du colis en centimes HT. */
  packPriceCents: z.number().int().nonnegative(),
});
export type SupplierItemCreate = z.infer<typeof SupplierItemCreateSchema>;

export const SupplierItemUpdateSchema = z.object({
  brandId: z.uuid().nullable().optional(),
  sku: z.string().max(80).nullable().optional(),
  packQty: z.number().positive().optional(),
  /** Tout changement insère d'abord l'ancien prix dans l'historique. */
  packPriceCents: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});
export type SupplierItemUpdate = z.infer<typeof SupplierItemUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// Recettes / nomenclatures (BOM)
// ─────────────────────────────────────────────────────────────

export const RecipeLineInputSchema = z.object({
  ingredientId: z.uuid(),
  qty: z.number().positive(),
  unit: MeasureUnitSchema,
});
export type RecipeLineInput = z.infer<typeof RecipeLineInputSchema>;

/** Remplace la recette de la portée (variantKey null = recette de base).
 *  `lines: []` supprime la recette de cette portée. */
export const BomPutSchema = z.object({
  variantKey: z.string().min(1).nullable().default(null),
  lines: z.array(RecipeLineInputSchema).default([]),
});
export type BomPut = z.infer<typeof BomPutSchema>;

/** Remplace la nomenclature d'un choix d'option (groupe « viandes » → « kebab »). */
export const OptionBomPutSchema = z.object({
  groupKey: z.string().min(1),
  choiceKey: z.string().min(1),
  lines: z.array(RecipeLineInputSchema).default([]),
});
export type OptionBomPut = z.infer<typeof OptionBomPutSchema>;

// ─────────────────────────────────────────────────────────────
// Mouvements de stock
// ─────────────────────────────────────────────────────────────

export const MovementCreateSchema = z
  .object({
    ingredientId: z.uuid(),
    type: MovementInputTypeSchema,
    /** purchase : +qty · waste : −qty · count : qty = nouvelle valeur absolue. */
    qty: z.number().nonnegative(),
    note: z.string().max(300).optional(),
  })
  .refine((m) => m.type === 'count' || m.qty > 0, {
    message: 'Quantité strictement positive requise',
    path: ['qty'],
  });
export type MovementCreate = z.infer<typeof MovementCreateSchema>;

// ─────────────────────────────────────────────────────────────
// Types de réponse (côté web — les Date sérialisent en ISO string)
// ─────────────────────────────────────────────────────────────

export interface SupplyBrand {
  id: string;
  ingredientId: string;
  name: string;
  preferred: boolean;
  notes: string | null;
}

export interface SupplyIngredient {
  id: string;
  name: string;
  category: IngredientCategory;
  unit: BaseUnit;
  allergens: Allergen[];
  costPerUnitCents: number;
  currentStock: number;
  parLevel: number;
  storage: StorageMode;
  isOut: boolean;
  active: boolean;
  /** L'ingrédient peut être retiré du produit (« sans salade »). */
  removable: boolean;
  /** Prix du supplément en centimes — `null` = non proposé en supplément. */
  supplementPriceCents: number | null;
  /** Libellé court pour la caisse et le ticket — `null` = utiliser `name`. */
  displayName: string | null;
  /** Indicateur calculé : currentStock < parLevel. */
  belowPar: boolean;
  brands: SupplyBrand[];
}

export interface SupplySupplierItem {
  id: string;
  supplierId: string;
  ingredientId: string;
  brandId: string | null;
  sku: string | null;
  packQty: number;
  packPriceCents: number;
  active: boolean;
  ingredient?: { id: string; name: string; unit: BaseUnit } | null;
  brand?: { id: string; name: string } | null;
}

export interface SupplySupplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  paymentTerms: string | null;
  deliveryDays: string | null;
  notes: string | null;
  active: boolean;
  items: SupplySupplierItem[];
}

export interface BomLine {
  ingredientId: string;
  name: string;
  qty: number;
  unit: MeasureUnit;
  costCents: number;
  allergens: Allergen[];
  isOut: boolean;
}

export interface BomRecipe {
  variantKey: string | null;
  lines: BomLine[];
  costCents: number;
}

export interface BomOptionLine extends BomLine {
  groupKey: string;
  choiceKey: string;
}

export interface MarginEntry {
  priceCents: number;
  costCents: number;
  marginCents: number;
  /** Marge en % du prix de vente, arrondie à 1 décimale. */
  marginPct: number;
}

export interface BomResponse {
  recipes: BomRecipe[];
  options: BomOptionLine[];
  /** Coût matière total par portée de recette — clé `<variantKey>` ou `base`. */
  costByVariant: Record<string, number>;
  /** Rollup : allergènes recette ∪ options. */
  allergens: Allergen[];
  marginByVariant: Record<string, MarginEntry>;
}

export interface CostEntry {
  /** Coût matière de la variante la moins chère (ou de la recette de base). */
  costCents: number;
  marginPct: number | null;
}
export type CostsResponse = Record<string, CostEntry>;

export interface PriceIncreaseAlert {
  itemId: string;
  supplierId: string;
  supplierName: string;
  ingredientId: string;
  ingredientName: string;
  sku: string | null;
  previousPriceCents: number;
  packPriceCents: number;
  /** Hausse en % vs prix précédent, arrondie à 1 décimale. */
  increasePct: number;
  recordedAt: string;
}

export interface SupplyAlerts {
  ruptures: SupplyIngredient[];
  belowPar: SupplyIngredient[];
  priceIncreases: PriceIncreaseAlert[];
}

export interface StockMovementRow {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unit: BaseUnit;
  type: StockMovementType;
  /** Quantité signée en unité de base (+ entrée / − sortie). */
  qty: number;
  ref: string | null;
  note: string | null;
  at: string;
}
