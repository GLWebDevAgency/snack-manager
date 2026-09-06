import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { FilterQuery, Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { DeliverySettingsSchema, TenantHoursUpdateSchema, TenantSettingsUpdateSchema } from '@sm/contracts';
import { validateControl } from '../ordering/order-capacity-control';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const MAX_CONTENTION_ATTEMPTS = 16;
type Projection = Record<string, 0 | 1>;
const CALENDAR_PATHS = new Set(['hours', 'closures', 'delivery', 'settings.slotCapacity', 'settings.slotIntervalMin']);

/** Les autres réglages (pause, impression, identité) gardent leur writer habituel. */
export function touchesCalendarSettings(patch: Record<string, unknown>): boolean {
  return Object.keys(patch).some((path) => CALENDAR_PATHS.has(path));
}

function unavailable() {
  return new ServiceUnavailableException({ code: 'TENANT_CAPACITY_SETTINGS_UNCERTAIN',
    message: 'Les réglages du calendrier restent à vérifier. Actualisez avant de les modifier à nouveau.' });
}

function invalid() {
  return new BadRequestException({ code: 'TENANT_CAPACITY_SETTINGS_INVALID', message: 'Réglages du calendrier invalides.' });
}

/** Contrat interne en liste positive, jamais un passe-plat d'opérateurs Mongo. */
function settingsPatch(input: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !touchesCalendarSettings(input)) throw invalid();
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) throw invalid();
    if (['hours', 'closures', 'delivery'].includes(key)) continue;
    if (!key.startsWith('settings.') || !Object.hasOwn(TenantSettingsUpdateSchema.shape, key.slice(9))) throw invalid();
    settings[key.slice(9)] = value;
  }
  const patch: Record<string, unknown> = {};
  // Zod construit aussi un corps détaché du demandeur avant le premier await.
  try {
    for (const [key, value] of Object.entries(TenantSettingsUpdateSchema.parse(settings))) patch[`settings.${key}`] = value;
    if (Object.hasOwn(input, 'hours')) patch.hours = TenantHoursUpdateSchema.shape.hours.parse(input.hours);
    if (Object.hasOwn(input, 'closures')) patch.closures = TenantHoursUpdateSchema.shape.closures.parse(input.closures);
    if (Object.hasOwn(input, 'delivery')) patch.delivery = DeliverySettingsSchema.parse(input.delivery);
  } catch { throw invalid(); }
  return patch;
}

function publicProjection(projection?: Projection): Projection | undefined {
  if (projection === undefined) return undefined;
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) throw invalid();
  for (const [key, value] of Object.entries(projection)) {
    if (key === 'capacityControl' || key.startsWith('capacityControl.') || key.startsWith('+') || key.startsWith('$')
      || ![0, 1].includes(value)) throw invalid();
  }
  return { ...projection };
}

/**
 * Réglages + révision dans UNE écriture Tenant, arbitre commun avec le CAS de
 * création d'une journée. Aucun changement des jours déjà figés, aucune
 * suppression d'intention, aucune activation/bootstrap implicite.
 *
 * Le tenant historique est modifié sous filtre « contrôle absent ». Si un
 * bootstrap gagne entre lecture et écriture, le PATCH relit son état au lieu
 * de contourner la coordination. Seules les collisions CAS acquittées (null)
 * autorisent une nouvelle tentative ; une erreur de transport reste incertaine.
 */
export class TenantCapacitySettingsStore {
  constructor(private readonly tenants: Model<Tenant>) {}

  async update(tenantId: string, input: Record<string, unknown>, projection?: Projection) {
    const $set = settingsPatch(input);
    const fields = publicProjection(projection);
    if (typeof tenantId !== 'string' || !/^[a-f0-9]{24}$/i.test(tenantId)) throw new NotFoundException('Tenant introuvable');
    for (let attempt = 0; attempt < MAX_CONTENTION_ATTEMPTS; attempt++) {
      const tenant = await this.readControl(tenantId);
      if (!tenant) throw new NotFoundException('Tenant introuvable');
      let filter: FilterQuery<Tenant>;
      let $inc: Record<string, number> | undefined;
      if (!Object.hasOwn(tenant, 'capacityControl')) {
        filter = { _id: tenantId, capacityControl: { $exists: false } };
      } else {
        const control = tenant.capacityControl;
        try {
          if (!control) throw unavailable();
          validateControl(control);
          if (control.state !== 'active' || control.configRevision === Number.MAX_SAFE_INTEGER) throw unavailable();
        } catch { throw unavailable(); }
        filter = { _id: tenantId, 'capacityControl.version': 1, 'capacityControl.state': 'active',
          'capacityControl.bootstrapId': control.bootstrapId, 'capacityControl.configRevision': control.configRevision };
        $inc = { 'capacityControl.configRevision': 1 };
      }
      try {
        const updated = await this.tenants.findOneAndUpdate(filter, { $set, ...($inc ? { $inc } : {}) }, {
          ...DURABLE, new: true, projection: fields, runValidators: true, context: 'query',
        }).select('-capacityControl');
        if (updated) return updated;
      } catch {
        // Ne pas réécrire après un timeout : le premier PATCH peut encore
        // gagner, puis écraser un réglage plus récent. L'opérateur doit relire.
        throw unavailable();
      }
    }
    throw unavailable();
  }

  private async readControl(tenantId: string) {
    try {
      return await this.tenants.findById(tenantId).select('_id capacityControl')
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    } catch { throw unavailable(); }
  }
}
