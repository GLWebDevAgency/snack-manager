import type { Order } from '@sm/db';
import { ConflictException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { LoyaltyMemberService } from './loyalty-member.service';
import {
  LoyaltyOrderEarnProcessor,
  loyaltyEarnRetryDelayMs,
  loyaltyEarnSafeErrorCode,
} from './loyalty-order-earn.processor';

const TENANT = '65f000000000000000000001';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const OPERATION_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '65f000000000000000000010';
const DEVICE_ID = '65f000000000000000000020';
const LEASE_UNTIL = new Date('2026-09-01T08:01:00.000Z');

function claimed(attempts = 1) {
  return {
    _id: 'mongo-order-id',
    tenantId: TENANT,
    clientId: CLIENT_ID,
    loyaltyMemberId: MEMBER_ID,
    loyaltyEarnOperationId: OPERATION_ID,
    loyaltyActorRef: ACTOR_ID,
    loyaltyDeviceRef: DEVICE_ID,
    loyaltyEarnAttempts: attempts,
    loyaltyEarnLeaseUntil: LEASE_UNTIL,
    totals: { total: 1_850 },
  };
}

function harness(claims: unknown[], earn = vi.fn().mockResolvedValue({})) {
  const findOneAndUpdate = vi.fn().mockImplementation(() => ({
    select: vi.fn().mockResolvedValue(claims.shift() ?? null),
  }));
  const orders = {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    findOneAndUpdate,
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const processor = new LoyaltyOrderEarnProcessor(
    orders as unknown as Model<Order>,
    { earn } as unknown as LoyaltyMemberService,
  );
  return { earn, findOneAndUpdate, orders, processor };
}

describe('LoyaltyOrderEarnProcessor — outbox serveur', () => {
  it('ne réclame que les ventes livrées et payées, puis crédite une fois', async () => {
    const { processor, earn, findOneAndUpdate, orders } = harness([claimed(), null]);

    await expect(processor.drain(new Date('2026-09-01T08:00:00Z'))).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        loyaltyEarnState: 'pending',
        status: 'delivered',
        'payment.status': 'paid',
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ loyaltyEarnState: 'processing' }),
        $inc: { loyaltyEarnAttempts: 1 },
      }),
      expect.objectContaining({ new: true }),
    );
    expect(earn).toHaveBeenCalledWith(
      TENANT,
      MEMBER_ID,
      {
        operationId: OPERATION_ID,
        purchaseCents: 1_850,
        externalRef: `pos-order:${CLIENT_ID}`,
      },
      { source: 'pos', actorRef: ACTOR_ID, deviceRef: DEVICE_ID },
    );
    expect(orders.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        loyaltyEarnOperationId: OPERATION_ID,
        loyaltyEarnLeaseUntil: LEASE_UNTIL,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ loyaltyEarnState: 'completed' }),
      }),
    );
  });

  it('rejoue exactement la même opération après une panne transitoire', async () => {
    const earn = vi
      .fn()
      .mockRejectedValueOnce(new Error('socket avec donnée non journalisable'))
      .mockResolvedValueOnce({});
    const { processor, orders } = harness([claimed(1), null, claimed(2), null], earn);

    await expect(processor.drain()).resolves.toMatchObject({ retried: 1 });
    await expect(processor.drain()).resolves.toMatchObject({ completed: 1 });

    expect(earn).toHaveBeenCalledTimes(2);
    expect(earn.mock.calls[0]?.[2]).toEqual(earn.mock.calls[1]?.[2]);
    expect(orders.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ loyaltyEarnState: 'processing' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          loyaltyEarnState: 'pending',
          loyaltyEarnLastError: 'dependency_unavailable',
        }),
      }),
    );
  });

  it('ne peut pas écraser le bail repris par un autre worker', async () => {
    const { processor, orders } = harness([claimed(), null]);

    await processor.drain();

    const completionFilter = orders.updateOne.mock.calls.find(
      ([filter]) =>
        (filter as { loyaltyEarnOperationId?: string }).loyaltyEarnOperationId === OPERATION_ID,
    )?.[0];
    expect(completionFilter).toMatchObject({
      loyaltyEarnState: 'processing',
      loyaltyEarnLeaseUntil: LEASE_UNTIL,
    });
  });

  it('ferme une intention corrompue sans appeler le ledger', async () => {
    const corrupt = { ...claimed(), loyaltyMemberId: '06 12 34 56 78' };
    const { processor, earn, orders } = harness([corrupt, null]);

    await expect(processor.drain()).resolves.toMatchObject({ failed: 1 });
    expect(earn).not.toHaveBeenCalled();
    expect(orders.updateOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          loyaltyEarnState: 'failed',
          loyaltyEarnLastError: 'invalid_outbox_intent',
        }),
      }),
    );
  });

  it('ne persiste jamais le message brut d’une dépendance', () => {
    expect(loyaltyEarnSafeErrorCode(new Error('client 06 12 34 56 78'))).toBe(
      'dependency_unavailable',
    );
    expect(
      loyaltyEarnSafeErrorCode(
        new ConflictException({ code: '0612345678', message: 'valeur non fiable' }),
      ),
    ).toBe('dependency_unavailable');
  });

  it('borne le backoff entre cinq secondes et quinze minutes', () => {
    expect(loyaltyEarnRetryDelayMs(1)).toBe(5_000);
    expect(loyaltyEarnRetryDelayMs(99)).toBe(15 * 60_000);
  });
});
