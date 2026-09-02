import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type AnyBulkWriteOperation } from 'mongoose';
import Redis from 'ioredis';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  ALLERGENS,
  ingredientBrands,
  ingredients,
  lineCostCents,
  optionIngredients,
  recipeLines,
  recipes,
  stockMovements,
  supplierItems,
  supplierPriceHistory,
  suppliers,
  type SupplyDb,
} from '@sm/supply';
import {
  isRemovableByDefault,
  ordersChannel,
  SUPPLEMENT_GROUP_KEY,
  SUPPLEMENT_GROUP_NAME,
  WS_EVENTS,
  type ProductModifiers,
} from '@sm/contracts';
import type {
  BomPut,
  BrandCreate,
  BrandUpdate,
  IngredientCategory,
  IngredientCreate,
  IngredientUpdate,
  MovementCreate,
  OptionBomPut,
  RecipeLineInput,
  SupplierCreate,
  SupplierItemCreate,
  SupplierItemUpdate,
  SupplierUpdate,
} from '@sm/contracts';
import type { Product } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { SUPPLY_DB } from '../../supply-db.module';
import { buildProductModifiers, modifierKey, type ModifierIngredient } from './menu-modifiers';

type IngredientRow = typeof ingredients.$inferSelect;

/** Produit Mongo réduit à ce dont dépendent les modificateurs. */
export interface ProductForModifiers {
  _id: unknown;
  removables?: readonly string[] | null;
  optionGroups?: readonly {
    key?: string | null;
    choices?: readonly { key?: string | null; name?: string | null; priceDelta?: number | null }[] | null;
  }[] | null;
}

/** Ligne (recette ou option) hydratée avec son ingrédient. */
interface LineWithIngredient {
  ingredientId: string;
  qty: string;
  unit: 'g' | 'kg' | 'ml' | 'l' | 'pcs';
  ingredient: IngredientRow;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Violation d'unicité PostgreSQL (23505), éventuellement enveloppée par drizzle. */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/** INSERT/UPDATE … RETURNING renvoie toujours une ligne — garde-fou pour tsc. */
function mustRow<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('RETURNING sans ligne — état inattendu');
  return row;
}

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
/** numeric(12,3) — évite les flottants baladeurs dans les stocks. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Pourcentage arrondi à 1 décimale. */
const pct1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class SupplyService {
  private readonly logger = new Logger(SupplyService.name);

  constructor(
    @Inject(SUPPLY_DB) private readonly db: SupplyDb,
    @InjectModel('Product') private readonly products: Model<Product>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  private publishMenuUpdated(tenantId: string, meta: Record<string, unknown>) {
    void publishRedisBestEffort(
      this.redis,
      ordersChannel(tenantId),
      JSON.stringify({ event: WS_EVENTS.menuUpdated, payload: meta }),
    );
  }

  private assertUuid(id: string) {
    if (!UUID_RE.test(id)) throw new BadRequestException('Identifiant invalide');
  }

  private mapIngredient<T extends { currentStock: string | number; parLevel: string | number }>(
    row: T,
  ) {
    const currentStock = num(row.currentStock);
    const parLevel = num(row.parLevel);
    return { ...row, currentStock, parLevel, belowPar: currentStock < parLevel };
  }

  // ─────────────────────────────────────────────────────────────
  // Ingrédients
  // ─────────────────────────────────────────────────────────────

  async listIngredients(tenantId: string, q?: string, category?: IngredientCategory) {
    const rows = await this.db.query.ingredients.findMany({
      where: (t, { and: andOp, eq: eqOp, ilike }) =>
        andOp(
          eqOp(t.tenantRef, tenantId),
          eqOp(t.active, true),
          q ? ilike(t.name, `%${q}%`) : undefined,
          category ? eqOp(t.category, category) : undefined,
        ),
      with: { brands: true },
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    return rows.map((r) => this.mapIngredient(r));
  }

  async createIngredient(tenantId: string, dto: IngredientCreate) {
    try {
      const [row] = await this.db
        .insert(ingredients)
        .values({
          tenantRef: tenantId,
          name: dto.name,
          category: dto.category,
          unit: dto.unit,
          allergens: dto.allergens,
          costPerUnitCents: dto.costPerUnitCents,
          currentStock: String(round3(dto.currentStock)),
          parLevel: String(round3(dto.parLevel)),
          storage: dto.storage,
          // Non transmis : la catégorie décide (crudités, fromages et sauces
          // sont retirables ; pain, viande principale et emballage non).
          removable: dto.removable ?? isRemovableByDefault(dto.category),
          supplementPriceCents: dto.supplementPriceCents ?? null,
          displayName: dto.displayName ?? null,
        })
        .returning();
      // Nouveau supplément tarifé : il rejoint la caisse tout de suite.
      if (dto.supplementPriceCents != null) await this.refreshSupplementProjection(tenantId);
      return this.mapIngredient({ ...mustRow(row), brands: [] });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Un ingrédient porte déjà ce nom');
      throw err;
    }
  }

  async updateIngredient(tenantId: string, id: string, dto: IngredientUpdate) {
    this.assertUuid(id);
    const patch: Partial<typeof ingredients.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.unit !== undefined) patch.unit = dto.unit;
    if (dto.allergens !== undefined) patch.allergens = dto.allergens;
    // Changement de coût sans historique : l'historique de prix vit côté fournisseur.
    if (dto.costPerUnitCents !== undefined) patch.costPerUnitCents = dto.costPerUnitCents;
    if (dto.currentStock !== undefined) patch.currentStock = String(round3(dto.currentStock));
    if (dto.parLevel !== undefined) patch.parLevel = String(round3(dto.parLevel));
    if (dto.storage !== undefined) patch.storage = dto.storage;
    if (dto.removable !== undefined) patch.removable = dto.removable;
    if (dto.supplementPriceCents !== undefined) patch.supplementPriceCents = dto.supplementPriceCents;
    if (dto.displayName !== undefined) patch.displayName = dto.displayName;

    try {
      const [row] = await this.db
        .update(ingredients)
        .set(patch)
        .where(and(eq(ingredients.id, id), eq(ingredients.tenantRef, tenantId)))
        .returning();
      if (!row) throw new NotFoundException('Ingrédient introuvable');
      const brands = await this.db.query.ingredientBrands.findMany({
        where: (t, { eq: eqOp }) => eqOp(t.ingredientId, id),
      });
      // Tarif, libellé ou retrait modifiés : la carte de la caisse suit sans
      // attendre la prochaine lecture de menu.
      if (
        dto.removable !== undefined ||
        dto.supplementPriceCents !== undefined ||
        dto.displayName !== undefined ||
        dto.name !== undefined ||
        dto.category !== undefined
      ) {
        await this.refreshSupplementProjection(tenantId);
        this.publishMenuUpdated(tenantId, { scope: 'supply', ingredientId: id });
      }
      return this.mapIngredient({ ...row, brands });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Un ingrédient porte déjà ce nom');
      throw err;
    }
  }

  /** Suppression douce : l'ingrédient reste référencé par les recettes et l'historique. */
  async deleteIngredient(tenantId: string, id: string) {
    this.assertUuid(id);
    const [row] = await this.db
      .update(ingredients)
      .set({ active: false, updatedAt: new Date() })
      .where(and(eq(ingredients.id, id), eq(ingredients.tenantRef, tenantId)))
      .returning({ id: ingredients.id, supplementPriceCents: ingredients.supplementPriceCents });
    if (!row) throw new NotFoundException('Ingrédient introuvable');
    // Un ingrédient retiré du catalogue ne doit plus être encaissable.
    if (row.supplementPriceCents !== null) await this.refreshSupplementProjection(tenantId);
    return { deleted: true };
  }

  /**
   * Cascade de rupture. isOut=true → tous les produits Mongo dont une ligne de
   * recette OU une nomenclature d'option exige cet ingrédient passent en
   * rupture (source 'ingredient' ; les ruptures manuelles restent intactes).
   * isOut=false → seuls les produits en rupture source 'ingredient' dont plus
   * AUCUN ingrédient requis n'est en rupture sont réactivés.
   */
  async setIngredientOut(tenantId: string, id: string, isOut: boolean) {
    this.assertUuid(id);
    const [ing] = await this.db
      .update(ingredients)
      .set({ isOut, updatedAt: new Date() })
      .where(and(eq(ingredients.id, id), eq(ingredients.tenantRef, tenantId)))
      .returning();
    if (!ing) throw new NotFoundException('Ingrédient introuvable');

    let productsUpdated = 0;
    if (isOut) {
      const refs = [...(await this.productsRequiringIngredients(tenantId, [id]))].filter((r) =>
        Types.ObjectId.isValid(r),
      );
      if (refs.length) {
        // outOfStock=false uniquement : une rupture 'manual' déjà posée reste intacte.
        const res = await this.products.updateMany(
          { tenantId, _id: { $in: refs }, outOfStock: false },
          { $set: { outOfStock: true, outOfStockSource: 'ingredient' } },
        );
        productsUpdated = res.modifiedCount;
      }
    } else {
      const stillOut = await this.db
        .select({ id: ingredients.id })
        .from(ingredients)
        .where(and(eq(ingredients.tenantRef, tenantId), eq(ingredients.isOut, true)));
      const blocked = [
        ...(await this.productsRequiringIngredients(
          tenantId,
          stillOut.map((r) => r.id),
        )),
      ].filter((r) => Types.ObjectId.isValid(r));
      const res = await this.products.updateMany(
        {
          tenantId,
          outOfStock: true,
          outOfStockSource: 'ingredient',
          ...(blocked.length ? { _id: { $nin: blocked } } : {}),
        },
        { $set: { outOfStock: false, outOfStockSource: null } },
      );
      productsUpdated = res.modifiedCount;
    }

    // Un supplément en rupture disparaît de la caisse ; il y revient au retour
    // du produit — sans quoi on encaisserait un cheddar qu'on n'a plus.
    if (ing.supplementPriceCents !== null) await this.refreshSupplementProjection(tenantId);

    this.publishMenuUpdated(tenantId, { scope: 'supply', ingredientId: id, isOut, productsUpdated });
    return { ingredient: this.mapIngredient({ ...ing }), productsUpdated };
  }

  /** productRef distincts du tenant dont une recette ou une option exige un de ces ingrédients. */
  private async productsRequiringIngredients(
    tenantId: string,
    ingredientIds: string[],
  ): Promise<Set<string>> {
    if (!ingredientIds.length) return new Set();
    const [fromRecipes, fromOptions] = await Promise.all([
      this.db
        .select({ productRef: recipes.productRef })
        .from(recipeLines)
        .innerJoin(recipes, eq(recipeLines.recipeId, recipes.id))
        .where(and(eq(recipes.tenantRef, tenantId), inArray(recipeLines.ingredientId, ingredientIds))),
      this.db
        .select({ productRef: optionIngredients.productRef })
        .from(optionIngredients)
        .where(
          and(
            eq(optionIngredients.tenantRef, tenantId),
            inArray(optionIngredients.ingredientId, ingredientIds),
          ),
        ),
    ]);
    return new Set([...fromRecipes, ...fromOptions].map((r) => r.productRef));
  }

  // ─────────────────────────────────────────────────────────────
  // Marques
  // ─────────────────────────────────────────────────────────────

  private async ingredientForTenant(tenantId: string, id: string) {
    this.assertUuid(id);
    const [row] = await this.db
      .select()
      .from(ingredients)
      .where(and(eq(ingredients.id, id), eq(ingredients.tenantRef, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Ingrédient introuvable');
    return row;
  }

  private async brandForTenant(tenantId: string, brandId: string) {
    this.assertUuid(brandId);
    const [row] = await this.db
      .select({ brand: ingredientBrands })
      .from(ingredientBrands)
      .innerJoin(ingredients, eq(ingredientBrands.ingredientId, ingredients.id))
      .where(and(eq(ingredientBrands.id, brandId), eq(ingredients.tenantRef, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Marque introuvable');
    return row.brand;
  }

  async addBrand(tenantId: string, ingredientId: string, dto: BrandCreate) {
    const ing = await this.ingredientForTenant(tenantId, ingredientId);
    if (dto.preferred) {
      await this.db
        .update(ingredientBrands)
        .set({ preferred: false })
        .where(eq(ingredientBrands.ingredientId, ing.id));
    }
    const [brand] = await this.db
      .insert(ingredientBrands)
      .values({
        ingredientId: ing.id,
        name: dto.name,
        preferred: dto.preferred,
        notes: dto.notes ?? null,
      })
      .returning();
    return brand;
  }

  async updateBrand(tenantId: string, brandId: string, dto: BrandUpdate) {
    const brand = await this.brandForTenant(tenantId, brandId);
    if (dto.preferred === true) {
      await this.db
        .update(ingredientBrands)
        .set({ preferred: false })
        .where(eq(ingredientBrands.ingredientId, brand.ingredientId));
    }
    const patch: Partial<typeof ingredientBrands.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.preferred !== undefined) patch.preferred = dto.preferred;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (!Object.keys(patch).length) return brand;
    const [row] = await this.db
      .update(ingredientBrands)
      .set(patch)
      .where(eq(ingredientBrands.id, brand.id))
      .returning();
    return row;
  }

  async deleteBrand(tenantId: string, brandId: string) {
    const brand = await this.brandForTenant(tenantId, brandId);
    await this.db.delete(ingredientBrands).where(eq(ingredientBrands.id, brand.id));
    return { deleted: true };
  }

  // ─────────────────────────────────────────────────────────────
  // Fournisseurs & catalogue
  // ─────────────────────────────────────────────────────────────

  private mapItem(it: {
    packQty: string | number;
    ingredient?: IngredientRow | null;
    brand?: { id: string; name: string } | null;
    [k: string]: unknown;
  }) {
    return {
      ...it,
      packQty: num(it.packQty),
      ingredient: it.ingredient
        ? { id: it.ingredient.id, name: it.ingredient.name, unit: it.ingredient.unit }
        : null,
      brand: it.brand ? { id: it.brand.id, name: it.brand.name } : null,
    };
  }

  async listSuppliers(tenantId: string) {
    const rows = await this.db.query.suppliers.findMany({
      where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.tenantRef, tenantId), eqOp(t.active, true)),
      with: { items: { with: { ingredient: true, brand: true } } },
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    return rows.map((s) => ({ ...s, items: s.items.map((it) => this.mapItem(it)) }));
  }

  async createSupplier(tenantId: string, dto: SupplierCreate) {
    const [row] = await this.db
      .insert(suppliers)
      .values({
        tenantRef: tenantId,
        name: dto.name,
        contactName: dto.contactName ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        paymentTerms: dto.paymentTerms ?? null,
        deliveryDays: dto.deliveryDays ?? null,
        notes: dto.notes ?? null,
      })
      .returning();
    return { ...mustRow(row), items: [] };
  }

  async updateSupplier(tenantId: string, id: string, dto: SupplierUpdate) {
    this.assertUuid(id);
    const patch: Partial<typeof suppliers.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.contactName !== undefined) patch.contactName = dto.contactName;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.paymentTerms !== undefined) patch.paymentTerms = dto.paymentTerms;
    if (dto.deliveryDays !== undefined) patch.deliveryDays = dto.deliveryDays;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.active !== undefined) patch.active = dto.active;
    const [row] = await this.db
      .update(suppliers)
      .set(patch)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantRef, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Fournisseur introuvable');
    return row;
  }

  /** Suppression douce : le catalogue et l'historique de prix restent consultables. */
  async deleteSupplier(tenantId: string, id: string) {
    this.assertUuid(id);
    const [row] = await this.db
      .update(suppliers)
      .set({ active: false })
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantRef, tenantId)))
      .returning({ id: suppliers.id });
    if (!row) throw new NotFoundException('Fournisseur introuvable');
    return { deleted: true };
  }

  private async supplierForTenant(tenantId: string, id: string) {
    this.assertUuid(id);
    const [row] = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), eq(suppliers.tenantRef, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Fournisseur introuvable');
    return row;
  }

  private async brandOfIngredient(brandId: string, ingredientId: string) {
    const [row] = await this.db
      .select({ id: ingredientBrands.id })
      .from(ingredientBrands)
      .where(and(eq(ingredientBrands.id, brandId), eq(ingredientBrands.ingredientId, ingredientId)))
      .limit(1);
    if (!row) throw new BadRequestException('Marque inconnue pour cet ingrédient');
  }

  async addSupplierItem(tenantId: string, supplierId: string, dto: SupplierItemCreate) {
    const supplier = await this.supplierForTenant(tenantId, supplierId);
    const ing = await this.ingredientForTenant(tenantId, dto.ingredientId);
    if (dto.brandId) await this.brandOfIngredient(dto.brandId, ing.id);
    const [row] = await this.db
      .insert(supplierItems)
      .values({
        supplierId: supplier.id,
        ingredientId: ing.id,
        brandId: dto.brandId ?? null,
        sku: dto.sku ?? null,
        packQty: String(dto.packQty),
        packPriceCents: dto.packPriceCents,
      })
      .returning();
    const created = mustRow(row);
    return { ...created, packQty: num(created.packQty) };
  }

  private async itemForTenant(tenantId: string, itemId: string) {
    this.assertUuid(itemId);
    const [row] = await this.db
      .select({ item: supplierItems })
      .from(supplierItems)
      .innerJoin(suppliers, eq(supplierItems.supplierId, suppliers.id))
      .where(and(eq(supplierItems.id, itemId), eq(suppliers.tenantRef, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Référence fournisseur introuvable');
    return row.item;
  }

  async updateSupplierItem(tenantId: string, itemId: string, dto: SupplierItemUpdate) {
    const item = await this.itemForTenant(tenantId, itemId);
    if (dto.brandId) await this.brandOfIngredient(dto.brandId, item.ingredientId);
    return this.db.transaction(async (tx) => {
      // Historise l'ANCIEN prix avant la mise à jour (l'alerte hausse de prix
      // compare le prix courant au dernier prix historisé).
      if (dto.packPriceCents !== undefined && dto.packPriceCents !== item.packPriceCents) {
        await tx
          .insert(supplierPriceHistory)
          .values({ supplierItemId: item.id, packPriceCents: item.packPriceCents });
      }
      const patch: Partial<typeof supplierItems.$inferInsert> = { updatedAt: new Date() };
      if (dto.brandId !== undefined) patch.brandId = dto.brandId;
      if (dto.sku !== undefined) patch.sku = dto.sku;
      if (dto.packQty !== undefined) patch.packQty = String(dto.packQty);
      if (dto.packPriceCents !== undefined) patch.packPriceCents = dto.packPriceCents;
      if (dto.active !== undefined) patch.active = dto.active;
      const [row] = await tx
        .update(supplierItems)
        .set(patch)
        .where(eq(supplierItems.id, item.id))
        .returning();
      const updated = mustRow(row);
      return { ...updated, packQty: num(updated.packQty) };
    });
  }

  async priceHistory(tenantId: string, itemId: string) {
    const item = await this.itemForTenant(tenantId, itemId);
    const history = await this.db.query.supplierPriceHistory.findMany({
      where: (t, { eq: eqOp }) => eqOp(t.supplierItemId, item.id),
      orderBy: (t, { desc: descOp }) => [descOp(t.recordedAt)],
    });
    return {
      current: { packPriceCents: item.packPriceCents, updatedAt: item.updatedAt },
      history,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Recettes / BOM & coût matière
  // ─────────────────────────────────────────────────────────────

  private async productForTenant(tenantId: string, productRef: string) {
    if (!Types.ObjectId.isValid(productRef)) {
      throw new BadRequestException('Référence produit invalide');
    }
    const prod = await this.products.findOne({ _id: productRef, tenantId }).lean();
    if (!prod) throw new NotFoundException('Produit introuvable');
    return prod;
  }

  private marginEntry(priceCents: number, costCents: number) {
    return {
      priceCents,
      costCents,
      marginCents: priceCents - costCents,
      marginPct: priceCents > 0 ? pct1(((priceCents - costCents) / priceCents) * 100) : 0,
    };
  }

  async bom(tenantId: string, productRef: string) {
    const product = await this.productForTenant(tenantId, productRef);
    const [recs, opts] = await Promise.all([
      this.db.query.recipes.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantRef, tenantId), eqOp(t.productRef, productRef)),
        with: { lines: { with: { ingredient: true } } },
      }),
      this.db.query.optionIngredients.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantRef, tenantId), eqOp(t.productRef, productRef)),
        with: { ingredient: true },
      }),
    ]);

    const allergenSet = new Set<string>();
    const mapLine = (l: LineWithIngredient) => {
      for (const a of l.ingredient.allergens) allergenSet.add(a);
      return {
        ingredientId: l.ingredientId,
        name: l.ingredient.name,
        qty: num(l.qty),
        unit: l.unit,
        costCents: lineCostCents(num(l.qty), l.unit, l.ingredient.costPerUnitCents),
        allergens: l.ingredient.allergens,
        isOut: l.ingredient.isOut,
      };
    };

    const costByVariant: Record<string, number> = {};
    const recipesOut = recs.map((r) => {
      const lines = r.lines.map(mapLine);
      const costCents = lines.reduce((s, l) => s + l.costCents, 0);
      costByVariant[r.variantKey ?? 'base'] = costCents;
      return { variantKey: r.variantKey, lines, costCents };
    });

    const options = opts.map((o) => ({
      groupKey: o.groupKey,
      choiceKey: o.choiceKey,
      ...mapLine(o),
    }));

    // Coût de chaque choix d'option (un choix peut consommer plusieurs ingrédients).
    const costByChoice = new Map<string, Map<string, number>>();
    for (const o of options) {
      const group = costByChoice.get(o.groupKey) ?? new Map<string, number>();
      group.set(o.choiceKey, (group.get(o.choiceKey) ?? 0) + o.costCents);
      costByChoice.set(o.groupKey, group);
    }

    /**
     * Coût des options OBLIGATOIRES d'une variante.
     *
     * Sans cela le food cost est faux : un tacos M sans sa viande imposée
     * afficherait 90 % de marge. Pour chaque groupe dont le minimum effectif
     * est ≥ 1 (le minimum peut dépendre de la taille via `perVariant`), on
     * facture les choix imposés — `typical` prend le coût moyen des choix
     * (le client choisit librement), `min`/`max` bornent la fourchette.
     */
    const requiredOptionsCost = (variantKey: string | null) => {
      let typical = 0;
      let min = 0;
      let max = 0;
      for (const group of product.optionGroups ?? []) {
        const rules =
          variantKey && group.perVariant
            ? (group.perVariant as Record<string, { min?: number }>)[variantKey]
            : undefined;
        const minCount = rules?.min ?? group.min ?? 0;
        if (minCount <= 0) continue;
        const costs = [...(costByChoice.get(group.key)?.values() ?? [])];
        if (costs.length === 0) continue; // nomenclature non définie pour ce groupe
        const avg = costs.reduce((s, c) => s + c, 0) / costs.length;
        const asc = [...costs].sort((a, b) => a - b);
        const pick = (arr: number[]) =>
          Array.from({ length: minCount }, (_, i) => arr[Math.min(i, arr.length - 1)] ?? 0).reduce(
            (s, c) => s + c,
            0,
          );
        typical += Math.round(avg * minCount);
        min += pick(asc);
        max += pick([...asc].reverse());
      }
      return { typical, min, max };
    };

    // Marges vs prix Mongo — variante sans recette propre : repli sur la recette de base.
    const recipeCostFor = (key: string) => costByVariant[key] ?? costByVariant['base'] ?? 0;
    const marginByVariant: Record<string, ReturnType<SupplyService['marginEntry']>> = {};
    const costBreakdownByVariant: Record<
      string,
      { recipeCents: number; requiredOptionsCents: number; totalCents: number; minCents: number; maxCents: number }
    > = {};
    const totalCostByVariant: Record<string, number> = {};

    const computeFor = (key: string, variantKey: string | null, priceCents: number) => {
      const recipeCents = recipeCostFor(key);
      const req = requiredOptionsCost(variantKey);
      const totalCents = recipeCents + req.typical;
      totalCostByVariant[key] = totalCents;
      costBreakdownByVariant[key] = {
        recipeCents,
        requiredOptionsCents: req.typical,
        totalCents,
        minCents: recipeCents + req.min,
        maxCents: recipeCents + req.max,
      };
      marginByVariant[key] = this.marginEntry(priceCents, totalCents);
    };

    if (product.variants?.length) {
      for (const v of product.variants) computeFor(v.key, v.key, v.price);
    } else {
      computeFor('base', null, product.price ?? 0);
    }

    return {
      recipes: recipesOut,
      options,
      /** Coût matière complet (recette + options imposées) — base des marges. */
      costByVariant: totalCostByVariant,
      /** Détail recette / options imposées + fourchette selon les choix du client. */
      costBreakdownByVariant,
      /** Coût de la seule recette, hors options imposées. */
      recipeCostByVariant: costByVariant,
      /** Rollup recette ∪ options, dans l'ordre réglementaire INCO. */
      allergens: ALLERGENS.filter((a) => allergenSet.has(a)),
      marginByVariant,
    };
  }

  private assertNoDuplicateLines(lines: RecipeLineInput[]) {
    if (new Set(lines.map((l) => l.ingredientId)).size !== lines.length) {
      throw new BadRequestException('Ingrédient en double dans les lignes');
    }
  }

  private async ingredientsForTenant(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, IngredientRow>();
    const rows = await this.db
      .select()
      .from(ingredients)
      .where(
        and(
          eq(ingredients.tenantRef, tenantId),
          eq(ingredients.active, true),
          inArray(ingredients.id, unique),
        ),
      );
    if (rows.length !== unique.length) {
      throw new BadRequestException('Ingrédient inconnu, inactif ou hors restaurant');
    }
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** Remplace la recette de la portée (variantKey null = base). `lines: []` la supprime. */
  async putBom(tenantId: string, productRef: string, dto: BomPut) {
    await this.productForTenant(tenantId, productRef);
    this.assertNoDuplicateLines(dto.lines);
    const ingredientById = await this.ingredientsForTenant(
      tenantId,
      dto.lines.map((l) => l.ingredientId),
    );
    const scope = and(
      eq(recipes.tenantRef, tenantId),
      eq(recipes.productRef, productRef),
      dto.variantKey === null ? isNull(recipes.variantKey) : eq(recipes.variantKey, dto.variantKey),
    );

    const result = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(recipes).where(scope).limit(1);
      if (!dto.lines.length) {
        if (existing) await tx.delete(recipes).where(eq(recipes.id, existing.id));
        return { variantKey: dto.variantKey, lines: [], costCents: 0, deleted: !!existing };
      }
      let recipeId: string;
      if (existing) {
        recipeId = existing.id;
        await tx.update(recipes).set({ updatedAt: new Date() }).where(eq(recipes.id, recipeId));
        await tx.delete(recipeLines).where(eq(recipeLines.recipeId, recipeId));
      } else {
        const [created] = await tx
          .insert(recipes)
          .values({ tenantRef: tenantId, productRef, variantKey: dto.variantKey })
          .returning();
        recipeId = mustRow(created).id;
      }
      await tx.insert(recipeLines).values(
        dto.lines.map((l) => ({
          recipeId,
          ingredientId: l.ingredientId,
          qty: String(l.qty),
          unit: l.unit,
        })),
      );
      const lines = dto.lines.map((l) => {
        const ing = ingredientById.get(l.ingredientId)!;
        return {
          ingredientId: l.ingredientId,
          name: ing.name,
          qty: l.qty,
          unit: l.unit,
          costCents: lineCostCents(l.qty, l.unit, ing.costPerUnitCents),
          allergens: ing.allergens,
          isOut: ing.isOut,
        };
      });
      return {
        variantKey: dto.variantKey,
        lines,
        costCents: lines.reduce((s, l) => s + l.costCents, 0),
      };
    });

    // La recette vient de changer : « sans tomate » et les suppléments encore
    // proposables suivent immédiatement, à la caisse comme en ligne.
    await this.refreshSupplementProjection(tenantId, [productRef]);
    this.publishMenuUpdated(tenantId, { scope: 'supply', productRef });
    return result;
  }

  /** Remplace la nomenclature d'un choix d'option. `lines: []` la supprime. */
  async putOptionBom(tenantId: string, productRef: string, dto: OptionBomPut) {
    await this.productForTenant(tenantId, productRef);
    this.assertNoDuplicateLines(dto.lines);
    const ingredientById = await this.ingredientsForTenant(
      tenantId,
      dto.lines.map((l) => l.ingredientId),
    );
    return this.db.transaction(async (tx) => {
      await tx
        .delete(optionIngredients)
        .where(
          and(
            eq(optionIngredients.tenantRef, tenantId),
            eq(optionIngredients.productRef, productRef),
            eq(optionIngredients.groupKey, dto.groupKey),
            eq(optionIngredients.choiceKey, dto.choiceKey),
          ),
        );
      if (dto.lines.length) {
        await tx.insert(optionIngredients).values(
          dto.lines.map((l) => ({
            tenantRef: tenantId,
            productRef,
            groupKey: dto.groupKey,
            choiceKey: dto.choiceKey,
            ingredientId: l.ingredientId,
            qty: String(l.qty),
            unit: l.unit,
          })),
        );
      }
      const lines = dto.lines.map((l) => {
        const ing = ingredientById.get(l.ingredientId)!;
        return {
          ingredientId: l.ingredientId,
          name: ing.name,
          qty: l.qty,
          unit: l.unit,
          costCents: lineCostCents(l.qty, l.unit, ing.costPerUnitCents),
          allergens: ing.allergens,
          isOut: ing.isOut,
        };
      });
      return {
        groupKey: dto.groupKey,
        choiceKey: dto.choiceKey,
        lines,
        costCents: lines.reduce((s, l) => s + l.costCents, 0),
      };
    });
  }

  /** Batch pour la vue Menu : coût de la variante la moins chère (ou base) + marge. */
  async costs(tenantId: string, refs: string[]) {
    const validRefs = [...new Set(refs)].filter((r) => Types.ObjectId.isValid(r));
    if (!validRefs.length) return {};
    const [recs, prods] = await Promise.all([
      this.db.query.recipes.findMany({
        where: (t, { and: andOp, eq: eqOp, inArray: inOp }) =>
          andOp(eqOp(t.tenantRef, tenantId), inOp(t.productRef, validRefs)),
        with: { lines: { with: { ingredient: true } } },
      }),
      this.products.find({ tenantId, _id: { $in: validRefs } }).lean(),
    ]);
    const prodByRef = new Map(prods.map((p) => [String(p._id), p]));

    const out: Record<string, { costCents: number; marginPct: number | null }> = {};
    const byRef = new Map<string, typeof recs>();
    for (const r of recs) {
      const list = byRef.get(r.productRef) ?? [];
      list.push(r);
      byRef.set(r.productRef, list);
    }
    for (const [ref, list] of byRef) {
      let best: { key: string; cost: number } | null = null;
      for (const r of list) {
        const cost = r.lines.reduce(
          (s, l) => s + lineCostCents(num(l.qty), l.unit, l.ingredient.costPerUnitCents),
          0,
        );
        const key = r.variantKey ?? 'base';
        if (!best || cost < best.cost) best = { key, cost };
      }
      if (!best) continue;
      const prod = prodByRef.get(ref);
      let priceCents: number | null = null;
      if (prod) {
        if (best.key !== 'base') {
          priceCents = prod.variants?.find((v) => v.key === best.key)?.price ?? null;
        }
        if (priceCents === null) {
          priceCents = prod.variants?.length
            ? Math.min(...prod.variants.map((v) => v.price))
            : (prod.price ?? 0);
        }
      }
      out[ref] = {
        costCents: best.cost,
        marginPct:
          priceCents && priceCents > 0 ? pct1(((priceCents - best.cost) / priceCents) * 100) : null,
      };
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // Modificateurs du menu — la RECETTE pilote la caisse
  // ─────────────────────────────────────────────────────────────

  /**
   * Blocs `removables` et `supplements` de chaque produit du menu.
   *
   * Mutualisé : deux lectures Postgres pour TOUT le menu (les lignes de recette
   * de tous les produits demandés, puis le catalogue des ingrédients tarifés du
   * restaurant), jamais une lecture par produit.
   *
   * Tolérant : si le contexte supply est indisponible (Postgres coupé, réseau),
   * le menu se sert quand même — chaque produit retombe sur ses `removables`
   * saisis en dur et se passe de suppléments.
   */
  async modifiersForMenu(
    tenantId: string,
    products: readonly ProductForModifiers[],
  ): Promise<Map<string, ProductModifiers>> {
    const refs = products.map((p) => String(p._id)).filter((r) => Types.ObjectId.isValid(r));
    const source = refs.length ? await this.readModifierSource(tenantId, refs) : null;

    const byRef = new Map<string, ProductModifiers>();
    for (const p of products) {
      const ref = String(p._id);
      byRef.set(
        ref,
        buildProductModifiers(
          source?.recipeByProduct.get(ref) ?? [],
          source?.catalog ?? [],
          (p.removables ?? []).map(String),
          this.choicesAlreadyOffered(p),
        ),
      );
    }

    // Le prix facturé se relit sur le produit Mongo à la création de commande :
    // la projection n'est tentée que sur des données Postgres fraîches.
    if (source) await this.projectSupplementGroups(tenantId, products, byRef);
    return byRef;
  }

  /**
   * Choix déjà vendus par les groupes d'options du gérant.
   *
   * Un produit qui propose déjà « supp. 1,00 € → Cheddar » à sa façon (le
   * « Compose ton Tacos ») ne doit pas voir le même cheddar réapparaître dans
   * les suppléments dérivés : la caisse l'afficherait deux fois.
   */
  private choicesAlreadyOffered(product: ProductForModifiers): string[] {
    const keys: string[] = [];
    for (const group of product.optionGroups ?? []) {
      if (!group || group.key === SUPPLEMENT_GROUP_KEY) continue;
      for (const choice of group.choices ?? []) {
        if (choice?.key) keys.push(choice.key);
        if (choice?.name) keys.push(modifierKey(choice.name));
      }
    }
    return keys;
  }

  /** Lecture mutualisée : recettes des produits demandés + catalogue des suppléments. */
  private async readModifierSource(
    tenantId: string,
    refs: string[],
  ): Promise<{ recipeByProduct: Map<string, ModifierIngredient[]>; catalog: ModifierIngredient[] } | null> {
    const columns = {
      ingredientId: ingredients.id,
      name: ingredients.name,
      displayName: ingredients.displayName,
      category: ingredients.category,
      removable: ingredients.removable,
      supplementPriceCents: ingredients.supplementPriceCents,
      isOut: ingredients.isOut,
    };
    try {
      const [lines, catalog] = await Promise.all([
        this.db
          .select({ productRef: recipes.productRef, ...columns })
          .from(recipeLines)
          .innerJoin(recipes, eq(recipeLines.recipeId, recipes.id))
          .innerJoin(ingredients, eq(recipeLines.ingredientId, ingredients.id))
          .where(and(eq(recipes.tenantRef, tenantId), inArray(recipes.productRef, refs))),
        this.db
          .select(columns)
          .from(ingredients)
          .where(
            and(
              eq(ingredients.tenantRef, tenantId),
              eq(ingredients.active, true),
              isNotNull(ingredients.supplementPriceCents),
            ),
          ),
      ]);

      // Un produit à variantes a plusieurs recettes : on retire les doublons
      // d'ingrédients, « sans tomate » vaut pour toutes les tailles.
      const recipeByProduct = new Map<string, ModifierIngredient[]>();
      const seen = new Set<string>();
      for (const { productRef, ...ing } of lines) {
        if (seen.has(`${productRef}|${ing.ingredientId}`)) continue;
        seen.add(`${productRef}|${ing.ingredientId}`);
        const list = recipeByProduct.get(productRef) ?? [];
        list.push(ing);
        recipeByProduct.set(productRef, list);
      }
      return { recipeByProduct, catalog };
    } catch (err) {
      this.logger.warn(
        `Modificateurs indisponibles (contexte supply) — menu servi sans suppléments : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Projette le groupe d'options RÉSERVÉ « supplements » sur les produits Mongo.
   *
   * C'est ce groupe qui fait autorité à la création de commande : la caisse
   * n'envoie qu'une clé de choix, le montant facturé est celui projeté ici
   * depuis PostgreSQL — jamais un prix venu de l'appareil. Le gérant ne le
   * saisit pas : il se régénère à chaque lecture de menu et après toute
   * évolution de recette ou de tarif.
   *
   * Écriture chirurgicale (`arrayFilters`, `$push`, `$pull`) et seulement pour
   * les produits dont le groupe a réellement changé : servir la carte
   * n'écrit rien tant qu'elle est à jour.
   */
  private async projectSupplementGroups(
    tenantId: string,
    products: readonly ProductForModifiers[],
    modifiers: Map<string, ProductModifiers>,
  ): Promise<number> {
    const tenantFilter = Types.ObjectId.isValid(tenantId) ? new Types.ObjectId(tenantId) : tenantId;
    const ops: AnyBulkWriteOperation<Product>[] = [];

    for (const p of products) {
      const ref = String(p._id);
      if (!Types.ObjectId.isValid(ref)) continue;
      const desired = modifiers.get(ref)?.supplements ?? [];
      const current = (p.optionGroups ?? []).find((g) => g?.key === SUPPLEMENT_GROUP_KEY);
      const _id = new Types.ObjectId(ref);

      if (desired.length === 0) {
        if (current) {
          ops.push({
            updateOne: {
              filter: { _id, tenantId: tenantFilter } as never,
              update: { $pull: { optionGroups: { key: SUPPLEMENT_GROUP_KEY } } } as never,
            },
          });
        }
        continue;
      }

      const choices = desired.map((s) => ({ key: s.key, name: s.label, priceDelta: s.priceCents }));
      const unchanged =
        current !== undefined &&
        (current.choices ?? []).length === choices.length &&
        choices.every((c, i) => {
          const existing = (current.choices ?? [])[i];
          return (
            existing?.key === c.key &&
            existing?.name === c.name &&
            (existing?.priceDelta ?? 0) === c.priceDelta
          );
        });
      if (unchanged) continue;

      const group = {
        key: SUPPLEMENT_GROUP_KEY,
        name: SUPPLEMENT_GROUP_NAME,
        type: 'multi',
        min: 0,
        max: null,
        choices,
        perVariant: null,
      };
      ops.push(
        current
          ? {
              updateOne: {
                filter: { _id, tenantId: tenantFilter } as never,
                update: { $set: { 'optionGroups.$[g]': group } } as never,
                arrayFilters: [{ 'g.key': SUPPLEMENT_GROUP_KEY }],
              },
            }
          : {
              updateOne: {
                filter: {
                  _id,
                  tenantId: tenantFilter,
                  'optionGroups.key': { $ne: SUPPLEMENT_GROUP_KEY },
                } as never,
                update: { $push: { optionGroups: group } } as never,
              },
            },
      );
    }

    if (!ops.length) return 0;
    try {
      const res = await this.products.bulkWrite(ops);
      return res.modifiedCount;
    } catch (err) {
      // Une projection ratée ne doit jamais empêcher de servir la carte.
      this.logger.warn(
        `Projection des suppléments impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /**
   * Recalcule la projection après une évolution de recette ou de tarif, sans
   * attendre la prochaine lecture de menu : le prix facturé suit le catalogue.
   */
  private async refreshSupplementProjection(tenantId: string, productRefs?: string[]): Promise<void> {
    try {
      const filter: Record<string, unknown> = { tenantId };
      if (productRefs?.length) {
        const valid = productRefs.filter((r) => Types.ObjectId.isValid(r));
        if (!valid.length) return;
        filter._id = { $in: valid };
      }
      const products = await this.products
        .find(filter, { removables: 1, optionGroups: 1 })
        .lean<ProductForModifiers[]>();
      if (products.length) await this.modifiersForMenu(tenantId, products);
    } catch (err) {
      this.logger.warn(
        `Rafraîchissement des suppléments impossible : ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Alertes
  // ─────────────────────────────────────────────────────────────

  async alerts(tenantId: string) {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const [ruptures, belowPar, tenantSuppliers] = await Promise.all([
      this.db.query.ingredients.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantRef, tenantId), eqOp(t.active, true), eqOp(t.isOut, true)),
        with: { brands: true },
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      this.db.query.ingredients.findMany({
        where: (t, { and: andOp, eq: eqOp, lt }) =>
          andOp(eqOp(t.tenantRef, tenantId), eqOp(t.active, true), lt(t.currentStock, t.parLevel)),
        with: { brands: true },
        orderBy: (t, { asc }) => [asc(t.name)],
      }),
      this.db.query.suppliers.findMany({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(eqOp(t.tenantRef, tenantId), eqOp(t.active, true)),
        with: {
          items: {
            with: {
              ingredient: true,
              priceHistory: { orderBy: (h, { desc: descOp }) => [descOp(h.recordedAt)], limit: 1 },
            },
          },
        },
      }),
    ]);

    // Hausse de prix : prix courant > dernier prix historisé, changement < 30 j.
    const priceIncreases: Array<Record<string, unknown> & { increasePct: number }> = [];
    for (const s of tenantSuppliers) {
      for (const it of s.items) {
        const prev = it.priceHistory[0];
        if (!it.active || !prev) continue;
        if (prev.recordedAt >= cutoff && it.packPriceCents > prev.packPriceCents) {
          priceIncreases.push({
            itemId: it.id,
            supplierId: s.id,
            supplierName: s.name,
            ingredientId: it.ingredientId,
            ingredientName: it.ingredient.name,
            sku: it.sku,
            previousPriceCents: prev.packPriceCents,
            packPriceCents: it.packPriceCents,
            increasePct:
              prev.packPriceCents > 0
                ? pct1(((it.packPriceCents - prev.packPriceCents) / prev.packPriceCents) * 100)
                : 100,
            recordedAt: prev.recordedAt,
          });
        }
      }
    }
    priceIncreases.sort((a, b) => b.increasePct - a.increasePct);

    return {
      ruptures: ruptures.map((r) => this.mapIngredient(r)),
      belowPar: belowPar.map((r) => this.mapIngredient(r)),
      priceIncreases,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Mouvements de stock
  // ─────────────────────────────────────────────────────────────

  /**
   * purchase : +qty · waste : −qty · count : qty = nouvelle valeur absolue
   * (le mouvement enregistré est le delta). Verrou ligne (FOR UPDATE) pour
   * sérialiser les mouvements concurrents sur un même ingrédient.
   */
  async createMovement(tenantId: string, dto: MovementCreate) {
    return this.db.transaction(async (tx) => {
      const [ing] = await tx
        .select()
        .from(ingredients)
        .where(and(eq(ingredients.id, dto.ingredientId), eq(ingredients.tenantRef, tenantId)))
        .limit(1)
        .for('update');
      if (!ing) throw new NotFoundException('Ingrédient introuvable');

      const current = num(ing.currentStock);
      let delta: number;
      let newStock: number;
      if (dto.type === 'purchase') {
        delta = dto.qty;
        newStock = current + dto.qty;
      } else if (dto.type === 'waste') {
        delta = -dto.qty;
        newStock = current - dto.qty;
      } else {
        // count : inventaire — la nouvelle valeur absolue remplace le stock.
        delta = dto.qty - current;
        newStock = dto.qty;
      }
      delta = round3(delta);
      newStock = round3(newStock);

      const [movement] = await tx
        .insert(stockMovements)
        .values({
          tenantRef: tenantId,
          ingredientId: ing.id,
          type: dto.type,
          qty: String(delta),
          note: dto.note ?? null,
        })
        .returning();
      await tx
        .update(ingredients)
        .set({ currentStock: String(newStock), updatedAt: new Date() })
        .where(eq(ingredients.id, ing.id));

      const inserted = mustRow(movement);
      return {
        movement: { ...inserted, qty: num(inserted.qty) },
        currentStock: newStock,
        belowPar: newStock < num(ing.parLevel),
      };
    });
  }

  async listMovements(tenantId: string, ingredientId?: string, limit = 50) {
    if (ingredientId) this.assertUuid(ingredientId);
    const rows = await this.db
      .select({
        id: stockMovements.id,
        ingredientId: stockMovements.ingredientId,
        ingredientName: ingredients.name,
        unit: ingredients.unit,
        type: stockMovements.type,
        qty: stockMovements.qty,
        ref: stockMovements.ref,
        note: stockMovements.note,
        at: stockMovements.at,
      })
      .from(stockMovements)
      .innerJoin(ingredients, eq(stockMovements.ingredientId, ingredients.id))
      .where(
        and(
          eq(stockMovements.tenantRef, tenantId),
          ingredientId ? eq(stockMovements.ingredientId, ingredientId) : undefined,
        ),
      )
      .orderBy(desc(stockMovements.at))
      .limit(limit);
    return rows.map((r) => ({ ...r, qty: num(r.qty) }));
  }
}
