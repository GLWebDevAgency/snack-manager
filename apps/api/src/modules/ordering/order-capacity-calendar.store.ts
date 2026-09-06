import { createHash, randomUUID } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { Model, Types } from 'mongoose';
import type { Order, OrderCapacityControl, OrderCapacityDay, PublicOrderAdmission, Tenant } from '@sm/db';
import { assertOrderCapacityIndexesReady } from '../orders/order-capacity-index-readiness';
import { buildOrderCapacityCalendar, InvalidCapacityCalendarDay } from './order-capacity-calendar';
import { addDays, formatDay, parisWallToUtc, parisYmd, parseDay } from './paris-time';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_HELP_ATTEMPTS = 16;
type Slot = { at: Date; kitchenCapacity: number; deliveryCapacity: number };
type Plan = { day: string; sourceRevision: number; closedReason: 'no_service' | 'exceptional_closure' | null; slots: Slot[] };
type Intent = Plan & { operationId: string; planHash: string };
type Control = Omit<OrderCapacityControl, 'dayIntent'> & { dayIntent?: Intent | null };
type StoredDay = OrderCapacityDay & { _id: Types.ObjectId };
export type OrderCapacityCalendarPreview = Omit<Plan, 'sourceRevision'> & { sourceRevision: number | null; frozen: boolean };

function unavailable() {
  return new ServiceUnavailableException({ code: 'ORDER_CAPACITY_CALENDAR_UNAVAILABLE',
    message: 'Le calendrier reste à vérifier. Conservez la même tentative de commande.' });
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function requestedDay(day: string) {
  const parsed = typeof day === 'string' ? parseDay(day) : null;
  if (!parsed) throw new InvalidCapacityCalendarDay();
  return parsed;
}

/** Stable across helpers/settings changes; operationId is deliberately not part of the plan. */
export function orderCapacityCalendarPlanHash(plan: Plan): string {
  return createHash('sha256').update(JSON.stringify({
    day: plan.day, sourceRevision: plan.sourceRevision, closedReason: plan.closedReason,
    slots: plan.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({
      at: at.toISOString(), kitchenCapacity, deliveryCapacity,
    })),
  })).digest('hex');
}

function validatePlan(plan: Omit<Plan, 'closedReason'> & { closedReason?: Plan['closedReason'] }): asserts plan is Plan {
  if (!plan || typeof plan.day !== 'string' || !parseDay(plan.day) || !validRevision(plan.sourceRevision)
    || !Array.isArray(plan.slots) || plan.slots.length > 1_000) throw unavailable();
  if (plan.slots.length === 0) {
    if (!['no_service', 'exceptional_closure'].includes(plan.closedReason ?? '')) throw unavailable();
  } else if (plan.closedReason !== null) throw unavailable();
  for (const [index, slot] of plan.slots.entries()) {
    if (!slot || !(slot.at instanceof Date) || !Number.isFinite(slot.at.getTime())
      || formatDay(parisYmd(slot.at)) !== plan.day || (index > 0 && slot.at.getTime() <= plan.slots[index - 1]!.at.getTime())
      || !Number.isInteger(slot.kitchenCapacity) || slot.kitchenCapacity < 1 || slot.kitchenCapacity > 100
      || !Number.isInteger(slot.deliveryCapacity) || slot.deliveryCapacity < 1 || slot.deliveryCapacity > 50) throw unavailable();
  }
}

function validateControl(control: OrderCapacityControl): asserts control is OrderCapacityControl & Control {
  if (!control || control.version !== 1 || !['seeding', 'active', 'blocked'].includes(control.state)
    || !validRevision(control.configRevision) || typeof control.bootstrapId !== 'string' || !UUID.test(control.bootstrapId)
    || !(control.cutoverAt instanceof Date) || !Number.isFinite(control.cutoverAt.getTime())) throw unavailable();
  const intent = control.dayIntent;
  if (intent !== undefined && intent !== null) {
    validatePlan(intent);
    if (typeof intent.operationId !== 'string' || !UUID.test(intent.operationId)
      || intent.sourceRevision > control.configRevision || intent.day < formatDay(parisYmd(control.cutoverAt))
      || typeof intent.planHash !== 'string'
      || intent.planHash !== orderCapacityCalendarPlanHash(intent)) throw unavailable();
  }
}

function readyControl(control: OrderCapacityControl | null | undefined): Control {
  if (!control) throw unavailable();
  validateControl(control);
  if (control.state !== 'active') throw unavailable();
  return control;
}

function dayPlan(day: StoredDay): Plan {
  if (!Array.isArray(day.slots) || !validRevision(day.sourceRevision)) throw unavailable();
  const plan = { day: day.day, sourceRevision: day.sourceRevision, closedReason: day.closedReason, slots: day.slots };
  validatePlan(plan);
  return { ...plan, slots: plan.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at, kitchenCapacity, deliveryCapacity })) };
}

/**
 * C15-B preparation, NOT a Nest provider or a bootstrap/activation procedure.
 *
 * Tenant CAS arbitrates configuration revision versus the entire day plan.
 * Helpers only finish that durable plan: no lease/TTL may replace it. GET is
 * read-only. An existing day is immutable, including after settings change.
 *
 * Activation still requires atomic revision updates in ALL settings writers,
 * stopping/draining old order writers, historical bootstrap and common capacity
 * admission. A cross-document control reread is NOT a fence against an old
 * binary or a concurrent administrator bypassing this protocol.
 */
export class OrderCapacityCalendarStore {
  constructor(
    private readonly tenants: Model<Tenant>,
    private readonly days: Model<OrderCapacityDay>,
    private readonly admissions: Model<PublicOrderAdmission>,
    private readonly orders: Model<Order>,
  ) {}

  async preview(tenantId: string, day: string): Promise<OrderCapacityCalendarPreview> {
    requestedDay(day);
    const tenant = await this.tenant(tenantId);
    const control = tenant.capacityControl;
    if (control) validateControl(control);
    const stored = await this.readDay(tenantId, day);
    if (stored) {
      if (stored.state !== 'ready') throw unavailable();
      if (control && (!validRevision(stored.sourceRevision) || stored.sourceRevision > control.configRevision)) throw unavailable();
      return { ...dayPlan(stored), frozen: true };
    }
    // A pending plan already won the settings race, even before Day exists.
    if (control?.dayIntent?.day === day) {
      const { slots, closedReason, sourceRevision } = control.dayIntent;
      return { day, slots: slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at, kitchenCapacity, deliveryCapacity })),
        closedReason, sourceRevision, frozen: true };
    }
    const grid = buildOrderCapacityCalendar(tenant, day);
    return { day, sourceRevision: control?.configRevision ?? null, closedReason: grid.emptyReason,
      slots: grid.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at, kitchenCapacity, deliveryCapacity })), frozen: false };
  }

  async ensureDay(tenantId: string, day: string): Promise<StoredDay> {
    requestedDay(day);
    for (let attempt = 0; attempt < MAX_HELP_ATTEMPTS; attempt++) {
      const tenant = await this.tenant(tenantId);
      const control = readyControl(tenant.capacityControl);
      if (day < formatDay(parisYmd(control.cutoverAt))) throw unavailable();
      await this.assertIndexes();
      const stored = await this.readDay(tenantId, day);
      if (stored?.state === 'ready') {
        dayPlan(stored);
        if (stored.sourceRevision! > control.configRevision) throw unavailable();
        // Also reconcile an interrupted final acknowledgement for this day.
        if (control.dayIntent?.day === day) return this.finish(tenantId, control.bootstrapId, control.dayIntent);
        return stored;
      }
      if (stored?.state === 'blocked') throw unavailable();
      if (control.dayIntent) {
        await this.finish(tenantId, control.bootstrapId, control.dayIntent);
        continue;
      }
      if (stored) throw unavailable(); // orphan seed: bootstrap must reconcile it
      const grid = buildOrderCapacityCalendar(tenant, day);
      const plan: Plan = { day, sourceRevision: control.configRevision, closedReason: grid.emptyReason,
        slots: grid.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at, kitchenCapacity, deliveryCapacity })) };
      validatePlan(plan);
      const intent: Intent = { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan) };
      try {
        await this.tenants.updateOne({ _id: tenantId, 'capacityControl.version': 1, 'capacityControl.state': 'active',
          'capacityControl.bootstrapId': control.bootstrapId, 'capacityControl.configRevision': control.configRevision,
          'capacityControl.dayIntent': null },
        { $set: { 'capacityControl.dayIntent': intent } }, { ...DURABLE, runValidators: true });
      } catch {
        // A timeout is not cancellation. Only the persisted plan may be helped.
        const current = readyControl((await this.tenant(tenantId)).capacityControl);
        if (current.bootstrapId !== control.bootstrapId || !current.dayIntent) throw unavailable();
        await this.finish(tenantId, current.bootstrapId, current.dayIntent);
      }
    }
    throw unavailable();
  }

  private async finish(tenantId: string, bootstrapId: string, intent: Intent): Promise<StoredDay> {
    validatePlan(intent);
    if (intent.planHash !== orderCapacityCalendarPlanHash(intent)) throw unavailable();
    await this.assertOwner(tenantId, bootstrapId, intent);
    await this.assertIndexes();
    let day = await this.readDay(tenantId, intent.day);
    if (!day) {
      try {
        await this.days.create([{ tenantId, day: intent.day, state: 'seeding', sourceRevision: intent.sourceRevision,
          slots: intent.slots, closedReason: intent.closedReason }], DURABLE.writeConcern);
      } catch { /* duplicate or lost acknowledgement: compare the persisted plan below */ }
      day = await this.readDay(tenantId, intent.day);
    }
    if (!day) throw unavailable();
    this.assertSamePlan(day, intent);
    if (day.state === 'seeding') {
      // This primitive opens only genuinely new days. It never infers that a
      // legacy order was imported, even if it is outside the public horizon.
      const start = requestedDay(intent.day);
      const bounds = { $gte: parisWallToUtc(start), $lt: parisWallToUtc(addDays(start, 1)) };
      const [order, admission] = await Promise.all([
        this.orders.findOne({ tenantId, status: { $ne: 'cancelled' }, 'pickup.slot': bounds }).select('_id')
          .read('primary').readConcern('majority').maxTimeMS(10_000).lean(),
        this.admissions.findOne({ tenantId, state: { $in: ['committing', 'created'] }, slot: bounds }).select('_id')
          .read('primary').readConcern('majority').maxTimeMS(10_000).lean(),
      ]);
      if (order || admission) {
        // A sibling may have opened the exact day and admitted its first sale.
        day = await this.readDay(tenantId, intent.day);
        if (!day || day.state !== 'ready') throw unavailable();
        this.assertSamePlan(day, intent);
      } else {
        await this.assertOwner(tenantId, bootstrapId, intent);
        await this.assertIndexes();
        try {
          await this.days.updateOne({ _id: day._id, tenantId, day: intent.day, state: 'seeding' },
            { $set: { state: 'ready' } }, { ...DURABLE, runValidators: true });
        } catch { /* read the exact durable day, never assume the transition won */ }
      }
    }
    const ready = await this.readDay(tenantId, intent.day);
    if (!ready || ready.state !== 'ready') throw unavailable();
    this.assertSamePlan(ready, intent);
    // Never clear a sibling's new plan or a new bootstrap generation.
    try {
      await this.tenants.updateOne({ _id: tenantId, 'capacityControl.version': 1, 'capacityControl.state': 'active',
        'capacityControl.bootstrapId': bootstrapId, 'capacityControl.dayIntent.operationId': intent.operationId,
        'capacityControl.dayIntent.planHash': intent.planHash },
      { $set: { 'capacityControl.dayIntent': null } }, { ...DURABLE, runValidators: true });
    } catch { /* ready day is durable; a later helper can clear this exact intent */ }
    const control = readyControl((await this.tenant(tenantId)).capacityControl);
    if (control.bootstrapId !== bootstrapId) throw unavailable();
    return ready;
  }

  private assertSamePlan(day: StoredDay, intent: Intent): void {
    if (orderCapacityCalendarPlanHash(dayPlan(day)) !== intent.planHash) throw unavailable();
  }

  private async assertOwner(tenantId: string, bootstrapId: string, intent: Intent): Promise<void> {
    const control = readyControl((await this.tenant(tenantId)).capacityControl);
    // A helper may finish after another has cleared the same intent. In that
    // case only the already-ready, matching day authorizes idempotent recovery.
    if (control.bootstrapId === bootstrapId && control.dayIntent?.operationId === intent.operationId
      && control.dayIntent.planHash === intent.planHash) return;
    const day = await this.readDay(tenantId, intent.day);
    if (control.bootstrapId !== bootstrapId || !day || day.state !== 'ready') throw unavailable();
    this.assertSamePlan(day, intent);
  }

  private async tenant(tenantId: string) {
    if (typeof tenantId !== 'string' || !/^[a-f0-9]{24}$/i.test(tenantId)) throw unavailable();
    const tenant = await this.tenants.findById(tenantId).select('settings delivery.slotCapacity hours closures +capacityControl')
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!tenant) throw unavailable();
    return tenant;
  }

  private readDay(tenantId: string, day: string) {
    return this.days.findOne({ tenantId, day }).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }

  private assertIndexes() {
    return assertOrderCapacityIndexesReady(this.admissions.collection, this.days.collection);
  }
}
