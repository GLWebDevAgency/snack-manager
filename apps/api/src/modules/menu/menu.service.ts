import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { ordersChannel, SUPPLEMENT_GROUP_KEY, WS_EVENTS } from '@sm/contracts';
import type { Category, Product } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { SupplyService, type ProductForModifiers } from '../supply/supply.service';
import { AuditService } from '../audit/audit.module';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel('Category') private readonly categories: Model<Category>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly supply: SupplyService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Joint à chaque produit les modificateurs DÉRIVÉS de sa recette.
   *
   * `removables` : les ingrédients retirables réellement présents dans la
   * recette (« sans tomate » n'apparaît que sur un produit qui en contient),
   * complétés par les anciens modificateurs express du produit.
   * `supplements` : les ingrédients tarifés qui n'y sont pas encore, prix
   * résolu côté serveur.
   *
   * Le groupe d'options réservé « supplements » est retiré de `optionGroups` :
   * il n'existe que pour faire foi sur le prix à la création de commande, la
   * carte l'expose une seule fois, dans son propre bloc.
   */
  private async withModifiers<T extends ProductForModifiers>(tenantId: string, prods: T[]) {
    const modifiers = await this.supply.modifiersForMenu(tenantId, prods);
    return prods.map((p) => {
      const derived = modifiers.get(String(p._id));
      return {
        ...p,
        optionGroups: (p.optionGroups ?? []).filter((g) => g?.key !== SUPPLEMENT_GROUP_KEY),
        removables: derived?.removables ?? [],
        supplements: derived?.supplements ?? [],
      };
    });
  }

  private publishMenuUpdated(tenantId: string, meta: Record<string, unknown>) {
    void this.redis.publish(
      ordersChannel(tenantId),
      JSON.stringify({ event: WS_EVENTS.menuUpdated, payload: meta }),
    );
  }

  /** Menu complet (back-office) : toutes catégories + produits, y compris inactifs. */
  async fullMenu(tenantId: string) {
    const [cats, rawProds] = await Promise.all([
      this.categories.find({ tenantId }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId }).sort({ order: 1 }).lean(),
    ]);
    const prods = await this.withModifiers(tenantId, rawProds);
    return {
      categories: cats.map((c) => ({
        ...c,
        products: prods.filter((p) => String(p.categoryId) === String(c._id)),
      })),
      // Produits « Non rattachés » (orphelins après suppression de catégorie)
      uncategorized: prods.filter((p) => !p.categoryId),
    };
  }

  /** Menu public (commande en ligne / POS) : actifs seulement, ruptures signalées. */
  async publicMenu(tenantId: string) {
    const [cats, rawProds] = await Promise.all([
      this.categories.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
    ]);
    const prods = await this.withModifiers(tenantId, rawProds);
    return {
      categories: cats.map((c) => ({
        _id: c._id,
        name: c.name,
        products: prods.filter((p) => String(p.categoryId) === String(c._id)),
      })),
    };
  }

  // ─── Catégories ───

  createCategory(tenantId: string, dto: { name: string; order?: number; active?: boolean }) {
    this.publishMenuUpdated(tenantId, { scope: 'category' });
    return this.categories.create({ ...dto, tenantId });
  }

  async updateCategory(tenantId: string, id: string, dto: Partial<Category>) {
    const $set: Record<string, unknown> = {};
    for (const k of ['name', 'order', 'active'] as const) {
      if (dto[k] !== undefined) $set[k] = dto[k];
    }
    const cat = await this.categories.findOneAndUpdate(
      { _id: id, tenantId },
      { $set },
      { new: true },
    );
    if (!cat) throw new NotFoundException('Catégorie introuvable');
    this.publishMenuUpdated(tenantId, { scope: 'category', id });
    return cat;
  }

  /**
   * Suppression protégée : refuse (409 + nombre d'items) si des produits sont
   * rattachés, sauf confirmation explicite `force` — les produits passent alors
   * en « Non rattachés » (categoryId null), jamais supprimés (spec maquette §7.4).
   */
  async deleteCategory(tenantId: string, id: string, force: boolean) {
    const cat = await this.categories.findOne({ _id: id, tenantId });
    if (!cat) throw new NotFoundException('Catégorie introuvable');
    const attached = await this.products.countDocuments({ tenantId, categoryId: id });
    if (attached > 0 && !force) {
      throw new ConflictException({
        message: `${attached} produit(s) rattaché(s) — confirmer la suppression`,
        attached,
      });
    }
    await this.products.updateMany({ tenantId, categoryId: id }, { $set: { categoryId: null } });
    await cat.deleteOne();
    this.publishMenuUpdated(tenantId, { scope: 'category', id, deleted: true });
    return { deleted: true, detached: attached };
  }

  /** Drag & drop : réordonne selon la liste complète d'ids reçue. */
  async reorderCategories(tenantId: string, ids: string[]) {
    await this.categories.bulkWrite(
      ids.map((id, i) => ({
        updateOne: {
          filter: { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
          update: { $set: { order: i } },
        },
      })),
    );
    this.publishMenuUpdated(tenantId, { scope: 'category', reordered: true });
    return this.categories.find({ tenantId }).sort({ order: 1 });
  }

  // ─── Produits ───

  async createProduct(tenantId: string, dto: Record<string, unknown>) {
    const cat = await this.categories.findOne({ _id: dto.categoryId, tenantId });
    if (!cat) throw new NotFoundException('Catégorie introuvable');
    const prod = await this.products.create({ ...dto, tenantId });
    this.publishMenuUpdated(tenantId, { scope: 'product', id: String(prod._id) });
    return prod;
  }

  async updateProduct(tenantId: string, id: string, dto: Record<string, unknown>) {
    if (dto.categoryId) {
      const cat = await this.categories.findOne({ _id: dto.categoryId, tenantId });
      if (!cat) throw new NotFoundException('Catégorie introuvable');
    }
    // Le prix d'AVANT, lu avant l'écriture : le journal NF525 doit porter la
    // transition, pas l'état final — « 9,50 € → 8,90 € » se défend en
    // contrôle, « 8,90 € » ne prouve rien. Cette lecture ne coûte que si un
    // prix change ; l'en-tête du journal annonçait cette couverture depuis le
    // premier jour sans que personne ne l'écrive (diagnostic 24/08, P3).
    const avant =
      dto.price !== undefined
        ? await this.products.findOne({ _id: id, tenantId }, { price: 1 }).lean()
        : null;
    const prod = await this.products.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: dto },
      { new: true },
    );
    if (!prod) throw new NotFoundException('Produit introuvable');
    if (avant && typeof dto.price === 'number' && avant.price !== dto.price) {
      await this.audit.log({
        tenantId,
        action: 'price.change',
        targetId: id,
        meta: { name: prod.name, fromCents: avant.price, toCents: dto.price },
      });
    }
    this.publishMenuUpdated(tenantId, { scope: 'product', id });
    return prod;
  }

  async deleteProduct(tenantId: string, id: string) {
    const res = await this.products.deleteOne({ _id: id, tenantId });
    if (res.deletedCount === 0) throw new NotFoundException('Produit introuvable');
    this.publishMenuUpdated(tenantId, { scope: 'product', id, deleted: true });
    return { deleted: true };
  }

  /** Rupture 1-tap. */
  async setStock(tenantId: string, id: string, outOfStock: boolean) {
    const prod = await this.products.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { outOfStock } },
      { new: true },
    );
    if (!prod) throw new NotFoundException('Produit introuvable');
    this.publishMenuUpdated(tenantId, { scope: 'product', id, outOfStock });
    return prod;
  }
}
