import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { posCompensationWake, type Order } from '@sm/db';
import type { Model } from 'mongoose';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleAttributionFingerprint, type HistoricalPosSaleSettlementInput, type HistoricalSaleSettlementResult } from './loyalty-historical-sale.types';
import { loyaltyPosObservation, LoyaltyPosObservationError, type LoyaltyPosObservedOrder } from './loyalty-pos-observation';

const WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const SELECT = '+loyaltyPosCompensationProcessing +customerSaleAttribution +loyaltyMemberId +loyaltyEarnOperationId +loyaltyEarnState +paymentFlow +counterCollection +counterRefundFlow +refundFlow';
const POLL_MS = 5_000, LEASE_MS = 60_000, SCAN_MS = 60_000, SCAN_PAGE = 50, MAX_BATCH = 25;
type Claimed = LoyaltyPosObservedOrder & { loyaltyPosCompensationProcessing: {
  attempts: number; leaseToken: string; leaseUntil: Date;
} };
export type LoyaltyPosDrainResult = { claimed: number; completed: number; reconciliation: number; retried: number };
type Outcome = 'completed' | 'reconciliation' | 'retried';
const enabled = () => process.env.LOYALTY_POS_COMPENSATION_ENABLED === 'true';

/** One historical POS receipt, one canonical SQL sale. Polling does not increment the
 * business revision. Financial writes wake completed entries; the periodic
 * scan is a fallback when an older writer did not know this scheduler. */
@Injectable()
export class LoyaltyPosCompensationProcessor implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LoyaltyPosCompensationProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private draining = false;
  private scanAfter: unknown = null;
  private nextScanAt = 0;

  constructor(@InjectModel('Order') private readonly orders: Model<Order>, private readonly settlement: LoyaltyHistoricalSaleService) {}

  onApplicationBootstrap(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const run = () => { void this.drain().catch(() => this.logger.warn('Rapprochement fidélité POS différé : dépendance indisponible')); };
    this.timer = setInterval(run, POLL_MS); this.timer.unref();
    this.first = setTimeout(run, 2_000); this.first.unref();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); if (this.first) clearTimeout(this.first); this.timer = null; this.first = null; }

  async drain(): Promise<LoyaltyPosDrainResult> {
    const result = { claimed: 0, completed: 0, reconciliation: 0, retried: 0 };
    if (!enabled() || this.draining) return result;
    this.draining = true;
    try {
      for (let i = 0; i < MAX_BATCH && enabled(); i++) {
        const order = await this.claim();
        if (!order) break;
        result.claimed++;
        result[await this.process(order)]++;
      }
      if (enabled() && result.claimed < MAX_BATCH) {
        try { await this.scanChangedCompleted(); }
        catch { this.logger.warn('Lecture de secours fidélité POS différée : dépendance indisponible'); }
      }
      return result;
    } finally { this.draining = false; }
  }

  private async claim(): Promise<Claimed | null> {
    const now = new Date(), token = randomUUID();
    return await this.orders.findOneAndUpdate({ channel: 'pos', loyaltyEarnState: 'completed',
      $and: [
        { $or: [{ status: 'delivered' }, { status: 'cancelled' }, { 'payment.status': 'refunded' }] },
        { $or: [
          { 'loyaltyPosCompensationProcessing.state': { $in: ['pending', 'completed', 'reconciliation_required'] },
            'loyaltyPosCompensationProcessing.dirty': true,
            'loyaltyPosCompensationProcessing.nextAttemptAt': { $lte: now } },
          { 'loyaltyPosCompensationProcessing.state': 'processing', 'loyaltyPosCompensationProcessing.leaseUntil': { $lte: now } },
        ] },
      ],
    }, { $set: { 'loyaltyPosCompensationProcessing.state': 'processing', 'loyaltyPosCompensationProcessing.leaseToken': token,
      'loyaltyPosCompensationProcessing.leaseUntil': new Date(now.getTime() + LEASE_MS) }, $inc: { 'loyaltyPosCompensationProcessing.attempts': 1 } },
    { new: true, sort: { 'loyaltyPosCompensationProcessing.nextAttemptAt': 1, _id: 1 }, writeConcern: WRITE, timestamps: false })
      .select(SELECT).read('primary').maxTimeMS(10_000).lean() as Claimed | null;
  }

  /** Read at most one small indexed page per minute, after runnable work. This
   * fallback detects an old writer without re-running SQL for every completed
   * sale forever. Its in-memory cursor is only an optimization: a restart
   * repeats safe reads. Normal financial writers set dirty atomically. */
  private async scanChangedCompleted(): Promise<void> {
    if (Date.now() < this.nextScanAt) return;
    this.nextScanAt = Date.now() + SCAN_MS;
    const rows = await this.orders.find({ channel: 'pos', loyaltyEarnState: 'completed',
      ...(this.scanAfter ? { _id: { $gt: this.scanAfter } } : {}) })
      .sort({ _id: 1 }).limit(SCAN_PAGE).select('_id tenantId channel __v payment.refundedCents payment.pendingRefundCents payment.refundSyncVersion +loyaltyMemberId +loyaltyEarnOperationId +loyaltyEarnState +loyaltyPosCompensationProcessing')
      .read('primary').readConcern('majority').maxTimeMS(5_000).lean();
    this.scanAfter = rows.length ? rows.at(-1)!._id : null;
    for (const row of rows) {
      const prior = row.loyaltyPosCompensationProcessing;
      if (!prior) {
        // No adoption is needed for a pristine historical gain. A refund wake
        // or this indexed fallback creates scheduling state, never a gain.
        if (!(row.payment.refundedCents > 0 || row.payment.pendingRefundCents > 0)) continue;
        await this.orders.updateOne({ _id: row._id, tenantId: row.tenantId, __v: row.__v,
          loyaltyEarnState: 'completed', loyaltyPosCompensationProcessing: null },
        { $set: posCompensationWake(row, new Date()) }, { writeConcern: WRITE, timestamps: false });
        continue;
      }
      if (prior.dirty || prior.state === 'processing'
        || (prior.state !== 'reconciliation_required' && prior.orderVersion === row.__v && prior.refundSyncVersion === row.payment.refundSyncVersion)) continue;
      await this.orders.updateOne({ _id: row._id, tenantId: row.tenantId, __v: row.__v,
        'payment.refundSyncVersion': row.payment.refundSyncVersion,
        'loyaltyPosCompensationProcessing.state': prior.state, 'loyaltyPosCompensationProcessing.dirty': false,
        'loyaltyPosCompensationProcessing.orderVersion': prior.orderVersion, 'loyaltyPosCompensationProcessing.refundSyncVersion': prior.refundSyncVersion },
      { $set: { 'loyaltyPosCompensationProcessing.dirty': true, 'loyaltyPosCompensationProcessing.nextAttemptAt': new Date() } },
      { writeConcern: WRITE, timestamps: false });
    }
  }

  private owned(order: Claimed) {
    return { _id: order._id, tenantId: order.tenantId, loyaltyMemberId: order.loyaltyMemberId, loyaltyEarnOperationId: order.loyaltyEarnOperationId, loyaltyEarnState: 'completed',
    'loyaltyPosCompensationProcessing.state': 'processing', 'loyaltyPosCompensationProcessing.leaseToken': order.loyaltyPosCompensationProcessing.leaseToken };
  }
  private fence(order: Claimed) {
    return { ...this.owned(order), __v: order.__v, 'payment.refundSyncVersion': order.payment.refundSyncVersion };
  }

  private async process(order: Claimed): Promise<Outcome> {
    try {
      const input = await loyaltyPosObservation(order, this.settlement);
      const receipt = await this.settlement.readHistoricalSale({ tenantRef: input.tenantRef, clientId: input.clientId,
        earnOperationId: input.earnOperationId, attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution),
        observationId: input.observation.observationId, financialFingerprint: input.observation.financialFingerprint });
      // A known receipt is sufficient to repair a lost Mongo acknowledgement.
      // Every other outcome must let SQL re-check its locked state; absence is
      // not evidence that a concurrent process did not commit.
      if (receipt.kind === 'recorded') return await this.acknowledge(order, input, receipt);
      if (!enabled()) return await this.defer(order, 'worker_disabled');
      return await this.acknowledge(order, input, await this.settlement.settlePosSale(input));
    } catch (error) {
      if (error instanceof LoyaltyPosObservationError) {
        const acknowledged = await this.finish(order, { 'loyaltyPosCompensationProcessing.state': 'reconciliation_required',
          'loyaltyPosCompensationProcessing.lastError': error.code, 'loyaltyPosCompensationProcessing.nextAttemptAt': null, 'loyaltyPosCompensationProcessing.dirty': false });
        return acknowledged ? 'reconciliation' : this.defer(order, 'financial_snapshot_changed', 0);
      }
      return await this.defer(order, 'dependency_unavailable');
    }
  }

  private async acknowledge(order: Claimed, input: HistoricalPosSaleSettlementInput, outcome: HistoricalSaleSettlementResult): Promise<Outcome> {
    const receipt = outcome.receipt;
    if (outcome.kind === 'reconciliation' && ['historical_proof_conflict', 'canonical_sale_conflict'].includes(outcome.reason)) {
      const acknowledged = await this.finish(order, { 'loyaltyPosCompensationProcessing.state': 'reconciliation_required',
        'loyaltyPosCompensationProcessing.lastError': outcome.reason, 'loyaltyPosCompensationProcessing.nextAttemptAt': null, 'loyaltyPosCompensationProcessing.dirty': false });
      return acknowledged ? 'reconciliation' : this.defer(order, 'financial_snapshot_changed', 0);
    }
    if (receipt && (receipt.earnOperationId !== input.earnOperationId
      || receipt.attributionFingerprint !== historicalSaleAttributionFingerprint(input.attribution)
      || receipt.observationId !== input.observation.observationId
      || receipt.financialFingerprint !== input.observation.financialFingerprint)) return this.defer(order, 'observation_superseded');
    const state = outcome.kind === 'recorded' ? 'completed' : outcome.kind === 'reconciliation' ? 'reconciliation_required' : 'pending';
    const retryPending = outcome.kind === 'pending';
    const pendingDelay = Math.min(15 * 60_000, 30_000 * 2 ** (Math.max(1, Math.min(6, order.loyaltyPosCompensationProcessing.attempts)) - 1));
    const acknowledged = await this.finish(order, {
      'loyaltyPosCompensationProcessing.state': state,
      'loyaltyPosCompensationProcessing.lastError': outcome.kind === 'recorded' ? null : outcome.reason,
      'loyaltyPosCompensationProcessing.nextAttemptAt': retryPending ? new Date(Date.now() + pendingDelay) : null,
      'loyaltyPosCompensationProcessing.dirty': retryPending,
      ...(outcome.kind === 'recorded' ? { 'loyaltyPosCompensationProcessing.attempts': 0 } : {}),
      'loyaltyPosCompensationProcessing.observationId': input.observation.observationId,
      'loyaltyPosCompensationProcessing.financialFingerprint': input.observation.financialFingerprint,
      'loyaltyPosCompensationProcessing.orderVersion': input.observation.orderVersion,
      'loyaltyPosCompensationProcessing.refundSyncVersion': input.observation.refundSyncVersion,
      'loyaltyPosCompensationProcessing.observedAt': new Date(),
      ...(receipt ? { 'loyaltyPosCompensationProcessing.awardedUnits': receipt.initialUnits,
        'loyaltyPosCompensationProcessing.reversedUnits': receipt.reversedUnits } : {}),
    });
    if (!acknowledged) return this.defer(order, 'financial_snapshot_changed', 0);
    return outcome.kind === 'recorded' ? 'completed' : outcome.kind === 'reconciliation' ? 'reconciliation' : 'retried';
  }

  private async finish(order: Claimed, set: Record<string, unknown>): Promise<boolean> {
    const result = await this.orders.updateOne(this.fence(order), { $set: { ...set,
      'loyaltyPosCompensationProcessing.leaseToken': null, 'loyaltyPosCompensationProcessing.leaseUntil': null } },
    { writeConcern: WRITE, timestamps: false });
    return result.modifiedCount === 1;
  }
  private async defer(order: Claimed, code: string, delay?: number): Promise<'retried'> {
    const bounded = Math.max(1, Math.min(8, order.loyaltyPosCompensationProcessing.attempts));
    await this.orders.updateOne(this.owned(order), { $set: {
      'loyaltyPosCompensationProcessing.state': 'pending', 'loyaltyPosCompensationProcessing.lastError': code,
      'loyaltyPosCompensationProcessing.dirty': true,
      'loyaltyPosCompensationProcessing.nextAttemptAt': new Date(Date.now() + (delay ?? Math.min(15 * 60_000, 5_000 * 2 ** (bounded - 1)))),
      'loyaltyPosCompensationProcessing.leaseToken': null, 'loyaltyPosCompensationProcessing.leaseUntil': null,
    } }, { writeConcern: WRITE, timestamps: false });
    return 'retried';
  }
}
