import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Tenant } from '@sm/db';

/**
 * Traduction identité métier → identité technique.
 *
 * Le domaine désigne un restaurant par son `TenantSlug` (« classfood ») : c'est
 * ce qui est écrit dans l'URL, sur le ticket, dans la tête du gérant. Les
 * canaux Redis et les rooms socket.io, eux, sont indexés sur l'ObjectId Mongo,
 * parce que c'est lui que porte le JWT des tablettes.
 *
 * Ce décalage est exactement ce qu'un adaptateur doit absorber. Le faire
 * remonter dans le domaine — en glissant un `tenantId` dans chaque événement —
 * reviendrait à faire connaître Mongo au métier pour la commodité du transport.
 */
export interface TenantIdLookup {
  /** `null` si le slug ne correspond à aucun restaurant (fiche supprimée). */
  idOf(slug: string): Promise<string | null>;
}

/** Nest n'injecte pas une interface : elle n'existe plus à l'exécution. */
export const TENANT_ID_LOOKUP = 'TENANT_ID_LOOKUP';

@Injectable()
export class MongoTenantIdLookup implements TenantIdLookup {
  /**
   * Cache sans expiration, et c'est volontaire : l'ObjectId d'un restaurant ne
   * change jamais, et son slug non plus (il est dans les URL imprimées sur les
   * flyers). Sans cache, chaque changement de statut d'une commande — plusieurs
   * par minute et par restaurant en plein service — coûterait une lecture Mongo
   * pour retrouver une constante.
   */
  private readonly known = new Map<string, string>();

  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

  async idOf(slug: string): Promise<string | null> {
    const cached = this.known.get(slug);
    if (cached) return cached;

    const tenant = await this.tenants.findOne({ slug }).select('_id').lean();
    if (!tenant) return null;

    const id = String(tenant._id);
    this.known.set(slug, id);
    return id;
  }
}
