import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Order, OrderReadyNotification } from '@sm/db';
import { ORDER_PUSH_CONFIG, openSubscription, type OrderPushConfig } from './order-push.crypto';
import { OrderPushSender } from './order-push.sender';
import { canNotifyReady, terminalOrder, type ReadyNotificationRow, type ReadySubscriptionRow } from './order-notifications.service';

export const ORDER_PUSH_LEASE_MS = 120_000;
export const ORDER_PUSH_MAX_ATTEMPTS = 8;
export function retryAt(attempts: number, now: number): Date { return new Date(now + Math.min(900_000, 15_000 * 2 ** Math.max(0, attempts - 1))); }

@Injectable()
export class OrderNotificationsWorker implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly logger = new Logger(OrderNotificationsWorker.name);
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('OrderReadyNotification') private readonly notices: Model<OrderReadyNotification>,
    private readonly sender: OrderPushSender,
    @Inject(ORDER_PUSH_CONFIG) private readonly config: OrderPushConfig | null,
  ) {}

  onModuleInit() {
    if (!this.config) return;
    this.timer = setInterval(() => { void this.drainOnce().catch(() => { this.logger.warn('Envoi des notifications reporté.'); }); }, 3_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async drainOnce(): Promise<void> {
    if (!this.config || this.running) return;
    this.running = true;
    try {
      for (let count = 0; count < 20; count++) {
        const now = new Date(), owner = randomUUID();
        const row = await this.notices.findOneAndUpdate({
          expiresAt: { $gt: now }, nextAttemptAt: { $ne: null, $lte: now },
          $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
        }, { $set: { leaseOwner: owner, leaseUntil: new Date(now.getTime() + ORDER_PUSH_LEASE_MS) } },
        { new: true, sort: { nextAttemptAt: 1 } }).select('+subscriptions.encrypted').lean<ReadyNotificationRow | null>();
        if (!row) break;
        try { await this.deliver(row, owner); }
        finally { await this.release(row, owner); }
      }
    } finally { this.running = false; }
  }

  private async settle(row: ReadyNotificationRow, owner: string, subscription: ReadySubscriptionRow, update: Record<string, unknown>) {
    const $set = Object.fromEntries(Object.entries(update).map(([key, value]) => [`subscriptions.$[entry].${key}`, value]));
    await this.notices.updateOne({ _id: row._id, leaseOwner: owner }, { $set, $inc: { revision: 1 } }, {
      arrayFilters: [{ 'entry.endpointHash': subscription.endpointHash, 'entry.generation': subscription.generation, 'entry.state': 'active' }],
    });
  }

  private async deliver(row: ReadyNotificationRow, owner: string) {
    const order = await this.orders.findOne({ _id: row.orderId, tenantId: row.tenantId }, { status: 1, statusHistory: 1, type: 1, 'payment.status': 1, 'payment.method': 1, 'payment.pendingRefundCents': 1 }).lean();
    const terminal = !order || terminalOrder(order);
    const ready = order?.status === 'ready' || order?.statusHistory?.some((step) => step.status === 'ready');
    for (const original of row.subscriptions) {
      if (original.state !== 'active') continue;
      if (terminal || original.expiresAt.getTime() <= Date.now()) {
        await this.settle(row, owner, original, { state: 'expired', encrypted: null }); continue;
      }
      if (!ready || !canNotifyReady(order!) || original.nextAttemptAt.getTime() > Date.now()) continue;
      const latestOrder = await this.orders.findOne({ _id: row.orderId, tenantId: row.tenantId }, { status: 1, type: 1, 'payment.status': 1, 'payment.method': 1, 'payment.pendingRefundCents': 1 }).lean();
      if (!latestOrder || terminalOrder(latestOrder)) { await this.settle(row, owner, original, { state: 'expired', encrypted: null }); continue; }
      if (!canNotifyReady(latestOrder)) continue;
      // Dernière lecture avant l'envoi : toute révocation acquittée pendant la
      // lecture de commande, ou tout bail expiré, reste prioritaire.
      const current = await this.notices.findOne({ _id: row._id, leaseOwner: owner }).select('+subscriptions.encrypted').lean<ReadyNotificationRow | null>();
      if (!current?.leaseUntil || current.leaseUntil.getTime() <= Date.now() + 10_000) return;
      const subscription = current.subscriptions.find((entry) => entry.endpointHash === original.endpointHash && entry.generation === original.generation && entry.state === 'active');
      if (!subscription?.encrypted) continue;
      let outcome: Awaited<ReturnType<OrderPushSender['send']>>;
      try {
        const clear = openSubscription(this.config!, String(row.tenantId), String(row.orderId), subscription.endpointHash, subscription.encrypted);
        outcome = await this.sender.send(clear, row.slug);
      } catch { outcome = 'expired'; }
      const attempts = subscription.attempts + 1;
      if (outcome === 'sent') await this.settle(row, owner, subscription, { state: 'sent', sentAt: new Date(), encrypted: null, attempts });
      else if (outcome === 'expired' || attempts >= ORDER_PUSH_MAX_ATTEMPTS) await this.settle(row, owner, subscription, { state: outcome === 'expired' ? 'expired' : 'failed', encrypted: null, attempts });
      else await this.settle(row, owner, subscription, { attempts, nextAttemptAt: retryAt(attempts, Date.now()) });
    }
  }

  private async release(row: ReadyNotificationRow, owner: string) {
    const fresh = await this.notices.findOne({ _id: row._id, leaseOwner: owner }).lean<ReadyNotificationRow | null>();
    if (!fresh) return;
    const active = fresh.subscriptions.filter((entry) => entry.state === 'active');
    const nextAttemptAt = active.length ? new Date(Math.max(Date.now() + 15_000, Math.min(...active.map((entry) => entry.nextAttemptAt.getTime())))) : null;
    const result = await this.notices.updateOne({ _id: row._id, leaseOwner: owner, revision: fresh.revision }, {
      $set: { leaseOwner: null, leaseUntil: null, nextAttemptAt },
    });
    // Un abonnement vient d'arriver : relire rapidement sans fermer sa file.
    if (!result.matchedCount) await this.notices.updateOne({ _id: row._id, leaseOwner: owner }, { $set: { leaseOwner: null, leaseUntil: null, nextAttemptAt: new Date() } });
  }
}
