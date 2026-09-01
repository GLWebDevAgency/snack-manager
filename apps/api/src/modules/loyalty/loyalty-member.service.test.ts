import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { LoyaltyCryptoAdapter, type LoyaltyDb } from '@sm/loyalty';
import { describe, expect, it, vi } from 'vitest';
import {
  LOYALTY_SMS_GRANT_DISABLED_CODE,
  LOYALTY_SMS_GRANT_DISABLED_MESSAGE,
  LoyaltyMemberService,
  isUniqueConstraint,
  type LoyaltyActorContext,
} from './loyalty-member.service';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

function crypto(): LoyaltyCryptoAdapter {
  return new LoyaltyCryptoAdapter({
    encryptionKeyBase64: Buffer.alloc(32, 11).toString('base64'),
    phoneLookupKeyBase64: Buffer.alloc(32, 22).toString('base64'),
    operationFingerprintKeyBase64: Buffer.alloc(32, 33).toString('base64'),
    qrTokenDerivationKeyBase64: Buffer.alloc(32, 44).toString('base64'),
  });
}

function harness() {
  const transaction = vi.fn();
  const db = { transaction } as unknown as LoyaltyDb;
  const purchases = {
    confirmedPurchaseCents: vi.fn(
      async ({ claimedPurchaseCents }: { claimedPurchaseCents: number }) =>
        claimedPurchaseCents,
    ),
  } as unknown as LoyaltyPurchaseVerifier;
  return {
    transaction,
    purchases,
    service: new LoyaltyMemberService(db, crypto(), purchases),
  };
}

const POS: LoyaltyActorContext = {
  source: 'pos',
  actorRef: 'cashier:test',
  deviceRef: 'device:test',
};

describe('LoyaltyMemberService — validations avant transaction', () => {
  it('ne traduit en doublon téléphone que la contrainte PostgreSQL exacte', () => {
    expect(
      isUniqueConstraint(
        {
          cause: {
            code: '23505',
            constraint: 'member_profiles_tenant_phone_uq',
          },
        },
        'member_profiles_tenant_phone_uq',
      ),
    ).toBe(true);
    expect(
      isUniqueConstraint(
        {
          code: '23505',
          cause: { constraint: 'member_profiles_tenant_phone_uq' },
        },
        'member_profiles_tenant_phone_uq',
      ),
    ).toBe(true);
    expect(
      isUniqueConstraint(
        { code: '23505', constraint: 'member_tokens_hash_uq' },
        'member_profiles_tenant_phone_uq',
      ),
    ).toBe(false);
    expect(
      isUniqueConstraint(
        {
          cause: {
            code: '23505',
            constraint: 'earn_receipts_tenant_source_external_ref_uq',
          },
        },
        'earn_receipts_tenant_source_external_ref_uq',
      ),
    ).toBe(true);
    expect(
      isUniqueConstraint(
        { code: '23505', constraint: 'ledger_redeem_external_ref_uq' },
        'earn_receipts_tenant_source_external_ref_uq',
      ),
    ).toBe(false);
  });

  it('refuse un téléphone invalide en 400 avant empreinte ou accès PostgreSQL', async () => {
    const { service, transaction } = harness();

    await expect(
      service.createMember(
        'tenant-test',
        {
          operationId: randomUUID(),
          firstName: 'Mina',
          phone: '+32 470 12 34 56',
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        POS,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuse un gain POS sans ticket avant de réclamer une opération', async () => {
    const { service, transaction, purchases } = harness();

    await expect(
      service.earn(
        'tenant-test',
        randomUUID(),
        { operationId: randomUUID(), purchaseCents: 1_000, externalRef: null },
        POS,
      ),
    ).rejects.toThrow('La référence du ticket est obligatoire pour ce canal');
    expect(transaction).not.toHaveBeenCalled();
    expect(purchases.confirmedPurchaseCents).not.toHaveBeenCalled();
  });

  it('refuse une consommation POS sans référence opaque avant de réclamer une opération', async () => {
    const { service, transaction } = harness();

    for (const externalRef of [null, '06 12 34 56 78', `online-redemption:${randomUUID()}`]) {
      await expect(
        service.redeem(
          'tenant-test',
          randomUUID(),
          {
            operationId: randomUUID(),
            rewardId: randomUUID(),
            expectedCostUnits: 10,
            externalRef,
          },
          POS,
        ),
      ).rejects.toThrow('La référence de consommation de ce canal est invalide');
    }
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuse tout nouvel octroi SMS avec une erreur métier stable avant PostgreSQL', async () => {
    const { service, transaction } = harness();

    const error = await service
      .recordConsent(
        'tenant-test',
        randomUUID(),
        {
          operationId: randomUUID(),
          purpose: 'marketing_sms',
          decision: 'granted',
          noticeVersion: 'marketing-2026-09',
        },
        POS,
      )
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      code: LOYALTY_SMS_GRANT_DISABLED_CODE,
      message: LOYALTY_SMS_GRANT_DISABLED_MESSAGE,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('réserve la compensation au manager ou au système avant tout accès PostgreSQL', async () => {
    const { service, transaction } = harness();

    await expect(
      service.reverseLedgerEntry(
        'tenant-test',
        randomUUID(),
        randomUUID(),
        {
          operationId: randomUUID(),
          reason: 'Tentative depuis la caisse',
        },
        POS,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
