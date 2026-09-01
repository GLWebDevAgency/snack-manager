import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { DomainStatus } from '@sm/domain';
import type { Tenant } from '@sm/db';
import { brandColorDe, logoUrlDe, marqueEffective } from '@sm/contracts';

/**
 * Un domaine tel qu'il est stocké — forme neutre, sans document Mongoose.
 *
 * Les cas d'usage manipulent CE type, jamais un `HydratedDocument` : le jour où
 * les tenants passent de Mongo à Postgres, seule cette classe change.
 */
export interface StoredDomain {
  readonly id: string;
  readonly hostname: string;
  readonly providerId: string;
  readonly status: DomainStatus;
  readonly target: string;
  readonly isPrimary: boolean;
  readonly addedAt: Date;
  readonly lastCheckedAt: Date | null;
  readonly detail: string | null;
}

/** Enregistrement à créer (l'`id` et `addedAt` sont décidés par le dépôt). */
export interface NewDomain {
  readonly hostname: string;
  readonly providerId: string;
  readonly status: DomainStatus;
  readonly target: string;
  readonly isPrimary: boolean;
  readonly addedAt: Date;
}

/** Identité minimale d'un établissement, telle qu'attendue par la résolution du Host. */
export interface TenantIdentity {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly brandColor: string;
  readonly logoUrl: string | null;
}

type RawDomain = Tenant['domains'][number];

function toStored(raw: RawDomain): StoredDomain {
  return {
    id: String(raw._id),
    hostname: raw.hostname,
    providerId: raw.providerId,
    status: raw.status as DomainStatus,
    target: raw.target,
    isPrimary: raw.isPrimary,
    addedAt: raw.addedAt,
    lastCheckedAt: raw.lastCheckedAt ?? null,
    detail: raw.detail ?? null,
  };
}

function toIdentity(tenant: Tenant & { _id: unknown }): TenantIdentity {
  // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
  const brand = marqueEffective(tenant);
  return {
    tenantId: String(tenant._id),
    slug: tenant.slug,
    name: tenant.name,
    brandColor: brandColorDe(brand),
    logoUrl: logoUrlDe(brand),
  };
}

/**
 * Accès base aux adresses publiques d'un établissement.
 *
 * Les domaines vivent dans un tableau du document tenant plutôt que dans une
 * collection dédiée : un restaurant en a un, deux au maximum (l'ancien et le
 * nouveau pendant une bascule), et ils sont TOUJOURS lus avec le tenant.
 */
@Injectable()
export class TenantSiteRepository {
  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

  async list(tenantId: string): Promise<StoredDomain[]> {
    const tenant = await this.tenants.findById(tenantId).select('domains');
    return (tenant?.domains ?? []).map(toStored);
  }

  async byId(tenantId: string, domainId: string): Promise<StoredDomain | null> {
    // Un `:id` de l'URL n'est pas forcément un ObjectId : sans ce garde-fou,
    // Mongoose lève une CastError et le client reçoit un 500 au lieu d'un 404.
    if (!Types.ObjectId.isValid(domainId)) return null;
    const tenant = await this.tenants.findById(tenantId).select('domains');
    const raw = tenant?.domains?.find((d) => String(d._id) === domainId);
    return raw ? toStored(raw) : null;
  }

  /**
   * Quel établissement détient déjà ce nom d'hôte ? La question se pose au-delà
   * du tenant courant : deux restaurants ne peuvent pas revendiquer la même
   * adresse, sinon la résolution du Host devient ambiguë.
   */
  async holderOf(hostname: string): Promise<string | null> {
    const tenant = await this.tenants.findOne({ 'domains.hostname': hostname }).select('_id');
    return tenant ? String(tenant._id) : null;
  }

  async add(tenantId: string, domain: NewDomain): Promise<StoredDomain> {
    const updated = await this.tenants
      .findByIdAndUpdate(tenantId, { $push: { domains: domain } }, { new: true })
      .select('domains');
    const raw = updated?.domains?.find((d) => d.hostname === domain.hostname);
    // Absent après un $push réussi = le tenant a disparu entre-temps.
    if (!raw) throw new Error(`Domaine « ${domain.hostname} » introuvable après ajout`);
    return toStored(raw);
  }

  /** Reporte le verdict du fournisseur (statut, cause, date de contrôle). */
  async saveCheck(
    tenantId: string,
    domainId: string,
    status: DomainStatus,
    detail: string | null,
    checkedAt: Date,
  ): Promise<StoredDomain | null> {
    if (!Types.ObjectId.isValid(domainId)) return null;
    await this.tenants.updateOne(
      { _id: tenantId, 'domains._id': new Types.ObjectId(domainId) },
      {
        $set: {
          'domains.$.status': status,
          'domains.$.detail': detail,
          'domains.$.lastCheckedAt': checkedAt,
        },
      },
    );
    return this.byId(tenantId, domainId);
  }

  async remove(tenantId: string, domainId: string): Promise<void> {
    if (!Types.ObjectId.isValid(domainId)) return;
    await this.tenants.updateOne(
      { _id: tenantId },
      { $pull: { domains: { _id: new Types.ObjectId(domainId) } } },
    );
  }

  /**
   * Résolution d'un domaine personnalisé : `active` uniquement. Un domaine dont
   * le certificat n'est pas émis servirait une erreur TLS — mieux vaut un 404
   * franc qu'une page cassée aux couleurs du restaurant.
   */
  async findByActiveHostname(hostname: string): Promise<TenantIdentity | null> {
    const tenant = await this.tenants.findOne({
      domains: { $elemMatch: { hostname, status: 'active' } },
    });
    return tenant ? toIdentity(tenant) : null;
  }

  async findBySlug(slug: string): Promise<TenantIdentity | null> {
    const tenant = await this.tenants.findOne({ slug });
    return tenant ? toIdentity(tenant) : null;
  }

  async findById(tenantId: string): Promise<TenantIdentity | null> {
    const tenant = await this.tenants.findById(tenantId);
    return tenant ? toIdentity(tenant) : null;
  }
}
