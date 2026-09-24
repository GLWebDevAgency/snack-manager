import { ConflictException, Inject, Injectable, Logger, ServiceUnavailableException, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { aLaCapacite, ordersChannel, WS_EVENTS, type OrderRewardSelection } from '@sm/contracts';
import type { Order, PublicOrderAdmission, Tenant } from '@sm/db';
import { POSTGRES_POOL } from '../../postgres.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { orderRewardsEnabled, rewardPricingHash } from './order-reward.policy';
import { REDIS_PUB } from '../../redis.module';
import { OrderRewardStore, OrderRewardSnapshotSchema, orderRewardHash, type OrderRewardSnapshot } from '../loyalty/order-reward.store';
import type { RewardPricedLine } from '../loyalty/order-reward-benefit';
import { OrderAdmissionJournal } from './order-admission-journal';
import type { PublicRecoveryBinding } from './order-recovery';
import { orderAdmissionId } from './order-admission-identity';
import { CustomerOrderPreparationUnavailable } from './order-admission.errors';
import { counterRefundProjection, type CounterRefundSnapshot } from '../ordering/order-counter-refund.policy';
import type { RefundSnapshot } from '../ordering/order-refund-flow.policy';
import { refundAllocationProjection } from '../ordering/order-refund-allocation.policy';

const WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const SELECT = '+loyaltyReward +loyaltyRewardProcessing +customerOwner +paymentFlow +refundFlow +counterRefundFlow +counterCollection';
@Injectable()
export class OrderRewardService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly store: OrderRewardStore;
  private readonly journal: OrderAdmissionJournal;
  private readonly logger = new Logger(OrderRewardService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private scanAfter: unknown = null;
  private nextScan = 0;
  constructor(@Inject(POSTGRES_POOL) pool: Pool,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('PublicOrderAdmission') private readonly admissions: Model<PublicOrderAdmission>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @Inject(REDIS_PUB) private readonly redis: Redis) {
    this.store = new OrderRewardStore(pool); this.journal = new OrderAdmissionJournal(admissions, orders, redis);
  }
  onApplicationBootstrap() {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.drain().catch(() => this.logger.warn('Reprise des récompenses différée')); }, 5_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async prepare(input: { tenantRef: string; clientId: string; binding: PublicRecoveryBinding; selection: OrderRewardSelection;
    subtotal: number; lines: readonly RewardPricedLine[] }): Promise<OrderRewardSnapshot> {
    if (input.clientId !== input.clientId.toLowerCase()) throw new ConflictException('Identifiant de commande non canonique.');
    if (!orderRewardsEnabled()) throw new ConflictException('Les récompenses en commande sont momentanément indisponibles.');
    // Both queues must be indexed before accepting a new hold. Automatic
    // model initialization creates these additive indexes at deployment.
    await this.assertIndexesReady();
    const owner = input.binding.customerOwner;
    if (!owner || owner.tenantRef !== input.tenantRef || !input.binding.validationOwner) throw new ConflictException('La récompense nécessite votre compte personnel.');
    const tenant = await this.tenants.findById(input.tenantRef).lean();
    if (!tenant || !aLaCapacite(tenant, 'loyalty') || !['trial','active'].includes(tenant.account?.status ?? '')) throw new ConflictException('La fidélité est indisponible.');
    // Record discoverability BEFORE the first SQL hold. A rejected C01 produces
    // a SQL tombstone even when the original reservation call is still delayed.
    const filter = { _id: orderAdmissionId(input.tenantRef, input.clientId), state: 'validating',
      validationOwner: input.binding.validationOwner, payloadHash: input.binding.payloadHash, proofHash: input.binding.proofHash };
    await this.admissions.updateOne(filter, { $set: { 'loyaltyRewardAttempt.version': 1,
      'loyaltyRewardAttempt.nextAttemptAt': new Date(), 'loyaltyRewardAttempt.done': false } }, { writeConcern: WRITE, timestamps: false });
    if (!await this.admissions.exists({ ...filter, 'loyaltyRewardAttempt.version': 1 }).read('primary').readConcern('majority')) {
      throw new ConflictException('Cette tentative a changé. Reprenez la commande.');
    }
    try {
      return await this.store.reserve({ owner, clientId: input.clientId, selection: input.selection, subtotalCents: input.subtotal,
        lines: input.lines, pricingHash: rewardPricingHash(input.binding.payloadHash, input.subtotal, input.lines) });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // This validator has issued no Mongo committing CAS. A lost SQL reply
      // preserves the hold, but releases C01's validation claim for exact retry.
      throw new CustomerOrderPreparationUnavailable();
    }
  }
  async reconcile(tenantRef: string, clientId: string): Promise<void> {
    const id = orderAdmissionId(tenantRef, clientId);
    let admission = await this.journal.read(tenantRef, clientId);
    if (!admission) throw new ServiceUnavailableException('La récompense doit être rapprochée.');
    if (admission.state === 'validating') {
      // Time only permits attempting a terminal CAS. It is never proof that
      // the order did not commit. Late validators are fenced by C01's state.
      if (admission.createdAt.getTime() > Date.now() - 60 * 60_000) return;
      await this.admissions.updateOne({ _id: id, state: 'validating', payloadHash: admission.payloadHash },
        { $set: { state: 'rejected', rejection: 'abandoned' } }, { writeConcern: WRITE });
      admission = await this.journal.read(tenantRef, clientId);
      if (!admission || admission.state === 'validating') return;
    }
    if (admission.state === 'rejected') {
      await this.store.reject(tenantRef, clientId, { kind: 'admission_rejected', payloadHash: admission.payloadHash! });
      await this.admissions.updateOne({ _id: id, state: 'rejected' }, { $set: { 'loyaltyRewardAttempt.done': true } }, { writeConcern: WRITE, timestamps: false });
      return;
    }
    if (admission.state === 'committing') await this.journal.committedOrder(admission);
    const order = await this.orders.findOne({ tenantId: tenantRef, clientId }).select(SELECT).read('primary').readConcern('majority').lean();
    if (!order) throw new ServiceUnavailableException('La commande doit être retrouvée avant sa récompense.');
    const snapshot = OrderRewardSnapshotSchema.parse(order.loyaltyReward);
    if (snapshot.owner.tenantRef !== tenantRef || snapshot.clientId !== clientId || order.channel !== 'online'
      || orderRewardHash(snapshot.owner) !== orderRewardHash(order.customerOwner)
      || snapshot.pricingHash !== rewardPricingHash(admission.payloadHash!, order.totals.subtotal, order.lines)
      || order.totals.discount?.amount !== snapshot.benefit.amountCents || order.totals.discount?.promotionId != null) {
      throw new ConflictException('Le montant de la récompense doit être rapproché.');
    }
    await this.store.consume(snapshot, { kind: 'order_created', orderId: String(order._id), pricingHash: snapshot.pricingHash });
    let state: 'consumed' | 'reversed' = 'consumed';
    const unpaidClosed = order.status === 'cancelled' && order.payment.status === 'pending' && order.paymentFlow?.phase === 'closed';
    // Mongoose widens literal schema fields. The policies validate the actual
    // persisted protocol/version/receipts; do not manufacture a valid version.
    const financial = order;
    const allocation = order.payment.method === 'online' ? refundAllocationProjection(financial as unknown as RefundSnapshot) : null;
    const counter = order.payment.method === 'counter' && order.counterRefundFlow ? counterRefundProjection(financial as unknown as CounterRefundSnapshot) : null;
    const fullyRefunded = order.totals.total > 0 && order.payment.status === 'refunded'
      && ((allocation?.proof.fullyRefunded === true && allocation.pendingRefundCents === 0)
        || (counter?.confirmedRefundedCents === order.totals.total && counter.pendingRefundCents === 0));
    const zeroCancelled = order.status === 'cancelled' && order.totals.total === 0;
    if (unpaidClosed || fullyRefunded || zeroCancelled) {
      await this.store.reverse(snapshot, { kind: 'order_reversed', orderId: String(order._id), orderVersion: order.__v ?? 0,
        reason: fullyRefunded ? 'fully_refunded' : 'cancelled_unpaid' });
      state = 'reversed';
    }
    const zeroPaid = state === 'consumed' && order.totals.total === 0 && order.payment.status === 'pending' && order.status !== 'cancelled'
      && order.paymentFlow?.phase === 'open' && !order.paymentFlow.attempt && !order.payment.stripePaymentIntentId;
    const result = await this.orders.updateOne({ _id: order._id, tenantId: tenantRef, __v: order.__v,
      'loyaltyReward.reservationId': snapshot.reservationId }, { $set: { loyaltyRewardProcessing: { state,
        orderVersion: (order.__v ?? 0) + (zeroPaid ? 1 : 0), zeroPaid: zeroPaid || order.loyaltyRewardProcessing?.zeroPaid === true },
        ...(zeroPaid ? { 'payment.status': 'paid' } : {}) },
      ...(zeroPaid ? { $inc: { __v: 1 } } : {}) }, { writeConcern: WRITE, timestamps: false });
    if (result.matchedCount !== 1) throw new ServiceUnavailableException('La commande a changé pendant la confirmation de la récompense.');
    if (zeroPaid) {
      const visible = await this.orders.findById(order._id);
      if (visible) await publishRedisBestEffort(this.redis, ordersChannel(tenantRef), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: visible.toObject() }));
    }
    await this.admissions.updateOne({ _id: id, state: 'created' }, { $set: { 'loyaltyRewardAttempt.done': true } }, { writeConcern: WRITE, timestamps: false });
  }
  private async assertIndexesReady(): Promise<void> {
    try {
      const indexes = await Promise.all([this.orders.collection.indexes(), this.admissions.collection.indexes()]);
      const expected = [
        ['order_reward_scan', { 'loyaltyReward.version': 1, _id: 1 }],
        ['order_reward_attempt_due', { 'loyaltyRewardAttempt.version': 1, 'loyaltyRewardAttempt.done': 1, 'loyaltyRewardAttempt.nextAttemptAt': 1, _id: 1 }],
      ] as const;
      for (const [i, [name, key]] of expected.entries()) {
        const index = indexes[i]!.find(row => row.name === name);
        if (!index || JSON.stringify(index.key) !== JSON.stringify(key) || index.sparse || index.partialFilterExpression || index.expireAfterSeconds !== undefined) throw new Error('index unavailable');
      }
    } catch { throw new CustomerOrderPreparationUnavailable(); }
  }
  async drain(): Promise<void> {
    if (this.running) return; this.running = true;
    try {
      const attempts = await this.admissions.find({ 'loyaltyRewardAttempt.version': 1, 'loyaltyRewardAttempt.done': false,
        'loyaltyRewardAttempt.nextAttemptAt': { $lte: new Date() } }).sort({ 'loyaltyRewardAttempt.nextAttemptAt': 1, _id: 1 }).limit(25)
        .select('_id tenantId clientId').hint('order_reward_attempt_due').read('primary').readConcern('majority').maxTimeMS(5_000).lean();
      for (const a of attempts) {
        try { await this.reconcile(String(a.tenantId), a.clientId); }
        catch { this.logger.warn('Une récompense attend sa reprise durable'); }
        await this.admissions.updateOne({ _id: a._id, 'loyaltyRewardAttempt.done': false },
          { $set: { 'loyaltyRewardAttempt.nextAttemptAt': new Date(Date.now() + 30_000) } }, { writeConcern: WRITE, timestamps: false });
      }
      if (Date.now() >= this.nextScan) {
        this.nextScan = Date.now() + 60_000;
        const rows = await this.orders.find({ 'loyaltyReward.version': 1, 'loyaltyRewardProcessing.state': { $ne: 'reversed' },
          $or: [{ 'loyaltyRewardProcessing.state': 'pending' }, { 'payment.status': 'refunded' },
            { status: 'cancelled', 'payment.status': 'pending' }, { status: 'cancelled', 'totals.total': 0 }],
          ...(this.scanAfter ? { _id: { $gt: this.scanAfter } } : {}) }).sort({ _id: 1 }).limit(50)
          .select('_id tenantId clientId __v +loyaltyRewardProcessing').hint('order_reward_scan').read('primary').readConcern('majority').maxTimeMS(5_000).lean();
        this.scanAfter = rows.at(-1)?._id ?? null;
        for (const order of rows) if (order.loyaltyRewardProcessing?.orderVersion !== order.__v) {
          await this.admissions.updateOne({ _id: orderAdmissionId(String(order.tenantId), order.clientId), 'loyaltyRewardAttempt.version': 1 },
            { $set: { 'loyaltyRewardAttempt.done': false, 'loyaltyRewardAttempt.nextAttemptAt': new Date() } }, { writeConcern: WRITE, timestamps: false });
        }
      }
    } finally { this.running = false; }
  }
}
