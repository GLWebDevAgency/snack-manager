import { mongo, type Model } from 'mongoose';
import type { Order, OrderCapacityDay, PublicOrderAdmission, Tenant } from '@sm/db';
import { OrderAdmissionJournal } from '../orders/order-admission-journal';
import { OrderCapacityCommitStore } from '../orders/order-capacity-commit.store';
import { assertOrderCapacityIndexesReady } from '../orders/order-capacity-index-readiness';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { OrderCapacityBootstrapReader, type CapacityBootstrapReadInput } from './order-capacity-bootstrap.reader';
import type { CapacityBootstrapReport } from './order-capacity-bootstrap.types';
import { orderCapacityCalendarPlanHash, validateControl, type Control, type Plan } from './order-capacity-control';
import { formatDay, parisYmd } from './paris-time';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
// Mongoose's CreateOptions omits the nested writeConcern accepted by its
// runtime. ordered is also a real option; the wire-level test locks durability.
const CREATE_DURABLE = { ...DURABLE, ordered: true };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PRIVATE = '+kind +channel +proofHash +payloadHash +snapshot +validationOwner +capacity +historicalImport';
const REPAIRABLE = new Set(['pending_validation', 'materialization_required', 'capacity_release_required', 'calendar_not_ready']);

export type CapacityBootstrapApplyInput = CapacityBootstrapReadInput & Readonly<{
  bootstrapId: string;
  /** Operator attestation, NOT a distributed fence. Operator verifies rollout separately. */
  writersStopped: true;
  writerRevision: string;
}>;

export class CapacityBootstrapBlocked extends Error {
  readonly code = 'ORDER_CAPACITY_BOOTSTRAP_BLOCKED';
  constructor(readonly reason: string) { super(`Initialisation interrompue : ${reason}. Le restaurant reste fermé aux nouvelles réservations.`); }
}
function blocked(reason: string): never { throw new CapacityBootstrapBlocked(reason); }
class BootstrapAlreadyActive extends Error {}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** One-way initial bootstrap under operational exclusion of OLD binaries.
 * New writers fail closed unless control is active. There is no automatic
 * active→seeding transition, lease expiry, reset, delete or rollback-to-legacy.
 * Every write is insert-only or an exact CAS and an ambiguous result is reread.
 */
export class OrderCapacityBootstrapStore {
  private readonly release: OrderCapacityCommitStore;
  constructor(
    private readonly tenants: Model<Tenant>, private readonly days: Model<OrderCapacityDay>,
    private readonly admissions: Model<PublicOrderAdmission>, private readonly orders: Model<Order>,
    private readonly reader: OrderCapacityBootstrapReader, private readonly journal: OrderAdmissionJournal,
  ) { this.release = new OrderCapacityCommitStore(admissions, orders, days); }

  async apply(input: CapacityBootstrapApplyInput) {
    if (!record(input) || input.writersStopped !== true
      || typeof input.tenantId !== 'string' || !/^[a-f0-9]{24}$/i.test(input.tenantId)
      || typeof input.bootstrapId !== 'string' || !UUID.test(input.bootstrapId)
      || !(input.cutoverAt instanceof Date) || !Number.isFinite(input.cutoverAt.getTime()) || typeof input.writerRevision !== 'string'
      || !/^[a-f0-9]{40}$/.test(input.writerRevision)
      || (input.limits !== undefined && !record(input.limits))
      || Object.keys(input).some((key) => !['tenantId', 'cutoverAt', 'limits', 'bootstrapId', 'writersStopped', 'writerRevision'].includes(key))) blocked('invalid_input');
    input = { ...input, tenantId: input.tenantId.toLowerCase(), cutoverAt: new Date(input.cutoverAt),
      ...(input.limits !== undefined ? { limits: { ...input.limits } } : {}) };
    try { return await this.applyOwned(input); }
    catch (error) {
      // A sibling completed the exact generation. Stop this helper immediately;
      // do not keep importing once active runtime writers can start.
      if (error instanceof BootstrapAlreadyActive) return { state: 'already_active' as const,
        bootstrapId: input.bootstrapId, tenantId: input.tenantId };
      throw error;
    }
  }

  private async applyOwned(input: CapacityBootstrapApplyInput) {
    const readInput: CapacityBootstrapReadInput = { tenantId: input.tenantId, cutoverAt: new Date(input.cutoverAt), ...(input.limits ? { limits: { ...input.limits } } : {}) };
    const bootstrapId = input.bootstrapId;
    // Reader validates its complete input before any writes or index creation.
    const initial = await this.read(readInput);
    const current = await this.control(input.tenantId);
    if (current) {
      if (current.bootstrapId !== bootstrapId || current.cutoverAt.getTime() !== readInput.cutoverAt.getTime()) blocked('different_bootstrap');
      if (current.state === 'active') return { state: 'already_active' as const, bootstrapId, tenantId: input.tenantId };
      if (current.state !== 'seeding' || current.dayIntent) blocked('control_not_resumable');
    } else if (initial.days.some((day) => day.frozen)) blocked('calendar_without_control');
    this.requireIssues(initial, REPAIRABLE);

    if (!current) {
      try {
        await this.tenants.updateOne({ _id: input.tenantId, capacityControl: { $exists: false } }, { $set: {
          capacityControl: { version: 1, state: 'seeding', bootstrapId, cutoverAt: readInput.cutoverAt, configRevision: 0, dayIntent: null },
        } }, { ...DURABLE, runValidators: true });
      } catch { /* Only the exact persisted owner allows continuation. */ }
    }
    await this.owner(readInput, bootstrapId);
    // Explicit maintenance step. No runtime read request constructs an index.
    await Promise.all([this.days.createIndexes(), this.admissions.createIndexes()]);
    await this.indexes();
    await this.reconcile(readInput, bootstrapId, initial);
    const prepared = await this.read(readInput);
    this.requireIssues(prepared, new Set(['calendar_not_ready']));

    for (const day of prepared.days) {
      await this.owner(readInput, bootstrapId);
      const plan: Plan = { day: day.day, sourceRevision: day.sourceRevision, closedReason: day.closedReason,
        slots: day.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({ at: new Date(at), kitchenCapacity, deliveryCapacity })) };
      let stored = await this.days.findOne({ tenantId: input.tenantId, day: day.day }).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (!stored) {
        try { await this.days.create([{ tenantId: input.tenantId, ...plan, state: 'seeding' }], CREATE_DURABLE); }
        catch { /* A sibling/lost response may already have inserted this exact plan. */ }
        stored = await this.days.findOne({ tenantId: input.tenantId, day: day.day }).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      }
      if (!stored || !['seeding', 'ready'].includes(stored.state)
        || orderCapacityCalendarPlanHash(stored as Plan) !== orderCapacityCalendarPlanHash(plan)) blocked('calendar_plan_changed');
    }

    for (const occupant of prepared.occupants) {
      await this.owner(readInput, bootstrapId);
      await this.importOccupant(readInput, bootstrapId, occupant, prepared);
    }
    const beforeReady = await this.read(readInput);
    this.requireIssues(beforeReady, new Set(['calendar_not_ready']));
    await this.verifyImported(beforeReady);
    for (const day of beforeReady.days) {
      await this.owner(readInput, bootstrapId);
      await this.indexes();
      try {
        await this.days.updateOne({ tenantId: input.tenantId, day: day.day, state: 'seeding' }, { $set: { state: 'ready' } }, DURABLE);
      } catch { /* Final read below verifies every day; no assumption on acknowledgement. */ }
    }
    const final = await this.read(readInput);
    this.requireIssues(final, new Set());
    await this.verifyImported(final);
    await this.owner(readInput, bootstrapId);
    await this.indexes();
    try {
      await this.tenants.updateOne({ _id: input.tenantId, 'capacityControl.state': 'seeding', 'capacityControl.version': 1,
        'capacityControl.bootstrapId': bootstrapId, 'capacityControl.cutoverAt': readInput.cutoverAt,
        'capacityControl.configRevision': 0, 'capacityControl.dayIntent': null },
      { $set: { 'capacityControl.state': 'active' } }, { ...DURABLE, runValidators: true });
    } catch { /* A timeout must not revert an already-active generation. */ }
    const active = await this.control(input.tenantId);
    if (active?.state !== 'active' || active.bootstrapId !== bootstrapId) blocked('activation_not_confirmed');
    return { state: 'active' as const, tenantId: input.tenantId, bootstrapId, writerRevision: input.writerRevision,
      days: final.days.length, orders: final.occupants.length };
  }

  private async read(input: CapacityBootstrapReadInput) {
    const scan = await this.reader.read(input);
    if (!scan.scan.complete || !scan.report || scan.issues.length) blocked('incomplete_scan');
    return scan.report;
  }
  private requireIssues(report: CapacityBootstrapReport, allowed: Set<string>) {
    if (report.issues.some((issue) => !allowed.has(issue.code))) blocked('historical_conflict');
  }
  private async control(tenantId: string): Promise<Control | undefined> {
    const tenant = await this.tenants.findById(tenantId).select('+capacityControl').read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!tenant) blocked('tenant_missing');
    if (!Object.hasOwn(tenant, 'capacityControl')) return undefined;
    validateControl(tenant.capacityControl!);
    return tenant.capacityControl!;
  }
  private async owner(input: CapacityBootstrapReadInput, bootstrapId: string) {
    const control = await this.control(input.tenantId);
    if (control?.state === 'active' && control.bootstrapId === bootstrapId
      && control.cutoverAt.getTime() === input.cutoverAt.getTime()) throw new BootstrapAlreadyActive();
    if (!control || control.state !== 'seeding' || control.bootstrapId !== bootstrapId || control.configRevision !== 0
      || control.cutoverAt.getTime() !== input.cutoverAt.getTime() || control.dayIntent) blocked('bootstrap_owner_changed');
  }
  private indexes() { return assertOrderCapacityIndexesReady(this.admissions.collection, this.days.collection); }

  private async reconcile(input: CapacityBootstrapReadInput, bootstrapId: string, initial: CapacityBootstrapReport) {
    const bound = input.limits?.maxDocuments ?? 10_000;
    const byteBound = input.limits?.maxBytes ?? 8 * 1024 * 1024;
    const cursor = this.admissions.find({ tenantId: input.tenantId }).select(PRIVATE)
      .read('primary').readConcern('majority').maxTimeMS(10_000).limit(bound + 1).batchSize(1).cursor();
    let count = 0;
    let bytes = 0;
    try {
      for await (const row of cursor) {
        if (++count > bound) blocked('admission_limit');
        // The analytical projection intentionally excludes full snapshots.
        // Bound those separately before helping a Mixed document; batchSize=1
        // prevents the driver from buffering hundreds of near-16MB snapshots.
        bytes += mongo.BSON.calculateObjectSize(row.toObject({ transform: false }));
        if (bytes > byteBound) blocked('admission_byte_limit');
        await this.owner(input, bootstrapId);
        if (row.state === 'validating') {
          // This exact CAS fences a delayed OLD C01 commit. No stale owner is reused.
          try {
            await this.admissions.updateOne({ _id: row._id, tenantId: input.tenantId, state: 'validating',
              proofHash: row.proofHash, payloadHash: row.payloadHash },
            { $set: { state: 'rejected', rejection: 'unavailable' } }, DURABLE);
          } catch { /* Reread, including any winning committing snapshot. */ }
        }
        const observed = await this.journal.read(input.tenantId, row.clientId);
        if (!observed || observed.state === 'validating') blocked('validation_not_closed');
        if (observed.state === 'committing') await this.journal.committedOrder(observed);
        if (['committing', 'created'].includes(observed.state) && observed.capacity) {
          await this.release.releaseCancelled(input.tenantId, row.clientId);
        } else if (['committing', 'created'].includes(observed.state) && observed.orderId) {
          const cancelled = await this.orders.findOne({ _id: observed.orderId, tenantId: input.tenantId,
            clientId: row.clientId, status: 'cancelled', 'pickup.slot': observed.slot }).select('_id')
            .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
          if (cancelled) {
            try {
              await this.admissions.updateOne({ _id: observed._id, tenantId: input.tenantId, state: 'created',
                orderId: cancelled._id, slot: observed.slot, capacity: null },
              { $set: { capacity: { slot: observed.slot, releasedAt: new Date() } } }, DURABLE);
            } catch { /* A full scan and the live availability guard retain any uncertainty. */ }
            const released = await this.journal.read(input.tenantId, row.clientId);
            if (!released?.capacity?.releasedAt) blocked('cancelled_capacity_not_reconciled');
          }
        }
      }
    } finally { await cursor.close(); }
    // The scan before mutation must have seen all candidates, not an arbitrary
    // target list handed to the writer. The next full scan reconciles mutations.
    if (!initial.fromInclusive) blocked('invalid_report');
  }

  private async importOccupant(input: CapacityBootstrapReadInput, bootstrapId: string,
    occupant: CapacityBootstrapReport['occupants'][number], report: CapacityBootstrapReport) {
    const order = await this.orders.findOne({ _id: occupant.orderId, tenantId: input.tenantId })
      .select('_id tenantId clientId channel type status pickup.slot +publicRecovery').read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!order || !order.pickup?.slot || order.pickup.slot.toISOString() !== occupant.slot || order.status === 'cancelled'
      || order.channel !== occupant.channel || order.type !== occupant.type) blocked('order_changed');
    const slot = new Date(occupant.slot);
    const capacity = report.days.find((day) => day.day === formatDay(parisYmd(slot)))?.slots.find((entry) => entry.at === occupant.slot);
    if (!capacity) blocked('missing_slot');
    const id = orderAdmissionId(input.tenantId, order.clientId);
    for (let attempt = 0; attempt < 101; attempt++) {
      const existing = await this.journal.read(input.tenantId, order.clientId);
      if (existing) {
        if (existing.state !== 'created' || String(existing.orderId) !== String(order._id)
          || existing.slot.getTime() !== slot.getTime()) blocked('admission_changed');
        if (existing.capacity) return; // Final full analysis validates the exact claim/type/proofs.
      } else if (order.publicRecovery) blocked('missing_public_admission');
      const occupied = await this.admissions.find({ tenantId: input.tenantId, 'capacity.slot': slot,
        $or: [{ 'capacity.kitchenSeat': { $exists: true } }, { 'capacity.deliverySeat': { $exists: true } }] })
        .select('+capacity').read('primary').readConcern('majority').maxTimeMS(10_000).limit(151).lean();
      if (occupied.length > 150) blocked('slot_inventory_limit');
      const free = (field: 'kitchenSeat' | 'deliverySeat', total: number) => {
        const seats = new Set(occupied.map((row) => row.capacity?.[field]).filter((value) => value !== undefined));
        for (let seat = 0; seat < total; seat++) if (!seats.has(seat)) return seat;
        return null;
      };
      const kitchenSeat = free('kitchenSeat', capacity.kitchenCapacity);
      const deliverySeat = order.type === 'delivery' ? free('deliverySeat', capacity.deliveryCapacity) : undefined;
      if (kitchenSeat === null || deliverySeat === null) blocked('capacity_exceeded');
      const claim = { slot, kitchenSeat, ...(deliverySeat === undefined ? {} : { deliverySeat }) };
      try {
        if (existing) {
          await this.admissions.updateOne({ _id: id, tenantId: input.tenantId, state: 'created', orderId: order._id,
            capacity: null, proofHash: existing.proofHash, payloadHash: existing.payloadHash },
          { $set: { capacity: claim } }, DURABLE);
        } else {
          await this.admissions.create([{ _id: id, tenantId: input.tenantId, clientId: order.clientId, version: 1,
            kind: 'historical', channel: order.channel, state: 'created', orderId: order._id, slot, capacity: claim,
            historicalImport: { version: 1, bootstrapId, importedAt: new Date() } }], CREATE_DURABLE);
        }
      } catch (error) {
        const observed = await this.journal.read(input.tenantId, order.clientId);
        if (observed?.state === 'created' && String(observed.orderId) === String(order._id) && observed.capacity) return;
        if (!(error instanceof mongo.MongoServerError) || error.code !== 11000) blocked('import_uncertain');
        continue;
      }
      const observed = await this.journal.read(input.tenantId, order.clientId);
      if (observed?.state === 'created' && String(observed.orderId) === String(order._id) && observed.capacity) return;
      blocked('import_not_confirmed');
    }
    blocked('import_contention');
  }

  private async verifyImported(report: CapacityBootstrapReport) {
    for (const occupant of report.occupants) {
      if (!occupant.admissionId) blocked('unimported_order');
      const admission = await this.admissions.findOne({ _id: occupant.admissionId, tenantId: report.tenantId }).select(PRIVATE)
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (!admission || admission.state !== 'created' || String(admission.orderId) !== occupant.orderId
        || !admission.capacity || admission.capacity.releasedAt || !Number.isInteger(admission.capacity.kitchenSeat)
        || (occupant.type === 'delivery' && !Number.isInteger(admission.capacity.deliverySeat))) blocked('unimported_order');
    }
  }
}
