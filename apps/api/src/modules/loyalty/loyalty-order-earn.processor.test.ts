import type { Order } from '@sm/db';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { LoyaltyMemberService } from './loyalty-member.service';
import { LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE } from './loyalty-purchase-verifier';
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
    status: 'delivered',
    payment: { status: 'paid' },
    totals: { total: 1_850 },
  };
}

function harness(claims: unknown[], earn = vi.fn().mockResolvedValue({}), receipt = vi.fn().mockResolvedValue({ kind: 'not_observed' })) {
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
    { earn, readEarnReceipt: receipt } as unknown as LoyaltyMemberService,
  );
  return { earn, receipt, findOneAndUpdate, orders, processor };
}

describe('LoyaltyOrderEarnProcessor — outbox serveur', () => {
  it('réclame les ventes éligibles et les reprises inéligibles, mais ne crédite que la vente éligible', async () => {
    const { processor, earn, findOneAndUpdate, orders } = harness([claimed(), null]);

    await expect(processor.drain(new Date('2026-09-01T08:00:00Z'))).resolves.toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      retried: 0,
      reviewRequired: 0,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        loyaltyEarnState: 'pending',
        $and: expect.arrayContaining([
          { $or: [
            { status: 'delivered', 'payment.status': 'paid' },
            { status: 'cancelled' },
            { 'payment.status': 'refunded' },
          ] },
        ]),
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

  it('rapproche le gain déjà enregistré après réponse perdue puis remboursement, sans recréditer', async () => {
    const receipt = vi.fn().mockResolvedValue({ kind: 'recorded', awardedUnits: 18, operationId: OPERATION_ID });
    const { processor, orders, earn } = harness([{ ...claimed(2), payment: { status: 'refunded' } }, null], undefined, receipt);
    await expect(processor.drain()).resolves.toMatchObject({ completed: 0, reviewRequired: 1 });
    expect(earn).not.toHaveBeenCalled();
    expect(receipt).toHaveBeenCalledWith({ tenantRef: TENANT, clientId: CLIENT_ID, memberId: MEMBER_ID, operationId: OPERATION_ID });
    expect(orders.updateOne).toHaveBeenCalledWith(expect.objectContaining({ loyaltyEarnOperationId: OPERATION_ID }),
      expect.objectContaining({ $set: expect.objectContaining({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'recorded_gain_sale_ineligible' }) }));
    expect(orders.updateMany.mock.calls.some(([, update]) => update.$set.loyaltyEarnState === 'cancelled')).toBe(false);
  });

  it('ne confond pas reçu encore invisible et absence définitive de gain', async () => {
    const { processor, orders, earn } = harness([{ ...claimed(2), status: 'cancelled' }, null]);
    await expect(processor.drain()).resolves.toMatchObject({ retried: 1, completed: 0 });
    expect(earn).not.toHaveBeenCalled();
    expect(orders.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ loyaltyEarnState: 'pending', loyaltyEarnLastError: 'sale_ineligible_unsettled' }),
    }));
  });

  it('reconnaît aussi le reçu de zéro point sans rappeler le calcul courant', async () => {
    const receipt = vi.fn().mockResolvedValue({ kind: 'recorded', awardedUnits: 0, operationId: OPERATION_ID });
    const { processor, earn } = harness([claimed(2), null], undefined, receipt);
    await expect(processor.drain()).resolves.toMatchObject({ completed: 1 });
    expect(earn).not.toHaveBeenCalled();
  });

  it('met un reçu canonique divergent à rapprocher sans appeler le writer', async () => {
    const { processor, earn, orders } = harness([claimed(), null], undefined, vi.fn().mockResolvedValue({ kind: 'conflict' }));
    await expect(processor.drain()).resolves.toMatchObject({ reviewRequired: 1 });
    expect(earn).not.toHaveBeenCalled();
    expect(orders.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'earn_receipt_conflict' }),
    }));
  });

  it('ne prétend pas avoir acquitté après changement de paiement ou perte du bail', async () => {
    const { processor, orders } = harness([claimed(), null]);
    orders.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(processor.drain()).resolves.toMatchObject({ completed: 0, retried: 1 });
    expect(orders.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      status: 'delivered', 'payment.status': 'paid', loyaltyEarnAttempts: 1,
    }), expect.anything());
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

  it('réessaie si la vente devient inéligible pendant la vérification du writer', async () => {
    const earn = vi.fn().mockRejectedValue(new ConflictException({ code: LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE }));
    const { processor, orders } = harness([claimed(), null], earn);
    await expect(processor.drain()).resolves.toMatchObject({ retried: 1, failed: 0, reviewRequired: 0 });
    expect(orders.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ loyaltyEarnState: 'pending', loyaltyEarnLastError: LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE }),
    }));
  });

  it('ne déduit pas l’absence de gain d’un refus permanent après validation de l’intention', async () => {
    const { processor, orders } = harness([claimed(), null], vi.fn().mockRejectedValue(new NotFoundException()));
    await expect(processor.drain()).resolves.toMatchObject({ failed: 0, reviewRequired: 1 });
    expect(orders.updateOne).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered', 'payment.status': 'paid' }), expect.objectContaining({
      $set: expect.objectContaining({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'earn_confirmation_rejected' }),
    }));
  });

  it('ne crédite pas si la lecture du reçu est indisponible', async () => {
    const { processor, earn, orders } = harness([claimed(), null], undefined, vi.fn().mockRejectedValue(new Error('secret de dépendance')));
    await expect(processor.drain()).resolves.toMatchObject({ retried: 1, completed: 0 });
    expect(earn).not.toHaveBeenCalled();
    expect(orders.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ loyaltyEarnLastError: 'dependency_unavailable' }),
    }));
  });

  it('ne compte pas un rapprochement si un autre bail a gagné', async () => {
    const { processor, orders } = harness([claimed(), null], undefined, vi.fn().mockResolvedValue({ kind: 'conflict' }));
    orders.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(processor.drain()).resolves.toMatchObject({ retried: 1, reviewRequired: 0 });
    expect(orders.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, loyaltyEarnAttempts: 1, loyaltyEarnLeaseUntil: LEASE_UNTIL,
      status: 'delivered', 'payment.status': 'paid',
    }), expect.anything());
  });

  it('ne compte pas une intention invalide comme fermée après perte du bail', async () => {
    const { processor, earn, receipt, orders } = harness([{ ...claimed(), tenantId: 'invalid' }, null]);
    orders.updateOne.mockResolvedValue({ modifiedCount: 0 });
    await expect(processor.drain()).resolves.toMatchObject({ retried: 1, failed: 0 });
    expect(earn).not.toHaveBeenCalled();
    expect(receipt).not.toHaveBeenCalled();
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
