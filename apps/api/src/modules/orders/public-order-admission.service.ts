import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import type Redis from 'ioredis';
import { ordersChannel, WS_EVENTS, type CreatePublicOrder, type PublicOrderRecoveryResult, type PublicOrderRejectionReason } from '@sm/contracts';
import type { Order, PublicOrderAdmission } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { assertPublicRecoveryReplay, publicRecoveryBinding, recoveryNotFound, recoveryProofHash, recoveryReceipt, sameRecoveryHash, type PublicRecoveryBinding } from './order-recovery';

const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const PRIVATE = '+proofHash +payloadHash +snapshot +validationOwner';
const MESSAGES: Record<PublicOrderRejectionReason, string> = {
  unavailable: 'Le restaurant ne peut pas accepter cette nouvelle commande pour le moment.',
  slot_unavailable: 'Ce créneau ne peut plus être réservé. Choisissez un autre créneau.',
  invalid_order: 'Cette configuration de commande ne peut plus être acceptée. Vérifiez votre panier.',
  abandoned: 'Cette tentative a été abandonnée avant la création de la commande.',
};

function admissionId(tenantId: string, clientId: string): string {
  return createHash('sha256').update(JSON.stringify(['sm.order-admission.v1', tenantId, clientId])).digest('hex');
}
function uncertain(): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'La création reste à vérifier. Reprenez cette même tentative.' });
}

/** Seul cet échec atteste qu'aucun CAS committing n'a encore été envoyé. */
export class PublicOrderSnapshotInvalid extends BadRequestException {
  constructor() { super('La configuration de la commande ne peut pas être enregistrée.'); }
}

/**
 * Protocole sans transaction : validating → committing(snapshot figé) OU rejected.
 * Une fois committing, aucun nouvel échec métier ne peut inventer un refus.
 * Tout lecteur peut matérialiser le snapshot par insert-only, jamais le recalculer.
 */
@Injectable()
export class PublicOrderAdmissionService {
  constructor(
    @InjectModel('PublicOrderAdmission') private readonly admissions: Model<PublicOrderAdmission>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  async begin(tenantId: string, body: CreatePublicOrder): Promise<PublicOrderRecoveryResult> {
    const binding = publicRecoveryBinding(tenantId, body);
    if (!binding) throw recoveryNotFound();
    // Jamais d'adoption : une clé appartenant à un ticket historique/POS ne
    // devient pas une identité publique par présentation d'une preuve neuve.
    const existing = await this.orderByClient(tenantId, body.clientId);
    if (existing) {
      assertPublicRecoveryReplay(existing, binding);
      return { state: 'created', order: recoveryReceipt(existing) };
    }
    const id = admissionId(tenantId, body.clientId);
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
    if (!admission || !sameRecoveryHash(admission.proofHash, recoveryProofHash(tenantId, clientId, proof))) throw recoveryNotFound();
    return this.result(admission);
  }

  /** Rejeu de POST : garde sa réponse historique complète, après preuve et empreinte. */
  async createdOrder(tenantId: string, body: CreatePublicOrder) {
    const order = await this.orderByClient(tenantId, body.clientId);
    if (!order) throw uncertain();
    assertPublicRecoveryReplay(order, publicRecoveryBinding(tenantId, body));
    return order;
  }

  /** Un seul validateur réserve promotion/numéro/quota. Aucun lease expirant ne le remplace. */
  async claimValidation(tenantId: string, clientId: string, binding: PublicRecoveryBinding): Promise<PublicRecoveryBinding | null> {
    await this.readAuthenticated(tenantId, clientId, binding);
    const validationOwner = randomUUID();
    try {
      await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', validationOwner: null },
        { $set: { validationOwner } }, DURABLE);
    } catch { /* Seule une lecture de notre owner permet de poursuivre après timeout. */ }
    const observed = await this.readAuthenticated(tenantId, clientId, binding);
    return observed.state === 'validating' && observed.validationOwner === validationOwner ? { ...binding, validationOwner } : null;
  }

  /** Seulement avant l'appel de création : un ancien propriétaire ne peut libérer son successeur. */
  async releaseValidation(tenantId: string, clientId: string, binding: PublicRecoveryBinding): Promise<void> {
    if (!binding.validationOwner) return;
    await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', validationOwner: binding.validationOwner,
      proofHash: binding.proofHash, payloadHash: binding.payloadHash }, { $set: { validationOwner: null } }, DURABLE);
  }

  async reject(tenantId: string, clientId: string, binding: PublicRecoveryBinding, reason: PublicOrderRejectionReason): Promise<PublicOrderRecoveryResult> {
    await this.readAuthenticated(tenantId, clientId, binding);
    try {
      await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', proofHash: binding.proofHash, payloadHash: binding.payloadHash },
        { $set: { state: 'rejected', rejection: reason } }, DURABLE);
    } catch {
      const observed = await this.readAuthenticated(tenantId, clientId, binding);
      if (observed.state === 'validating') throw uncertain();
    }
    return this.result(await this.readAuthenticated(tenantId, clientId, binding));
  }

  async commit(tenantId: string, clientId: string, binding: PublicRecoveryBinding, candidate: Record<string, unknown>) {
    if (!binding.validationOwner || String(candidate.tenantId) !== tenantId || candidate.clientId !== clientId || candidate.channel !== 'online') throw uncertain();
    const now = new Date();
    const document = new this.orders({ ...candidate, publicRecovery: binding, createdAt: now, updatedAt: now, __v: 0 });
    try { await document.validate(); } catch { throw new PublicOrderSnapshotInvalid(); }
    const snapshot = document.toObject({ transform: false });
    await this.readAuthenticated(tenantId, clientId, binding);
    try {
      await this.admissions.updateOne({ _id: admissionId(tenantId, clientId), state: 'validating', validationOwner: binding.validationOwner, proofHash: binding.proofHash, payloadHash: binding.payloadHash },
        { $set: { state: 'committing', snapshot, orderId: snapshot._id } }, DURABLE);
    } catch {
      const observed = await this.readAuthenticated(tenantId, clientId, binding);
      if (observed.state === 'validating') throw uncertain();
    }
    const admission = await this.readAuthenticated(tenantId, clientId, binding);
    if (admission.state === 'rejected') throw this.rejectionError(admission);
    if (admission.state !== 'committing' && admission.state !== 'created') throw uncertain();
    const order = admission.state === 'created' ? await this.confirmedOrder(admission) : await this.materialize(admission);
    return { order, created: String(order._id) === String(snapshot._id) };
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
    const snapshot = admission.snapshot as Record<string, unknown> | null;
    if (!snapshot?._id || !snapshot.publicRecovery) throw uncertain();
    let writeError: unknown;
    try {
      await this.orders.updateOne({ _id: snapshot._id }, { $setOnInsert: snapshot },
        { upsert: true, runValidators: true, setDefaultsOnInsert: false, timestamps: false, ...DURABLE });
    } catch (error) { writeError = error; }
    const order = await this.orderByClient(String(admission.tenantId), admission.clientId);
    if (!order) throw writeError ?? uncertain();
    const binding = { version: 1 as const, proofHash: admission.proofHash, payloadHash: admission.payloadHash };
    assertPublicRecoveryReplay(order, binding);
    if (String(order._id) !== String(snapshot._id) || order.number !== snapshot.number) throw uncertain();
    // Diffusion best-effort répétable : les consommateurs réconcilient par _id. Aucun effet
    // monétaire/fidélité n'est lancé ici, et aucune donnée privée n'est diffusée.
    void publishRedisBestEffort(this.redis, ordersChannel(String(admission.tenantId)), JSON.stringify({ event: WS_EVENTS.orderCreated, payload: order.toObject() }));
    try {
      await this.admissions.updateOne({ _id: admission._id, state: 'committing', orderId: order._id },
        { $set: { state: 'created', snapshot: null } }, DURABLE);
    } catch { /* Snapshot conservé si nettoyage incertain, jamais vente ni preuve effacées. */ }
    return order;
  }

  private async confirmedOrder(admission: PublicOrderAdmission) {
    const order = await this.orderByClient(String(admission.tenantId), admission.clientId);
    if (!order || String(order._id) !== String(admission.orderId)) throw uncertain();
    assertPublicRecoveryReplay(order, { version: 1, proofHash: admission.proofHash, payloadHash: admission.payloadHash });
    return order;
  }

  private async readAuthenticated(tenantId: string, clientId: string, binding: PublicRecoveryBinding) {
    const admission = await this.read(admissionId(tenantId, clientId));
    if (!admission) throw uncertain();
    assertPublicRecoveryReplay({ channel: 'online', publicRecovery: admission } as Pick<Order, 'channel' | 'publicRecovery'>, binding);
    return admission;
  }

  private read(id: string) {
    return this.admissions.findById(id).select(PRIVATE).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }
  private orderByClient(tenantId: string, clientId: string) {
    return this.orders.findOne({ tenantId, clientId }).select('+publicRecovery').read('primary').readConcern('majority').maxTimeMS(10_000);
  }
}
