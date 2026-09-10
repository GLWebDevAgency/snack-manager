import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import type Redis from 'ioredis';
import { type CreateOrder, type CreatePublicOrder, type PublicOrderRecoveryResult, type PublicOrderRejectionReason } from '@sm/contracts';
import type { Order, OrderCapacityDay, PublicOrderAdmission, Tenant } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { assertPublicRecoveryReplay, publicRecoveryBinding, recoveryNotFound, recoveryProofHash, recoveryReceipt, sameRecoveryHash, type PublicRecoveryBinding } from './order-recovery';
import { internalOrderAdmissionBinding, isPublicOrderAdmission, orderAdmissionChannel, orderAdmissionId as admissionId, orderAdmissionKindFilter, type OrderAdmissionBinding } from './order-admission-identity';
import { OrderAdmissionJournal } from './order-admission-journal';
import { OrderCapacityCommitStore } from './order-capacity-commit.store';
import { OrderCapacityCalendarStore } from '../ordering/order-capacity-calendar.store';
import { formatDay, parisYmd } from '../ordering/paris-time';
import { unavailable, validateControl } from '../ordering/order-capacity-control';
import { assertOrderSlotFresh } from '../ordering/order-slot-freshness';
import { validCustomerOrderOwner, type CustomerOrderOwner, type CustomerOrderCommitAuthority } from './customer-order-owner';
import { PublicOrderSnapshotInvalid } from './order-admission.errors';
export { PublicOrderSnapshotInvalid } from './order-admission.errors';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const PRIVATE = '+kind +channel +proofHash +payloadHash +snapshot +validationOwner +customerOwner';
const MESSAGES: Record<PublicOrderRejectionReason, string> = {
  unavailable: 'Le restaurant ne peut pas accepter cette nouvelle commande pour le moment.',
  slot_unavailable: 'Ce créneau ne peut plus être réservé. Choisissez un autre créneau.',
  invalid_order: 'Cette configuration de commande ne peut plus être acceptée. Vérifiez votre panier.',
  abandoned: 'Cette tentative a été abandonnée avant la création de la commande.',
};

function uncertain(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'La création reste à vérifier. Reprenez cette même tentative.' });
}

/**
 * Protocole sans transaction : validating → committing(snapshot figé) OU rejected.
 * Une fois committing, aucun nouvel échec métier ne peut inventer un refus.
 * Tout lecteur peut matérialiser le snapshot par insert-only, jamais le recalculer.
 */
@Injectable()
export class PublicOrderAdmissionService {
  private readonly journal: OrderAdmissionJournal;
  private readonly capacity: OrderCapacityCommitStore;
  private readonly calendar: OrderCapacityCalendarStore;
  constructor(
    @InjectModel('PublicOrderAdmission') private readonly admissions: Model<PublicOrderAdmission>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    @InjectModel('OrderCapacityDay') days: Model<OrderCapacityDay>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
  ) {
    this.journal = new OrderAdmissionJournal(admissions, orders, redis);
    this.capacity = new OrderCapacityCommitStore(admissions, orders, days);
    this.calendar = new OrderCapacityCalendarStore(tenants, days, admissions, orders);
  }

  /** Route-authenticated internal admission. Never used by the public recovery endpoint. */
  async prepareInternal(tenantId: string, dto: CreateOrder, kind: 'legacy' | 'staff') {
    const binding = internalOrderAdmissionBinding(kind, tenantId, dto);
    let admission = await this.journal.read(tenantId, dto.clientId);
    if (admission?.kind === 'historical') {
      if (admission.channel !== dto.channel) throw recoveryNotFound();
      return { order: await this.journal.committedOrder(admission), binding: null };
    }
    if (admission) {
      admission = await this.journal.authenticated(tenantId, dto.clientId, binding);
      if (admission.state !== 'validating') return { order: await this.journal.committedOrder(admission), binding: null };
    } else {
      const existing = await this.orderByClient(tenantId, dto.clientId);
      if (existing) {
        if (existing.channel !== dto.channel) throw recoveryNotFound();
        assertPublicRecoveryReplay(existing);
        return { order: existing, binding: null };
      }
      if (!dto.pickup) throw new BadRequestException('Un créneau est requis.');
      if (kind === 'staff') {
        // Même un rejet neuf n'est admis qu'après activation. En revanche,
        // une décision existante committing/created a déjà été reprise ci-dessus.
        const tenant = await this.tenants.findById(tenantId).select('_id capacityControl')
          .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
        if (!tenant?.capacityControl) throw unavailable();
        validateControl(tenant.capacityControl);
        if (tenant.capacityControl.state !== 'active') throw unavailable();
      }
    }
    if (!dto.pickup) throw new BadRequestException('Un créneau est requis.');
    if (kind === 'staff') {
      try { assertOrderSlotFresh(dto.pickup.slot); }
      catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        // Une horloge expirée n'est pas une preuve d'absence d'effet : fermer
        // la même identité par CAS avant de laisser le POS modifier son ticket.
        if (!admission) admission = await this.journal.begin(tenantId, dto.clientId, binding, new Date(dto.pickup.slot));
        const closed = await this.journal.reject(tenantId, dto.clientId, binding, 'slot_unavailable');
        return { order: await this.journal.committedOrder(closed), binding: null };
      }
    }
    if (!admission) {
      await this.calendar.ensureDay(tenantId, formatDay(parisYmd(new Date(dto.pickup.slot))));
      admission = await this.journal.begin(tenantId, dto.clientId, binding, new Date(dto.pickup.slot));
      if (admission.state !== 'validating') return { order: await this.journal.committedOrder(admission), binding: null };
    }
    const owner = await this.journal.claim(tenantId, dto.clientId, binding);
    if (!owner) throw uncertain();
    return { order: null, binding: owner };
  }

  async rejectInternal(tenantId: string, clientId: string, binding: OrderAdmissionBinding, reason: PublicOrderRejectionReason) {
    if (isPublicOrderAdmission(binding)) throw recoveryNotFound();
    const admission = await this.journal.reject(tenantId, clientId, binding, reason);
    if (admission.state === 'rejected') throw this.rejectionError(admission);
    return this.journal.committedOrder(admission);
  }

  async releaseInternalValidation(tenantId: string, clientId: string, binding: OrderAdmissionBinding) {
    if (isPublicOrderAdmission(binding)) throw recoveryNotFound();
    return this.journal.releaseValidation(tenantId, clientId, binding);
  }

  async commitInternal(tenantId: string, clientId: string, binding: OrderAdmissionBinding, candidate: Record<string, unknown>) {
    if (isPublicOrderAdmission(binding)) throw recoveryNotFound();
    return this.commitCandidate(tenantId, clientId, binding, candidate);
  }

  releaseCancelled(tenantId: string, clientId: string) { return this.capacity.releaseCancelled(tenantId, clientId); }

  /** No insertion for a read. An explicit abandonment creates a terminal
   * identity even if the original POST has not arrived yet. */
  async observeInternal(tenantId: string, dto: CreateOrder, kind: 'legacy' | 'staff', abandon = false) {
    const binding = internalOrderAdmissionBinding(kind, tenantId, dto);
    let admission = await this.journal.read(tenantId, dto.clientId);
    if (admission?.kind === 'historical') {
      if (admission.channel !== dto.channel) throw recoveryNotFound();
      return { state: 'created' as const, order: await this.journal.committedOrder(admission) };
    }
    if (!admission) {
      const order = await this.orderByClient(tenantId, dto.clientId);
      if (order) {
        if (order.channel !== dto.channel) throw recoveryNotFound();
        assertPublicRecoveryReplay(order);
        return { state: 'created' as const, order };
      }
      if (!abandon) return { state: 'pending' as const };
      if (!dto.pickup) throw new BadRequestException('Un créneau est requis.');
      admission = await this.journal.begin(tenantId, dto.clientId, binding, new Date(dto.pickup.slot));
    } else admission = await this.journal.authenticated(tenantId, dto.clientId, binding);
    if (abandon && admission.state === 'validating') admission = await this.journal.reject(tenantId, dto.clientId, binding, 'abandoned');
    if (admission.state === 'validating') return { state: 'pending' as const };
    if (admission.state === 'rejected') {
      const reason = (admission.rejection ?? 'invalid_order') as PublicOrderRejectionReason;
      return { state: 'rejected' as const, code: 'ORDER_ATTEMPT_REJECTED' as const, reason, message: MESSAGES[reason] };
    }
    return { state: 'created' as const, order: await this.journal.committedOrder(admission) };
  }

  async begin(tenantId: string, body: CreatePublicOrder, customerOwner?: CustomerOrderOwner): Promise<PublicOrderRecoveryResult> {
    const binding = publicRecoveryBinding(tenantId, body, customerOwner);
    if (!binding) throw recoveryNotFound();
    // Jamais d'adoption : une clé appartenant à un ticket historique/POS ne
    // devient pas une identité publique par présentation d'une preuve neuve.
    const existing = await this.orderByClient(tenantId, body.clientId);
    if (existing) {
      assertPublicRecoveryReplay(existing, binding);
      // An Order may exist while its insert acknowledgement is still lost.
      // Resume the winning journal (including private attribution equality),
      // not a shortcut that leaves its snapshot unverified indefinitely.
      if (await this.read(admissionId(tenantId, body.clientId))) {
        const admission = await this.readAuthenticated(tenantId, body.clientId, binding);
        if (!['committing', 'created'].includes(admission.state)) throw uncertain();
        return this.result(admission);
      }
      return { state: 'created', order: recoveryReceipt(existing) };
    }
    const id = admissionId(tenantId, body.clientId);
    if (!await this.read(id)) {
      // No fresh admission while the initial bootstrap is absent or seeding.
      // Old binaries must still be drained before that one-way cutover.
      const tenant = await this.tenants.findById(tenantId).select('+capacityControl')
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (!tenant?.capacityControl) throw unavailable();
      validateControl(tenant.capacityControl);
      if (tenant.capacityControl.state !== 'active') throw unavailable();
    }
    try {
      await this.admissions.updateOne({ _id: id }, { $setOnInsert: {
        _id: id, tenantId, clientId: body.clientId, ...binding,
        slot: new Date(body.pickup.slot), state: 'validating', snapshot: null, rejection: null,
      } }, { upsert: true, ...DURABLE });
    } catch (error) {
      // Un timeout peut avoir gagné : la lecture majorité décide, pas l'erreur.
      const existingAdmission = await this.read(id);
      if (!existingAdmission) throw error;
    }
    const admission = await this.readAuthenticated(tenantId, body.clientId, binding);
    return this.result(admission);
  }

  async recover(tenantId: string, clientId: string, proof: string): Promise<PublicOrderRecoveryResult> {
    const admission = await this.read(admissionId(tenantId, clientId));
    if (!admission || !isPublicOrderAdmission(admission) || orderAdmissionChannel(admission) !== 'online'
      || !sameRecoveryHash(admission.proofHash, recoveryProofHash(tenantId, clientId, proof))) throw recoveryNotFound();
    return this.result(admission);
  }

  /** The one-order capability may close its own pending attempt after logout.
   * It cannot choose or change the account stored by the original admission. */
  async abandon(tenantId: string, body: CreatePublicOrder): Promise<PublicOrderRecoveryResult> {
    const admission = await this.read(admissionId(tenantId, body.clientId));
    if (!admission) {
      const state = await this.begin(tenantId, body);
      if (state.state !== 'pending') return state;
      return this.reject(tenantId, body.clientId, publicRecoveryBinding(tenantId, body)!, 'abandoned');
    }
    const storedOwner = admission.customerOwner;
    if (storedOwner != null && !validCustomerOrderOwner(storedOwner)) throw recoveryNotFound();
    const binding = publicRecoveryBinding(tenantId, body, storedOwner ?? undefined);
    if (!binding) throw recoveryNotFound();
    await this.readAuthenticated(tenantId, body.clientId, binding);
    return this.reject(tenantId, body.clientId, binding, 'abandoned');
  }

  /** Rejeu de POST : garde sa réponse historique complète, après preuve et empreinte. */
  async createdOrder(tenantId: string, body: CreatePublicOrder, customerOwner?: CustomerOrderOwner) {
    const order = await this.orderByClient(tenantId, body.clientId);
    if (!order) throw uncertain();
    const binding = publicRecoveryBinding(tenantId, body, customerOwner);
    assertPublicRecoveryReplay(order, binding);
    if (binding && await this.read(admissionId(tenantId, body.clientId))) {
      const admission = await this.readAuthenticated(tenantId, body.clientId, binding);
      if (!['committing', 'created'].includes(admission.state)) throw uncertain();
      return this.journal.committedOrder(admission);
    }
    return order;
  }

  /** Un seul validateur réserve promotion/numéro/quota. Aucun lease expirant ne le remplace. */
  async claimValidation(tenantId: string, clientId: string, binding: PublicRecoveryBinding): Promise<PublicRecoveryBinding | null> {
    await this.readAuthenticated(tenantId, clientId, binding);
    const validationOwner = randomUUID();
    try {
      await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', validationOwner: null, ...orderAdmissionKindFilter(binding) },
        { $set: { validationOwner } }, DURABLE);
    } catch { /* Seule une lecture de notre owner permet de poursuivre après timeout. */ }
    const observed = await this.readAuthenticated(tenantId, clientId, binding);
    return observed.state === 'validating' && observed.validationOwner === validationOwner ? { ...binding, validationOwner } : null;
  }

  /** Seulement avant l'appel de création : un ancien propriétaire ne peut libérer son successeur. */
  async releaseValidation(tenantId: string, clientId: string, binding: PublicRecoveryBinding): Promise<void> {
    if (!binding.validationOwner) return;
    await this.readAuthenticated(tenantId, clientId, binding);
    await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', validationOwner: binding.validationOwner, ...orderAdmissionKindFilter(binding),
      proofHash: binding.proofHash, payloadHash: binding.payloadHash }, { $set: { validationOwner: null } }, DURABLE);
  }

  async reject(tenantId: string, clientId: string, binding: PublicRecoveryBinding, reason: PublicOrderRejectionReason): Promise<PublicOrderRecoveryResult> {
    await this.readAuthenticated(tenantId, clientId, binding);
    try {
      await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', proofHash: binding.proofHash, payloadHash: binding.payloadHash, ...orderAdmissionKindFilter(binding) },
        { $set: { state: 'rejected', rejection: reason } }, DURABLE);
    } catch {
      const observed = await this.readAuthenticated(tenantId, clientId, binding);
      if (observed.state === 'validating') throw uncertain();
    }
    return this.result(await this.readAuthenticated(tenantId, clientId, binding));
  }

  async commit(tenantId: string, clientId: string, binding: PublicRecoveryBinding, candidate: Record<string, unknown>, beforeCommit?: CustomerOrderCommitAuthority) {
    await this.readAuthenticated(tenantId, clientId, binding);
    return this.commitCandidate(tenantId, clientId, binding, candidate, beforeCommit);
  }

  private async commitCandidate(tenantId: string, clientId: string, binding: OrderAdmissionBinding, candidate: Record<string, unknown>, beforeCommit?: CustomerOrderCommitAuthority) {
    const admission = await this.journal.authenticated(tenantId, clientId, binding);
    if (admission.state !== 'validating') return { order: await this.journal.committedOrder(admission), created: false };
    if (!binding.validationOwner) throw uncertain();
    const slot = (candidate.pickup as { slot?: unknown } | null)?.slot;
    if (!(slot instanceof Date) || !Number.isFinite(slot.getTime()) || slot.getTime() !== admission.slot.getTime()) throw new PublicOrderSnapshotInvalid();
    const day = await this.calendar.ensureDay(tenantId, formatDay(parisYmd(slot)));
    if (!day.slots.some((entry) => entry.at.getTime() === slot.getTime())) {
      const closed = await this.journal.reject(tenantId, clientId, binding, 'slot_unavailable');
      return { order: await this.journal.committedOrder(closed), created: false };
    }
    const outcome = await this.capacity.commit(tenantId, clientId, binding, candidate, beforeCommit);
    if (outcome.state === 'stale') throw uncertain();
    const observed = outcome.state === 'full'
      ? await this.journal.reject(tenantId, clientId, binding, 'slot_unavailable')
      : await this.journal.authenticated(tenantId, clientId, binding);
    const order = await this.journal.committedOrder(observed);
    return { order, created: String(order._id) === String(candidate._id) };
  }

  /** Compensation autorisée uniquement si la lecture prouve que CE snapshot n'a pas gagné. */
  async candidateLost(tenantId: string, clientId: string, candidateId: unknown): Promise<boolean> {
    const admission = await this.read(admissionId(tenantId, clientId));
    if (!admission) return false;
    // Un timeout n'annule pas un write en vol. `validating` seul n'exclut
    // pas qu'un CAS committing retardé gagne APRÈS cette lecture.
    return admission.state === 'rejected'
      || (['committing', 'created'].includes(admission.state) && String(admission.orderId) !== String(candidateId));
  }

  async assertLegacyKeyAvailable(tenantId: string, clientId: string): Promise<void> {
    if (await this.read(admissionId(tenantId, clientId))) throw recoveryNotFound();
  }

  /** Sous le verrou créneau AVANT le comptage : aucun snapshot engagé invisible. */
  async materializeSlot(tenantId: string, slot: string): Promise<void> {
    const pending = await this.admissions.find({ tenantId, slot: new Date(slot), state: 'committing' }).select(PRIVATE)
      .read('primary').readConcern('majority').maxTimeMS(10_000).limit(201).lean();
    if (pending.length > 200) throw uncertain();
    for (const admission of pending) await this.materialize(admission);
  }

  rejectionError(admission: { rejection?: string | null }): ConflictException {
    const reason = (admission.rejection ?? 'invalid_order') as PublicOrderRejectionReason;
    return new ConflictException({ code: 'ORDER_ATTEMPT_REJECTED', reason, message: MESSAGES[reason] });
  }

  private async result(admission: PublicOrderAdmission): Promise<PublicOrderRecoveryResult> {
    if (admission.state === 'rejected') {
      const reason = (admission.rejection ?? 'invalid_order') as PublicOrderRejectionReason;
      return { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason, message: MESSAGES[reason] };
    }
    if (admission.state === 'committing') return { state: 'created', order: recoveryReceipt(await this.materialize(admission)) };
    if (admission.state === 'created') return { state: 'created', order: recoveryReceipt(await this.confirmedOrder(admission)) };
    return { state: 'pending' };
  }

  private async materialize(admission: PublicOrderAdmission) {
    return this.journal.committedOrder(admission);
  }

  private async confirmedOrder(admission: PublicOrderAdmission) {
    return this.journal.committedOrder(admission);
  }

  private async readAuthenticated(tenantId: string, clientId: string, binding: OrderAdmissionBinding) {
    if (!isPublicOrderAdmission(binding) || orderAdmissionChannel(binding) !== 'online') throw recoveryNotFound();
    const admission = await this.read(admissionId(tenantId, clientId));
    if (!admission) throw uncertain();
    if (!isPublicOrderAdmission(admission) || orderAdmissionChannel(admission) !== 'online') throw recoveryNotFound();
    assertPublicRecoveryReplay({ channel: 'online', publicRecovery: {
      version: admission.version, proofHash: admission.proofHash ?? '', payloadHash: admission.payloadHash ?? '',
    }, customerOwner: admission.customerOwner }, binding);
    return admission;
  }

  private read(id: string) {
    return this.admissions.findById(id).select(PRIVATE).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }
  private orderByClient(tenantId: string, clientId: string) {
    return this.orders.findOne({ tenantId, clientId }).select('+publicRecovery +customerOwner').read('primary').readConcern('majority').maxTimeMS(10_000);
  }
}
