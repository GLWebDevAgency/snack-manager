import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Tenant } from '@sm/db';

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
    return {
      slug: t.slug,
      name: t.name,
      logoUrl: t.logoUrl,
      brandColor: t.brandColor,
      address: t.address,
      phones: t.phones,
      hours: t.hours,
      onlineOrderingPaused: t.settings?.onlineOrderingPaused ?? false,
      pauseMessage: t.settings?.pauseMessage,
      slotIntervalMin: t.settings?.slotIntervalMin ?? 10,
    };
  }

  async updateSettings(tenantId: string, patch: Record<string, unknown>) {
    const allowed = [
      'slotIntervalMin',
      'slotCapacity',
      'onlineOrderingPaused',
      'pauseMessage',
      'printTicketOn',
      'printStickerOn',
      'dailyGoalCents',
    ];
    const $set: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in patch) $set[`settings.${k}`] = patch[k];
    }
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }

  /** Horaires hebdomadaires (vue Horaires du back-office). */
  async updateHours(tenantId: string, hours: unknown[], closures?: unknown[]) {
    const $set: Record<string, unknown> = { hours };
    if (closures) $set.closures = closures;
    return this.tenants.findByIdAndUpdate(tenantId, { $set }, { new: true });
  }
}
