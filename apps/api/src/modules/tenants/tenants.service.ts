import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { publicOrderingState, type TenantIdentityUpdate } from '@sm/contracts';
import type { Tenant } from '@sm/db';

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

  async byId(tenantId: string) {
    const t = await this.tenants.findById(tenantId);
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
    return {
      slug: t.slug,
      name: t.name,
      logoUrl: t.logoUrl,
      brandColor: t.brandColor,
      address: t.address,
      phones: t.phones,
      hours: t.hours,
      onlineOrderingPaused: gate.paused,
      pauseMessage: gate.message,
      slotIntervalMin: t.settings?.slotIntervalMin ?? 10,
    };
  }

  async updateSettings(tenantId: string, patch: Record<string, unknown>) {
    const $set: Record<string, unknown> = {};
    for (const k of REGLAGES_MODIFIABLES) {
      if (k in patch) $set[`settings.${k}`] = patch[k];
    }
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

  /** Horaires hebdomadaires (vue Horaires du back-office). */
  async updateHours(tenantId: string, hours: unknown[], closures?: unknown[]) {
    const $set: Record<string, unknown> = { hours };
    if (closures) $set.closures = closures;
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }
}
