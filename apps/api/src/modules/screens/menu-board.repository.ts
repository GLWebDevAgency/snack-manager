import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Category, Product, Promotion, Tenant } from '@sm/db';
import type { RawDayHours } from './daypart';

/**
 * Le modèle de LECTURE du Menu Board.
 *
 * L'écran n'écrit rien et ne connaît ni les commandes, ni les stocks, ni les
 * options. Il lui faut la carte du jour et l'identité du restaurant — c'est
 * exactement ce que cette classe expose, sous une forme neutre, sans document
 * Mongoose : les cas d'usage restent testables en mémoire.
 */

export interface BoardIdentity {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly brandColor: string;
  readonly hours: RawDayHours[];
}

export interface BoardCategory {
  readonly id: string;
  readonly name: string;
}

export interface BoardProduct {
  readonly id: string;
  readonly categoryId: string | null;
  readonly name: string;
  readonly description: string;
  /** Centimes — ignoré si `variantPrices` n'est pas vide. */
  readonly priceCents: number;
  /** Centimes, une entrée par variante : source de la fourchette affichée. */
  readonly variantPrices: number[];
  readonly photoUrl: string | null;
  readonly isNew: boolean;
  readonly outOfStock: boolean;
  readonly tags: string[];
}

export interface BoardPromo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: 'percent' | 'amount' | 'offered_item';
  readonly value: number;
}

/** Tout ce qu'une résolution de contenu consomme, en une seule lecture. */
export interface BoardSnapshot {
  readonly identity: BoardIdentity;
  readonly categories: BoardCategory[];
  readonly products: BoardProduct[];
  readonly promos: BoardPromo[];
}

@Injectable()
export class MenuBoardRepository {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Category') private readonly categories: Model<Category>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Promotion') private readonly promotions: Model<Promotion>,
  ) {}

  /**
   * Un seul aller-retour pour toute la carte.
   *
   * Les quatre lectures partent en parallèle : l'écran attend, le client
   * derrière lui aussi. Les inactifs sont écartés côté base — inutile de faire
   * transiter une carte d'hiver désactivée jusqu'à une clé HDMI.
   */
  async snapshot(tenantId: string, now: Date): Promise<BoardSnapshot | null> {
    const [tenant, cats, prods, promos] = await Promise.all([
      this.tenants.findById(tenantId).lean(),
      this.categories.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
      this.products.find({ tenantId, active: true }).sort({ order: 1 }).lean(),
      // ── CE QUE L'ÉCRAN DE SALLE A LE DROIT D'ANNONCER ──
      //
      // Seuls `active` et les dates étaient regardés. Une offre réservée à la
      // commande EN LIGNE, protégée par un code, ou déjà épuisée s'affichait
      // donc en grand au-dessus du comptoir — et la caisse la refusait au
      // client qui venait de la lire. C'est la pire forme du défaut : le
      // logiciel promet à la place du restaurateur, puis le dédit devant son
      // client.
      //
      // Le filtre est celui de l'affichage EN SALLE : le canal doit contenir
      // « pos », l'offre ne doit pas demander un code que personne n'a
      // distribué au comptoir, et son quota ne doit pas être épuisé.
      this.promotions
        .find({
          tenantId,
          active: true,
          channels: 'pos',
          code: null,
          $and: [
            { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
            {
              $or: [
                { maxUsage: { $lte: 0 } },
                { maxUsage: null },
                { $expr: { $lt: ['$usageCount', '$maxUsage'] } },
              ],
            },
          ],
        })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (!tenant) return null;

    return {
      identity: {
        tenantId: String(tenant._id),
        slug: String(tenant.slug ?? ''),
        name: String(tenant.name ?? ''),
        logoUrl: tenant.logoUrl ?? null,
        brandColor: tenant.brandColor ?? '#c9a15a',
        hours: (tenant.hours ?? []).map((h) => ({
          day: Number(h?.day ?? 0),
          lunch: h?.lunch ? { open: h.lunch.open, close: h.lunch.close } : null,
          dinner: h?.dinner ? { open: h.dinner.open, close: h.dinner.close } : null,
        })),
      },
      categories: cats.map((c) => ({ id: String(c._id), name: String(c.name ?? '') })),
      products: prods.map((p) => ({
        id: String(p._id),
        categoryId: p.categoryId ? String(p.categoryId) : null,
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        priceCents: Number(p.price ?? 0),
        variantPrices: (p.variants ?? []).map((v) => Number(v?.price ?? 0)),
        photoUrl: p.photoUrl ?? null,
        isNew: p.isNew === true,
        outOfStock: p.outOfStock === true,
        tags: (p.tags ?? []).map((t) => String(t)),
      })),
      promos: promos.map((p) => ({
        id: String(p._id),
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        kind: (p.kind ?? 'percent') as BoardPromo['kind'],
        value: Number(p.value ?? 0),
      })),
    };
  }

}
