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
});
export type IngredientCreate = z.infer<typeof IngredientCreateSchema>;

export const IngredientUpdateSchema = IngredientCreateSchema.partial();
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

export const BrandUpdateSchema = BrandCreateSchema.partial();
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

export const SupplierUpdateSchema = SupplierCreateSchema.partial().extend({
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
