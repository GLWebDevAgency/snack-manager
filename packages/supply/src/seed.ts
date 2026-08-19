/**
 * Seed du contexte « Supply » — PostgreSQL (Drizzle), contre la base Railway.
 *
 * Contenu :
 *   1. Registre CANONIQUE d'ingrédients (tenantRef = NULL) — allergènes INCO exacts,
 *      coûts marché 2026 en centimes, unités de base kg / l / pcs.
 *   2. Fork tenant Class'Food (tenantRef = ObjectId Mongo) avec stocks initiaux
 *      réalistes (quelques-uns sous le par pour alimenter les alertes, un à zéro).
 *   3. Recettes (BOM) des 109 produits Mongo du tenant — par variante quand
 *      la nomenclature diffère (tacos M/L/XL/XXL, Smash simple/double/triple…).
 *   4. Nomenclature des OPTIONS (option_ingredients) : viandes, suppléments,
 *      sauces, pain/galette, garnitures, bases.
 *   5. Fournisseurs + catalogue (supplier_items) + marques + historique de prix.
 *
 * Idempotent : vide toutes les tables supply (ordre des FK) avant de ré-insérer.
 *
 *   pnpm --filter @sm/supply seed
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createSupplyDb } from './client';
import {
  ALLERGENS,
  ingredients,
  ingredientBrands,
  recipes,
  recipeLines,
  optionIngredients,
  suppliers,
  supplierItems,
  supplierPriceHistory,
  stockMovements,
  purchaseOrders,
  purchaseOrderLines,
  invoices,
} from './schema';

config({ path: resolve(__dirname, '../../../.env') });

// mongoose n'est pas une dépendance de @sm/supply : on le résout depuis
// packages/db (qui le possède) — lecture seule des produits du tenant.
const dbRequire = createRequire(resolve(__dirname, '../../db/package.json'));
const mongoose: any = dbRequire('mongoose');

type Allergen = (typeof ALLERGENS)[number];
type BaseUnit = 'kg' | 'l' | 'pcs';
type MUnit = 'g' | 'kg' | 'ml' | 'l' | 'pcs';
type Storage = 'sec' | 'frais' | 'congele';
type IngCategory =
  | 'viande'
  | 'volaille'
  | 'poisson'
  | 'fromage'
  | 'legume'
  | 'feculent'
  | 'pain'
  | 'sauce'
  | 'epicerie'
  | 'dessert'
  | 'boisson'
  | 'emballage'
  | 'autre';

type IngredientDef = {
  key: string;
  name: string;
  category: IngCategory;
  unit: BaseUnit;
  allergens: Allergen[];
  /** centimes par unité de base */
  cost: number;
  storage: Storage;
  /** seuil de réassort en unité de base */
  par: number;
};

/** Ligne de nomenclature : [clé ingrédient, quantité, unité de mesure]. */
type Line = [string, number, MUnit];

// ─────────────────────────────────────────────────────────────
// 1. Registre canonique (~105 ingrédients, allergènes INCO 1169/2011)
// ─────────────────────────────────────────────────────────────

const I = (
  key: string,
  name: string,
  category: IngCategory,
  unit: BaseUnit,
  allergens: Allergen[],
  cost: number,
  storage: Storage,
  par: number,
): IngredientDef => ({ key, name, category, unit, allergens, cost, storage, par });

const INGREDIENT_DEFS: IngredientDef[] = [
  // ── Viandes / volailles / poissons ──
  I('viande-kebab', 'Viande kebab (broche)', 'viande', 'kg', ['lait'], 750, 'congele', 20),
  I('steak-hache', 'Steak haché pur bœuf', 'viande', 'kg', [], 890, 'congele', 12),
  I('kefta', 'Kefta (viande hachée épicée)', 'viande', 'kg', [], 780, 'congele', 6),
  I('merguez', 'Merguez', 'viande', 'kg', ['sulfites'], 720, 'frais', 8),
  I('escalope-poulet', 'Escalope de poulet', 'volaille', 'kg', [], 750, 'frais', 8),
  I('poulet-pane', 'Poulet pané (escalope panée)', 'volaille', 'kg', ['gluten'], 680, 'congele', 10),
  I('poulet-tikka', 'Poulet mariné tikka', 'volaille', 'kg', ['lait'], 820, 'frais', 5),
  I('poulet-tandoori', 'Poulet mariné tandoori', 'volaille', 'kg', ['lait'], 820, 'frais', 5),
  I('tenders', 'Tenders de poulet', 'volaille', 'kg', ['gluten'], 730, 'congele', 10),
  I('nuggets', 'Nuggets de poulet', 'volaille', 'kg', ['gluten'], 550, 'congele', 8),
  I('wings', 'Wings de poulet', 'volaille', 'kg', [], 490, 'congele', 10),
  I('cordon-bleu', 'Cordon bleu', 'volaille', 'kg', ['gluten', 'lait'], 620, 'congele', 5),
  I('bacon-dinde', 'Bacon de dinde', 'volaille', 'kg', [], 920, 'frais', 3),
  I('lardons-dinde', 'Lardons de dinde', 'volaille', 'kg', [], 830, 'frais', 3),
  I('chorizo', 'Chorizo de volaille', 'volaille', 'kg', ['lait'], 890, 'frais', 3),
  I('jambon-dinde', 'Jambon de dinde', 'volaille', 'kg', [], 700, 'frais', 3),
  I('saucisse-hotdog', 'Saucisse hot dog (volaille)', 'volaille', 'kg', [], 590, 'frais', 4),
  I('poisson-pane', 'Poisson pané', 'poisson', 'kg', ['poissons', 'gluten'], 700, 'congele', 4),
  I('thon', 'Thon (miettes, boîte)', 'poisson', 'kg', ['poissons'], 950, 'sec', 3),
  I('calamar', 'Beignets de calamar', 'poisson', 'kg', ['mollusques', 'gluten'], 860, 'congele', 4),
  // ── Fromages ──
  I('cheddar', 'Cheddar (tranches)', 'fromage', 'kg', ['lait'], 650, 'frais', 8),
  I('chevre', 'Chèvre (bûche)', 'fromage', 'kg', ['lait'], 1080, 'frais', 3),
  I('raclette', 'Raclette (tranches)', 'fromage', 'kg', ['lait'], 950, 'frais', 3),
  I('camembert', 'Camembert', 'fromage', 'kg', ['lait'], 780, 'frais', 3),
  I('bleu', 'Bleu', 'fromage', 'kg', ['lait'], 1020, 'frais', 2),
  I('boursin', 'Boursin ail & fines herbes', 'fromage', 'kg', ['lait'], 1130, 'frais', 2),
  I('mozzarella', 'Mozzarella râpée', 'fromage', 'kg', ['lait'], 720, 'frais', 6),
  I('emmental', 'Emmental râpé', 'fromage', 'kg', ['lait'], 690, 'frais', 6),
  I('reblochon', 'Reblochon', 'fromage', 'kg', ['lait'], 1180, 'frais', 1.5),
  I('burrata', 'Burrata (boules 125 g)', 'fromage', 'kg', ['lait'], 1350, 'frais', 2),
  I('mozza-sticks', 'Mozza sticks panés', 'fromage', 'kg', ['lait', 'gluten'], 820, 'congele', 5),
  // ── Légumes / crudités ──
  I('tomate', 'Tomate', 'legume', 'kg', [], 320, 'frais', 8),
  I('salade', 'Salade iceberg', 'legume', 'kg', [], 290, 'frais', 6),
  I('oignon-rouge', 'Oignon rouge', 'legume', 'kg', [], 230, 'frais', 5),
  I('cornichons', 'Cornichons', 'legume', 'kg', [], 480, 'sec', 2),
  I('poivrons', 'Poivrons', 'legume', 'kg', [], 380, 'frais', 4),
  I('champignons', 'Champignons', 'legume', 'kg', [], 450, 'frais', 4),
  I('avocat', 'Avocat', 'legume', 'kg', [], 680, 'frais', 3),
  I('aubergine', 'Aubergine', 'legume', 'kg', [], 350, 'frais', 3),
  I('oignons-frits', 'Oignons frits', 'legume', 'kg', ['gluten'], 640, 'sec', 2),
  I('olives', 'Olives noires', 'legume', 'kg', [], 520, 'sec', 2),
  I('onion-rings', 'Onion rings panés', 'legume', 'kg', ['gluten'], 460, 'congele', 5),
  I('jalapenos', 'Jalapeños panés (cheese poppers)', 'legume', 'kg', ['lait', 'gluten'], 760, 'congele', 4),
  // ── Féculents ──
  I('frites', 'Frites surgelées', 'feculent', 'kg', [], 180, 'congele', 30),
  I('riz', 'Riz long grain', 'feculent', 'kg', [], 220, 'sec', 8),
  I('pates', 'Pâtes (penne)', 'feculent', 'kg', ['gluten'], 180, 'sec', 6),
  I('nouilles', 'Nouilles asiatiques', 'feculent', 'kg', ['gluten', 'oeufs'], 320, 'sec', 4),
  I('galette-pdt', 'Galette de pomme de terre', 'feculent', 'pcs', ['gluten'], 45, 'congele', 40),
  // ── Pains ──
  I('pain-sandwich', 'Pain sandwich', 'pain', 'pcs', ['gluten'], 35, 'sec', 60),
  I('pain-burger', 'Pain burger brioché', 'pain', 'pcs', ['gluten', 'sesame', 'lait', 'oeufs'], 40, 'congele', 40),
  I('galette-tortilla', 'Galette tortilla', 'pain', 'pcs', ['gluten'], 30, 'sec', 80),
  I('pain-panini', 'Pain panini', 'pain', 'pcs', ['gluten'], 35, 'congele', 30),
  I('pain-suedois', 'Pain suédois', 'pain', 'pcs', ['gluten', 'lait'], 32, 'congele', 25),
  I('pain-hotdog', 'Pain hot dog', 'pain', 'pcs', ['gluten', 'lait'], 30, 'congele', 25),
  I('pain-buns', "Pain bun's", 'pain', 'pcs', ['gluten', 'sesame'], 38, 'congele', 25),
  // ── Sauces (les 11 de la carte + techniques) ──
  I('sauce-ketchup', 'Sauce ketchup', 'sauce', 'l', [], 280, 'sec', 5),
  I('sauce-mayonnaise', 'Sauce mayonnaise', 'sauce', 'l', ['oeufs', 'moutarde'], 350, 'frais', 5),
  I('sauce-samourai', 'Sauce samouraï', 'sauce', 'l', ['oeufs', 'moutarde'], 390, 'frais', 3),
  I('sauce-andalouse', 'Sauce andalouse', 'sauce', 'l', ['oeufs', 'moutarde'], 390, 'frais', 3),
  I('sauce-poivre', 'Sauce poivre', 'sauce', 'l', ['lait'], 420, 'frais', 2),
  I('sauce-biggy', 'Sauce biggy', 'sauce', 'l', ['oeufs', 'moutarde'], 390, 'frais', 3),
  I('sauce-blanche', 'Sauce blanche maison', 'sauce', 'l', ['lait', 'oeufs'], 310, 'frais', 6),
  I('sauce-harissa', 'Sauce harissa', 'sauce', 'l', [], 450, 'sec', 2),
  I('sauce-cheesy', 'Sauce cheesy', 'sauce', 'l', ['lait'], 430, 'frais', 2),
  I('moutarde', 'Moutarde', 'sauce', 'l', ['moutarde'], 320, 'sec', 2),
  I('sauce-algerienne', 'Sauce algérienne', 'sauce', 'l', ['oeufs', 'moutarde'], 390, 'frais', 3),
  I('sauce-fromagere', 'Sauce fromagère (poche)', 'sauce', 'l', ['lait'], 460, 'frais', 8),
  I('sauce-cheddar', 'Sauce cheddar (poche)', 'sauce', 'l', ['lait'], 500, 'frais', 6),
  I('sauce-creme', 'Sauce crème', 'sauce', 'l', ['lait'], 400, 'frais', 3),
  I('creme-balsamique', 'Crème balsamique', 'sauce', 'l', ['sulfites'], 560, 'sec', 1),
  // ── Épicerie ──
  I('oeufs', 'Œufs', 'epicerie', 'pcs', ['oeufs'], 25, 'frais', 60),
  I('miel', 'Miel', 'epicerie', 'kg', [], 850, 'sec', 2),
  I('nutella', 'Nutella', 'epicerie', 'kg', ['lait', 'fruits_a_coque', 'soja'], 780, 'sec', 3),
  I('huile-friture', 'Huile de friture', 'epicerie', 'l', [], 250, 'sec', 20),
  I('samoussa-legumes', 'Samoussa légumes', 'epicerie', 'pcs', ['gluten'], 55, 'congele', 30),
  I('samoussa-poulet', 'Samoussa poulet', 'epicerie', 'pcs', ['gluten'], 60, 'congele', 30),
  I('samoussa-boeuf', 'Samoussa bœuf', 'epicerie', 'pcs', ['gluten'], 65, 'congele', 30),
  I('nem-legumes', 'Nem légumes', 'epicerie', 'pcs', ['gluten', 'soja'], 55, 'congele', 30),
  I('nem-poulet', 'Nem poulet', 'epicerie', 'pcs', ['gluten', 'soja'], 60, 'congele', 30),
  I('nem-boeuf', 'Nem bœuf', 'epicerie', 'pcs', ['gluten', 'soja'], 65, 'congele', 30),
  I('compote', 'Compote (gourde)', 'epicerie', 'pcs', [], 35, 'sec', 24),
  // ── Desserts ──
  I('glace-100', 'Glace pot 100 ml', 'dessert', 'pcs', ['lait'], 120, 'congele', 24),
  I('glace-500', 'Glace pot 500 ml', 'dessert', 'pcs', ['lait'], 320, 'congele', 12),
  I('chocobon', 'Chocobon', 'dessert', 'pcs', ['lait', 'fruits_a_coque'], 150, 'congele', 24),
  I('base-milkshake', 'Base milkshake', 'dessert', 'l', ['lait'], 380, 'congele', 5),
  I('coulis', 'Coulis (fraise, caramel, chocolat)', 'dessert', 'l', ['lait'], 520, 'sec', 2),
  I('oreo', 'Biscuits Oréo', 'dessert', 'kg', ['gluten', 'soja'], 900, 'sec', 2),
  I('bueno', 'Kinder Bueno', 'dessert', 'kg', ['gluten', 'lait', 'fruits_a_coque', 'soja'], 1600, 'sec', 2),
  I('tarte-daim', 'Tarte au Daim (part)', 'dessert', 'pcs', ['gluten', 'lait', 'fruits_a_coque', 'oeufs', 'soja'], 120, 'congele', 12),
  I('cheesecake', 'Cheesecake (part)', 'dessert', 'pcs', ['gluten', 'lait', 'oeufs'], 110, 'congele', 12),
  I('tiramisu', 'Tiramisu (part)', 'dessert', 'pcs', ['gluten', 'lait', 'oeufs'], 100, 'congele', 12),
  I('fondant', 'Fondant chocolat (part)', 'dessert', 'pcs', ['gluten', 'lait', 'oeufs', 'soja'], 95, 'congele', 12),
  // ── Boissons ──
  I('canette', 'Canette 33 cl', 'boisson', 'pcs', [], 45, 'sec', 72),
  I('bouteille-50', 'Bouteille 50 cl', 'boisson', 'pcs', [], 60, 'sec', 24),
  I('bouteille-150', 'Bouteille 1,5 L', 'boisson', 'pcs', [], 90, 'sec', 12),
  I('bouteille-2l', 'Bouteille 2 L', 'boisson', 'pcs', [], 110, 'sec', 12),
  I('redbull', 'Red Bull 25 cl', 'boisson', 'pcs', [], 120, 'sec', 24),
  I('monster', 'Monster 50 cl', 'boisson', 'pcs', [], 130, 'sec', 24),
  I('freez', 'Freez', 'boisson', 'pcs', [], 90, 'sec', 24),
  I('capri-sun', 'Capri-Sun', 'boisson', 'pcs', [], 30, 'sec', 24),
  I('cafe', 'Café / thé (dosette)', 'boisson', 'pcs', [], 15, 'sec', 50),
  // ── Emballages ──
  I('barquette', 'Barquette', 'emballage', 'pcs', [], 12, 'sec', 300),
  I('sac-kraft', 'Sac kraft', 'emballage', 'pcs', [], 5, 'sec', 300),
  I('papier-burger', 'Papier burger', 'emballage', 'pcs', [], 3, 'sec', 500),
  I('gobelet-milkshake', 'Gobelet milkshake + couvercle', 'emballage', 'pcs', [], 8, 'sec', 100),
  I('bol-salade', 'Bol salade + couvercle', 'emballage', 'pcs', [], 15, 'sec', 60),
  I('boite-carton', 'Boîte carton (box)', 'emballage', 'pcs', [], 22, 'sec', 60),
];

// ─────────────────────────────────────────────────────────────
// 1 bis. Modificateurs pilotés par la recette
//
// Ces trois colonnes suffisent à alimenter TOUTE la caisse : les « sans X »
// proposés sur un produit sont ses ingrédients retirables, et les suppléments
// payants son catalogue d'ingrédients tarifés. Aucune ressaisie produit par
// produit — la recette fait la carte.
// ─────────────────────────────────────────────────────────────

/** Miroir de `SUPPLEMENT_GROUP_KEY` (@sm/contracts) — @sm/supply ne dépend pas de contracts. */
const SUPPLEMENT_GROUP_KEY = 'supplements';

/** Catégories retirables par défaut (miroir de `isRemovableByDefault`, @sm/contracts). */
const REMOVABLE_CATEGORIES = new Set<IngCategory>(['legume', 'fromage', 'sauce']);

/**
 * Exceptions au défaut par catégorie.
 * `true`  : épicerie qu'on retire couramment (l'œuf du végétarien, le miel du chèvre-miel).
 * `false` : produits panés vendus tels quels — « sans onion rings » sur une
 *           barquette d'onion rings n'a aucun sens au comptoir.
 */
const REMOVABLE_OVERRIDES: Record<string, boolean> = {
  oeufs: true,
  miel: true,
  'onion-rings': false,
  jalapenos: false,
  'mozza-sticks': false,
};

const isRemovable = (d: IngredientDef): boolean =>
  REMOVABLE_OVERRIDES[d.key] ?? REMOVABLE_CATEGORIES.has(d.category);

/**
 * Tarifs RÉELS des suppléments de la carte Class'Food
 * (design_handoff_snack_manager/menu-data.js — supp100 / supp150 / supp080).
 * Un ingrédient absent de cette table n'est jamais proposé en supplément.
 */
const SUPPLEMENT_PRICES: Record<string, number> = {
  // +1,00 € — fromages, œuf, miel
  cheddar: 100,
  chevre: 100,
  bleu: 100,
  boursin: 100,
  miel: 100,
  oeufs: 100,
  reblochon: 100,
  raclette: 100,
  camembert: 100,
  // +1,50 € — charcuterie de volaille
  'lardons-dinde': 150,
  'bacon-dinde': 150,
  'jambon-dinde': 150,
  chorizo: 150,
  // +0,80 € — légumes
  champignons: 80,
  avocat: 80,
  poivrons: 80,
  aubergine: 80,
  'oignons-frits': 80,
  // +2,00 € — viandes en supplément (les viandes du « Compose ton Tacos »)
  'viande-kebab': 200,
  'steak-hache': 200,
  kefta: 200,
  merguez: 200,
  'escalope-poulet': 200,
  'poulet-pane': 200,
  'poulet-tikka': 200,
  'poulet-tandoori': 200,
  'cordon-bleu': 200,
  nuggets: 200,
  tenders: 200,
};

/**
 * Libellés courts pour la caisse et le ticket : le stock parle de
 * « Oignon rouge », le client demande « sans oignons ».
 */
const DISPLAY_NAMES: Record<string, string> = {
  'viande-kebab': 'Kebab',
  'steak-hache': 'Steak',
  kefta: 'Kefta',
  'escalope-poulet': 'Poulet',
  'poulet-pane': 'Poulet pané',
  'poulet-tikka': 'Tikka',
  'poulet-tandoori': 'Tandoori',
  nuggets: 'Nuggets',
  tenders: 'Tenders',
  wings: 'Wings',
  'bacon-dinde': 'Bacon',
  'lardons-dinde': 'Lardons',
  chorizo: 'Chorizo',
  'saucisse-hotdog': 'Saucisse',
  'poisson-pane': 'Poisson pané',
  thon: 'Thon',
  calamar: 'Calamars',
  cheddar: 'Cheddar',
  chevre: 'Chèvre',
  boursin: 'Boursin',
  raclette: 'Raclette',
  mozzarella: 'Mozzarella',
  emmental: 'Emmental',
  burrata: 'Burrata',
  'mozza-sticks': 'Mozza sticks',
  salade: 'Salade',
  'oignon-rouge': 'Oignons',
  'oignons-frits': 'Oignons frits',
  'onion-rings': 'Onion rings',
  jalapenos: 'Jalapeños',
  'galette-pdt': 'Galette de pomme de terre',
  oeufs: 'Œuf',
  'sauce-ketchup': 'Ketchup',
  'sauce-mayonnaise': 'Mayonnaise',
  'sauce-samourai': 'Samouraï',
  'sauce-andalouse': 'Andalouse',
  'sauce-biggy': 'Biggy',
  'sauce-blanche': 'Sauce blanche',
  'sauce-harissa': 'Harissa',
  'sauce-cheesy': 'Cheesy',
  'sauce-algerienne': 'Algérienne',
  'sauce-fromagere': 'Sauce fromagère',
  'sauce-creme': 'Sauce crème',
  'base-milkshake': 'Milkshake',
  'gobelet-milkshake': 'Gobelet milkshake',
  'bol-salade': 'Bol salade',
  'boite-carton': 'Boîte carton',
  'glace-100': 'Glace 100 ml',
  'glace-500': 'Glace 500 ml',
  'tarte-daim': 'Tarte au Daim',
  cheesecake: 'Cheesecake',
  tiramisu: 'Tiramisu',
  fondant: 'Fondant chocolat',
  oreo: 'Oréo',
  bueno: 'Kinder Bueno',
  compote: 'Compote',
  cafe: 'Café / thé',
};

/** Colonnes « modificateurs » d'un ingrédient — identiques canonique et fork. */
const modifierColumns = (d: IngredientDef) => ({
  removable: isRemovable(d),
  supplementPriceCents: SUPPLEMENT_PRICES[d.key] ?? null,
  displayName: DISPLAY_NAMES[d.key] ?? null,
});

/** Stocks du fork Class'Food : 3 ingrédients sous le par (alertes), 1 à zéro. */
const UNDER_PAR: Record<string, number> = {
  'pain-burger': 12, // par 40 → alerte réassort
  frites: 8, // par 30 → alerte réassort (et hausse de prix récente)
  'sauce-samourai': 0.8, // par 3 → alerte réassort
};
const OUT_OF_STOCK = new Set(['reblochon']); // stock 0, isOut laissé à false (pas de cascade au seed)

// ─────────────────────────────────────────────────────────────
// 2. Recettes — clé « Catégorie|Produit » (noms Mongo exacts)
// ─────────────────────────────────────────────────────────────

type RecipeSpec = {
  base?: Line[];
  /** variantKey → lignes (quand la nomenclature diffère par variante) */
  variants?: Record<string, Line[]>;
  note?: string;
};

/** Fusionne les lignes dupliquées (même ingrédient + même unité). */
function mergeLines(lines: Line[]): Line[] {
  const acc = new Map<string, Line>();
  for (const [k, q, u] of lines) {
    const id = `${k}|${u}`;
    const prev = acc.get(id);
    if (prev) prev[1] += q;
    else acc.set(id, [k, q, u]);
  }
  return [...acc.values()];
}

// Bases réutilisables (portions standard snacking)
const CRUD_SW: Line[] = [
  ['salade', 30, 'g'],
  ['tomate', 40, 'g'],
  ['oignon-rouge', 15, 'g'],
];
const SW_BASE: Line[] = [...CRUD_SW, ['frites', 150, 'g'], ['papier-burger', 1, 'pcs'], ['barquette', 1, 'pcs']];
/** Sandwich : pain/galette via le groupe d'options « pain » (option_ingredients). */
const sw = (extra: Line[], note?: string): RecipeSpec => ({
  base: mergeLines([...SW_BASE, ...extra]),
  note: note ?? 'Pain ou galette via l’option « pain » — frites & crudités incluses',
});

const BURGER_BASE: Line[] = [
  ['pain-burger', 1, 'pcs'],
  ['salade', 20, 'g'],
  ['tomate', 30, 'g'],
  ['oignon-rouge', 15, 'g'],
  ['cornichons', 15, 'g'],
  ['papier-burger', 1, 'pcs'],
];
const burger = (extra: Line[]): RecipeSpec => ({ base: mergeLines([...BURGER_BASE, ...extra]) });

const CLASSIC_BASE: Line[] = [
  ['pain-burger', 1, 'pcs'],
  ['salade', 20, 'g'],
  ['tomate', 30, 'g'],
  ['frites', 150, 'g'],
  ['papier-burger', 1, 'pcs'],
  ['barquette', 1, 'pcs'],
];
const classic = (extra: Line[]): RecipeSpec => ({ base: mergeLines([...CLASSIC_BASE, ...extra]) });

const HUM_BASE: Line[] = [
  ['pain-sandwich', 1, 'pcs'],
  ['salade', 20, 'g'],
  ['tomate', 30, 'g'],
  ['frites', 150, 'g'],
  ['papier-burger', 1, 'pcs'],
  ['barquette', 1, 'pcs'],
];
const hummer = (steaksG: number, cheddarG: number): RecipeSpec => ({
  base: mergeLines([...HUM_BASE, ['steak-hache', steaksG, 'g'], ['cheddar', cheddarG, 'g']]),
});

const HD_BASE: Line[] = [
  ['pain-hotdog', 1, 'pcs'],
  ['saucisse-hotdog', 70, 'g'],
  ['frites', 150, 'g'],
  ['papier-burger', 1, 'pcs'],
  ['barquette', 1, 'pcs'],
];
const hotdog = (extra: Line[]): RecipeSpec => ({ base: mergeLines([...HD_BASE, ...extra]) });

const SALADE_BASE: Line[] = [
  ['bol-salade', 1, 'pcs'],
  ['salade', 100, 'g'],
  ['tomate', 80, 'g'],
];
const salade = (extra: Line[]): RecipeSpec => ({ base: mergeLines([...SALADE_BASE, ...extra]) });

const texmex = (perVariant: Record<string, Line[]>, note?: string): RecipeSpec => ({
  variants: Object.fromEntries(
    Object.entries(perVariant).map(([k, lines]) => [k, mergeLines([...lines, ['barquette', 1, 'pcs']])]),
  ),
  note,
});

const RECIPES: Record<string, RecipeSpec> = {
  // ── Sandwichs (24) ──
  'Sandwichs|Kebab': sw([['viande-kebab', 150, 'g']]),
  'Sandwichs|Végétarien': sw([
    ['galette-pdt', 2, 'pcs'],
    ['oeufs', 1, 'pcs'],
  ]),
  'Sandwichs|Merguez': sw([['merguez', 160, 'g']]),
  'Sandwichs|2 Steaks': sw([
    ['steak-hache', 90, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Sandwichs|3 Steaks': sw([
    ['steak-hache', 135, 'g'],
    ['cheddar', 30, 'g'],
  ]),
  'Sandwichs|4 Steaks': sw([
    ['steak-hache', 180, 'g'],
    ['cheddar', 40, 'g'],
  ]),
  'Sandwichs|Kebab Fromage': sw([
    ['viande-kebab', 150, 'g'],
    ['cheddar', 30, 'g'],
  ]),
  'Sandwichs|Chèvre Miel': sw([
    ['viande-kebab', 150, 'g'],
    ['chevre', 40, 'g'],
    ['miel', 20, 'g'],
  ]),
  'Sandwichs|Kefta': sw([
    ['kefta', 150, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Sandwichs|Tikka': sw([['poulet-tikka', 150, 'g']]),
  'Sandwichs|Tandoori': sw([['poulet-tandoori', 150, 'g']]),
  'Sandwichs|Le Boursin': sw([
    ['escalope-poulet', 150, 'g'],
    ['boursin', 40, 'g'],
  ]),
  'Sandwichs|Escalope Normande': sw([
    ['poulet-pane', 150, 'g'],
    ['camembert', 40, 'g'],
    ['champignons', 40, 'g'],
  ]),
  'Sandwichs|Spécial': sw([
    ['viande-kebab', 100, 'g'],
    ['merguez', 80, 'g'],
  ]),
  'Sandwichs|Radical': sw([
    ['steak-hache', 90, 'g'],
    ['merguez', 160, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Sandwichs|Duo': sw([
    ['steak-hache', 90, 'g'],
    ['cordon-bleu', 100, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Sandwichs|Mexicain': sw([
    ['viande-kebab', 120, 'g'],
    ['chorizo', 40, 'g'],
    ['poivrons', 40, 'g'],
  ]),
  'Sandwichs|Suprême': sw([
    ['viande-kebab', 150, 'g'],
    ['champignons', 40, 'g'],
    ['emmental', 30, 'g'],
  ]),
  'Sandwichs|Buffalo': sw([
    ['steak-hache', 90, 'g'],
    ['bacon-dinde', 30, 'g'],
    ['cheddar', 20, 'g'],
    ['oeufs', 1, 'pcs'],
  ]),
  'Sandwichs|Royal': sw([
    ['steak-hache', 45, 'g'],
    ['viande-kebab', 100, 'g'],
  ]),
  'Sandwichs|Beldi': sw([
    ['steak-hache', 150, 'g'],
    ['oeufs', 1, 'pcs'],
    ['cheddar', 20, 'g'],
  ]),
  'Sandwichs|Maxi Kebab': sw([['viande-kebab', 300, 'g']]),
  'Sandwichs|Galette 4 Fromages': sw([
    ['viande-kebab', 150, 'g'],
    ['cheddar', 20, 'g'],
    ['emmental', 20, 'g'],
    ['chevre', 20, 'g'],
    ['bleu', 20, 'g'],
  ]),
  'Sandwichs|Galette Burrata': sw([
    ['viande-kebab', 150, 'g'],
    ['burrata', 125, 'g'],
    ['tomate', 60, 'g'],
    ['creme-balsamique', 15, 'ml'],
  ]),
  // ── Gourmets Burgers (8) ──
  'Gourmets Burgers|Le Classic': burger([
    ['steak-hache', 130, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Gourmets Burgers|Le Crousty': burger([
    ['steak-hache', 130, 'g'],
    ['poulet-pane', 80, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Gourmets Burgers|Le Chèvre Miel': burger([
    ['steak-hache', 130, 'g'],
    ['chevre', 40, 'g'],
    ['miel', 15, 'g'],
  ]),
  'Gourmets Burgers|Le Gourmet': burger([
    ['steak-hache', 130, 'g'],
    ['oeufs', 1, 'pcs'],
    ['bacon-dinde', 30, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Gourmets Burgers|Le Montagnard': burger([
    ['steak-hache', 130, 'g'],
    ['oeufs', 1, 'pcs'],
    ['raclette', 50, 'g'],
  ]),
  'Gourmets Burgers|Le Red': burger([
    ['steak-hache', 130, 'g'],
    ['camembert', 40, 'g'],
    ['lardons-dinde', 40, 'g'],
  ]),
  'Gourmets Burgers|Le Black': burger([
    ['steak-hache', 130, 'g'],
    ['bleu', 40, 'g'],
    ['bacon-dinde', 30, 'g'],
  ]),
  'Gourmets Burgers|Le King': burger([
    ['steak-hache', 260, 'g'],
    ['oeufs', 1, 'pcs'],
    ['cheddar', 40, 'g'],
  ]),
  // ── Les Classiques (12) ──
  'Les Classiques|Cheese': classic([
    ['steak-hache', 45, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Double Cheese': classic([
    ['steak-hache', 90, 'g'],
    ['cheddar', 40, 'g'],
  ]),
  'Les Classiques|Triple Cheese': classic([
    ['steak-hache', 135, 'g'],
    ['cheddar', 60, 'g'],
  ]),
  'Les Classiques|Chicken': classic([
    ['poulet-pane', 100, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Fish': classic([
    ['poisson-pane', 100, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Veggi': classic([
    ['galette-pdt', 1, 'pcs'],
    ['oeufs', 1, 'pcs'],
    ['poivrons', 30, 'g'],
    ['champignons', 30, 'g'],
  ]),
  'Les Classiques|Texan': classic([
    ['steak-hache', 90, 'g'],
    ['cheddar', 20, 'g'],
    ['oeufs', 1, 'pcs'],
    ['bacon-dinde', 30, 'g'],
  ]),
  'Les Classiques|Farci': classic([
    ['kefta', 150, 'g'],
    ['oeufs', 1, 'pcs'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Country': classic([
    ['steak-hache', 90, 'g'],
    ['galette-pdt', 1, 'pcs'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Le 180': classic([
    ['steak-hache', 180, 'g'],
    ['cheddar', 20, 'g'],
  ]),
  'Les Classiques|Le 360': classic([
    ['steak-hache', 360, 'g'],
    ['cheddar', 40, 'g'],
  ]),
  'Les Classiques|Le 540': classic([
    ['steak-hache', 540, 'g'],
    ['cheddar', 60, 'g'],
  ]),
  // ── Class Bowl (viandes via options → une seule recette de base) ──
  'Class Bowl|Class Bowl': {
    base: [
      ['frites', 200, 'g'],
      ['sauce-fromagere', 60, 'ml'],
      ['mozzarella', 50, 'g'],
      ['poivrons', 30, 'g'],
      ['champignons', 30, 'g'],
      ['aubergine', 30, 'g'],
      ['oignons-frits', 20, 'g'],
      ['bol-salade', 1, 'pcs'],
    ],
    note: 'Viandes via le groupe d’options « viandes » (0/1/2-3 selon la variante)',
  },
  // ── Compose ton Tacos (recette par taille, viandes/suppléments via options) ──
  'Compose ton Tacos|Compose ton Tacos': {
    variants: {
      M: [
        ['galette-tortilla', 1, 'pcs'],
        ['frites', 130, 'g'],
        ['sauce-fromagere', 50, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
      L: [
        ['galette-tortilla', 1, 'pcs'],
        ['frites', 150, 'g'],
        ['sauce-fromagere', 70, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
      XL: [
        ['galette-tortilla', 2, 'pcs'],
        ['frites', 180, 'g'],
        ['sauce-fromagere', 90, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
      XXL: [
        ['galette-tortilla', 2, 'pcs'],
        ['frites', 220, 'g'],
        ['sauce-fromagere', 110, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
    },
    note: 'Viandes (120 g / choix), suppléments et sauces via option_ingredients',
  },
  // ── Assiettes ──
  'Assiettes|Assiette': {
    variants: {
      M: [
        ['salade', 50, 'g'],
        ['tomate', 60, 'g'],
        ['oignon-rouge', 20, 'g'],
        ['frites', 200, 'g'],
        ['barquette', 1, 'pcs'],
      ],
      L: [
        ['salade', 50, 'g'],
        ['tomate', 60, 'g'],
        ['oignon-rouge', 20, 'g'],
        ['frites', 220, 'g'],
        ['barquette', 1, 'pcs'],
      ],
      XL: [
        ['salade', 50, 'g'],
        ['tomate', 60, 'g'],
        ['oignon-rouge', 20, 'g'],
        ['frites', 250, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
    note: 'Viandes (120 g / choix) via option_ingredients',
  },
  "Assiettes|Assiette Class'Food": {
    base: [
      ['onion-rings', 60, 'g'],
      ['calamar', 75, 'g'],
      ['salade', 50, 'g'],
      ['tomate', 60, 'g'],
      ['frites', 220, 'g'],
      ['barquette', 1, 'pcs'],
    ],
    note: '2 viandes via option_ingredients',
  },
  // ── Bun's (viandes via options) ──
  "Bun's|Bun's": {
    base: [
      ['pain-buns', 1, 'pcs'],
      ['salade', 20, 'g'],
      ['tomate', 30, 'g'],
      ['frites', 150, 'g'],
      ['papier-burger', 1, 'pcs'],
      ['barquette', 1, 'pcs'],
    ],
    note: 'Viandes (120 g / choix) via option_ingredients',
  },
  // ── Paninis ──
  'Paninis|Panini au choix': {
    base: [
      ['pain-panini', 1, 'pcs'],
      ['emmental', 20, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
    note: 'Garniture via le groupe d’options « garniture »',
  },
  'Paninis|Panini 3 fromages': {
    base: [
      ['pain-panini', 1, 'pcs'],
      ['cheddar', 25, 'g'],
      ['emmental', 25, 'g'],
      ['chevre', 25, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Paninis|Panini Nutella': {
    base: [
      ['pain-panini', 1, 'pcs'],
      ['nutella', 50, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  // ── Hummers ──
  'Hummers|H1 — 2 steaks': hummer(90, 40),
  'Hummers|H2 — 4 steaks': hummer(180, 60),
  'Hummers|H3 — 6 steaks': hummer(270, 80),
  'Hummers|H4 — 8 steaks': hummer(360, 100),
  // ── Salades ──
  'Salades|Salade César': salade([['poulet-pane', 100, 'g']]),
  'Salades|Salade Océane': salade([
    ['thon', 80, 'g'],
    ['olives', 30, 'g'],
  ]),
  'Salades|Salade Lyonnaise': salade([
    ['oeufs', 1, 'pcs'],
    ['chevre', 40, 'g'],
  ]),
  'Salades|Salade Normande': salade([
    ['aubergine', 60, 'g'],
    ['camembert', 50, 'g'],
    ['olives', 30, 'g'],
  ]),
  'Salades|Salade Andelloise': salade([
    ['avocat', 80, 'g'],
    ['olives', 30, 'g'],
    ['camembert', 50, 'g'],
    ['oignon-rouge', 20, 'g'],
  ]),
  // ── Barquettes ──
  'Barquettes|Frites': {
    variants: {
      M: [
        ['frites', 250, 'g'],
        ['barquette', 1, 'pcs'],
      ],
      L: [
        ['frites', 350, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
  },
  'Barquettes|Frites cheddar ou fromagère': {
    variants: {
      M: [
        ['frites', 250, 'g'],
        ['sauce-cheddar', 60, 'ml'],
        ['barquette', 1, 'pcs'],
      ],
      L: [
        ['frites', 350, 'g'],
        ['sauce-cheddar', 80, 'ml'],
        ['barquette', 1, 'pcs'],
      ],
    },
  },
  'Barquettes|Frites cheddar lardons': {
    variants: {
      M: [
        ['frites', 250, 'g'],
        ['sauce-cheddar', 60, 'ml'],
        ['lardons-dinde', 50, 'g'],
        ['barquette', 1, 'pcs'],
      ],
      L: [
        ['frites', 350, 'g'],
        ['sauce-cheddar', 80, 'ml'],
        ['lardons-dinde', 70, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
  },
  'Barquettes|Viande (kebab ou poulet)': {
    variants: {
      M: [
        ['viande-kebab', 200, 'g'],
        ['frites', 200, 'g'],
        ['barquette', 1, 'pcs'],
      ],
      L: [
        ['viande-kebab', 280, 'g'],
        ['frites', 250, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
    note: 'Recette de référence : viande kebab (variante poulet non différenciée)',
  },
  // ── Pain Suédois (base 3 steaks / escalope via options) ──
  'Pain Suédois|Pain Suédois': {
    base: [
      ['pain-suedois', 1, 'pcs'],
      ['salade', 30, 'g'],
      ['tomate', 40, 'g'],
      ['oeufs', 1, 'pcs'],
      ['frites', 150, 'g'],
      ['papier-burger', 1, 'pcs'],
      ['barquette', 1, 'pcs'],
    ],
    note: 'Base (3 steaks ou escalope) via option_ingredients',
  },
  // ── Menu Enfant (plat & douceur via options) ──
  'Menu Enfant|Menu Enfant': {
    base: [
      ['frites', 100, 'g'],
      ['sac-kraft', 1, 'pcs'],
      ['barquette', 1, 'pcs'],
    ],
    note: 'Plat et boisson/dessert via option_ingredients',
  },
  // ── Hot Dogs ──
  'Hot Dogs|Le Class Dog': hotdog([
    ['sauce-ketchup', 15, 'ml'],
    ['moutarde', 10, 'ml'],
    ['oignons-frits', 15, 'g'],
  ]),
  'Hot Dogs|Le Royal Dog': hotdog([
    ['bacon-dinde', 30, 'g'],
    ['cheddar', 20, 'g'],
    ['oignons-frits', 20, 'g'],
  ]),
  'Hot Dogs|Le Cheese Dog': hotdog([['cheddar', 40, 'g']]),
  // ── Les Signatures ──
  'Les Signatures|Le Boss': {
    base: [
      ['pain-burger', 1, 'pcs'],
      ['steak-hache', 130, 'g'],
      ['cheddar', 20, 'g'],
      ['onion-rings', 40, 'g'],
      ['cornichons', 20, 'g'],
      ['salade', 20, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Les Signatures|Le Bo Goss': {
    base: [
      ['pain-burger', 1, 'pcs'],
      ['escalope-poulet', 100, 'g'],
      ['jambon-dinde', 30, 'g'],
      ['oeufs', 1, 'pcs'],
      ['tomate', 60, 'g'],
      ['oignons-frits', 20, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Les Signatures|Bling Bling': {
    base: [
      ['pain-burger', 1, 'pcs'],
      ['steak-hache', 130, 'g'],
      ['escalope-poulet', 80, 'g'],
      ['creme-balsamique', 15, 'ml'],
      ['sauce-blanche', 30, 'ml'],
      ['oignons-frits', 20, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Les Signatures|Egg 180': {
    base: [
      ['pain-burger', 1, 'pcs'],
      ['steak-hache', 180, 'g'],
      ['oeufs', 1, 'pcs'],
      ['sauce-cheddar', 40, 'ml'],
      ['oignon-rouge', 30, 'g'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Les Signatures|Le Smash': {
    variants: {
      simple: [
        ['pain-burger', 1, 'pcs'],
        ['steak-hache', 90, 'g'],
        ['cheddar', 20, 'g'],
        ['sauce-fromagere', 30, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
      double: [
        ['pain-burger', 1, 'pcs'],
        ['steak-hache', 180, 'g'],
        ['cheddar', 40, 'g'],
        ['sauce-fromagere', 40, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
      triple: [
        ['pain-burger', 1, 'pcs'],
        ['steak-hache', 270, 'g'],
        ['cheddar', 60, 'g'],
        ['sauce-fromagere', 50, 'ml'],
        ['papier-burger', 1, 'pcs'],
      ],
    },
  },
  'Les Signatures|Le Smash Chicken': {
    base: [
      ['pain-burger', 1, 'pcs'],
      ['poulet-pane', 100, 'g'],
      ['cheddar', 20, 'g'],
      ['sauce-fromagere', 30, 'ml'],
      ['papier-burger', 1, 'pcs'],
    ],
  },
  'Les Signatures|Le Double Kif': {
    base: [
      ['pain-burger', 2, 'pcs'],
      ['steak-hache', 180, 'g'],
      ['cheddar', 40, 'g'],
      ['sauce-fromagere', 60, 'ml'],
      ['papier-burger', 2, 'pcs'],
    ],
  },
  // ── Crousty One (base riz/pâtes/nouilles via options) ──
  'Crousty One|Crousty One': {
    base: [
      ['poulet-pane', 150, 'g'],
      ['barquette', 1, 'pcs'],
    ],
    note: 'Base féculent + sauce via option_ingredients',
  },
  // ── Tex-Mex ──
  'Tex-Mex|Nuggets': texmex({ '5': [['nuggets', 100, 'g']], '10': [['nuggets', 200, 'g']] }),
  'Tex-Mex|Wings': texmex({ '5': [['wings', 150, 'g']], '10': [['wings', 300, 'g']] }),
  'Tex-Mex|Mozza sticks': texmex({ '5': [['mozza-sticks', 125, 'g']], '10': [['mozza-sticks', 250, 'g']] }),
  'Tex-Mex|Tenders': texmex({ '5': [['tenders', 200, 'g']], '10': [['tenders', 400, 'g']] }),
  'Tex-Mex|Jalapeños': texmex({ '5': [['jalapenos', 125, 'g']], '10': [['jalapenos', 250, 'g']] }),
  'Tex-Mex|Samoussa': texmex(
    { '5': [], '10': [] },
    'Pièces via le groupe « garniture » (nomenclature calée sur le format 5 pcs)',
  ),
  'Tex-Mex|Nems': texmex(
    { '5': [], '10': [] },
    'Pièces via le groupe « garniture » (nomenclature calée sur le format 5 pcs)',
  ),
  'Tex-Mex|Beignets de calamar': texmex({ '10': [['calamar', 250, 'g']], '20': [['calamar', 500, 'g']] }),
  'Tex-Mex|Onion rings': texmex({ '10': [['onion-rings', 200, 'g']], '20': [['onion-rings', 400, 'g']] }),
  // ── Box à Partager ──
  'Box à Partager|Box Menu Solo': {
    base: [
      ['frites', 200, 'g'],
      ['canette', 1, 'pcs'],
      ['boite-carton', 1, 'pcs'],
    ],
    note: '5 tenders ou 5 wings via option_ingredients',
  },
  'Box à Partager|Mix Box 1': {
    base: [
      ['tenders', 320, 'g'],
      ['wings', 240, 'g'],
      ['boite-carton', 1, 'pcs'],
    ],
  },
  'Box à Partager|Mix Box 2': {
    base: [
      ['tenders', 320, 'g'],
      ['wings', 450, 'g'],
      ['boite-carton', 1, 'pcs'],
    ],
  },
  'Box à Partager|Family Box': {
    base: [
      ['tenders', 560, 'g'],
      ['wings', 480, 'g'],
      ['frites', 600, 'g'],
      ['bouteille-150', 1, 'pcs'],
      ['boite-carton', 1, 'pcs'],
    ],
  },
  'Box à Partager|Family Big Box': {
    base: [
      ['tenders', 400, 'g'],
      ['wings', 300, 'g'],
      ['calamar', 125, 'g'],
      ['samoussa-poulet', 3, 'pcs'],
      ['nem-poulet', 3, 'pcs'],
      ['onion-rings', 100, 'g'],
      ['jalapenos', 100, 'g'],
      ['frites', 750, 'g'],
      ['bouteille-150', 1, 'pcs'],
      ['boite-carton', 1, 'pcs'],
    ],
  },
  // ── Glaces / Desserts ──
  'Glaces|Pot 100 ml': { base: [['glace-100', 1, 'pcs']] },
  'Glaces|Pot 500 ml': { base: [['glace-500', 1, 'pcs']] },
  'Glaces|Chocobon': { base: [['chocobon', 1, 'pcs']] },
  'Desserts|Tarte au Daim': { base: [['tarte-daim', 1, 'pcs']] },
  'Desserts|Cheesecake': { base: [['cheesecake', 1, 'pcs']] },
  'Desserts|Tiramisu': { base: [['tiramisu', 1, 'pcs']] },
  'Desserts|Fondant chocolat': { base: [['fondant', 1, 'pcs']] },
  // ── Milkshakes ──
  'Milkshakes|Milkshake Nature, vanille, fraise': {
    variants: {
      classique: [
        ['base-milkshake', 250, 'ml'],
        ['coulis', 20, 'ml'],
        ['gobelet-milkshake', 1, 'pcs'],
      ],
      xl: [
        ['base-milkshake', 400, 'ml'],
        ['coulis', 30, 'ml'],
        ['gobelet-milkshake', 1, 'pcs'],
      ],
    },
  },
  'Milkshakes|Milkshake Oréo ou Bueno': {
    variants: {
      classique: [
        ['base-milkshake', 250, 'ml'],
        ['oreo', 30, 'g'],
        ['gobelet-milkshake', 1, 'pcs'],
      ],
      xl: [
        ['base-milkshake', 400, 'ml'],
        ['oreo', 50, 'g'],
        ['gobelet-milkshake', 1, 'pcs'],
      ],
    },
    note: 'Recette de référence : Oréo (variante Bueno non différenciée)',
  },
  // ── Boissons ──
  'Boissons|Canette 33 cl': { base: [['canette', 1, 'pcs']] },
  'Boissons|Bouteille 50 cl': { base: [['bouteille-50', 1, 'pcs']] },
  'Boissons|Bouteille 1,5 L': { base: [['bouteille-150', 1, 'pcs']] },
  'Boissons|Bouteille 2 L': { base: [['bouteille-2l', 1, 'pcs']] },
  'Boissons|Red Bull': { base: [['redbull', 1, 'pcs']] },
  'Boissons|Monster': { base: [['monster', 1, 'pcs']] },
  'Boissons|Freez': { base: [['freez', 1, 'pcs']] },
  'Boissons|Thé / Café': { base: [['cafe', 1, 'pcs']] },
};

// ─────────────────────────────────────────────────────────────
// 3. Nomenclature des options — appliquée d'après les groupes réels Mongo
// ─────────────────────────────────────────────────────────────

/** Groupes GLOBAUX (mêmes choix sur tous les produits qui portent le groupe). */
const SAUCE_OPTION: Record<string, Line[]> = {
  ketchup: [['sauce-ketchup', 30, 'ml']],
  mayonnaise: [['sauce-mayonnaise', 30, 'ml']],
  samourai: [['sauce-samourai', 30, 'ml']],
  andalouse: [['sauce-andalouse', 30, 'ml']],
  poivre: [['sauce-poivre', 30, 'ml']],
  biggy: [['sauce-biggy', 30, 'ml']],
  'blanche-maison': [['sauce-blanche', 30, 'ml']],
  harissa: [['sauce-harissa', 30, 'ml']],
  cheesy: [['sauce-cheesy', 30, 'ml']],
  moutarde: [['moutarde', 30, 'ml']],
  algerienne: [['sauce-algerienne', 30, 'ml']],
};

/** Chaque choix de viande consomme 120 g de l'ingrédient correspondant. */
const VIANDE_OPTION: Record<string, Line[]> = {
  kebab: [['viande-kebab', 120, 'g']],
  steak: [['steak-hache', 120, 'g']],
  kefta: [['kefta', 120, 'g']],
  poulet: [['escalope-poulet', 120, 'g']],
  tikka: [['poulet-tikka', 120, 'g']],
  tandoori: [['poulet-tandoori', 120, 'g']],
  'cordon-bleu': [['cordon-bleu', 120, 'g']],
  nuggets: [['nuggets', 120, 'g']],
  merguez: [['merguez', 120, 'g']],
  tenders: [['tenders', 120, 'g']],
};

/** Pain / galette des sandwichs. */
const PAIN_OPTION: Record<string, Line[]> = {
  pain: [['pain-sandwich', 1, 'pcs']],
  galette: [['galette-tortilla', 1, 'pcs']],
};

/** Groupes SPÉCIFIQUES à un produit : « Catégorie|Produit » → groupe → choix → lignes. */
const PRODUCT_OPTIONS: Record<string, Record<string, Record<string, Line[]>>> = {
  'Compose ton Tacos|Compose ton Tacos': {
    'supp-1-00': {
      cheddar: [['cheddar', 30, 'g']],
      chevre: [['chevre', 30, 'g']],
      bleu: [['bleu', 30, 'g']],
      boursin: [['boursin', 30, 'g']],
      miel: [['miel', 20, 'g']],
      uf: [['oeufs', 1, 'pcs']], // clé Mongo « uf » = Œuf (œ non décomposé par key())
      reblochon: [['reblochon', 30, 'g']],
      raclette: [['raclette', 30, 'g']],
      camembert: [['camembert', 30, 'g']],
    },
    'supp-1-50': {
      lardons: [['lardons-dinde', 40, 'g']],
      bacon: [['bacon-dinde', 30, 'g']],
      'jambon-de-dinde': [['jambon-dinde', 30, 'g']],
      chorizo: [['chorizo', 30, 'g']],
    },
    'supp-0-80': {
      champignons: [['champignons', 40, 'g']],
      avocat: [['avocat', 50, 'g']],
      poivrons: [['poivrons', 40, 'g']],
      aubergine: [['aubergine', 40, 'g']],
      'oignons-frits': [['oignons-frits', 20, 'g']],
    },
    gratine: { gratine: [['mozzarella', 60, 'g']] },
  },
  'Paninis|Panini au choix': {
    garniture: {
      merguez: [['merguez', 80, 'g']],
      thon: [['thon', 80, 'g']],
      kebab: [['viande-kebab', 100, 'g']],
      steak: [['steak-hache', 90, 'g']],
      poulet: [['escalope-poulet', 100, 'g']],
      'merguez-ou-poulet-chorizo': [
        ['merguez', 60, 'g'],
        ['chorizo', 30, 'g'],
      ],
      'steak-chevre': [
        ['steak-hache', 90, 'g'],
        ['chevre', 30, 'g'],
      ],
      'steak-chevre-miel': [
        ['steak-hache', 90, 'g'],
        ['chevre', 30, 'g'],
        ['miel', 15, 'g'],
      ],
      'jambon-de-dinde': [['jambon-dinde', 60, 'g']],
    },
    extras: {
      frites: [
        ['frites', 150, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
  },
  'Paninis|Panini 3 fromages': {
    extras: {
      frites: [
        ['frites', 150, 'g'],
        ['barquette', 1, 'pcs'],
      ],
    },
  },
  'Pain Suédois|Pain Suédois': {
    base: {
      '3-steaks': [['steak-hache', 135, 'g']],
      'escalope-de-poulet': [['escalope-poulet', 150, 'g']],
    },
  },
  'Menu Enfant|Menu Enfant': {
    plat: {
      cheeseburger: [
        ['pain-burger', 1, 'pcs'],
        ['steak-hache', 45, 'g'],
        ['cheddar', 20, 'g'],
      ],
      '5-nuggets': [['nuggets', 100, 'g']],
      kebab: [
        ['pain-sandwich', 1, 'pcs'],
        ['viande-kebab', 100, 'g'],
      ],
      'mini-tacos': [
        ['galette-tortilla', 1, 'pcs'],
        ['viande-kebab', 80, 'g'],
        ['sauce-fromagere', 30, 'ml'],
      ],
    },
    douceur: {
      'capri-sun': [['capri-sun', 1, 'pcs']],
      compote: [['compote', 1, 'pcs']],
    },
  },
  'Crousty One|Crousty One': {
    base: {
      'riz-sauce-creme': [
        ['riz', 180, 'g'],
        ['sauce-creme', 80, 'ml'],
      ],
      'pates-sauce-cheddar': [
        ['pates', 180, 'g'],
        ['sauce-cheddar', 80, 'ml'],
      ],
      'nouilles-sauce-cheddar': [
        ['nouilles', 180, 'g'],
        ['sauce-cheddar', 80, 'ml'],
      ],
    },
  },
  'Box à Partager|Box Menu Solo': {
    choix: {
      '5-tenders': [['tenders', 200, 'g']],
      '5-wings': [['wings', 150, 'g']],
    },
  },
  // Quantités calées sur le format 5 pcs (option_ingredients n'a pas de dimension variante)
  'Tex-Mex|Samoussa': {
    garniture: {
      legumes: [['samoussa-legumes', 5, 'pcs']],
      poulet: [['samoussa-poulet', 5, 'pcs']],
      'b-uf': [['samoussa-boeuf', 5, 'pcs']], // clé Mongo « b-uf » = Bœuf
    },
  },
  'Tex-Mex|Nems': {
    garniture: {
      legumes: [['nem-legumes', 5, 'pcs']],
      poulet: [['nem-poulet', 5, 'pcs']],
      'b-uf': [['nem-boeuf', 5, 'pcs']],
    },
  },
};

function optionLinesFor(productKey: string, groupKey: string, choiceKey: string): Line[] | undefined {
  if (groupKey === 'sauces') return SAUCE_OPTION[choiceKey];
  if (groupKey === 'viandes') return VIANDE_OPTION[choiceKey];
  if (groupKey === 'pain') return PAIN_OPTION[choiceKey];
  return PRODUCT_OPTIONS[productKey]?.[groupKey]?.[choiceKey];
}

// ─────────────────────────────────────────────────────────────
// 4. Fournisseurs, marques, catalogue & historique de prix
// ─────────────────────────────────────────────────────────────

type SupplierDef = {
  key: string;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  paymentTerms: string;
  deliveryDays: string;
  notes?: string;
};

const SUPPLIER_DEFS: SupplierDef[] = [
  {
    key: 'metro',
    name: 'METRO France',
    contactName: 'Karim Bensaïd',
    phone: '02 35 61 20 40',
    email: 'commande.rouen@metro.fr',
    paymentTerms: 'Prélèvement à 8 jours',
    deliveryDays: 'mar, ven',
    notes: 'Cash & carry Rouen — commande avant 17 h pour livraison J+1',
  },
  {
    key: 'promocash',
    name: 'Promocash Rouen',
    contactName: 'Sophie Leroy',
    phone: '02 35 72 14 88',
    email: 'rouen@promocash.fr',
    paymentTerms: '30 j fin de mois',
    deliveryDays: 'mer',
    notes: 'Pains, épicerie & emballages',
  },
  {
    key: 'francefrais',
    name: 'France Frais Normandie',
    contactName: 'Julien Vasseur',
    phone: '02 32 40 18 60',
    email: 'adv@francefrais-normandie.fr',
    paymentTerms: '30 j net',
    deliveryDays: 'jeu',
    notes: 'Frais & surgelés — franco à partir de 250 € HT',
  },
];

type BrandDef = { ing: string; name: string; preferred?: boolean; notes?: string };
const BRAND_DEFS: BrandDef[] = [
  { ing: 'viande-kebab', name: 'Ege Food', preferred: true, notes: 'Broche 100 % dinde-veau — référence maison' },
  { ing: 'viande-kebab', name: 'Anadolu' },
  { ing: 'cheddar', name: 'Entremont', preferred: true },
  { ing: 'cheddar', name: 'Président' },
  { ing: 'frites', name: 'McCain', preferred: true, notes: 'Coupe 9/9 — bonne tenue en friture' },
  { ing: 'frites', name: 'Lutosa' },
  { ing: 'saucisse-hotdog', name: 'Isla Délice', preferred: true },
];

type ItemDef = {
  supplier: string;
  ing: string;
  brand?: string;
  sku: string;
  /** quantité par colis, en unité de base de l'ingrédient */
  packQty: number;
  packPriceCents: number;
};

const ITEM_DEFS: ItemDef[] = [
  // METRO — surgelés, viandes, fromages râpés, sauces poche, boissons
  { supplier: 'metro', ing: 'frites', brand: 'McCain', sku: 'FRI-MCC-10', packQty: 10, packPriceCents: 1650 },
  { supplier: 'metro', ing: 'frites', brand: 'Lutosa', sku: 'FRI-LUT-10', packQty: 10, packPriceCents: 1520 },
  { supplier: 'metro', ing: 'viande-kebab', brand: 'Ege Food', sku: 'KEB-EGE-10', packQty: 10, packPriceCents: 7200 },
  { supplier: 'metro', ing: 'viande-kebab', brand: 'Anadolu', sku: 'KEB-ANA-10', packQty: 10, packPriceCents: 6800 },
  { supplier: 'metro', ing: 'steak-hache', sku: 'STK-5', packQty: 5, packPriceCents: 4400 },
  { supplier: 'metro', ing: 'poulet-pane', sku: 'POU-PAN-25', packQty: 2.5, packPriceCents: 1650 },
  { supplier: 'metro', ing: 'tenders', sku: 'TEN-25', packQty: 2.5, packPriceCents: 1800 },
  { supplier: 'metro', ing: 'nuggets', sku: 'NUG-25', packQty: 2.5, packPriceCents: 1350 },
  { supplier: 'metro', ing: 'wings', sku: 'WIN-25', packQty: 2.5, packPriceCents: 1180 },
  { supplier: 'metro', ing: 'cheddar', brand: 'Entremont', sku: 'CHE-ENT-25', packQty: 2.5, packPriceCents: 1600 },
  { supplier: 'metro', ing: 'mozzarella', sku: 'MOZ-25', packQty: 2.5, packPriceCents: 1750 },
  { supplier: 'metro', ing: 'emmental', sku: 'EMM-25', packQty: 2.5, packPriceCents: 1680 },
  { supplier: 'metro', ing: 'pain-burger', sku: 'PBU-48', packQty: 48, packPriceCents: 1850 },
  { supplier: 'metro', ing: 'galette-tortilla', sku: 'TOR-60', packQty: 60, packPriceCents: 1750 },
  { supplier: 'metro', ing: 'sauce-fromagere', sku: 'SFR-3L', packQty: 3, packPriceCents: 1350 },
  { supplier: 'metro', ing: 'sauce-ketchup', sku: 'KET-5L', packQty: 5, packPriceCents: 1350 },
  { supplier: 'metro', ing: 'sauce-mayonnaise', sku: 'MAY-5L', packQty: 5, packPriceCents: 1600 },
  { supplier: 'metro', ing: 'huile-friture', sku: 'HUI-10L', packQty: 10, packPriceCents: 2300 },
  { supplier: 'metro', ing: 'canette', sku: 'CAN-24', packQty: 24, packPriceCents: 950 },
  { supplier: 'metro', ing: 'bouteille-150', sku: 'B15-6', packQty: 6, packPriceCents: 480 },
  { supplier: 'metro', ing: 'oeufs', sku: 'OEU-180', packQty: 180, packPriceCents: 4300 },
  // Promocash — pains, viandes fraîches, épicerie, emballages
  { supplier: 'promocash', ing: 'pain-sandwich', sku: 'PSA-60', packQty: 60, packPriceCents: 1950 },
  { supplier: 'promocash', ing: 'pain-panini', sku: 'PPA-40', packQty: 40, packPriceCents: 1300 },
  { supplier: 'promocash', ing: 'pain-hotdog', sku: 'PHD-36', packQty: 36, packPriceCents: 1050 },
  { supplier: 'promocash', ing: 'pain-suedois', sku: 'PSU-48', packQty: 48, packPriceCents: 1450 },
  { supplier: 'promocash', ing: 'pain-buns', sku: 'PBN-40', packQty: 40, packPriceCents: 1450 },
  { supplier: 'promocash', ing: 'merguez', sku: 'MER-5', packQty: 5, packPriceCents: 3400 },
  { supplier: 'promocash', ing: 'kefta', sku: 'KEF-5', packQty: 5, packPriceCents: 3750 },
  { supplier: 'promocash', ing: 'riz', sku: 'RIZ-10', packQty: 10, packPriceCents: 2100 },
  { supplier: 'promocash', ing: 'pates', sku: 'PAT-5', packQty: 5, packPriceCents: 850 },
  { supplier: 'promocash', ing: 'sauce-samourai', sku: 'SAM-3L', packQty: 3, packPriceCents: 1150 },
  { supplier: 'promocash', ing: 'barquette', sku: 'BAR-500', packQty: 500, packPriceCents: 5500 },
  { supplier: 'promocash', ing: 'sac-kraft', sku: 'SAC-500', packQty: 500, packPriceCents: 2400 },
  { supplier: 'promocash', ing: 'papier-burger', sku: 'PAP-1000', packQty: 1000, packPriceCents: 2800 },
  { supplier: 'promocash', ing: 'gobelet-milkshake', sku: 'GOB-100', packQty: 100, packPriceCents: 1400 },
  { supplier: 'promocash', ing: 'boite-carton', sku: 'BOX-100', packQty: 100, packPriceCents: 2900 },
  // France Frais — fromages à la coupe, frais & desserts
  { supplier: 'francefrais', ing: 'chevre', sku: 'CHV-2', packQty: 2, packPriceCents: 2100 },
  { supplier: 'francefrais', ing: 'raclette', sku: 'RAC-3', packQty: 3, packPriceCents: 2750 },
  { supplier: 'francefrais', ing: 'camembert', sku: 'CAM-3', packQty: 3, packPriceCents: 2250 },
  { supplier: 'francefrais', ing: 'bleu', sku: 'BLE-2', packQty: 2, packPriceCents: 2000 },
  { supplier: 'francefrais', ing: 'boursin', sku: 'BOU-15', packQty: 1.5, packPriceCents: 1650 },
  { supplier: 'francefrais', ing: 'reblochon', sku: 'REB-25', packQty: 2.5, packPriceCents: 2850 },
  { supplier: 'francefrais', ing: 'burrata', sku: 'BUR-15', packQty: 1.5, packPriceCents: 1950 },
  { supplier: 'francefrais', ing: 'base-milkshake', sku: 'MLK-5L', packQty: 5, packPriceCents: 1850 },
  { supplier: 'francefrais', ing: 'glace-100', sku: 'GLA-24', packQty: 24, packPriceCents: 2400 },
  { supplier: 'francefrais', ing: 'glace-500', sku: 'GLB-12', packQty: 12, packPriceCents: 3300 },
  { supplier: 'francefrais', ing: 'lardons-dinde', sku: 'LAR-25', packQty: 2.5, packPriceCents: 2000 },
  { supplier: 'francefrais', ing: 'bacon-dinde', sku: 'BAC-2', packQty: 2, packPriceCents: 1800 },
  { supplier: 'francefrais', ing: 'saucisse-hotdog', brand: 'Isla Délice', sku: 'SHD-3', packQty: 3, packPriceCents: 1750 },
];

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);

/**
 * Historique de prix par SKU.
 *
 * Sémantique (identique à celle de l'API) : chaque ligne archive l'ANCIEN prix
 * au moment où il a changé — le prix courant vit sur `supplier_items`, jamais
 * ici. L'alerte « hausse » compare donc le prix courant à la dernière ligne.
 *
 * Frites McCain : 1250 → 1450 → 1650 (courant) ; la marche d'il y a 9 jours
 * (1450 → 1650, +13,8 %) alimente l'alerte priceIncreases.
 * Mayonnaise : 1400 → 1500 → 1600 (courant), +6,7 % il y a 12 jours.
 */
const PRICE_HISTORY_DEFS: { sku: string; priceCents: number; recordedAt: Date }[] = [
  { sku: 'FRI-MCC-10', priceCents: 1250, recordedAt: daysAgo(45) },
  { sku: 'FRI-MCC-10', priceCents: 1450, recordedAt: daysAgo(9) },
  { sku: 'MAY-5L', priceCents: 1400, recordedAt: daysAgo(60) },
  { sku: 'MAY-5L', priceCents: 1500, recordedAt: daysAgo(12) },
];

// ─────────────────────────────────────────────────────────────
// 5. Exécution
// ─────────────────────────────────────────────────────────────

/** Insertion par paquets (limite de paramètres pg). */
async function bulkInsert(db: any, table: any, rows: any[], chunk = 400): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    await db.insert(table).values(rows.slice(i, i + chunk));
  }
}

type MongoProduct = {
  _id: any;
  name: string;
  categoryId: any;
  variants: { key: string; name: string }[];
  optionGroups: { key: string; choices: { key: string }[] }[];
};

async function main() {
  const pgUrl = process.env.DATABASE_URL;
  const mongoUrl = process.env.MONGO_URL;
  if (!pgUrl) throw new Error('DATABASE_URL manquant (racine .env)');
  if (!mongoUrl) throw new Error('MONGO_URL manquant (racine .env)');

  // ── Lecture Mongo : tenant + catégories + produits ──
  await mongoose.connect(mongoUrl);
  const mdb = mongoose.connection.db;
  const tenant = await mdb.collection('tenants').findOne({ slug: 'classfood' });
  if (!tenant) throw new Error('Tenant « classfood » introuvable — lancer d’abord pnpm --filter @sm/db seed');
  const tenantRef: string = tenant._id.toString();
  const cats = await mdb.collection('categories').find({ tenantId: tenant._id }).toArray();
  const catName = new Map<string, string>(cats.map((c: any) => [c._id.toString(), c.name]));
  const products: MongoProduct[] = await mdb
    .collection('products')
    .find({ tenantId: tenant._id })
    .toArray();
  await mongoose.disconnect();
  console.log(`→ Tenant classfood ${tenantRef} — ${cats.length} catégories, ${products.length} produits Mongo`);

  const { db, pool } = createSupplyDb(pgUrl);

  // ── Purge idempotente (ordre des FK) ──
  await db.delete(purchaseOrderLines);
  await db.delete(invoices);
  await db.delete(purchaseOrders);
  await db.delete(supplierPriceHistory);
  await db.delete(supplierItems);
  await db.delete(suppliers);
  await db.delete(stockMovements);
  await db.delete(optionIngredients);
  await db.delete(recipeLines);
  await db.delete(recipes);
  await db.delete(ingredientBrands);
  await db.delete(ingredients);
  console.log('↻ Tables supply vidées');

  // ── 1. Registre canonique ──
  const canonicalId = new Map<string, string>();
  const canonicalRows = INGREDIENT_DEFS.map((d) => {
    const id = randomUUID();
    canonicalId.set(d.key, id);
    return {
      id,
      tenantRef: null as string | null,
      canonicalId: null as string | null,
      name: d.name,
      category: d.category,
      unit: d.unit,
      allergens: d.allergens,
      costPerUnitCents: d.cost,
      currentStock: '0',
      parLevel: String(d.par),
      storage: d.storage,
      ...modifierColumns(d),
      isOut: false,
      active: true,
    };
  });
  await bulkInsert(db, ingredients, canonicalRows);

  // ── 2. Fork tenant Class'Food (stocks initiaux réalistes) ──
  const forkId = new Map<string, string>();
  const forkRows = INGREDIENT_DEFS.map((d, i) => {
    const id = randomUUID();
    forkId.set(d.key, id);
    let stock: number;
    if (OUT_OF_STOCK.has(d.key)) stock = 0;
    else if (d.key in UNDER_PAR) stock = UNDER_PAR[d.key];
    else {
      const factor = 1.7 + ((i * 7) % 10) / 10; // 1,7 → 2,6, déterministe
      stock = d.unit === 'pcs' ? Math.round(d.par * factor) : Math.round(d.par * factor * 10) / 10;
    }
    return {
      id,
      tenantRef,
      canonicalId: canonicalId.get(d.key)!,
      name: d.name,
      category: d.category,
      unit: d.unit,
      allergens: d.allergens,
      costPerUnitCents: d.cost,
      currentStock: String(stock),
      parLevel: String(d.par),
      storage: d.storage,
      ...modifierColumns(d),
      isOut: false,
      active: true,
    };
  });
  await bulkInsert(db, ingredients, forkRows);
  const ing = (key: string): string => {
    const id = forkId.get(key);
    if (!id) throw new Error(`Ingrédient inconnu dans les nomenclatures : « ${key} »`);
    return id;
  };

  // ── 3. Recettes (une par produit, ou par variante) ──
  const recipeRows: any[] = [];
  const recipeLineRows: any[] = [];
  const missingRecipes: string[] = [];
  const pushRecipe = (productRef: string, variantKey: string | null, lines: Line[], note?: string) => {
    const id = randomUUID();
    recipeRows.push({ id, tenantRef, productRef, variantKey, note: note ?? null });
    for (const [k, qty, unit] of lines) {
      recipeLineRows.push({ id: randomUUID(), recipeId: id, ingredientId: ing(k), qty: String(qty), unit });
    }
  };

  for (const p of products) {
    const keyName = `${catName.get(p.categoryId.toString())}|${p.name}`;
    const spec = RECIPES[keyName];
    if (!spec) {
      missingRecipes.push(keyName);
      continue;
    }
    if (spec.variants) {
      for (const [variantKey, lines] of Object.entries(spec.variants)) {
        pushRecipe(p._id.toString(), variantKey, lines, spec.note);
      }
      // garde-fou : chaque variante Mongo doit avoir sa recette
      for (const v of p.variants ?? []) {
        if (!spec.variants[v.key]) missingRecipes.push(`${keyName} [variante ${v.key}]`);
      }
    } else if (spec.base) {
      pushRecipe(p._id.toString(), null, spec.base, spec.note);
    }
  }

  if (missingRecipes.length > 0) {
    console.error(`✗ ${missingRecipes.length} produit(s)/variante(s) SANS recette :`);
    for (const m of missingRecipes) console.error(`   - ${m}`);
    await pool.end();
    process.exit(1);
  }
  await bulkInsert(db, recipes, recipeRows);
  await bulkInsert(db, recipeLines, recipeLineRows);

  // ── 4. Nomenclature des options (d'après les groupes réels des produits Mongo) ──
  const optionRows: any[] = [];
  const uncoveredChoices: string[] = [];
  for (const p of products) {
    const keyName = `${catName.get(p.categoryId.toString())}|${p.name}`;
    for (const g of p.optionGroups ?? []) {
      // Groupe RÉSERVÉ, projeté par l'API depuis la recette et le catalogue :
      // il n'a pas de nomenclature à saisir, et son contenu est optionnel — lui
      // en donner une propagerait à tort la rupture d'un supplément à tous les
      // produits qui le proposent.
      if (g.key === SUPPLEMENT_GROUP_KEY) continue;
      for (const c of g.choices ?? []) {
        const lines = optionLinesFor(keyName, g.key, c.key);
        if (!lines) {
          uncoveredChoices.push(`${keyName} · ${g.key} / ${c.key}`);
          continue;
        }
        for (const [k, qty, unit] of lines) {
          optionRows.push({
            id: randomUUID(),
            tenantRef,
            productRef: p._id.toString(),
            groupKey: g.key,
            choiceKey: c.key,
            ingredientId: ing(k),
            qty: String(qty),
            unit,
          });
        }
      }
    }
  }
  if (uncoveredChoices.length > 0) {
    console.error(`✗ ${uncoveredChoices.length} choix d'option sans nomenclature :`);
    for (const u of uncoveredChoices) console.error(`   - ${u}`);
    await pool.end();
    process.exit(1);
  }
  await bulkInsert(db, optionIngredients, optionRows);

  // ── 5. Fournisseurs, marques, catalogue, historique de prix ──
  const supplierId = new Map<string, string>();
  await bulkInsert(
    db,
    suppliers,
    SUPPLIER_DEFS.map((s) => {
      const id = randomUUID();
      supplierId.set(s.key, id);
      return {
        id,
        tenantRef,
        name: s.name,
        contactName: s.contactName,
        phone: s.phone,
        email: s.email,
        paymentTerms: s.paymentTerms,
        deliveryDays: s.deliveryDays,
        notes: s.notes ?? null,
        active: true,
      };
    }),
  );

  const brandId = new Map<string, string>();
  await bulkInsert(
    db,
    ingredientBrands,
    BRAND_DEFS.map((b) => {
      const id = randomUUID();
      brandId.set(`${b.ing}|${b.name}`, id);
      return {
        id,
        ingredientId: ing(b.ing),
        name: b.name,
        preferred: b.preferred ?? false,
        notes: b.notes ?? null,
      };
    }),
  );

  const itemIdBySku = new Map<string, string>();
  await bulkInsert(
    db,
    supplierItems,
    ITEM_DEFS.map((it) => {
      const id = randomUUID();
      itemIdBySku.set(it.sku, id);
      return {
        id,
        supplierId: supplierId.get(it.supplier)!,
        ingredientId: ing(it.ing),
        brandId: it.brand ? (brandId.get(`${it.ing}|${it.brand}`) ?? null) : null,
        sku: it.sku,
        packQty: String(it.packQty),
        packPriceCents: it.packPriceCents,
        active: true,
      };
    }),
  );

  await bulkInsert(
    db,
    supplierPriceHistory,
    PRICE_HISTORY_DEFS.map((h) => ({
      id: randomUUID(),
      supplierItemId: itemIdBySku.get(h.sku)!,
      packPriceCents: h.priceCents,
      recordedAt: h.recordedAt,
    })),
  );

  // ── Contrôle final : chaque produit Mongo a au moins une recette ──
  const covered = new Set(recipeRows.map((r) => r.productRef));
  const withoutRecipe = products.filter((p) => !covered.has(p._id.toString()));
  if (withoutRecipe.length > 0) {
    console.error(`✗ ${withoutRecipe.length} produit(s) Mongo sans recette :`);
    for (const p of withoutRecipe) console.error(`   - ${p.name}`);
    await pool.end();
    process.exit(1);
  }

  const underParCount = Object.keys(UNDER_PAR).length;
  console.log('✓ Seed supply — récapitulatif');
  console.log(`  Ingrédients : ${canonicalRows.length} canoniques + ${forkRows.length} fork classfood`);
  console.log(`    dont ${underParCount} sous le par (${Object.keys(UNDER_PAR).join(', ')}) et 1 à zéro (reblochon, isOut=false)`);
  const removableCount = INGREDIENT_DEFS.filter(isRemovable).length;
  const suppCount = INGREDIENT_DEFS.filter((d) => SUPPLEMENT_PRICES[d.key] != null).length;
  console.log(
    `  Modificateurs : ${removableCount} ingrédients retirables · ${suppCount} suppléments payants (0,80 € → 2,00 €) · ${Object.keys(DISPLAY_NAMES).length} libellés courts`,
  );
  console.log(`  Recettes : ${recipeRows.length} (${recipeLineRows.length} lignes) — ${covered.size}/${products.length} produits couverts`);
  console.log(`  Options : ${optionRows.length} lignes de nomenclature (sauces, viandes, pain, suppléments, garnitures…)`);
  console.log(`  Fournisseurs : ${SUPPLIER_DEFS.length} · références : ${ITEM_DEFS.length} · marques : ${BRAND_DEFS.length} · historique prix : ${PRICE_HISTORY_DEFS.length}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});



