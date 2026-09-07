import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Order, OrderCapacityDay, PublicOrderAdmission, Tenant } from '@sm/db';
import { OrderCapacityCalendarStore, type OrderCapacityCalendarPreview } from './order-capacity-calendar.store';
import { orderCapacityCalendarPlanHash, unavailable, validateControl, validatePlan, type Slot } from './order-capacity-control';
import { addDays, formatDay, parisWallToUtc, parisYmd, parseDay } from './paris-time';

export type OrderCapacityAvailabilityDay = Omit<OrderCapacityCalendarPreview, 'slots'> & {
  slots: (Slot & { kitchenTaken: number; deliveryTaken: number })[];
};
type Occupant = { state?: unknown; slot?: unknown; orderId?: unknown; capacity?: {
  slot?: unknown; kitchenSeat?: unknown; deliverySeat?: unknown; releasedAt?: unknown;
} | null };
const MAX_OCCUPANTS = 100_000; // 1 000 slots × 100 unique kitchen seats.
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }
function seat(value: unknown, capacity: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < capacity;
}

/** Read-only availability. Seat ownership, not Order status or an expiring
 * Redis lock, is authoritative. The final admission CAS still arbitrates a
 * concurrently claimed last seat; this GET does not reserve anything. */
@Injectable()
export class OrderCapacityAvailabilityService {
  private readonly calendar: OrderCapacityCalendarStore;
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('OrderCapacityDay') days: Model<OrderCapacityDay>,
    @InjectModel('PublicOrderAdmission') private readonly admissions: Model<PublicOrderAdmission>,
    @InjectModel('Order') orders: Model<Order>,
  ) { this.calendar = new OrderCapacityCalendarStore(tenants, days, admissions, orders); }

  /** Calendar-only lookup for the next open day; no occupancy scan or writes. */
  async previewDay(tenantId: string, day: string): Promise<OrderCapacityCalendarPreview> {
    try {
      if (typeof day !== 'string' || !parseDay(day) || !/^[a-f0-9]{24}$/i.test(tenantId)) throw unavailable();
      const before = await this.activeControl(tenantId, day);
      const preview = await this.calendar.preview(tenantId, day);
      const after = await this.activeControl(tenantId, day);
      if (after.bootstrapId !== before.bootstrapId || after.configRevision !== before.configRevision
        || after.cutoverAt.getTime() !== before.cutoverAt.getTime() || preview.sourceRevision === null) throw unavailable();
      validatePlan({ ...preview, sourceRevision: preview.sourceRevision });
      return preview;
    } catch { throw unavailable(); }
  }

  async readDay(tenantId: string, day: string): Promise<OrderCapacityAvailabilityDay> {
    try { return await this.loadDay(tenantId, day); }
    catch { throw unavailable(); }
  }

  private async loadDay(tenantId: string, day: string): Promise<OrderCapacityAvailabilityDay> {
    const parsed = typeof day === 'string' ? parseDay(day) : null;
    if (!parsed || !/^[a-f0-9]{24}$/i.test(tenantId)) throw unavailable();
    const before = await this.activeControl(tenantId, day);
    const preview = await this.calendar.preview(tenantId, day);
    if (preview.sourceRevision === null) throw unavailable();
    const plan = { ...preview, sourceRevision: preview.sourceRevision };
    validatePlan(plan);
    const slots = plan.slots.map((slot) => ({ ...slot, kitchenTaken: 0, deliveryTaken: 0 }));
    const byInstant = new Map(slots.map((slot) => [slot.at.getTime(), slot]));
    const kitchenSeats = new Set<string>();
    const deliverySeats = new Set<string>();
    const bounds = { $gte: parisWallToUtc(parsed), $lt: parisWallToUtc(addDays(parsed, 1)) };
    // Native projection avoids casting a corrupt string date/seat into a valid
    // claim. A released claim retaining either seat must be diagnosed, not
    // filtered away. Old committing claims without capacity also fail closed.
    const cursor = this.admissions.collection.aggregate<Occupant>([
      { $match: { tenantId: new Types.ObjectId(tenantId), $and: [
        { $or: [{ slot: bounds }, { 'capacity.slot': bounds }] },
        { $or: [
          { 'capacity.kitchenSeat': { $exists: true } },
          { 'capacity.deliverySeat': { $exists: true } },
          { state: { $in: ['committing', 'created'] }, 'capacity.releasedAt': null },
        ] },
      ] } },
      { $project: { _id: 1, state: 1, slot: 1, orderId: 1, capacity: 1 } },
      { $limit: MAX_OCCUPANTS + 1 },
    ], { readPreference: 'primary', readConcern: { level: 'majority' }, maxTimeMS: 10_000, batchSize: 1_000 });
    let count = 0;
    try {
      for await (const claim of cursor) {
        if (++count > MAX_OCCUPANTS) throw unavailable();
        const capacity = claim.capacity;
        if (!['committing', 'created'].includes(String(claim.state)) || !capacity || typeof capacity !== 'object' || Array.isArray(capacity)
          || !validDate(claim.slot) || !validDate(capacity.slot) || claim.slot.getTime() !== capacity.slot.getTime()
          || !(claim.orderId instanceof Types.ObjectId)) throw unavailable();
        if (capacity.releasedAt !== undefined && capacity.releasedAt !== null) {
          if (!validDate(capacity.releasedAt) || capacity.kitchenSeat !== undefined || capacity.deliverySeat !== undefined) throw unavailable();
          continue;
        }
        const slot = byInstant.get(capacity.slot.getTime());
        if (!slot || !seat(capacity.kitchenSeat, slot.kitchenCapacity)) throw unavailable();
        const kitchenKey = `${capacity.slot.getTime()}:${capacity.kitchenSeat}`;
        if (kitchenSeats.has(kitchenKey)) throw unavailable();
        kitchenSeats.add(kitchenKey);
        slot.kitchenTaken++;
        if (capacity.deliverySeat !== undefined) {
          if (!seat(capacity.deliverySeat, slot.deliveryCapacity)) throw unavailable();
          const deliveryKey = `${capacity.slot.getTime()}:${capacity.deliverySeat}`;
          if (deliverySeats.has(deliveryKey)) throw unavailable();
          deliverySeats.add(deliveryKey);
          slot.deliveryTaken++;
        }
      }
    } finally { await cursor.close(); }
    const after = await this.activeControl(tenantId, day);
    if (after.bootstrapId !== before.bootstrapId || after.configRevision !== before.configRevision
      || after.cutoverAt.getTime() !== before.cutoverAt.getTime()) throw unavailable();
    const current = await this.calendar.preview(tenantId, day);
    if (current.sourceRevision === null) throw unavailable();
    const currentPlan = { ...current, sourceRevision: current.sourceRevision };
    validatePlan(currentPlan);
    if (orderCapacityCalendarPlanHash(currentPlan) !== orderCapacityCalendarPlanHash(plan)) throw unavailable();
    return { ...preview, slots };
  }

  private async activeControl(tenantId: string, day: string) {
    // Avec une inclusion _id, « +capacityControl » n'ajoute pas le champ
    // select:false à la projection réellement envoyée par Mongoose.
    const tenant = await this.tenants.findById(tenantId).select('_id capacityControl')
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!tenant?.capacityControl) throw unavailable();
    validateControl(tenant.capacityControl);
    const control = tenant.capacityControl;
    if (control.state !== 'active' || day < formatDay(parisYmd(control.cutoverAt))) throw unavailable();
    return control;
  }
}
