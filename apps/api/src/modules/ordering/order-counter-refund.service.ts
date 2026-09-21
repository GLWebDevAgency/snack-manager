import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isDeepStrictEqual } from 'node:util';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';
import { COUNTER_REFUND_DISBURSE_WINDOW_MS, CounterRefundIntentSchema, CounterRefundJournalSchema, orderAccessScope, ordersChannel, WS_EVENTS,
  type CounterRefundIntent, type CounterRefundJournal, type CounterRefundResult, type JwtPayload } from '@sm/contracts';
import { posCompensationWake, type Order } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { CapacitesService } from '../../common/capacites';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { AuditService } from '../audit/audit.module';
import { counterRefundProjection, CounterRefundProofError, sameCounterRefundActor,
  type CounterRefundActor, type CounterRefundFlow, type CounterRefundOperation, type CounterRefundSnapshot } from './order-counter-refund.policy';

const SELECT = '+counterRefundFlow +counterCollection +paymentFlow +refundFlow +loyaltyWebIntent +loyaltyEarnOperationId +loyaltyMemberId +loyaltyEarnState +loyaltyPosCompensationProcessing';
const WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const enabled = () => process.env.ORDER_COUNTER_REFUNDS_ENABLED === 'true';
type Action = 'prepare' | 'start' | 'confirm' | 'withdraw' | 'no_effect';
type Evidence = { attestation?: CounterRefundOperation['attestation']; resolutionReason?: string };
const identity = ({ sub, kind, role }: CounterRefundActor): CounterRefundActor => ({ sub, kind, role });
const intentOf = (operation: CounterRefundIntent): CounterRefundIntent => ({ operationId: operation.operationId,
  amountCents: operation.amountCents, reason: operation.reason, tender: operation.tender, allocation: { ...operation.allocation } });
const conflict = (): never => { throw new ConflictException({ code: 'COUNTER_REFUND_CONFLICT',
  message: 'Demande modifiée ou remboursement déjà engagé. Vérifiez cette même référence sans rendre de nouveau l’argent.' }); };

@Injectable()
export class OrderCounterRefundService {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>,
    private readonly capacites: CapacitesService, private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis) {}

  private actor(tenantId: string, actor: JwtPayload): void {
    if (actor.tenantId !== tenantId || !['user', 'staff'].includes(actor.kind)
      || !['owner', 'cogerant', 'gerant', 'caisse'].includes(actor.role) || !/^[a-f0-9]{24}$/.test(actor.sub)) throw new ForbiddenException('Accès au remboursement comptoir refusé.');
  }
  private async read(tenantId: string, orderId: string): Promise<CounterRefundSnapshot> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Commande introuvable.');
    const scope = orderAccessScope(await this.capacites.pourTenant(tenantId));
    if (scope === 'none') throw new NotFoundException('Commande introuvable.');
    const order = await this.orders.findOne({ _id: orderId, tenantId, ...(scope === 'online' ? { channel: 'online' } : {}) })
      .select(SELECT).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!order) throw new NotFoundException('Commande introuvable.');
    return order as unknown as CounterRefundSnapshot;
  }
  private project(order: CounterRefundSnapshot, actor: JwtPayload): CounterRefundJournal {
    const base = { orderId: String(order._id), enabled: enabled(), observedAt: new Date().toISOString(), canResolveNoEffect: actor.kind === 'user' && actor.role === 'owner' };
    try {
      const projection = counterRefundProjection(order);
      return CounterRefundJournalSchema.parse({ ...base, available: true, unavailableReason: null, tender: projection.tender,
        originalPaidCents: projection.originalPaidCents, refundedCents: projection.confirmedRefundedCents,
        pendingRefundCents: projection.pendingRefundCents,
        remainingCents: projection.originalPaidCents - projection.confirmedRefundedCents - projection.pendingRefundCents,
        basis: projection.basis, remaining: projection.remaining,
        operations: (order.counterRefundFlow?.operations ?? []).map(operation => ({ ...intentOf(operation), state: operation.state,
          preparedAt: operation.preparedAt.toISOString(), startedAt: operation.startedAt?.toISOString() ?? null,
          disburseExpiresAt: operation.disburseExpiresAt?.toISOString() ?? null,
          confirmedAt: operation.confirmedAt?.toISOString() ?? null, resolvedAt: operation.resolvedAt?.toISOString() ?? null,
          resolutionReason: operation.resolution?.reason ?? null,
          canResume: sameCounterRefundActor(operation.actor, actor) && ['prepared', 'started'].includes(operation.state),
        })) });
    } catch (error) {
      if (!(error instanceof CounterRefundProofError)) throw error;
      return { ...base, available: false, unavailableReason: error.reason, tender: null,
        originalPaidCents: 0, refundedCents: 0, pendingRefundCents: 0, remainingCents: 0,
        basis: { merchandiseCents: 0, deliveryCents: 0 }, remaining: { merchandiseCents: 0, deliveryCents: 0 }, operations: [] };
    }
  }
  async journal(tenantId: string, orderId: string, actor: JwtPayload) {
    this.actor(tenantId, actor);
    return this.project(await this.read(tenantId, orderId), actor);
  }

  private async change(order: CounterRefundSnapshot, flow: CounterRefundFlow) {
    const confirmed = flow.operations.filter(row => row.state === 'confirmed').reduce((sum, row) => sum + row.amountCents, 0);
    const pending = flow.operations.filter(row => row.state === 'prepared' || row.state === 'started').reduce((sum, row) => sum + row.amountCents, 0);
    const status = confirmed === order.totals.total && confirmed > 0 ? 'refunded' : 'paid';
    // Validate the entire next document before issuing the one financial CAS.
    counterRefundProjection({ ...order, counterRefundFlow: flow,
      payment: { ...order.payment, status, refundedCents: confirmed, pendingRefundCents: pending } });
    const set: Record<string, unknown> = { counterRefundFlow: flow, 'payment.status': status,
      'payment.refundedCents': confirmed, 'payment.pendingRefundCents': pending };
    if (order.loyaltyWebIntent?.version === 1) Object.assign(set, {
      'loyaltyWebProcessing.dirty': true, 'loyaltyWebProcessing.nextAttemptAt': new Date(),
    });
    Object.assign(set, posCompensationWake(order, new Date()));
    try {
      const next = await this.orders.findOneAndUpdate({ _id: order._id, tenantId: order.tenantId,
        __v: order.__v ?? { $exists: false }, 'payment.method': 'counter' },
      { $set: set, $inc: { __v: 1, 'payment.refundSyncVersion': 1 } },
      { new: true, writeConcern: WRITE, runValidators: true }).select(SELECT).read('primary').lean();
      return next ? { order: next as unknown as CounterRefundSnapshot, acknowledged: true } : null;
    } catch {
      // A read may prove the state, never that this caller still owns the
      // one-time permission to perform a physical gesture after a lost ACK.
      const next = await this.read(String(order.tenantId), String(order._id)).catch(() => null);
      if (next && next.__v === (order.__v ?? 0) + 1 && isDeepStrictEqual(next.counterRefundFlow, flow)
        && next.payment.refundedCents === confirmed && next.payment.pendingRefundCents === pending
        && next.payment.refundSyncVersion === (order.payment.refundSyncVersion ?? 0) + 1) return { order: next, acknowledged: false };
      throw new ServiceUnavailableException({ code: 'COUNTER_REFUND_UNCERTAIN',
        message: 'Réponse non confirmée. Conservez la même demande et vérifiez-la sans rendre de nouveau l’argent.' });
    }
  }

  private async auditReceipt(order: CounterRefundSnapshot, operation: CounterRefundOperation) {
    const common = { tenantId: String(order.tenantId), targetId: String(order._id), actor: operation.approver,
      meta: { ...intentOf(operation), initiator: operation.actor, approver: operation.approver } };
    await this.audit.logOnce({ ...common, action: 'order.counter_refund.prepare',
      meta: { ...common.meta, at: operation.preparedAt.toISOString() } }, operation.operationId);
    if (operation.startedAt) await this.audit.logOnce({ ...common, action: 'order.counter_refund.start',
      meta: { ...common.meta, at: operation.startedAt.toISOString(), disburseExpiresAt: operation.disburseExpiresAt!.toISOString() } }, operation.operationId);
    if (operation.confirmedAt) await this.audit.logOnce({ ...common, action: 'order.counter_refund.confirm',
      meta: { ...common.meta, at: operation.confirmedAt.toISOString(), attestation: operation.attestation } }, operation.operationId);
    if (operation.resolvedAt) await this.audit.logOnce({ ...common,
      actor: operation.resolution?.actor ?? operation.approver,
      action: operation.state === 'withdrawn' ? 'order.counter_refund.withdraw' : 'order.counter_refund.no_effect',
      meta: { ...common.meta, at: operation.resolvedAt.toISOString(), resolution: operation.resolution } }, operation.operationId);
  }
  private async result(order: CounterRefundSnapshot, operation: CounterRefundOperation, actor: JwtPayload, mayDisburse: boolean): Promise<CounterRefundResult> {
    try { await this.auditReceipt(order, operation); }
    catch { throw new ServiceUnavailableException({ code: 'COUNTER_REFUND_AUDIT_PENDING',
      message: 'Demande enregistrée. Son journal reste à synchroniser ; vérifiez cette même référence sans rendre de nouveau l’argent.' }); }
    const publicOrder = { ...order } as Record<string, unknown>;
    for (const key of Object.keys(publicOrder)) if (key.startsWith('loyalty') || ['counterRefundFlow', 'counterCollection', 'paymentFlow',
      'refundFlow', 'customerOwner', 'customerSaleAttribution', 'publicRecovery', 'deliveryMission', 'deliveryHandoff', 'diningServeReceipt', 'diningServeRejections'].includes(key)) delete publicOrder[key];
    await publishRedisBestEffort(this.redis, ordersChannel(String(order.tenantId)), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: publicOrder }));
    return { journal: this.project(order, actor), mayDisburse: mayDisburse && operation.state === 'started'
      && operation.disburseExpiresAt !== null && Date.now() < operation.disburseExpiresAt.getTime() };
  }

  async execute(action: Action, tenantId: string, orderId: string, actor: JwtPayload, approver: CounterRefundActor,
    raw: CounterRefundIntent, evidence: Evidence = {}): Promise<CounterRefundResult> {
    this.actor(tenantId, actor);
    if (!/^[a-f0-9]{24}$/.test(approver.sub) || !(approver.kind === 'user' && approver.role === 'owner'
      || approver.kind === 'staff' && approver.role === 'gerant')) throw new ForbiddenException('Confirmation d’un responsable requise.');
    const parsed = CounterRefundIntentSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Demande de remboursement invalide.');
    const body = { ...parsed.data, operationId: parsed.data.operationId.toLowerCase() };
    if (action === 'no_effect' && (actor.kind !== 'user' || actor.role !== 'owner'
      || !sameCounterRefundActor(actor, approver))) throw new ForbiddenException('Décision réservée au propriétaire.');
    if (action === 'no_effect' && (!evidence.resolutionReason || evidence.resolutionReason.trim().length < 3
      || evidence.resolutionReason.length > 200)) throw new BadRequestException('Motif de décision requis.');
    if (action === 'confirm' && evidence.attestation !== (body.tender === 'cash' ? 'cash_returned' : 'terminal_refund_confirmed')) throw new BadRequestException('Attestation de remboursement requise.');
    for (let retry = 0; retry < 8; retry++) {
      const order = await this.read(tenantId, orderId);
      let projection: ReturnType<typeof counterRefundProjection>;
      try { projection = counterRefundProjection(order); }
      catch (error) { if (error instanceof CounterRefundProofError) throw new ConflictException({ code: 'COUNTER_REFUND_PROOF_REQUIRED',
        message: 'Preuve d’encaissement ou historique incomplet. Faites rapprocher cette commande avant tout remboursement.' }); throw error; }
      const flow: CounterRefundFlow = structuredClone(order.counterRefundFlow ?? { version: 1, paymentProofHash: projection.paymentProofHash, operations: [] });
      let operation = flow.operations.find(row => row.operationId.toLowerCase() === body.operationId);
      if (operation) {
        if (!isDeepStrictEqual(intentOf(operation), body)) conflict();
        if (action !== 'no_effect' && (!sameCounterRefundActor(operation.actor, actor)
          || !sameCounterRefundActor(operation.approver, approver))) throw new ForbiddenException('Reprise réservée à l’auteur et au responsable de cette demande.');
        const replay = action === 'prepare' || action === 'start' && operation.state === 'started'
          || action === 'confirm' && operation.state === 'confirmed' && operation.attestation === evidence.attestation
          || action === 'withdraw' && operation.state === 'withdrawn'
          || action === 'no_effect' && operation.state === 'not_executed' && operation.resolution?.reason === evidence.resolutionReason!.trim()
            && sameCounterRefundActor(operation.resolution.actor, actor);
        if (replay) return this.result(order, operation, actor, false);
      } else {
        if (action !== 'prepare' && action !== 'withdraw') conflict();
        if (flow.operations.length >= 128 || body.tender !== projection.tender) conflict();
        if (action === 'prepare' && (projection.pendingRefundCents > 0 || body.amountCents > projection.originalPaidCents - projection.confirmedRefundedCents
          || body.allocation.merchandiseCents > projection.remaining.merchandiseCents || body.allocation.deliveryCents > projection.remaining.deliveryCents)) conflict();
        operation = { ...body, actor: identity(actor), approver: identity(approver), state: 'prepared', preparedAt: new Date(),
          startedAt: null, disburseExpiresAt: null, confirmedAt: null, resolvedAt: null, attestation: null, resolution: null };
        flow.operations.push(operation);
      }
      // Closing the gate cannot erase a physical act already performed. Only
      // preparation/start issue new permissions; completion remains possible.
      if ((action === 'prepare' || action === 'start') && !enabled()) throw new ServiceUnavailableException('Les nouveaux remboursements comptoir sont suspendus.');
      if (action === 'start') {
        if (operation.state !== 'prepared') conflict();
        operation.state = 'started'; operation.startedAt = new Date();
        operation.disburseExpiresAt = new Date(operation.startedAt.getTime() + COUNTER_REFUND_DISBURSE_WINDOW_MS);
      } else if (action === 'confirm') {
        if (operation.state !== 'started') conflict();
        operation.state = 'confirmed'; operation.confirmedAt = new Date(); operation.attestation = evidence.attestation!;
      } else if (action === 'withdraw') {
        if (operation.state !== 'prepared') conflict();
        operation.state = 'withdrawn'; operation.resolvedAt = new Date();
      } else if (action === 'no_effect') {
        if (operation.state !== 'started') conflict();
        if (!operation.disburseExpiresAt || Date.now() < operation.disburseExpiresAt.getTime()) throw new ConflictException({
          code: 'COUNTER_REFUND_PERMISSION_ACTIVE', message: 'Une autorisation de remboursement reste ouverte. Attendez son expiration avant de confirmer l’absence de tout geste ou paiement en cours.' });
        operation.state = 'not_executed'; operation.resolvedAt = new Date();
        operation.resolution = { actor: identity(actor), reason: evidence.resolutionReason!.trim() };
      }
      const changed = await this.change(order, flow);
      if (changed) return this.result(changed.order, operation, actor, action === 'start' && changed.acknowledged);
    }
    throw new ServiceUnavailableException('Commande modifiée en parallèle. Vérifiez la même demande.');
  }
}
