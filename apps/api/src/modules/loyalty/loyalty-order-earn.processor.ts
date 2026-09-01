import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Order } from '@sm/db';
import { Types, type Model } from 'mongoose';
import {
  LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE,
  LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
  LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE,
} from './loyalty-purchase-verifier';
import { LoyaltyMemberService } from './loyalty-member.service';

const POLL_INTERVAL_MS = 5_000;
const FIRST_RUN_DELAY_MS = 2_000;
const LEASE_MS = 60_000;
const MAX_BATCH = 25;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_DEPENDENCY_CODES = new Set([
  LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE,
  LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
  LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE,
]);

type ClaimedOrder = Order & {
  _id: unknown;
  tenantId: unknown;
  clientId: string;
  loyaltyMemberId: string | null;
  loyaltyEarnOperationId: string | null;
  loyaltyActorRef: string | null;
  loyaltyDeviceRef: string | null;
  loyaltyEarnAttempts: number;
  totals: { total: number };
};

export interface LoyaltyEarnDrainResult {
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
}

class InvalidLoyaltyEarnIntent extends Error {}

function responseCode(error: unknown): string | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('getResponse' in error) ||
    typeof error.getResponse !== 'function'
  ) {
    return null;
  }
  const response = error.getResponse() as unknown;
  if (typeof response !== 'object' || response === null || !('code' in response)) return null;
  const code = String(response.code);
  return PUBLIC_DEPENDENCY_CODES.has(code) ? code : null;
}

/**
 * Uniquement des codes fermés dans Mongo et les journaux : un message de
 * dépendance peut contenir une donnée client ou une chaîne fournie par elle.
 */
export function loyaltyEarnSafeErrorCode(error: unknown): string {
  if (error instanceof InvalidLoyaltyEarnIntent) return 'invalid_outbox_intent';
  const code = responseCode(error);
  if (code) return code;
  if (error instanceof NotFoundException) return 'member_not_found';
  if (error instanceof BadRequestException) return 'invalid_outbox_intent';
  return 'dependency_unavailable';
}

export function loyaltyEarnRetryDelayMs(attempts: number): number {
  const bounded = Math.max(1, Math.min(9, Math.trunc(attempts)));
  return Math.min(15 * 60_000, 5_000 * 2 ** (bounded - 1));
}

function permanentFailure(error: unknown): boolean {
  const code = responseCode(error);
  return (
    error instanceof InvalidLoyaltyEarnIntent ||
    error instanceof NotFoundException ||
    error instanceof BadRequestException ||
    code === LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE ||
    code === LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE ||
    code === LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE
  );
}

/**
 * Outbox transactionnel Mongo -> ledger PostgreSQL.
 *
 * La vente et l'intention de gain naissent dans le même document. Le worker
 * prend ensuite un bail atomique, ne crédite qu'une vente `delivered + paid`,
 * et utilise l'operationId comme clé idempotente. Un arrêt après le commit
 * PostgreSQL mais avant le marquage Mongo expire simplement le bail : le
 * passage suivant rejoue le résultat, sans jamais recréditer le portefeuille.
 */
@Injectable()
export class LoyaltyOrderEarnProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LoyaltyOrderEarnProcessor.name);
  private timer: NodeJS.Timeout | null = null;
  private firstRunTimer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly loyalty: LoyaltyMemberService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
    const run = () => {
      void this.drain().catch(() => {
        this.logger.warn('Traitement fidélité différé : dépendance indisponible');
      });
    };
    this.timer = setInterval(run, POLL_INTERVAL_MS);
    this.timer.unref();
    this.firstRunTimer = setTimeout(run, FIRST_RUN_DELAY_MS);
    this.firstRunTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.firstRunTimer) clearTimeout(this.firstRunTimer);
    this.timer = null;
    this.firstRunTimer = null;
  }

  async drain(now: Date = new Date()): Promise<LoyaltyEarnDrainResult> {
    if (this.draining) return { claimed: 0, completed: 0, failed: 0, retried: 0 };
    this.draining = true;
    const result: LoyaltyEarnDrainResult = {
      claimed: 0,
      completed: 0,
      failed: 0,
      retried: 0,
    };
    try {
      await this.recoverExpiredLeases(now);
      await this.cancelIneligibleSales();

      for (let index = 0; index < MAX_BATCH; index += 1) {
        const order = await this.claimNext(new Date());
        if (!order) break;
        result.claimed += 1;
        const outcome = await this.process(order);
        result[outcome] += 1;
      }
      return result;
    } finally {
      this.draining = false;
    }
  }

  private async recoverExpiredLeases(now: Date): Promise<void> {
    await this.orders.updateMany(
      { loyaltyEarnState: 'processing', loyaltyEarnLeaseUntil: { $lte: now } },
      {
        $set: {
          loyaltyEarnState: 'pending',
          loyaltyEarnLeaseUntil: null,
          loyaltyEarnNextAttemptAt: now,
        },
      },
    );
  }

  private async cancelIneligibleSales(): Promise<void> {
    await this.orders.updateMany(
      {
        loyaltyEarnState: 'pending',
        $or: [{ status: 'cancelled' }, { 'payment.status': 'refunded' }],
      },
      {
        $set: {
          loyaltyEarnState: 'cancelled',
          loyaltyEarnLastError: 'sale_cancelled',
          loyaltyEarnNextAttemptAt: null,
          loyaltyEarnLeaseUntil: null,
        },
      },
    );
  }

  private async claimNext(now: Date): Promise<ClaimedOrder | null> {
    const query = this.orders.findOneAndUpdate(
      {
        loyaltyEarnState: 'pending',
        status: 'delivered',
        'payment.status': 'paid',
        $or: [
          { loyaltyEarnNextAttemptAt: null },
          { loyaltyEarnNextAttemptAt: { $exists: false } },
          { loyaltyEarnNextAttemptAt: { $lte: now } },
        ],
      },
      {
        $set: {
          loyaltyEarnState: 'processing',
          loyaltyEarnLeaseUntil: new Date(now.getTime() + LEASE_MS),
          loyaltyEarnLastError: null,
        },
        $inc: { loyaltyEarnAttempts: 1 },
      },
      { new: true, sort: { createdAt: 1 } },
    );
    return (await query.select(
      '+loyaltyMemberId +loyaltyEarnOperationId +loyaltyActorRef +loyaltyDeviceRef +loyaltyEarnAttempts',
    )) as ClaimedOrder | null;
  }

  private async process(
    order: ClaimedOrder,
  ): Promise<'completed' | 'failed' | 'retried'> {
    try {
      const tenantRef = String(order.tenantId);
      const memberId = order.loyaltyMemberId;
      const operationId = order.loyaltyEarnOperationId;
      const actorRef = order.loyaltyActorRef;
      const total = order.totals?.total;
      if (
        !UUID_V4.test(order.clientId) ||
        !memberId ||
        !UUID_V4.test(memberId) ||
        !operationId ||
        !UUID_V4.test(operationId) ||
        !actorRef ||
        !Types.ObjectId.isValid(actorRef) ||
        (order.loyaltyDeviceRef !== null &&
          !Types.ObjectId.isValid(order.loyaltyDeviceRef)) ||
        !Number.isSafeInteger(total) ||
        total < 0
      ) {
        throw new InvalidLoyaltyEarnIntent();
      }

      await this.loyalty.earn(
        tenantRef,
        memberId,
        {
          operationId,
          purchaseCents: total,
          externalRef: `pos-order:${order.clientId}`,
        },
        {
          source: 'pos',
          actorRef,
          deviceRef: order.loyaltyDeviceRef ?? null,
        },
      );
      await this.orders.updateOne(
        {
          _id: order._id,
          loyaltyEarnOperationId: operationId,
          loyaltyEarnState: 'processing',
        },
        {
          $set: {
            loyaltyEarnState: 'completed',
            loyaltyEarnCompletedAt: new Date(),
            loyaltyEarnLastError: null,
            loyaltyEarnNextAttemptAt: null,
            loyaltyEarnLeaseUntil: null,
          },
        },
      );
      return 'completed';
    } catch (error) {
      const errorCode = loyaltyEarnSafeErrorCode(error);
      if (permanentFailure(error)) {
        await this.orders.updateOne(
          { _id: order._id, loyaltyEarnState: 'processing' },
          {
            $set: {
              loyaltyEarnState: 'failed',
              loyaltyEarnLastError: errorCode,
              loyaltyEarnNextAttemptAt: null,
              loyaltyEarnLeaseUntil: null,
            },
          },
        );
        this.logger.warn(`Gain fidélité en échec contrôlé (${errorCode})`);
        return 'failed';
      }

      const nextAttemptAt = new Date(
        Date.now() + loyaltyEarnRetryDelayMs(order.loyaltyEarnAttempts),
      );
      await this.orders.updateOne(
        { _id: order._id, loyaltyEarnState: 'processing' },
        {
          $set: {
            loyaltyEarnState: 'pending',
            loyaltyEarnLastError: errorCode,
            loyaltyEarnNextAttemptAt: nextAttemptAt,
            loyaltyEarnLeaseUntil: null,
          },
        },
      );
      return 'retried';
    }
  }
}
