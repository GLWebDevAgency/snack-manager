import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'node:crypto';
import { Model } from 'mongoose';
import type Redis from 'ioredis';
import {
  DELIVERY_HANDOFF_MAX_OPERATIONS, DELIVERY_HANDOFF_TTL_MS, DeliveryCustomerProofSchema,
  DeliveryHandoffIncidentSchema, DeliveryHandoffReasonSchema, DeliveryHandoffResolveSchema, DeliveryHandoffResultSchema,
  DeliveryHandoffSubmitSchema, DeliveryProofRequestSchema, capacitesEffectives, isAccessBlocked, ordersChannel, WS_EVENTS,
  type DeliveryHandoffAction, type DeliveryHandoffIncident, type DeliveryHandoffReason, type DeliveryHandoffResolve,
  type DeliveryHandoffResult, type DeliveryHandoffSubmit, type DeliveryHandoffRefusalCode, type DeliveryProofRequest, type JwtPayload,
} from '@sm/contracts';
import type { Order, Tenant } from '@sm/db';
import { SOUSCRIPTION_FIELDS } from '../../common/capacites';
import { REDIS_PUB } from '../../redis.module';
import { AuditService, type AuditActor } from '../audit/audit.module';
import { recoveryProofHash, sameRecoveryHash } from '../orders/order-recovery';
import { DeliveryAccessService, type DeliveryAccessSession } from './delivery-access.service';
import { createDeliveryHandoffCrypto } from './delivery-handoff.crypto';
import { HANDOFF_PROJECTION, eligibility, emptyHandoff, handoffView, proofAvailability,
  type HandoffOperation, type HandoffOrder, type HandoffProof, type HandoffRecord } from './delivery-handoff.projection';

const MANAGERS = ['owner', 'cogerant', 'gerant'];
const WRITE_CONCERN = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const active = ['new', 'preparing', 'ready'];
const unavailable = () => new NotFoundException({ code: 'DELIVERY_HANDOFF_NOT_FOUND', message: 'Remise de livraison introuvable.' });
const invalid = () => new BadRequestException({ code: 'DELIVERY_HANDOFF_INPUT_INVALID', message: 'Paramètres de remise invalides.' });
const changed = () => new ConflictException({ code: 'DELIVERY_HANDOFF_CHANGED', message: 'Cette livraison a changé. Vérifiez la remise avant une nouvelle action.' });
const conflict = () => new ConflictException({ code: 'DELIVERY_HANDOFF_OPERATION_CONFLICT', message: 'Cette opération correspond à une autre action.' });
const uncertain = () => new ServiceUnavailableException({ code: 'DELIVERY_HANDOFF_UNCERTAIN', message: 'La confirmation reste à vérifier. Reprenez cette même opération.' });
type Principal = { kind: 'manager'; actor: JwtPayload } | { kind: 'courier'; access: DeliveryAccessSession };
type Input = DeliveryHandoffSubmit | DeliveryHandoffIncident | DeliveryHandoffReason | DeliveryHandoffResolve;

@Injectable()
export class DeliveryHandoffService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly access: DeliveryAccessService,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private crypto() {
    try { return createDeliveryHandoffCrypto(this.config.get<string>('DELIVERY_HANDOFF_KEY') ?? ''); }
    catch { throw uncertain(); }
  }

  private async tenant(tenantId: string) {
    if (!/^[a-f0-9]{24}$/.test(tenantId)) throw new ForbiddenException();
    const tenant = await this.tenants.findById(tenantId, { ...SOUSCRIPTION_FIELDS, 'account.status': 1 })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean().catch(() => { throw uncertain(); });
    if (!tenant || isAccessBlocked(tenant.account?.status) || !capacitesEffectives(tenant).includes('delivery')) throw new ForbiddenException();
  }

  private async authorize(tenantId: string, principal: Principal, managerOnly = false) {
    if (principal.kind === 'courier') {
      if (managerOnly || principal.access.tenantId !== tenantId) throw new ForbiddenException();
      await this.access.revalidate(principal.access);
    } else {
      const actor = principal.actor;
      if (!['user', 'staff'].includes(actor.kind) || actor.tenantId !== tenantId
        || !(managerOnly ? MANAGERS : [...MANAGERS, 'caisse']).includes(actor.role)) throw new ForbiddenException();
      await this.tenant(tenantId);
    }
  }

  private identity(principal: Principal) {
    return principal.kind === 'courier'
      ? { actorKind: 'delivery' as const, actorId: principal.access.operatorId, actorRole: 'livreur', actorName: principal.access.session.name }
      : { actorKind: principal.actor.kind as 'user' | 'staff', actorId: principal.actor.sub, actorRole: principal.actor.role, actorName: null };
  }

  private async read(filter: Record<string, unknown>): Promise<HandoffOrder> {
    const row = await this.orders.findOne(filter, HANDOFF_PROJECTION).read('primary').readConcern('majority').maxTimeMS(10_000)
      .lean<HandoffOrder | null>().catch(() => { throw uncertain(); });
    if (!row) throw unavailable();
    const h = row.deliveryHandoff;
    const m = row.deliveryMission;
    if ((h && (h.version !== 1 || !Number.isSafeInteger(h.revision) || h.revision < 0 || !Array.isArray(h.operations)
      || h.operations.length > DELIVERY_HANDOFF_MAX_OPERATIONS))
      || (m && (m.version !== 1 || !Number.isSafeInteger(m.revision) || m.revision < 0))) throw uncertain();
    return row;
  }

  private async row(tenantId: string, id: string, principal: Principal, operationId?: string) {
    if (!/^[a-f0-9]{24}$/.test(id)) throw unavailable();
    const filter: Record<string, unknown> = { _id: id, tenantId, type: 'delivery' };
    if (principal.kind === 'courier') {
      const assigned = { 'deliveryMission.assignment.operatorId': principal.access.operatorId };
      // Closed-order recovery returns ONLY the non-PII handoff state/receipt.
      // No general mission/customer scope is enlarged.
      Object.assign(filter, operationId ? { $or: [assigned, { 'deliveryHandoff.operations': { $elemMatch: {
        operationId, actorKind: 'delivery', actorId: principal.access.operatorId,
      } } }] } : { ...assigned, status: { $in: active } });
    }
    return this.read(filter);
  }

  private async get(tenantId: string, id: string, principal: Principal) {
    await this.authorize(tenantId, principal);
    const row = await this.row(tenantId, id, principal);
    await this.authorize(tenantId, principal);
    return handoffView(row, principal.kind === 'manager' && MANAGERS.includes(principal.actor.role));
  }
  getManager(tenantId: string, id: string, actor: JwtPayload) { return this.get(tenantId, id, { kind: 'manager', actor }); }
  getCourier(access: DeliveryAccessSession, id: string) { return this.get(access.tenantId, id, { kind: 'courier', access }); }
  confirmManager(tenantId: string, id: string, input: DeliveryHandoffSubmit, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, 'handoff'); }
  confirmCourier(access: DeliveryAccessSession, id: string, input: DeliveryHandoffSubmit) { return this.mutate(access.tenantId, id, input, { kind: 'courier', access }, 'handoff'); }
  incidentManager(tenantId: string, id: string, input: DeliveryHandoffIncident, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, 'incident'); }
  incidentCourier(access: DeliveryAccessSession, id: string, input: DeliveryHandoffIncident) { return this.mutate(access.tenantId, id, input, { kind: 'courier', access }, 'incident'); }
  override(tenantId: string, id: string, input: DeliveryHandoffReason, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, 'override'); }
  rotate(tenantId: string, id: string, input: DeliveryHandoffReason, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, 'rotate'); }
  resolveManager(tenantId: string, id: string, input: DeliveryHandoffResolve, actor: JwtPayload) { return this.mutate(tenantId, id, input, { kind: 'manager', actor }, input.action, true); }
  resolveCourier(access: DeliveryAccessSession, id: string, input: DeliveryHandoffResolve) { return this.mutate(access.tenantId, id, input, { kind: 'courier', access }, input.action, true); }

  private context(row: HandoffOrder, proof: HandoffProof) {
    return { tenantId: String(row.tenantId), orderId: String(row._id), proofId: proof.id, expiresAt: new Date(proof.expiresAt).toISOString() };
  }
  private newProof(row: HandoffOrder, expiresAt: Date): HandoffProof {
    const proof = { id: randomUUID(), createdAt: new Date(), expiresAt, failedAttempts: 0,
      assignmentId: row.deliveryMission?.assignment?.assignmentId ?? null, sealed: '' };
    proof.sealed = this.crypto().create(this.context(row, proof)).sealed;
    return proof;
  }
  private cas(row: HandoffOrder) {
    return { _id: row._id, tenantId: row.tenantId, type: 'delivery', status: row.status, __v: row.__v ?? { $exists: false },
      ...(row.deliveryMission ? { 'deliveryMission.version': 1, 'deliveryMission.revision': row.deliveryMission.revision,
        'deliveryMission.assignment.assignmentId': row.deliveryMission.assignment?.assignmentId ?? null } : { deliveryMission: null }),
      ...(row.deliveryHandoff ? { 'deliveryHandoff.version': 1, 'deliveryHandoff.revision': row.deliveryHandoff.revision } : { deliveryHandoff: null }) };
  }
  private financialFence() {
    return { status: 'ready', 'payment.status': 'paid', 'payment.refundedCents': { $in: [0, null] },
      'payment.pendingRefundCents': { $in: [0, null] }, 'paymentFlow.phase': { $in: [null, 'settled'] },
      'delivery.dispatchedAt': { $ne: null }, 'delivery.deliveredAt': null };
  }
  private room(record: HandoffRecord) {
    if (record.revision === Number.MAX_SAFE_INTEGER || record.operations.length >= DELIVERY_HANDOFF_MAX_OPERATIONS) {
      throw new ConflictException({ code: 'DELIVERY_HANDOFF_LIMIT', message: 'Le journal de remise est complet. Contactez le responsable.' });
    }
  }

  /** The purchaser capability is C01 recoveryProof, never the operational tracking token. */
  async customerProof(id: string, raw: DeliveryProofRequest) {
    const parsed = DeliveryProofRequestSchema.safeParse(raw);
    if (!parsed.success) throw invalid();
    if (!/^[a-f0-9]{24}$/.test(id)) throw unavailable();
    const input = parsed.data;
    const read = async () => {
      const row = await this.read({ _id: id, clientId: input.clientId, channel: 'online', type: 'delivery' });
      if (row.publicRecovery?.version !== 1 || !sameRecoveryHash(row.publicRecovery.proofHash,
        recoveryProofHash(String(row.tenantId), input.clientId, input.recoveryProof))) throw unavailable();
      await this.tenant(String(row.tenantId));
      const refusal = eligibility(row);
      if (refusal) throw new ConflictException({ code: 'DELIVERY_PROOF_UNAVAILABLE', message: 'Le code sera disponible pour une livraison prête, payée et partie.' });
      if (row.deliveryHandoff?.incident) throw new ConflictException({ code: 'DELIVERY_PROOF_UNAVAILABLE', message: 'Un incident est en cours de vérification par le responsable.' });
      return row;
    };
    // Read-only re-display. Only the first authorized request creates the encrypted epoch.
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await read();
      if (row.deliveryHandoff?.proof) {
        if (proofAvailability(row)) throw new ConflictException({ code: 'DELIVERY_PROOF_UNAVAILABLE', message: 'Ce code nécessite une vérification du responsable.' });
        let secrets;
        try { secrets = this.crypto().open(this.context(row, row.deliveryHandoff.proof), row.deliveryHandoff.proof.sealed); }
        catch { throw uncertain(); }
        return DeliveryCustomerProofSchema.parse({ missionId: id, proofId: row.deliveryHandoff.proof.id, pin: secrets.pin,
          qr: `sm-handoff:v1:${id}:${row.deliveryHandoff.proof.id}:${secrets.qrToken}`, expiresAt: new Date(row.deliveryHandoff.proof.expiresAt).toISOString() });
      }
      const record = row.deliveryHandoff ?? emptyHandoff();
      this.room(record);
      const expiresAt = new Date(new Date(row.delivery!.dispatchedAt!).getTime() + DELIVERY_HANDOFF_TTL_MS);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        throw new ConflictException({ code: 'DELIVERY_PROOF_UNAVAILABLE', message: 'Le délai de remise nécessite une vérification du responsable.' });
      }
      const next = { ...record, revision: record.revision + 1, proof: this.newProof(row, expiresAt) };
      try {
        await this.orders.updateOne({ ...this.cas(row), ...this.financialFence() }, { $set: { deliveryHandoff: next }, $inc: { __v: 1 } },
          { runValidators: true, writeConcern: WRITE_CONCERN });
      } catch {
        // An ACK timeout must be proven by a fresh majority read, not interpreted as absence.
        const current = await read().catch(() => { throw uncertain(); });
        if (!current.deliveryHandoff?.proof) throw uncertain();
      }
    }
    throw uncertain();
  }

  private async mutate(tenantId: string, id: string, raw: Input, principal: Principal, action: DeliveryHandoffAction, resolving = false, attempt = 0): Promise<DeliveryHandoffResult> {
    const schema = resolving ? DeliveryHandoffResolveSchema : action === 'handoff' ? DeliveryHandoffSubmitSchema
      : action === 'incident' ? DeliveryHandoffIncidentSchema : DeliveryHandoffReasonSchema;
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw invalid();
    const input = parsed.data;
    const managerOnly = action === 'override' || action === 'rotate';
    await this.authorize(tenantId, principal, managerOnly);
    const identity = this.identity(principal);
    const envelope = [tenantId, id, identity.actorKind, identity.actorId, action, input.operationId, input.expectedRevision, input.expectedMissionRevision];
    const intentFingerprint = createHash('sha256').update(JSON.stringify(['sm.delivery-handoff.intent.v1', envelope])).digest('hex');
    const fingerprint = resolving ? null : this.crypto().fingerprint([envelope, parsed.data]);
    const before = await this.row(tenantId, id, principal, input.operationId);
    const record = before.deliveryHandoff ?? emptyHandoff();
    const previous = record.operations.find(op => op.operationId === input.operationId);
    if (previous) return this.replay(tenantId, id, principal, previous, intentFingerprint, fingerprint);
    const missionRevision = before.deliveryMission?.revision ?? 0;
    if (resolving ? record.revision < input.expectedRevision || missionRevision < input.expectedMissionRevision
      : record.revision !== input.expectedRevision || missionRevision !== input.expectedMissionRevision) throw changed();
    this.room(record);
    let refusal: DeliveryHandoffRefusalCode | null = resolving ? 'abandoned' : eligibility(before);
    const at = new Date();
    const next: HandoffRecord = { ...record, revision: record.revision + 1, operations: [...record.operations] };
    if (!refusal && action === 'handoff') {
      refusal = next.incident ? 'incident_required' : proofAvailability(before);
      if (!refusal) {
        let matches: boolean;
        try { matches = this.crypto().matches(this.context(before, next.proof!), next.proof!.sealed, (input as DeliveryHandoffSubmit).proof); }
        catch { throw uncertain(); }
        if (!matches) { refusal = 'proof_incorrect'; next.proof = { ...next.proof!, failedAttempts: next.proof!.failedAttempts + 1 }; }
      }
    } else if (!refusal && action === 'override' && !next.incident) refusal = 'incident_required';
    else if (!refusal && action === 'rotate' && (before.channel !== 'online' || before.publicRecovery?.version !== 1)) refusal = 'proof_unavailable';
    if (!refusal) {
      if (action === 'incident') next.incident = { code: (input as DeliveryHandoffIncident).code, reportedAt: at, ...identity };
      else if (action === 'rotate') { next.proof = this.newProof(before, new Date(at.getTime() + DELIVERY_HANDOFF_TTL_MS)); next.incident = null; }
      else next.completed = { at, method: action === 'override' ? 'override' : (input as DeliveryHandoffSubmit).proof.kind,
        operationId: input.operationId, ...identity };
    }
    const operation: HandoffOperation = { ...identity, operationId: input.operationId, intentFingerprint, fingerprint,
      action, outcome: resolving ? 'abandoned' : refusal ? 'rejected' : 'applied', refusalCode: refusal,
      revision: next.revision, expectedRevision: input.expectedRevision, expectedMissionRevision: input.expectedMissionRevision,
      at, reason: !resolving && managerOnly ? (input as DeliveryHandoffReason).reason : null };
    next.operations.push(operation);
    const completed = !refusal && (action === 'handoff' || action === 'override');
    await this.authorize(tenantId, principal, managerOnly);
    const filter = { ...this.cas(before), ...(!refusal ? this.financialFence() : {}),
      ...(!refusal && action === 'handoff' ? { 'deliveryHandoff.proof.id': next.proof!.id,
        $expr: { $gt: ['$deliveryHandoff.proof.expiresAt', '$$NOW'] } } : {}),
      ...(principal.kind === 'courier' ? { 'deliveryMission.assignment.operatorId': principal.access.operatorId } : {}) };
    let applied: boolean;
    try {
      const result = await this.orders.updateOne(filter, { $set: { deliveryHandoff: next,
        ...(completed ? { status: 'delivered', 'delivery.deliveredAt': at } : {}) }, $inc: { __v: 1 },
        ...(completed ? { $push: { statusHistory: { status: 'delivered', at, by: identity.actorId } } } : {}) },
      { runValidators: true, writeConcern: WRITE_CONCERN });
      applied = result.modifiedCount === 1;
    } catch {
      const current = await this.row(tenantId, id, principal, input.operationId).catch(() => { throw uncertain(); });
      const proof = current.deliveryHandoff?.operations.find(op => op.operationId === input.operationId);
      if (proof) return this.replay(tenantId, id, principal, proof, intentFingerprint, fingerprint);
      throw uncertain();
    }
    if (!applied) {
      const current = await this.row(tenantId, id, principal, input.operationId);
      const proof = current.deliveryHandoff?.operations.find(op => op.operationId === input.operationId);
      if (proof) return this.replay(tenantId, id, principal, proof, intentFingerprint, fingerprint);
      if (!resolving && ((current.deliveryHandoff?.revision ?? 0) !== input.expectedRevision
        || (current.deliveryMission?.revision ?? 0) !== input.expectedMissionRevision)) throw changed();
      if (attempt < 2) return this.mutate(tenantId, id, raw, principal, action, resolving, attempt + 1);
      throw uncertain();
    }
    return this.result(tenantId, id, principal, operation, false);
  }

  private async replay(tenantId: string, id: string, principal: Principal, operation: HandoffOperation, intent: string, fingerprint: string | null) {
    const identity = this.identity(principal);
    if (operation.intentFingerprint !== intent || operation.actorKind !== identity.actorKind || operation.actorId !== identity.actorId
      || (fingerprint !== null && operation.outcome !== 'abandoned' && operation.fingerprint !== fingerprint)) throw conflict();
    return this.result(tenantId, id, principal, operation, true);
  }
  private async result(tenantId: string, id: string, principal: Principal, operation: HandoffOperation, replay: boolean): Promise<DeliveryHandoffResult> {
    await this.authorize(tenantId, principal, operation.action === 'override' || operation.action === 'rotate');
    await this.publish(tenantId, id, operation);
    const row = await this.row(tenantId, id, principal, operation.operationId);
    await this.authorize(tenantId, principal, operation.action === 'override' || operation.action === 'rotate');
    return DeliveryHandoffResultSchema.parse({ missionId: id, operationId: operation.operationId, action: operation.action,
      outcome: operation.outcome, refusalCode: operation.refusalCode, appliedRevision: operation.revision, replay,
      state: handoffView(row, principal.kind === 'manager' && MANAGERS.includes(principal.actor.role)) });
  }
  private async publish(tenantId: string, id: string, operation: HandoffOperation) {
    if (operation.outcome !== 'applied') return;
    const actions = { handoff: 'order.handoff', incident: 'order.delivery_incident', override: 'order.delivery_override', rotate: 'order.delivery_proof_rotate' } as const;
    try {
      const actor: AuditActor = operation.actorKind === 'delivery'
        ? { kind: 'delivery', sub: operation.actorId, role: 'livreur', name: operation.actorName ?? 'Livreur' }
        : { kind: operation.actorKind, sub: operation.actorId, role: operation.actorRole as JwtPayload['role'] };
      await this.audit.logOnce({ tenantId, targetId: id, action: actions[operation.action], actor,
        meta: { operationId: operation.operationId, revision: operation.revision, at: new Date(operation.at).toISOString(), reason: operation.reason } }, operation.operationId);
      const order = await this.orders.findOne({ _id: id, tenantId }).read('primary').readConcern('majority').maxTimeMS(10_000);
      if (!order) throw unavailable();
      const payload = order.toObject() as Record<string, unknown>;
      delete payload.deliveryHandoff;
      delete payload.deliveryMission;
      await this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload }));
    } catch { throw uncertain(); }
  }
}
