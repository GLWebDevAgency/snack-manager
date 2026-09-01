import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  brandColorDe,
  logoUrlDe,
  marqueEffective,
  publicOrderingState,
  type Brand,
  type TenantIdentityUpdate,
  type TenantSettingsUpdate,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { avecLogoHerite, exigerAA } from './marque';

/**
 * Les réglages de service qu'un gérant peut écrire. Tout ce qui n'est pas ici
 * est ignoré en silence — c'est voulu : la route prend un corps nu, sans schéma
 * Zod, et cette liste est le seul rempart.
 *
 * Elle est EXPORTÉE pour être testable. Une liste blanche qui autorise un champ
 * absent du schéma Mongoose produit le pire des défauts : la route répond 200,
 * le gérant croit avoir enregistré, et rien ne persiste. C'est arrivé à
 * `dailyGoalCents`, resté six semaines dans cette liste sans exister en base.
 * Le test `tenants.test.ts` verrouille désormais la correspondance.
 */
/**
 * Ce que `GET /tenants/me` a le droit de rendre.
 *
 * EXPORTÉE pour être testable : cette liste décide de ce qu'une tablette de
 * comptoir peut lire sur son propre restaurant, et un champ de trop y est une
 * fuite silencieuse.
 */
export const TENANT_ME_FIELDS = {
  slug: 1,
  name: 1,
  logoUrl: 1,
  brandColor: 1,
  brand: 1,
  address: 1,
  phones: 1,
  hours: 1,
  closures: 1,
  plan: 1,
  settings: 1,
} as const;

export const REGLAGES_MODIFIABLES = [
  'slotIntervalMin',
  'slotCapacity',
  'onlineOrderingPaused',
  'pauseMessage',
  'printTicketOn',
  'printStickerOn',
  'dailyGoalCents',
] as const;

@Injectable()
export class TenantsService {
  constructor(@InjectModel('Tenant') private readonly tenants: Model<Tenant>) {}

  /**
   * L'ÉTABLISSEMENT DE LA SESSION — en liste blanche, jamais le document entier.
   *
   * Elle rendait le tenant complet. Or cette route sert TOUT l'équipage, y
   * compris une session ouverte au code sur la tablette du comptoir : un
   * équipier de cuisine lisait donc le SIRET, le numéro de TVA, l'identité de
   * facturation, l'identifiant du compte Stripe du restaurant, le motif de sa
   * suspension, et jusqu'au montant de sa remise fondateur.
   *
   * Rien de tout cela n'est utilisé par les écrans — ils lisent onze champs, et
   * ce sont exactement ceux d'en dessous. La projection est écrite en liste
   * BLANCHE, et non en retrait des champs sensibles : un champ ajouté demain au
   * schéma ne doit pas partir sur une tablette parce que personne n'a pensé à
   * l'exclure. C'est le même choix que pour la diffusion temps réel du suivi.
   */
  async byId(tenantId: string) {
    const t = await this.tenants.findById(tenantId, TENANT_ME_FIELDS);
    if (!t) throw new NotFoundException('Tenant introuvable');
    return t;
  }

  async bySlug(slug: string) {
    const t = await this.tenants.findOne({ slug });
    if (!t) throw new NotFoundException('Établissement introuvable');
    return t;
  }

  /** Vue publique (page de commande client) — pas de données internes. */
  async publicBySlug(slug: string) {
    const t = await this.bySlug(slug);
    // Une suspension de compte se présente au public comme une pause de
    // service — la page reste belle, le litige commercial reste privé.
    const gate = publicOrderingState(t.account, {
      paused: t.settings?.onlineOrderingPaused ?? false,
      message: t.settings?.pauseMessage ?? null,
    });
    // Calculé une fois : les champs plats en dérivent, jamais l'inverse.
    const brand = marqueEffective(t);
    return {
      slug: t.slug,
      name: t.name,
      brand,
      logoUrl: logoUrlDe(brand),
      brandColor: brandColorDe(brand),
      address: t.address,
      phones: t.phones,
      hours: t.hours,
      onlineOrderingPaused: gate.paused,
      pauseMessage: gate.message,
      slotIntervalMin: t.settings?.slotIntervalMin ?? 10,
    };
  }

  /**
   * Les réglages du service. Le corps est VALIDÉ en amont
   * (`TenantSettingsUpdateSchema`) : cette liste ne décide plus que des champs
   * ÉCRITS, ce qu'elle a toujours fait, et le schéma décide des VALEURS — ce
   * que personne ne faisait.
   *
   * Les deux restent nécessaires et le test `tenants.test.ts` verrouille leur
   * correspondance : une clé validée mais absente d'ici serait acceptée puis
   * jetée en silence, et une clé d'ici absente du schéma Mongoose subirait le
   * même sort en base — c'est exactement ce qui est arrivé à `dailyGoalCents`.
   */
  async updateSettings(tenantId: string, patch: TenantSettingsUpdate) {
    const $set: Record<string, unknown> = {};
    for (const k of REGLAGES_MODIFIABLES) {
      if (k in patch) $set[`settings.${k}`] = (patch as Record<string, unknown>)[k];
    }
    if (Object.keys($set).length === 0) return this.tenants.findById(tenantId);
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }

  /**
   * Identité de l'enseigne — champs RACINE du tenant, par opposition aux
   * réglages (`settings.*`). Seules les clés présentes s'écrivent : un PATCH
   * qui corrige l'adresse ne doit pas pouvoir vider les téléphones.
   */
  async updateIdentity(tenantId: string, patch: TenantIdentityUpdate) {
    const $set: Record<string, unknown> = {};
    if (patch.name !== undefined) $set.name = patch.name;
    if (patch.brandColor !== undefined) $set.brandColor = patch.brandColor;
    if (patch.address !== undefined) $set.address = patch.address;
    if (patch.phones !== undefined) $set.phones = patch.phones;
    if (Object.keys($set).length === 0) return this.tenants.findById(tenantId);
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }

  /**
   * Le masque d'identité posé par le restaurateur.
   *
   * Le tenant est LU avant d'être écrit : un masque dont les quatre
   * emplacements de logo sont vides hérite du logo legacy (`avecLogoHerite`)
   * — sinon la première pose du masque effacerait le logo affiché depuis
   * toujours, avant même que le restaurateur en pose un nouveau. Le contraste
   * est rejoué ENSUITE, sur le masque tel qu'il sera vraiment enregistré.
   */
  async updateMarque(tenantId: string, brand: Brand) {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException('Tenant introuvable');
    const herite = avecLogoHerite(brand, tenant.logoUrl);
    exigerAA(herite);
    return this.tenants.findByIdAndUpdate(tenantId, { $set: { brand: herite } }, { new: true });
  }

  /** Horaires hebdomadaires (vue Horaires du back-office). */
  async updateHours(tenantId: string, hours: unknown[], closures?: unknown[]) {
    const $set: Record<string, unknown> = { hours };
    if (closures) $set.closures = closures;
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }
}
