import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Types, type Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order, PublicOrderAdmission } from '@sm/db';
import { ordersChannel, WS_EVENTS, type PublicOrderRejectionReason } from '@sm/contracts';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { assertOrderAdmissionBinding, isPublicOrderAdmission, orderAdmissionChannel, orderAdmissionId, orderAdmissionKindFilter, type OrderAdmissionBinding } from './order-admission-identity';
import { assertPublicRecoveryReplay, recoveryNotFound } from './order-recovery';
import { orderAttemptUncertain as uncertain } from './order-admission.errors';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const PRIVATE = '+kind +channel +proofHash +payloadHash +snapshot +validationOwner +capacity +historicalImport';
const MESSAGES: Record<PublicOrderRejectionReason, string> = {
  unavailable: 'Le restaurant ne peut pas accepter cette nouvelle commande pour le moment.',
  slot_unavailable: 'Ce créneau ne peut plus être réservé. Choisissez un autre créneau.',
  invalid_order: 'Cette configuration de commande ne peut plus être acceptée. Vérifiez votre panier.',
  abandoned: 'Cette tentative a été abandonnée avant la création de la commande.',
};

export function admissionRejection(admission: { rejection?: string | null }): ConflictException {
  const reason = (admission.rejection ?? 'invalid_order') as PublicOrderRejectionReason;
  return new ConflictException({ code: 'ORDER_ATTEMPT_REJECTED', reason, message: MESSAGES[reason] });
}

/**
 * Shared durable journal, not an authorization boundary. Callers authenticate
 * public proofs or staff access BEFORE invoking it. No calendar or pricing is
 * consulted when helping an already committed snapshot, including old C01.
 */
export class OrderAdmissionJournal {
  constructor(private readonly admissions: Model<PublicOrderAdmission>, private readonly orders: Model<Order>, private readonly redis: Redis) {}

  read(tenantId: string, clientId: string) {
    return this.admissions.findById(orderAdmissionId(tenantId, clientId)).select(PRIVATE)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }

  orderByClient(tenantId: string, clientId: string) {
    return this.orders.findOne({ tenantId, clientId }).select('+publicRecovery').read('primary').readConcern('majority').maxTimeMS(10_000);
  }

  async authenticated(tenantId: string, clientId: string, binding: OrderAdmissionBinding) {
    const admission = await this.read(tenantId, clientId);
    if (!admission) throw uncertain();
    assertOrderAdmissionBinding(admission, binding);
    return admission;
  }

  async begin(tenantId: string, clientId: string, binding: OrderAdmissionBinding, slot: Date) {
    const id = orderAdmissionId(tenantId, clientId);
    try {
      await this.admissions.updateOne({ _id: id }, { $setOnInsert: {
        _id: id, tenantId, clientId, ...binding, slot, state: 'validating', snapshot: null, rejection: null,
      } }, { upsert: true, ...DURABLE });
    } catch (error) {
      if (!await this.read(tenantId, clientId)) throw error;
    }
    const admission = await this.authenticated(tenantId, clientId, binding);
    if (!(admission.slot instanceof Date) || admission.slot.getTime() !== slot.getTime()) throw recoveryNotFound();
    return admission;
  }

  async claim(tenantId: string, clientId: string, binding: OrderAdmissionBinding): Promise<OrderAdmissionBinding | null> {
    await this.authenticated(tenantId, clientId, binding);
    const validationOwner = randomUUID();
    try {
      await this.admissions.updateOne({ _id: orderAdmissionId(tenantId, clientId), state: 'validating', validationOwner: null,
        ...orderAdmissionKindFilter(binding), proofHash: binding.proofHash, payloadHash: binding.payloadHash },
      { $set: { validationOwner } }, DURABLE);
    } catch { /* An ambiguous write may continue; only OUR observed owner authorizes work. */ }
    const observed = await this.authenticated(tenantId, clientId, binding);
    return observed.state === 'validating' && observed.validationOwner === validationOwner ? { ...binding, validationOwner } : null;
  }

  async releaseValidation(tenantId: string, clientId: string, binding: OrderAdmissionBinding): Promise<void> {
    if (!binding.validationOwner) return;
    await this.authenticated(tenantId, clientId, binding);
    await this.admissions.updateOne({ _id: orderAdmissionId(tenantId, clientId), state: 'validating', validationOwner: binding.validationOwner,
      ...orderAdmissionKindFilter(binding), proofHash: binding.proofHash, payloadHash: binding.payloadHash },
    { $set: { validationOwner: null } }, DURABLE);
  }

  async reject(tenantId: string, clientId: string, binding: OrderAdmissionBinding, reason: PublicOrderRejectionReason) {
    await this.authenticated(tenantId, clientId, binding);
    try {
      await this.admissions.updateOne({ _id: orderAdmissionId(tenantId, clientId), state: 'validating',
        ...orderAdmissionKindFilter(binding), proofHash: binding.proofHash, payloadHash: binding.payloadHash },
      { $set: { state: 'rejected', rejection: reason } }, DURABLE);
    } catch { /* A delayed commit may still win; reread the durable decision. */ }
    const admission = await this.authenticated(tenantId, clientId, binding);
    if (admission.state === 'validating') throw uncertain();
    return admission;
  }

  async candidateLost(tenantId: string, clientId: string, candidateId: unknown): Promise<boolean> {
    const admission = await this.read(tenantId, clientId);
    return Boolean(admission && (admission.state === 'rejected'
      || (['committing', 'created'].includes(admission.state) && String(admission.orderId) !== String(candidateId))));
  }

  /** Never adopts an unrelated order or changes a paid/cancelled/delivered order. */
  async committedOrder(admission: PublicOrderAdmission) {
    if (admission.state === 'rejected') throw admissionRejection(admission);
    if (!['committing', 'created'].includes(admission.state) || !admission.orderId) throw uncertain();
    const tenantId = String(admission.tenantId);
    const snapshot = admission.snapshot as Record<string, unknown> | null;
    if (admission.state === 'committing') {
      if (admission.kind === 'historical' || !snapshot || !(snapshot._id instanceof Types.ObjectId)
        || !(snapshot.tenantId instanceof Types.ObjectId)
        || String(snapshot._id) !== String(admission.orderId) || String(snapshot.tenantId) !== tenantId
        || snapshot.clientId !== admission.clientId || snapshot.channel !== orderAdmissionChannel(admission)) throw uncertain();
      const pickup = snapshot.pickup as { slot?: unknown } | null;
      if (!(pickup?.slot instanceof Date) || pickup.slot.getTime() !== admission.slot.getTime()) throw uncertain();
      this.assertOrderOrigin(snapshot as unknown as Order, admission);
      let writeError: unknown;
      try {
        await this.orders.updateOne({ _id: snapshot._id }, { $setOnInsert: snapshot },
          { upsert: true, runValidators: true, setDefaultsOnInsert: false, timestamps: false, ...DURABLE });
      } catch (error) { writeError = error; }
      const order = await this.orderByClient(tenantId, admission.clientId);
      if (!order) throw writeError ?? uncertain();
      this.assertOrderIdentity(order, admission);
      if (order.number !== snapshot.number) throw uncertain();
      void publishRedisBestEffort(this.redis, ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderCreated, payload: order.toObject() }));
      try {
        await this.admissions.updateOne({ _id: admission._id, state: 'committing', orderId: order._id },
          { $set: { state: 'created', snapshot: null } }, DURABLE);
      } catch { /* Retain the snapshot if acknowledgement failed. */ }
      return order;
    }
    const order = await this.orderByClient(tenantId, admission.clientId);
    if (!order) throw uncertain();
    this.assertOrderIdentity(order, admission);
    return order;
  }

  private assertOrderOrigin(order: Order, admission: PublicOrderAdmission) {
    if (isPublicOrderAdmission(admission)) {
      if (!admission.proofHash || !admission.payloadHash) throw uncertain();
      assertPublicRecoveryReplay(order, { version: 1, proofHash: admission.proofHash, payloadHash: admission.payloadHash });
    } else if (order.publicRecovery) throw recoveryNotFound();
  }

  private assertOrderIdentity(order: Order & { _id: unknown }, admission: PublicOrderAdmission) {
    const channel = admission.kind === 'historical' ? admission.channel : orderAdmissionChannel(admission);
    if (String(order._id) !== String(admission.orderId) || String(order.tenantId) !== String(admission.tenantId)
      || order.clientId !== admission.clientId || order.channel !== channel
      || !(order.pickup?.slot instanceof Date) || order.pickup.slot.getTime() !== admission.slot.getTime()) throw uncertain();
    this.assertOrderOrigin(order, admission);
  }
}
