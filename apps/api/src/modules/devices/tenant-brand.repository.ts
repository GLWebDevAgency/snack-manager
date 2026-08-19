import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { DeviceTenantBrand, TenantAccountStatus } from '@sm/contracts';
import type { Tenant } from '@sm/db';

/**
 * Modèle de LECTURE de l'identité visuelle d'un établissement.
 *
 * Il ne renvoie que les quatre champs dont une surface de terrain a besoin
 * pour se peindre : le slug (elle interroge encore la carte publique par
 * slug), le nom, l'accent et le logo. C'est ce qui remplace la constante
 * `TENANT_SLUG = 'classfood'` autrefois compilée dans la caisse.
 */
@Injectable()
export class TenantBrandRepository {
  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

  async byId(tenantId: string): Promise<DeviceTenantBrand | null> {
    if (!Types.ObjectId.isValid(tenantId)) return null;
    const raw = await this.tenants
      .findById(tenantId)
      .select({ slug: 1, name: 1, brandColor: 1, logoUrl: 1 })
      .lean();
    if (!raw) return null;
    return {
      slug: String(raw.slug),
      name: String(raw.name),
      // Un accent vide en base ferait retomber la caisse sur du noir sur noir :
      // on rend l'or par défaut de la charte plutôt qu'une chaîne vide.
      brandColor: raw.brandColor || '#c9a15a',
      logoUrl: raw.logoUrl ?? null,
    };
  }

  /**
   * Statut d'abonnement de l'établissement.
   *
   * Une tablette appairée ne présente pas de JWT pour ouvrir son service : elle
   * présente son jeton d'appareil, qui ne passe pas par le guard global. Sans
   * cette lecture, suspendre un client laisserait ses caisses déjà installées
   * encaisser indéfiniment — c'est-à-dire tout le parc en service, donc la
   * suspension entière.
   *
   * `undefined` quand l'établissement n'existe pas ou n'a pas encore de champ
   * `account` : l'appelant traite l'absence comme « pas de blocage », un champ
   * manquant ne doit jamais fermer une caisse en plein coup de feu.
   */
  async accountStatus(tenantId: string): Promise<TenantAccountStatus | undefined> {
    if (!Types.ObjectId.isValid(tenantId)) return undefined;
    const raw = await this.tenants
      .findById(tenantId, { 'account.status': 1 })
      .lean<{ account?: { status?: TenantAccountStatus } } | null>();
    return raw?.account?.status;
  }
}
