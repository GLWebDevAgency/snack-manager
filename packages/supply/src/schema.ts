/**
 * Contexte « Supply » — PostgreSQL (Drizzle).
 *
 * Domaine relationnel : ingrédients, allergènes (règlement UE INCO 1169/2011),
 * marques, recettes/nomenclatures, fournisseurs, prix d'achat, stocks, achats.
 * Les références vers le contexte « Commerce » (MongoDB) se font par id texte :
 * `tenantRef` = ObjectId du tenant, `productRef` = ObjectId du produit.
 */
import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ─────────────────────────────────────────────────────────────
// Énumérations
// ─────────────────────────────────────────────────────────────

/** Les 14 allergènes à déclaration obligatoire (UE 1169/2011 « INCO »). */
export const allergenEnum = pgEnum('allergen', [
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
]);
export const ALLERGENS = allergenEnum.enumValues;

/** Unité de base d'un ingrédient : le coût est exprimé par unité de base. */
export const baseUnitEnum = pgEnum('base_unit', ['kg', 'l', 'pcs']);
/** Unité de mesure d'une ligne de recette (convertie vers l'unité de base). */
export const measureUnitEnum = pgEnum('measure_unit', ['g', 'kg', 'ml', 'l', 'pcs']);

export const storageEnum = pgEnum('storage', ['sec', 'frais', 'congele']);

export const ingredientCategoryEnum = pgEnum('ingredient_category', [
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
]);

export const movementTypeEnum = pgEnum('movement_type', [
  'purchase', // réception d'achat (+)
  'sale', // déplétion théorique par les ventes (−)
  'waste', // perte / casse (−)
  'count', // ajustement d'inventaire (±)
]);

export const poStatusEnum = pgEnum('po_status', ['draft', 'sent', 'received', 'cancelled']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['a_payer', 'payee', 'litige']);

// ─────────────────────────────────────────────────────────────
// Ingrédients — registre canonique SM + registre par restaurant
// ─────────────────────────────────────────────────────────────

/**
 * `tenantRef = NULL` → ingrédient du registre canonique Snack Manager
 * (mutualisé entre restaurants : « Tomate », « Cheddar », « Viande kebab »…).
 * Un ingrédient de tenant peut pointer son origine canonique via
 * `canonicalId` (fork : le resto ajuste coût, stock, marque… localement,
 * l'analytique cross-restaurants reste possible via l'id canonique).
 */
export const ingredients = pgTable(
  'ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref'), // NULL = canonique SM
    canonicalId: uuid('canonical_id'),
    name: text('name').notNull(),
    category: ingredientCategoryEnum('category').notNull().default('autre'),
    unit: baseUnitEnum('unit').notNull().default('kg'),
    allergens: allergenEnum('allergens').array().notNull().default([]),
    /** Coût d'achat par unité de base (centimes / kg, / l ou / pièce). */
    costPerUnitCents: integer('cost_per_unit_cents').notNull().default(0),
    /** Stock courant en unité de base. */
    currentStock: numeric('current_stock', { precision: 12, scale: 3 }).notNull().default('0'),
    /** Seuil de réassort (alerte « à commander »). */
    parLevel: numeric('par_level', { precision: 12, scale: 3 }).notNull().default('0'),
    storage: storageEnum('storage').notNull().default('sec'),
    /**
     * L'ingrédient peut-il être RETIRÉ du produit ? La caisse et la commande
     * en ligne proposent « sans X » pour chaque ingrédient retirable présent
     * dans la recette — le gérant ne saisit aucun modificateur produit par
     * produit. Défaut posé par catégorie (crudités, fromages et sauces oui ;
     * pain, viande principale et emballage non).
     */
    removable: boolean('removable').notNull().default(false),
    /**
     * Prix de l'ingrédient AJOUTÉ en supplément, en centimes.
     * NULL = jamais proposé en supplément. Seule source du montant facturé :
     * le client n'envoie qu'une clé, jamais un prix.
     */
    supplementPriceCents: integer('supplement_price_cents'),
    /** Libellé court pour la caisse et le ticket (« Oignons » vs « Oignon rouge »). */
    displayName: text('display_name'),
    /** Rupture ingrédient — propagée aux produits dont la recette l'exige. */
    isOut: boolean('is_out').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingredients_tenant_idx').on(t.tenantRef),
    index('ingredients_canonical_idx').on(t.canonicalId),
    uniqueIndex('ingredients_tenant_name_uq').on(t.tenantRef, t.name),
  ],
);

/** Marques possibles d'un ingrédient (ex. cheddar : « Entremont », « Président »). */
export const ingredientBrands = pgTable(
  'ingredient_brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    preferred: boolean('preferred').notNull().default(false),
    notes: text('notes'),
  },
  (t) => [index('brands_ingredient_idx').on(t.ingredientId)],
);

// ─────────────────────────────────────────────────────────────
// Recettes / nomenclatures (BOM)
// ─────────────────────────────────────────────────────────────

/**
 * Une recette par produit — et par variante quand elles diffèrent
 * (`variantKey` : tacos M vs XL, smash simple vs triple ; NULL = recette de base).
 */
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    productRef: text('product_ref').notNull(),
    variantKey: text('variant_key'), // NULL = base / toutes variantes
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recipes_scope_uq').on(t.tenantRef, t.productRef, t.variantKey),
    index('recipes_product_idx').on(t.productRef),
  ],
);

export const recipeLines = pgTable(
  'recipe_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unit: measureUnitEnum('unit').notNull(),
  },
  (t) => [index('recipe_lines_recipe_idx').on(t.recipeId), index('recipe_lines_ingredient_idx').on(t.ingredientId)],
);

/**
 * Nomenclature des OPTIONS : ce que consomme chaque choix d'option d'un
 * produit (ex. tacos, groupe « viandes », choix « kebab » → 120 g de viande
 * kebab). Permet coût matière exact, allergènes exacts et déplétion de stock
 * par commande réelle.
 */
export const optionIngredients = pgTable(
  'option_ingredients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    productRef: text('product_ref').notNull(),
    groupKey: text('group_key').notNull(),
    choiceKey: text('choice_key').notNull(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unit: measureUnitEnum('unit').notNull(),
  },
  (t) => [
    index('option_ing_product_idx').on(t.tenantRef, t.productRef),
    uniqueIndex('option_ing_scope_uq').on(t.tenantRef, t.productRef, t.groupKey, t.choiceKey, t.ingredientId),
  ],
);

// ─────────────────────────────────────────────────────────────
// Fournisseurs, catalogue & historique de prix
// ─────────────────────────────────────────────────────────────

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    phone: text('phone'),
    email: text('email'),
    /** Conditions de règlement (ex. « 30 j fin de mois »). */
    paymentTerms: text('payment_terms'),
    deliveryDays: text('delivery_days'), // ex. « mar, ven »
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('suppliers_tenant_idx').on(t.tenantRef)],
);

/** Référence catalogue : un ingrédient (éventuellement une marque) chez un fournisseur. */
export const supplierItems = pgTable(
  'supplier_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    brandId: uuid('brand_id').references(() => ingredientBrands.id, { onDelete: 'set null' }),
    sku: text('sku'),
    /** Conditionnement : quantité par colis en unité de base (ex. 10 kg). */
    packQty: numeric('pack_qty', { precision: 12, scale: 3 }).notNull(),
    /** Prix du colis en centimes HT. */
    packPriceCents: integer('pack_price_cents').notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('supplier_items_supplier_idx').on(t.supplierId),
    index('supplier_items_ingredient_idx').on(t.ingredientId),
  ],
);

/** Historique de prix — alimenté à chaque changement de `packPriceCents`. */
export const supplierPriceHistory = pgTable(
  'supplier_price_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierItemId: uuid('supplier_item_id')
      .notNull()
      .references(() => supplierItems.id, { onDelete: 'cascade' }),
    packPriceCents: integer('pack_price_cents').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_history_item_idx').on(t.supplierItemId, t.recordedAt)],
);

// ─────────────────────────────────────────────────────────────
// Stocks & achats
// ─────────────────────────────────────────────────────────────

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    type: movementTypeEnum('type').notNull(),
    /** Quantité signée en unité de base (+ entrée / − sortie). */
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    /** Référence libre : id commande Mongo, n° de BL, motif de perte… */
    ref: text('ref'),
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('movements_tenant_ing_idx').on(t.tenantRef, t.ingredientId, t.at)],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    status: poStatusEnum('status').notNull().default('draft'),
    expectedAt: timestamp('expected_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('po_tenant_idx').on(t.tenantRef, t.status)],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    supplierItemId: uuid('supplier_item_id')
      .notNull()
      .references(() => supplierItems.id, { onDelete: 'restrict' }),
    qtyPacks: numeric('qty_packs', { precision: 12, scale: 3 }).notNull(),
    packPriceCents: integer('pack_price_cents').notNull(),
  },
  (t) => [index('po_lines_po_idx').on(t.purchaseOrderId)],
);

/** Factures fournisseurs — fondation (OCR/rapprochement : phase ultérieure). */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }),
    number: text('number').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    totalHtCents: integer('total_ht_cents').notNull().default(0),
    tvaCents: integer('tva_cents').notNull().default(0),
    totalTtcCents: integer('total_ttc_cents').notNull().default(0),
    status: invoiceStatusEnum('status').notNull().default('a_payer'),
    fileUrl: text('file_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('invoices_tenant_idx').on(t.tenantRef, t.status),
    uniqueIndex('invoices_supplier_number_uq').on(t.supplierId, t.number),
  ],
);

// ─────────────────────────────────────────────────────────────
// Relations (requêtes drizzle-orm `with`)
// ─────────────────────────────────────────────────────────────

export const ingredientsRelations = relations(ingredients, ({ many }) => ({
  brands: many(ingredientBrands),
  recipeLines: many(recipeLines),
  supplierItems: many(supplierItems),
}));

export const ingredientBrandsRelations = relations(ingredientBrands, ({ one }) => ({
  ingredient: one(ingredients, {
    fields: [ingredientBrands.ingredientId],
    references: [ingredients.id],
  }),
}));

export const recipesRelations = relations(recipes, ({ many }) => ({
  lines: many(recipeLines),
}));

export const recipeLinesRelations = relations(recipeLines, ({ one }) => ({
  recipe: one(recipes, { fields: [recipeLines.recipeId], references: [recipes.id] }),
  ingredient: one(ingredients, {
    fields: [recipeLines.ingredientId],
    references: [ingredients.id],
  }),
}));

export const optionIngredientsRelations = relations(optionIngredients, ({ one }) => ({
  ingredient: one(ingredients, {
    fields: [optionIngredients.ingredientId],
    references: [ingredients.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  items: many(supplierItems),
  purchaseOrders: many(purchaseOrders),
  invoices: many(invoices),
}));

export const supplierItemsRelations = relations(supplierItems, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [supplierItems.supplierId], references: [suppliers.id] }),
  ingredient: one(ingredients, {
    fields: [supplierItems.ingredientId],
    references: [ingredients.id],
  }),
  brand: one(ingredientBrands, {
    fields: [supplierItems.brandId],
    references: [ingredientBrands.id],
  }),
  priceHistory: many(supplierPriceHistory),
}));

export const supplierPriceHistoryRelations = relations(supplierPriceHistory, ({ one }) => ({
  item: one(supplierItems, {
    fields: [supplierPriceHistory.supplierItemId],
    references: [supplierItems.id],
  }),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  supplier: one(suppliers, { fields: [purchaseOrders.supplierId], references: [suppliers.id] }),
  lines: many(purchaseOrderLines),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLines.purchaseOrderId],
    references: [purchaseOrders.id],
  }),
  supplierItem: one(supplierItems, {
    fields: [purchaseOrderLines.supplierItemId],
    references: [supplierItems.id],
  }),
}));

// ─────────────────────────────────────────────────────────────
// Helpers de conversion d'unités (g→kg, ml→l)
// ─────────────────────────────────────────────────────────────

/** Convertit une quantité de ligne (g/kg/ml/l/pcs) vers l'unité de base de l'ingrédient. */
export function toBaseUnit(qty: number, unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs'): number {
  switch (unit) {
    case 'g':
      return qty / 1000; // → kg
    case 'ml':
      return qty / 1000; // → l
    default:
      return qty;
  }
}

/** Coût en centimes d'une quantité d'ingrédient (qty exprimée en unité de ligne). */
export function lineCostCents(
  qty: number,
  unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs',
  costPerUnitCents: number,
): number {
  return Math.round(toBaseUnit(qty, unit) * costPerUnitCents);
}
