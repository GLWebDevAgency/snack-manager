import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  aLaCapacite,
  brandColorDe,
  logoUrlDe,
  publicOrderingState,
  type PublicSiteCategory,
  type PublicSiteProduct,
  type PublicSiteResponse,
  type PublicSiteReview,
  type PublicSiteTenant,
} from '@sm/contracts';
import type { Category, Product, Review } from '@sm/db';
import { marqueObservee } from '../../common/marque-observee';
import { horairesPublics } from '../tenants/horaires-publics';
import { TenantsService } from '../tenants/tenants.service';
import { SlotsService } from './slots.service';
import { parisYmd } from './paris-time';

/** Nombre d'avis récents renvoyés avec la page publique. */
const LATEST_REVIEWS = 3;

/**
 * La vue publique de l'établissement — EXPORTÉE pour être testée sans Mongo.
 * Les champs plats sont DÉRIVÉS du masque : une seule vérité, l'accent ne
 * peut plus diverger de la palette.
 */
export function tenantPublicDe(tenant: {
  slug?: unknown; name?: unknown; brand?: unknown; brandColor?: unknown; logoUrl?: unknown;
  address?: unknown; phones?: unknown[]; hours?: Parameters<typeof horairesPublics>[0];
}): PublicSiteTenant {
  const brand = marqueObservee({
    // Le slug voyage avec : c'est lui qui NOMME le restaurant dans
    // l'avertissement quand son masque est illisible.
    slug: tenant.slug,
    brand: tenant.brand,
    brandColor: typeof tenant.brandColor === 'string' ? tenant.brandColor : null,
    logoUrl: typeof tenant.logoUrl === 'string' ? tenant.logoUrl : null,
  });
  return {
    slug: String(tenant.slug ?? ''),
    name: String(tenant.name ?? ''),
    brand,
    logoUrl: logoUrlDe(brand),
    brandColor: brandColorDe(brand),
    address: String(tenant.address ?? ''),
    phones: (tenant.phones ?? []).map(String),
    // Une seule conversion pour les trois surfaces publiques (`horaires-publics`) :
    // cette copie-ci et celle de l'écran de salle avaient déjà divergé de la
    // fiche publique, qui ne convertissait pas du tout.
    hours: horairesPublics(tenant.hours),
  };
}

/**
 * Agrégat « page publique du restaurant » : tout ce dont le site vitrine et
 * l'écran d'accueil de la commande en ligne ont besoin, en un seul aller-retour
 * (tenant, menu actif, créneaux du jour, avis, état de pause).
 */
@Injectable()
export class SiteService {
  constructor(
    @InjectModel('Category') private readonly categories: Model<Category>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Review') private readonly reviews: Model<Review>,
    private readonly tenants: TenantsService,
    private readonly slots: SlotsService,
  ) {}

  async build(slug: string, date?: string): Promise<PublicSiteResponse> {
    const tenant = await this.tenants.bySlug(slug);
    const tenantId = String(tenant._id);

    const [menu, slots, reviews] = await Promise.all([
      this.publicMenu(tenantId),
      this.slots.compute(tenant, date),
      this.reviewsSummary(tenantId),
    ]);

    // Suspension de compte, ou commande en ligne non souscrite = pause de
    // service aux yeux du public (message neutre, jamais le motif du litige ni
    // la mention d'un abonnement) — règle partagée des contrats. Le menu, les
    // horaires et les avis restent servis : on ferme un guichet, on n'efface
    // pas un restaurant d'Internet.
    const gate = publicOrderingState(
      tenant.account,
      {
        paused: tenant.settings?.onlineOrderingPaused === true,
        message: tenant.settings?.pauseMessage ?? null,
      },
      aLaCapacite(tenant, 'online'),
    );
    const paused = gate.paused;

    return {
      tenant: tenantPublicDe(tenant),
      menu,
      slots,
      reviews,
      ordering: {
        paused,
        message: gate.message,
      },
      openNow: this.slots.isOpenNow(tenant),
      todayHours: this.slots.todayHours(tenant, parisYmd(new Date())),
      timezone: slots.timezone,
    };
  }

  /**
   * Menu public : catégories et produits actifs, ruptures signalées.
   * Miroir de `MenuService.publicMenu` — ce service n'est pas exporté par
   * `MenuModule`, la requête est donc reprise ici (cf. `issues`).
   */
  private async publicMenu(tenantId: string): Promise<{ categories: PublicSiteCategory[] }> {
    const [cats, prods] = await Promise.all([
      this.categories.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
    ]);

    const byCategory = new Map<string, PublicSiteProduct[]>();
    for (const p of prods) {
      const key = String(p.categoryId ?? '');
      if (!key) continue; // produit « Non rattaché » : jamais exposé au client
      const list = byCategory.get(key) ?? [];
      list.push({
        _id: String(p._id),
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        price: Number(p.price ?? 0),
        variants: (p.variants ?? []).map((v) => ({
          key: String(v.key ?? ''),
          name: String(v.name ?? ''),
          price: Number(v.price ?? 0),
        })),
        optionGroups: (p.optionGroups ?? []) as unknown[],
        removables: (p.removables ?? []).map(String),
        tags: (p.tags ?? []).map(String),
        isNew: p.isNew === true,
        outOfStock: p.outOfStock === true,
        photoUrl: p.photoUrl ?? null,
      });
      byCategory.set(key, list);
    }

    return {
      categories: cats.map((c) => ({
        _id: String(c._id),
        name: String(c.name ?? ''),
        products: byCategory.get(String(c._id)) ?? [],
      })),
    };
  }

  /** Note moyenne (1 décimale), volume total et 3 derniers avis. */
  private async reviewsSummary(tenantId: string): Promise<PublicSiteResponse['reviews']> {
    const oid = new Types.ObjectId(tenantId);
    const [aggregate, latest] = await Promise.all([
      this.reviews.aggregate<{ count: number; sum: number }>([
        { $match: { tenantId: oid } },
        { $group: { _id: null, count: { $sum: 1 }, sum: { $sum: '$rating' } } },
      ]),
      this.reviews.find({ tenantId }).sort({ createdAt: -1 }).limit(LATEST_REVIEWS).lean(),
    ]);

    const stats = aggregate.at(0);
    const count = stats?.count ?? 0;
    const avg = count > 0 ? Math.round(((stats?.sum ?? 0) / count) * 10) / 10 : 0;

    const rows: PublicSiteReview[] = latest.map((r) => ({
      _id: String(r._id),
      author: String(r.author ?? ''),
      rating: Number(r.rating ?? 0),
      text: String(r.text ?? ''),
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      reply: r.reply
        ? {
            text: String(r.reply.text ?? ''),
            at: r.reply.at ? new Date(r.reply.at).toISOString() : null,
          }
        : null,
    }));

    return { avg, count, latest: rows };
  }
}
