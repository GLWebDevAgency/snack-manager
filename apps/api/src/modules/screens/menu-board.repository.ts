import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Category, Product, Promotion, Tenant } from '@sm/db';
import {
  brandColorDe,
  catalogueMedias,
  logoUrlDe,
  photoPointDe,
  photoUrlDe,
  type Brand,
  type PointInteret,
} from '@sm/contracts';
import { marqueObservee } from '../../common/marque-observee';
import { MediasService } from '../mediatheque/medias.service';
import { horairesPublics } from '../tenants/horaires-publics';
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
  /** LE MASQUE observé — la source dont `logoUrl` et `brandColor` dérivent. */
  readonly brand: Brand;
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
  /** DÉRIVÉ de `medias[0]`, usage « bandeau » — voir `photoUrlDe`. */
  readonly photoUrl: string | null;
  /**
   * OÙ RECADRER — l'écran de salle est la surface la plus large (16:9) et
   * donc celle qui coupe le plus. Sans point commun, elle tranche le plat
   * ailleurs que la vignette carrée de la caisse, sur le même cliché.
   */
  readonly photoPoint: PointInteret | null;
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

/**
 * L'identité du restaurant telle que l'écran la reçoit — extraite du dépôt
 * pour être TESTABLE sans Mongo.
 *
 * Les deux champs plats sont des dérivés du masque, jamais la colonne lue :
 * un tenant repris peint son écran de menu avec l'accent de SON masque, et un
 * tenant pas encore repris avec son `brandColor` brut, via le repli. Inline
 * dans la requête, cette règle n'avait aucun test — et c'est exactement là
 * qu'un « retour au champ plat, c'est plus simple » serait passé inaperçu.
 */
export function identiteDuTableau(
  tenant: Partial<Tenant> & { _id: unknown },
): BoardIdentity {
  // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
  const brand = marqueObservee(tenant);
  return {
    tenantId: String(tenant._id),
    slug: String(tenant.slug ?? ''),
    name: String(tenant.name ?? ''),
    brand,
    logoUrl: logoUrlDe(brand),
    brandColor: brandColorDe(brand),
    // La même conversion que la vitrine et la fiche publique — elle vivait ici
    // en copie, et le dayparting de l'écran de salle en dépend au caractère près.
    hours: horairesPublics(tenant.hours),
  };
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
    private readonly medias: MediasService,
  ) {}

  /**
   * Un seul aller-retour pour toute la carte.
   *
   * Les quatre lectures partent en parallèle : l'écran attend, le client
   * derrière lui aussi. Les inactifs sont écartés côté base — inutile de faire
   * transiter une carte d'hiver désactivée jusqu'à une clé HDMI.
   */
  async snapshot(tenantId: string, now: Date): Promise<BoardSnapshot | null> {
    const [tenant, cats, prods, promos, medias] = await Promise.all([
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
      this.medias.catalogue(tenantId),
    ]);

    if (!tenant) return null;

    const catalogue = catalogueMedias(medias);

    return {
      identity: identiteDuTableau(tenant),
      categories: cats.map((c) => ({ id: String(c._id), name: String(c.name ?? '') })),
      products: prods.map((p) => ({
        id: String(p._id),
        categoryId: p.categoryId ? String(p.categoryId) : null,
        name: String(p.name ?? ''),
        description: String(p.description ?? ''),
        priceCents: Number(p.price ?? 0),
        variantPrices: (p.variants ?? []).map((v) => Number(v?.price ?? 0)),
        photoUrl: photoUrlDe(p, catalogue, 'bandeau'),
        photoPoint: photoPointDe(p, catalogue),
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
