import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { roleSatisfait, LoyaltySaleResolutionReceiptSchema, LoyaltySaleSettlementV2Schema, type JwtPayload, type LoyaltySaleResolutionRequest, type LoyaltySaleSettlementV2, type LoyaltySaleSettlementListV2, type LoyaltySaleSettlementQuery } from '@sm/contracts';
import { posCompensationWake, type Order } from '@sm/db';
import { and, desc, eq, operations, sql, withLoyaltyTenant, type LoyaltyDb } from '@sm/loyalty';
import { Types, type Model } from 'mongoose';
import { LOYALTY_DB } from '../../loyalty-db.module';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleAttributionFingerprint, type HistoricalSaleSettlementInput, type HistoricalSaleSource, type HistoricalPosSaleSettlementInput, type HistoricalSaleSettlementResult } from './loyalty-historical-sale.types';
import { loyaltyWebObservation, LoyaltyWebObservationError, type LoyaltyWebObservedOrder } from './loyalty-web-observation';

import { loyaltyPosObservation, LoyaltyPosObservationError, type LoyaltyPosObservedOrder } from './loyalty-pos-observation';
type AnyInput = HistoricalSaleSettlementInput<HistoricalSaleSource>;
type ObservedOrder = (LoyaltyWebObservedOrder | LoyaltyPosObservedOrder) & { number: number; loyaltyPosCompensationProcessing?: unknown };
const SELECT = '+loyaltyWebIntent +customerOwner +customerSaleAttribution +loyaltyMemberId +paymentFlow +counterCollection +deliveryHandoff +refundFlow +counterRefundFlow +loyaltyEarnOperationId +loyaltyEarnState +loyaltyPosCompensationProcessing +loyaltyReward +loyaltyRewardProcessing';
const EMPTY = { initialUnits: null, reversedUnits: 0, waivedUnits: 0, retainedUnits: 0, dueUnits: 0 };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const enabled = (order: Pick<ObservedOrder, 'channel'>) => order.channel === 'pos'
  ? process.env.LOYALTY_POS_COMPENSATION_ENABLED === 'true' : process.env.LOYALTY_WEB_SETTLEMENT_ENABLED === 'true';
const owner = (actor: JwtPayload) => actor.kind === 'user' && actor.role === 'owner';

@Injectable()
export class LoyaltySaleSettlementService {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>, @Inject(LOYALTY_DB) private readonly db: LoyaltyDb,
    private readonly historical: LoyaltyHistoricalSaleService) {}

  private assertActor(tenantRef: string, actor: JwtPayload) {
    if (actor.tenantId !== tenantRef || !roleSatisfait(actor.role, ['owner', 'gerant'])) throw new ForbiddenException('Accès fidélité refusé');
  }
  private filter(tenantRef: string) {
    if (!/^[a-f0-9]{24}$/.test(tenantRef)) throw new BadRequestException('Établissement invalide');
    return { tenantId: new Types.ObjectId(tenantRef), $or: [
      { channel: 'online', 'loyaltyWebIntent.version': 1 },
      { channel: 'pos', loyaltyEarnState: 'completed', loyaltyEarnOperationId: { $ne: null }, loyaltyMemberId: { $ne: null },
        $or: [{ 'payment.refundedCents': { $gt: 0 } }, { 'payment.pendingRefundCents': { $gt: 0 } }, { loyaltyPosCompensationProcessing: { $ne: null } }] },
    ] };
  }
  private async order(tenantRef: string, orderId: string): Promise<ObservedOrder> {
    if (!/^[a-f0-9]{24}$/.test(orderId)) throw new BadRequestException('Commande invalide');
    const order = await this.orders.findOne({ ...this.filter(tenantRef), _id: new Types.ObjectId(orderId) }).select(SELECT)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean() as ObservedOrder | null;
    if (!order) throw new NotFoundException('Vente fidélité introuvable');
    return order;
  }
  private query(input: AnyInput) {
    return { tenantRef: input.tenantRef, clientId: input.clientId, earnOperationId: input.earnOperationId,
      attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution), observationId: input.observation.observationId,
      financialFingerprint: input.observation.financialFingerprint };
  }
  private amounts(outcome: HistoricalSaleSettlementResult) {
    const receipt = outcome.receipt;
    return receipt ? { initialUnits: receipt.initialUnits, reversedUnits: receipt.reversedUnits, waivedUnits: receipt.waivedUnits,
      retainedUnits: receipt.retainedUnits, dueUnits: receipt.dueUnits } : EMPTY;
  }
  private async hasCanonicalEarn(tenantRef: string, clientId: string): Promise<boolean> {
    // A pending managed case can precede detection of a legacy receipt. Check
    // both canonical histories before claiming that no gain was ever recorded.
    return withLoyaltyTenant(this.db, tenantRef, async tx => {
      const found = await tx.execute(sql`SELECT 1 FROM loyalty.earn_receipts WHERE tenant_ref=${tenantRef} AND source IN ('pos','online')
        AND external_ref ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND lower(split_part(external_ref,':',2))=${clientId.toLowerCase()}
        UNION ALL SELECT 1 FROM loyalty.ledger_entries WHERE tenant_ref=${tenantRef} AND kind='earn' AND source IN ('pos','online')
        AND external_ref ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        AND lower(split_part(external_ref,':',2))=${clientId.toLowerCase()} LIMIT 1`);
      return found.rows.length > 0;
    });
  }
  private async receipts(tenantRef: string, clientId: string, actor: JwtPayload, operationId?: string) {
    if (!owner(actor)) return [];
    return withLoyaltyTenant(this.db, tenantRef, async tx => {
      const rows = await tx.select({ result: operations.result, completedAt: operations.completedAt }).from(operations)
        .where(and(eq(operations.tenantRef, tenantRef), eq(operations.kind, 'adjust'), eq(operations.status, 'completed'), sql`${operations.result} ? 'resolutionActorRef'`,
          ...(operationId ? [eq(operations.operationId, operationId)] : []),
          sql`${operations.result}->>'clientId' = ${clientId}`, sql`${operations.result}->>'resolutionActorRef' = ${actor.sub}`))
        .orderBy(desc(operations.completedAt)).limit(128);
      return rows.map(row => {
        const stored = row.result;
        if (!isRecord(stored) || !isRecord(stored.result) || !row.completedAt) throw new ServiceUnavailableException('Reçu de résolution illisible');
        const outcome = stored.result as unknown as HistoricalSaleSettlementResult;
        if (!['recorded', 'reconciliation'].includes(outcome.kind) || !outcome.receipt) throw new ServiceUnavailableException('Reçu de résolution illisible');
        return LoyaltySaleResolutionReceiptSchema.parse({ request: stored.request, recordedAt: row.completedAt.toISOString(),
          result: { ...this.amounts(outcome), state: outcome.kind, reason: outcome.kind === 'reconciliation' ? outcome.reason : null, version: outcome.receipt.version } });
      });
    });
  }
  private async observe(order: ObservedOrder): Promise<AnyInput> {
    return order.channel === 'pos' ? loyaltyPosObservation(order as LoyaltyPosObservedOrder, this.historical)
      : loyaltyWebObservation(order as LoyaltyWebObservedOrder);
  }
  private settle(input: AnyInput) {
    return input.attribution.decision === 'pos_receipt'
      ? this.historical.settlePosSale(input as HistoricalPosSaleSettlementInput)
      : this.historical.settleHistoricalSale(input as HistoricalSaleSettlementInput);
  }
  private async project(order: ObservedOrder, actor: JwtPayload, resolutionId?: string, presentationVersion?: '2'): Promise<LoyaltySaleSettlementV2> {
    const base = { orderId: String(order._id), orderNumber: order.number, caseId: null, version: null, ...EMPTY,
      canResolve: false, canAllocate: false, resolutions: [] };
    const resolutions = /^[a-f0-9-]{36}$/i.test(order.clientId) ? await this.receipts(String(order.tenantId), order.clientId, actor, resolutionId) : [];
    let input: AnyInput;
    try { input = await this.observe(order); }
    catch (error) {
      if (!(error instanceof LoyaltyWebObservationError) && !(error instanceof LoyaltyPosObservationError)) throw error;
      return LoyaltySaleSettlementV2Schema.parse({ ...base, resolutions, state: 'reconciliation', reason: error.code === 'financial_proof_too_large' ? 'financial_proof_too_large' : 'financial_proof_conflict' });
    }
    const outcome = await this.historical.readHistoricalSale(this.query(input));
    const exact = outcome.receipt?.attributionFingerprint === historicalSaleAttributionFingerprint(input.attribution)
      && outcome.receipt?.earnOperationId === input.earnOperationId && outcome.receipt?.observationId === input.observation.observationId
      && outcome.receipt?.financialFingerprint === input.observation.financialFingerprint;
    const canResolve = owner(actor) && enabled(order) && exact && outcome.kind === 'reconciliation' && outcome.reason === 'insufficient_balance';
    // This is a read-only presentation of a parked canonical case, never an
    // invented zero-unit earn. The observation already checked the exact reward
    // and cancellation proof; unknown payments and stale SQL receipts stay open.
    const proof = input.observation.proof;
    const payment = isRecord(proof) && isRecord(proof.payment) ? proof.payment : null;
    const noGainCandidate = presentationVersion === '2' && order.channel === 'online' && order.status === 'cancelled'
      && order.totals.total === 0 && input.observation.paidAndDelivered === false
      && input.observation.eligibleRefundedCents === 0 && input.observation.pendingRefundCents === 0
      && payment?.kind === 'zero_total_reward' && isRecord(payment.closure) && payment.closure.destination === 'cancel_order'
      && exact && resolutions.length === 0 && outcome.kind === 'pending' && outcome.reason === 'payment_or_handoff_pending'
      && outcome.receipt?.initialUnits === null && outcome.receipt.earnReceiptId === null && outcome.receipt.earnLedgerEntryId === null
      && outcome.receipt.reversedUnits === 0 && outcome.receipt.waivedUnits === 0 && outcome.receipt.retainedUnits === 0 && outcome.receipt.dueUnits === 0;
    const canonicalConflict = noGainCandidate && await this.hasCanonicalEarn(input.tenantRef, input.clientId);
    const cancelledWithoutGain = noGainCandidate && !canonicalConflict;
    return LoyaltySaleSettlementV2Schema.parse({ ...base, ...this.amounts(outcome), resolutions,
      caseId: outcome.receipt?.saleId ?? null, version: outcome.receipt?.version ?? null,
      state: cancelledWithoutGain ? 'not_earned' : canonicalConflict ? 'reconciliation' : outcome.kind === 'pending' ? 'waiting' : outcome.kind,
      reason: cancelledWithoutGain ? 'cancelled_before_handoff' : canonicalConflict ? 'canonical_sale_conflict' : outcome.kind === 'recorded' ? null : outcome.reason,
      canResolve: !!canResolve, canAllocate: owner(actor) && outcome.kind === 'reconciliation' && outcome.reason === 'allocation_unknown' });
  }
  async list(tenantRef: string, actor: JwtPayload, query: LoyaltySaleSettlementQuery): Promise<LoyaltySaleSettlementListV2> {
    this.assertActor(tenantRef, actor);
    const rows = await this.orders.find({ ...this.filter(tenantRef), ...(query.cursor ? { _id: { $lt: new Types.ObjectId(query.cursor) } } : {}) })
      .select(SELECT).sort({ _id: -1 }).limit(query.limit + 1).read('primary').readConcern('majority').maxTimeMS(10_000).lean() as ObservedOrder[];
    const page = rows.slice(0, query.limit), items: LoyaltySaleSettlementV2[] = [];
    // Bound work per request and avoid a burst of concurrent SQL transactions.
    for (const order of page) items.push(await this.project(order, actor, undefined, query.presentationVersion));
    return { items, nextCursor: rows.length > query.limit ? String(page.at(-1)!._id) : null };
  }
  async get(tenantRef: string, orderId: string, actor: JwtPayload, resolutionId?: string, presentationVersion?: '2'): Promise<LoyaltySaleSettlementV2> {
    this.assertActor(tenantRef, actor);
    return this.project(await this.order(tenantRef, orderId), actor, resolutionId, presentationVersion);
  }
  async resolve(tenantRef: string, orderId: string, actor: JwtPayload, body: LoyaltySaleResolutionRequest): Promise<LoyaltySaleSettlementV2> {
    this.assertActor(tenantRef, actor);
    if (!owner(actor)) throw new ConflictException('Décision réservée au propriétaire');
    const order = await this.order(tenantRef, orderId);
    const input = await this.observe(order);
    // Exact receipts are readable even when a kill switch subsequently closes.
    const previous = await this.receipts(tenantRef, input.clientId, actor, body.operationId);
    const saved = previous.find(entry => entry.request.operationId === body.operationId);
    const { password: _password, ...request } = body;
    if (saved) {
      if (saved.request.operationId !== request.operationId || saved.request.caseId !== request.caseId || saved.request.expectedVersion !== request.expectedVersion || saved.request.decision !== request.decision || saved.request.reason !== request.reason) throw new ConflictException('Référence de décision déjà utilisée');
      return this.project(order, actor, body.operationId);
    }
    if (!enabled(order)) throw new ConflictException('Le traitement fidélité est désactivé');
    // Refresh SQL with the latest server financial observation before comparing
    // the operator's case/version. No browser amounts enter the writer.
    const current = await this.settle(input);
    if (current.kind !== 'reconciliation' || current.reason !== 'insufficient_balance' || current.caseId !== body.caseId
      || current.receipt.version !== body.expectedVersion) throw new ConflictException('Ce dossier a changé. Relisez-le avant de décider.');
    const fresh = await this.observe(await this.order(tenantRef, orderId));
    if (fresh.observation.financialFingerprint !== input.observation.financialFingerprint || fresh.earnOperationId !== input.earnOperationId)
      throw new ConflictException('Le remboursement a changé. Relisez ce dossier.');
    if (!enabled(order)) throw new ConflictException('Le traitement fidélité est désactivé');
    await this.historical.resolveHistoricalSale({ tenantRef, clientId: input.clientId, ...request, actorRef: actor.sub });
    await this.orders.updateOne({ ...this.filter(tenantRef), _id: new Types.ObjectId(orderId), ...(order.channel === 'pos' ? { loyaltyEarnOperationId: input.earnOperationId } : { 'loyaltyWebIntent.operationId': input.earnOperationId }) },
      { $set: order.channel === 'pos' ? posCompensationWake(order, new Date())
        : { 'loyaltyWebProcessing.dirty': true, 'loyaltyWebProcessing.nextAttemptAt': new Date() } },
      { timestamps: false, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } });
    return this.get(tenantRef, orderId, actor, body.operationId);
  }
}
