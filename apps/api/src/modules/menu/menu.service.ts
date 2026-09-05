import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import {
  catalogueMedias,
  mediasDuProduit,
  normalizeLegacyOptionGroup,
  photoUrlDe,
  SUPPLEMENT_GROUP_KEY,
  CategoryFeaturedUpdateSchema,
  featuredProductIdsOf,
  type CategoryFeaturedUpdate,
  type CategoryFeaturedView,
  type JwtPayload,
  type MediaVue,
  type UsageMedia,
} from '@sm/contracts';
import type { Category, Product } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publierMenuMisAJour } from '../../common/menu-updated';
import { MediasService } from '../mediatheque/medias.service';
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
    private readonly medias: MediasService,
  ) {}

  /**
   * `photoUrl`, DÉRIVÉ — et le catalogue des médias, servi UNE FOIS.
   *
   * La colonne `photoUrl` du produit n'est plus rendue telle quelle : elle
   * était une chaîne libre qui contournait la liste blanche d'origines, et
   * elle ne survit que comme repli des dix-neuf photos du pilote. La vérité
   * est `medias[0]`, résolue par l'adaptateur unique `photoUrlDe`.
   *
   * Les médias voyagent À PLAT, à côté des catégories, et les produits n'en
   * portent que les identifiants : trois galettes qui partagent le cliché du
   * panneau mural ne doivent pas le faire transiter trois fois — et l'écran
   * qui veut le point d'intérêt ou le texte alternatif le trouve au même
   * endroit, quelle que soit la surface.
   */
  private async avecPhotos<T extends { photoUrl?: unknown; medias?: unknown }>(
    tenantId: string,
    prods: T[],
    usage: UsageMedia,
  ): Promise<{ produits: (Omit<T, 'photoUrl'> & { photoUrl: string | null; medias: string[] })[]; medias: MediaVue[] }> {
    const medias = await this.medias.catalogue(tenantId);
    const catalogue = catalogueMedias(medias);
    return {
      produits: prods.map((p) => ({
        ...p,
        photoUrl: photoUrlDe(p, catalogue, usage),
        medias: mediasDuProduit(p),
      })),
      medias,
    };
  }

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
        optionGroups: (p.optionGroups ?? [])
          .filter((g) => g?.key !== SUPPLEMENT_GROUP_KEY)
          .map(normalizeLegacyOptionGroup),
        removables: derived?.removables ?? [],
        supplements: derived?.supplements ?? [],
      };
    });
  }

  private publishMenuUpdated(tenantId: string, meta: Record<string, unknown>) {
    publierMenuMisAJour(this.redis, tenantId, meta);
  }

  /** Menu complet (back-office) : toutes catégories + produits, y compris inactifs. */
  async fullMenu(tenantId: string) {
    const [cats, rawProds] = await Promise.all([
      this.categories.find({ tenantId }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId }).sort({ order: 1 }).lean(),
    ]);
    const avecModificateurs = await this.withModifiers(tenantId, rawProds);
    // Usage « fiche » : le back-office montre les photos en grand dans
    // l'éditeur d'un plat, c'est le plus exigeant de ses affichages.
    const { produits: prods, medias } = await this.avecPhotos(tenantId, avecModificateurs, 'fiche');
    return {
      categories: cats.map((c) => ({
        ...c,
        featuredProductIds: featuredProductIdsOf(c.featuredProductIds),
        featuredRevision: c.featuredRevision ?? 0,
        products: prods.filter((p) => String(p.categoryId) === String(c._id)),
      })),
      // Produits « Non rattachés » (orphelins après suppression de catégorie)
      uncategorized: prods.filter((p) => !p.categoryId),
      medias,
    };
  }

  /** Menu public (commande en ligne / POS) : actifs seulement, ruptures signalées. */
  async publicMenu(tenantId: string, photoUsage: UsageMedia = 'vignette') {
    const [cats, rawProds] = await Promise.all([
      // L'intention éditoriale reste connue lorsqu'une catégorie est masquée.
      // Seules ses références servent à ce booléen ; son contenu ne sort pas.
      this.categories.find({ tenantId }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
    ]);
    const avecModificateurs = await this.withModifiers(tenantId, rawProds);
    // La même projection métier pour toutes les surfaces ; seule la découpe
    // de photo change entre grille de caisse et carte du site public.
    const { produits: prods, medias } = await this.avecPhotos(
      tenantId,
      avecModificateurs,
      photoUsage,
    );
    return {
      featuredConfigured: cats.some((c) => (c.featuredRevision ?? 0) > 0 || featuredProductIdsOf(c.featuredProductIds).length > 0),
      categories: cats.filter((c) => c.active === true).map((c) => ({
        _id: c._id,
        name: c.name,
        featuredProductIds: featuredProductIdsOf(c.featuredProductIds),
        featuredConfigured: (c.featuredRevision ?? 0) > 0 || featuredProductIdsOf(c.featuredProductIds).length > 0,
        products: prods.filter((p) => String(p.categoryId) === String(c._id)),
      })),
      medias,
    };
  }

  // ─── Catégories ───

  /** La limite et l'ordre sont écrits ensemble, avec comparaison de révision. */
  async updateFeatured(tenantId: string, id: string, dto: CategoryFeaturedUpdate): Promise<CategoryFeaturedView> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Catégorie introuvable');
    const parsed = CategoryFeaturedUpdateSchema.safeParse(dto);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((i) => i.message).join(' · '));
    const productIds = parsed.data.productIds.map((productId) => productId.toLowerCase());
    const { expectedRevision } = parsed.data;
    const view = (category: { featuredProductIds?: unknown; featuredRevision?: number }): CategoryFeaturedView => ({
      categoryId: id,
      featuredProductIds: featuredProductIdsOf(category.featuredProductIds),
      featuredRevision: category.featuredRevision ?? 0,
    });
    const conflict = (current: CategoryFeaturedView) => new ConflictException({
      code: 'FEATURED_SELECTION_CHANGED',
      message: 'La sélection a été modifiée par une autre personne. Vérifiez la sélection actuelle avant de réessayer.',
      current,
    });
    const category = await this.categories.findOne({ _id: id, tenantId }).lean();
    if (!category) throw new NotFoundException('Catégorie introuvable');
    if ((category.featuredRevision ?? 0) !== expectedRevision) throw conflict(view(category));

    // Les ruptures et inactifs peuvent rester sélectionnés, mais leur diffusion
    // est suspendue. Le produit doit en revanche appartenir à CETTE catégorie.
    if (productIds.length > 0) {
      const belonging = await this.products.find({ tenantId, categoryId: id, _id: { $in: productIds } }).lean();
      if (belonging.length !== productIds.length) {
        throw new BadRequestException('Choisissez uniquement des produits de cette catégorie. Un produit a peut-être été déplacé ou supprimé.');
      }
    }
    const revisionFilter = expectedRevision === 0
      ? { $or: [{ featuredRevision: 0 }, { featuredRevision: { $exists: false } }] }
      : { featuredRevision: expectedRevision };
    const updated = await this.categories.findOneAndUpdate(
      { _id: id, tenantId, ...revisionFilter },
      { $set: { featuredProductIds: productIds }, $inc: { featuredRevision: 1 } },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      const current = await this.categories.findOne({ _id: id, tenantId }).lean();
      if (!current) throw new NotFoundException('Catégorie introuvable');
      throw conflict(view(current));
    }
    this.publishMenuUpdated(tenantId, { scope: 'category', id, featured: true });
    return view(updated);
  }

  /** Nettoyage des références après déplacement/suppression. Le rendu filtre
   * aussi l'appartenance : une course entre deux documents ne diffuse jamais
   * un produit depuis son ancienne catégorie. */
  private async removeFeaturedReferences(tenantId: string, productId: string, keepCategoryId?: string): Promise<void> {
    await this.categories.updateMany(
      { tenantId, featuredProductIds: productId, ...(keepCategoryId ? { _id: { $ne: keepCategoryId } } : {}) },
      { $pull: { featuredProductIds: productId }, $inc: { featuredRevision: 1 } },
    );
  }

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
  async deleteCategory(tenantId: string, id: string, force: boolean, actor?: JwtPayload) {
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
    // JOURNALISÉE, contrairement à la création et au renommage : les produits
    // détachés quittent les écrans qui présentent la carte par catégorie —
    // c'est une mise hors service en masse, et `detached` en donne l'ampleur.
    await this.audit.log({
      tenantId,
      actor,
      action: 'category.delete',
      targetId: id,
      meta: { name: cat.name, detached: attached },
    });
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

  async createProduct(tenantId: string, dto: Record<string, unknown>, actor?: JwtPayload) {
    const cat = await this.categories.findOne({ _id: dto.categoryId, tenantId });
    if (!cat) throw new NotFoundException('Catégorie introuvable');
    const prod = await this.products.create({ ...dto, tenantId });
    // Un article devient VENDABLE, avec un prix : c'est le même fait que le
    // changement de prix, pris à sa naissance. Le journal porte donc le prix
    // d'entrée — sans lui, la première ligne de l'histoire d'un tarif manque.
    await this.audit.log({
      tenantId,
      actor,
      action: 'product.create',
      targetId: String(prod._id),
      meta: { name: prod.name, priceCents: prod.price ?? null, categoryName: cat.name },
    });
    this.publishMenuUpdated(tenantId, { scope: 'product', id: String(prod._id) });
    return prod;
  }

  async updateProduct(
    tenantId: string,
    id: string,
    dto: Record<string, unknown>,
    actor?: JwtPayload,
  ) {
    if (dto.categoryId) {
      const cat = await this.categories.findOne({ _id: dto.categoryId, tenantId });
      if (!cat) throw new NotFoundException('Catégorie introuvable');
    }
    // Le prix d'AVANT, lu avant l'écriture : le journal NF525 doit porter la
    // transition, pas l'état final — « 9,50 € → 8,90 € » se défend en
    // contrôle, « 8,90 € » ne prouve rien. Cette lecture ne coûte que si un
    // prix change ; l'en-tête du journal annonçait cette couverture depuis le
    // premier jour sans que personne ne l'écrive (diagnostic 24/08, P3).
    // L'obligation de traçabilité porte sur le PRIX DE VENTE, pas sur le champ
    // qui le porte. Un produit à variantes a un `price` mort — la création de
    // commande exige une variante dès qu'il y en a — et son prix réel vit dans
    // `variants[].price`. Ne journaliser que `price` laissait un trou : un
    // tacos pouvait passer de 8,90 € à 12,90 € sans une ligne, tandis qu'un
    // soda à 2 € était tracé.
    const suitLePrix = dto.price !== undefined || dto.variants !== undefined;
    const avant = suitLePrix
      ? await this.products.findOne({ _id: id, tenantId }, { price: 1, variants: 1 }).lean()
      : null;
    // LE GROUPE RÉSERVÉ NE PASSE PAS PAR L'ÉCRAN.
    //
    // `GET /menu` retire `supplements` de `optionGroups` : un éditeur qui lit
    // la carte puis renvoie les groupes tels quels EFFACE la seule source du
    // prix des suppléments à la création de commande. Ce n'est pas une
    // hypothèse — `packages/db/src/repair-options.ts` raconte l'incident :
    // 32 produits privés de leur choix de pain et de leurs sauces, 19 sans
    // aucune option, et la caisse refusant tout sandwich avec « Option
    // inconnue ».
    //
    // La garantie vit ici, côté serveur, plutôt que dans la discipline de
    // chaque écran qui écrira un jour un produit.
    const $set: Record<string, unknown> = { ...dto };
    if (Array.isArray(dto.optionGroups)) {
      const entrant = dto.optionGroups as { key?: string }[];
      if (!entrant.some((g) => g?.key === SUPPLEMENT_GROUP_KEY)) {
        const actuel = await this.products.findOne({ _id: id, tenantId }, { optionGroups: 1 }).lean();
        const reserve = (actuel?.optionGroups ?? []).find(
          (g: { key?: string }) => g?.key === SUPPLEMENT_GROUP_KEY,
        );
        if (reserve) $set.optionGroups = [...entrant, reserve];
      }
    }

    const prod = await this.products.findOneAndUpdate(
      { _id: id, tenantId },
      { $set },
      { new: true },
    );
    if (!prod) throw new NotFoundException('Produit introuvable');
    if (typeof dto.categoryId === 'string') await this.removeFeaturedReferences(tenantId, id, dto.categoryId);
    if (avant && typeof dto.price === 'number' && avant.price !== dto.price) {
      await this.audit.log({
        tenantId,
        actor,
        action: 'price.change',
        targetId: id,
        meta: { name: prod.name, fromCents: avant.price, toCents: dto.price },
      });
    }
    if (avant && Array.isArray(dto.variants)) {
      // Une ligne PAR variante : « le tacos a changé » ne dit pas laquelle, et
      // c'est la taille qui se défend en contrôle. Une variante ajoutée part
      // de `null` — un prix qui apparaît est aussi un prix qui change.
      const anciens = new Map(
        ((avant.variants ?? []) as { key?: string; price?: number }[]).map((v) => [v.key, v.price]),
      );
      for (const v of dto.variants as { key: string; name: string; price: number }[]) {
        const de = anciens.get(v.key) ?? null;
        if (de === v.price) continue;
        await this.audit.log({
          tenantId,
          actor,
          action: 'price.change',
          targetId: id,
          meta: { name: prod.name, variantKey: v.key, variantName: v.name, fromCents: de, toCents: v.price },
        });
      }
    }
    this.publishMenuUpdated(tenantId, { scope: 'product', id });
    return prod;
  }

  async deleteProduct(tenantId: string, id: string, actor?: JwtPayload) {
    // LU AVANT d'être détruit : après le `deleteOne`, plus personne ne peut
    // dire ce qui a disparu de la carte, et « produit 665f… supprimé » ne se
    // défend pas devant un gérant six mois plus tard. Une lecture par
    // suppression est un coût négligeable au regard du trou qu'elle comble.
    const prod = await this.products
      .findOne({ _id: id, tenantId }, { name: 1, price: 1 })
      .lean<{ name?: string; price?: number } | null>();
    const res = await this.products.deleteOne({ _id: id, tenantId });
    if (res.deletedCount === 0) throw new NotFoundException('Produit introuvable');
    await this.removeFeaturedReferences(tenantId, id);
    await this.audit.log({
      tenantId,
      actor,
      action: 'product.delete',
      targetId: id,
      meta: { name: prod?.name ?? '', priceCents: prod?.price ?? null },
    });
    this.publishMenuUpdated(tenantId, { scope: 'product', id, deleted: true });
    return { deleted: true };
  }

  /**
   * Rupture 1-tap.
   *
   * L'état d'AVANT est lu pour ne journaliser qu'un vrai changement : ce bouton
   * est tapé du bout du doigt sur une tablette grasse, et une ligne par
   * pression noierait le registre sous des « rupture → rupture ». Ce qui
   * intéresse un gérant, c'est le MOMENT où un plat a cessé d'être vendable.
   */
  async setStock(tenantId: string, id: string, outOfStock: boolean, actor?: JwtPayload) {
    const avant = await this.products
      .findOne({ _id: id, tenantId }, { outOfStock: 1 })
      .lean<{ outOfStock?: boolean } | null>();
    const prod = await this.products.findOneAndUpdate(
      { _id: id, tenantId },
      { $set: { outOfStock } },
      { new: true },
    );
    if (!prod) throw new NotFoundException('Produit introuvable');
    if ((avant?.outOfStock ?? false) !== outOfStock) {
      await this.audit.log({
        tenantId,
        actor,
        action: 'product.stock',
        targetId: id,
        meta: { name: prod.name, outOfStock },
      });
    }
    this.publishMenuUpdated(tenantId, { scope: 'product', id, outOfStock });
    return prod;
  }
}
