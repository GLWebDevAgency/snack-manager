import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Order } from '@sm/db';
import type { Model } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import {
  LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE,
  LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
  LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE,
  LoyaltyPurchaseVerifier,
} from './loyalty-purchase-verifier';

const TENANT = '65f000000000000000000001';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const EXTERNAL_REF = `pos-order:${CLIENT_ID}`;

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof BadRequestException || error instanceof ConflictException)) {
    return undefined;
  }
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response
    ? String(response.code)
    : undefined;
}

function harness(order: unknown) {
  const lean = vi.fn().mockResolvedValue(order);
  const findOne = vi.fn().mockReturnValue({ lean });
  const verifier = new LoyaltyPurchaseVerifier({ findOne } as unknown as Model<Order>);
  return { findOne, lean, verifier };
}

const eligibleOrder = {
  channel: 'pos',
  status: 'delivered',
  payment: { status: 'paid' },
  totals: { total: 1_850 },
};

describe('LoyaltyPurchaseVerifier — preuve serveur du ticket POS', () => {
  it('refuse toute référence qui ne désigne pas un UUIDv4 POS', async () => {
    const { verifier, findOne } = harness(eligibleOrder);

    const promise = verifier.confirmedPurchaseCents({
      tenantRef: TENANT,
      memberId: MEMBER_ID,
      externalRef: 'ticket-libre:42',
      claimedPurchaseCents: 1_850,
    });

    await expect(promise).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === LOYALTY_POS_TICKET_REFERENCE_INVALID_CODE,
    );
    expect(findOne).not.toHaveBeenCalled();
  });

  it('lie ticket, tenant et membre signés puis masque toute absence ou discordance', async () => {
    const { verifier, findOne } = harness(null);

    const promise = verifier.confirmedPurchaseCents({
      tenantRef: TENANT,
      memberId: MEMBER_ID,
      externalRef: EXTERNAL_REF,
      claimedPurchaseCents: 1_850,
    });

    await expect(promise).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
    );
    expect(findOne).toHaveBeenCalledWith(
      { tenantId: TENANT, clientId: CLIENT_ID, loyaltyMemberId: MEMBER_ID },
      {
        _id: 0,
        channel: 1,
        status: 1,
        loyaltyMemberId: 1,
        'payment.status': 1,
        'totals.total': 1,
      },
    );
  });

  it.each([
    ['commande en ligne', { ...eligibleOrder, channel: 'online' }],
    ['commande non payée', { ...eligibleOrder, payment: { status: 'pending' } }],
    ['commande remboursée', { ...eligibleOrder, payment: { status: 'refunded' } }],
    ['commande annulée', { ...eligibleOrder, status: 'cancelled' }],
    ['commande encore ouverte', { ...eligibleOrder, status: 'ready' }],
    ['total corrompu', { ...eligibleOrder, totals: { total: 18.5 } }],
  ])('refuse une %s', async (_label, order) => {
    const { verifier } = harness(order);

    await expect(
      verifier.confirmedPurchaseCents({
        tenantRef: TENANT,
        memberId: MEMBER_ID,
        externalRef: EXTERNAL_REF,
        claimedPurchaseCents: 1_850,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === LOYALTY_POS_TICKET_NOT_ELIGIBLE_CODE,
    );
  });

  it('refuse un montant caisse différent du total serveur sans révéler le bon montant', async () => {
    const { verifier } = harness(eligibleOrder);

    await expect(
      verifier.confirmedPurchaseCents({
        tenantRef: TENANT,
        memberId: MEMBER_ID,
        externalRef: EXTERNAL_REF,
        claimedPurchaseCents: 99_999,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => errorCode(error) === LOYALTY_POS_TICKET_AMOUNT_MISMATCH_CODE,
    );
  });

  it('retourne exclusivement le total serveur pour un ticket POS payé et intact', async () => {
    const { verifier } = harness(eligibleOrder);

    await expect(
      verifier.confirmedPurchaseCents({
        tenantRef: TENANT,
        memberId: MEMBER_ID,
        externalRef: EXTERNAL_REF,
        claimedPurchaseCents: 1_850,
      }),
    ).resolves.toBe(1_850);
  });
});
