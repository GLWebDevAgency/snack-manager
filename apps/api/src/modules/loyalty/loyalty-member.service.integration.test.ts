import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  LoyaltyCryptoAdapter,
  and,
  consentEvents,
  consentState,
  earnReceipts,
  eq,
  ledgerEntries,
  loyaltyDb,
  migrateLoyaltySchema,
  operations,
  programVersions,
  programs,
  rewards,
  withLoyaltyTenant,
  type LoyaltyDb,
} from '@sm/loyalty';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LOYALTY_SMS_GRANT_DISABLED_CODE,
  LOYALTY_SMS_GRANT_DISABLED_MESSAGE,
  LoyaltyMemberService,
  type LoyaltyActorContext,
} from './loyalty-member.service';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

const adminUrl = process.env.LOYALTY_TEST_DATABASE_URL;
const integration = adminUrl ? describe : describe.skip;
const requestedTimeout = Number(process.env.LOYALTY_TEST_TIMEOUT_MS);
const integrationTestTimeout =
  Number.isInteger(requestedTimeout) && requestedTimeout >= 20_000 && requestedTimeout <= 120_000
    ? requestedTimeout
    : 20_000;
const appRole = 'loyalty_app_test';
const appPassword = 'loyalty-test-only';

let adminPool: Pool;
let appPool: Pool;
let db: LoyaltyDb;
let service: LoyaltyMemberService;
let purchaseVerificationFailure: Error | null = null;

const trustedTestPurchases = {
  // Ces tests prouvent la transaction PostgreSQL. La preuve Mongo dispose de
  // sa propre suite unitaire et l'intégration API la rebranche en production.
  confirmedPurchaseCents: async ({
    claimedPurchaseCents,
  }: {
    claimedPurchaseCents: number;
  }) => {
    if (purchaseVerificationFailure) throw purchaseVerificationFailure;
    return claimedPurchaseCents;
  },
} as unknown as LoyaltyPurchaseVerifier;

const actor: LoyaltyActorContext = {
  source: 'standalone',
  actorRef: 'terminal:test',
  deviceRef: 'device:test',
};

function testCrypto(): LoyaltyCryptoAdapter {
  return new LoyaltyCryptoAdapter({
    encryptionKeyBase64: Buffer.alloc(32, 17).toString('base64'),
    phoneLookupKeyBase64: Buffer.alloc(32, 43).toString('base64'),
    operationFingerprintKeyBase64: Buffer.alloc(32, 91).toString('base64'),
    qrTokenDerivationKeyBase64: Buffer.alloc(32, 127).toString('base64'),
    encryptionKeyVersion: 1,
  });
}

/** Simule uniquement l'état légal hérité d'avant le pilote sans rouvrir l'octroi. */
async function seedHistoricalSmsGrant(
  tenantRef: string,
  memberId: string,
  noticeVersion = 'marketing-2026-09',
): Promise<string> {
  const operationId = randomUUID();
  const recordedAt = new Date();
  await withLoyaltyTenant(db, tenantRef, async (tx) => {
    await tx.insert(operations).values({
      tenantRef,
      operationId,
      kind: 'consent',
      requestFingerprint: `historical-grant:${operationId}`,
      status: 'completed',
      result: {
        operationId,
        replayed: false,
        consent: {
          purpose: 'marketing_sms',
          decision: 'granted',
          noticeVersion,
          updatedAt: recordedAt.toISOString(),
        },
      },
      completedAt: recordedAt,
    });
    const [event] = await tx
      .insert(consentEvents)
      .values({
        tenantRef,
        memberId,
        operationId,
        purpose: 'marketing_sms',
        decision: 'granted',
        noticeVersion,
        source: 'standalone',
        actorRef: 'historical-import:test',
        recordedAt,
      })
      .returning({ id: consentEvents.id });
    if (!event) throw new Error('Événement historique de consentement absent');
    await tx.insert(consentState).values({
      tenantRef,
      memberId,
      purpose: 'marketing_sms',
      decision: 'granted',
      noticeVersion,
      eventId: event.id,
      updatedAt: recordedAt,
    });
  });
  return operationId;
}

async function acknowledgeCreated(
  tenantRef: string,
  created: Awaited<ReturnType<LoyaltyMemberService['createMember']>>,
  enrollmentActor: LoyaltyActorContext,
) {
  await service.acknowledgeEnrollment(
    tenantRef,
    { operationId: created.operationId },
    enrollmentActor,
  );
  return created;
}

async function forceEnrollmentExpired(input: {
  tenantRef: string;
  operationId: string;
  memberId: string;
  ageOperation?: boolean;
}): Promise<string> {
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  await adminPool.query(
    `UPDATE loyalty.operations
        SET result = jsonb_set(result, '{recoveryExpiresAt}', to_jsonb($3::text)),
            created_at = CASE WHEN $4::boolean THEN $5::timestamptz ELSE created_at END
      WHERE tenant_ref = $1 AND operation_id = $2`,
    [
      input.tenantRef,
      input.operationId,
      expiredAt,
      input.ageOperation ?? false,
      new Date(Date.now() - 31 * 60_000).toISOString(),
    ],
  );
  await adminPool.query(
    `UPDATE loyalty.member_tokens
        SET expires_at = $3
      WHERE tenant_ref = $1 AND member_id = $2 AND status = 'active'`,
    [input.tenantRef, input.memberId, expiredAt],
  );
  return expiredAt;
}

integration('LoyaltyMemberService — transaction PostgreSQL réelle', () => {
  beforeAll(async () => {
    const url = new URL(adminUrl!);
    const databaseName = url.pathname.slice(1);
    if (!/^snackmanager_loyalty_test_[a-z0-9_]+$/.test(databaseName)) {
      throw new Error(
        'La suite fidélité refuse toute base sans préfixe snackmanager_loyalty_test_',
      );
    }

    adminPool = new Pool({ connectionString: adminUrl, max: 4 });
    await migrateLoyaltySchema(loyaltyDb(adminPool), {
      migrationsFolder: resolve(__dirname, '../../../../../packages/loyalty/drizzle'),
      migrationsTable: '__drizzle_loyalty_migrations',
    });
    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
          CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}';
        END IF;
      END
      $$;
      GRANT CONNECT ON DATABASE "${databaseName}" TO ${appRole};
      GRANT USAGE ON SCHEMA loyalty TO ${appRole};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loyalty TO ${appRole};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA loyalty TO ${appRole};
    `);

    const appUrl = new URL(adminUrl!);
    appUrl.username = appRole;
    appUrl.password = appPassword;
    appPool = new Pool({ connectionString: appUrl.toString(), max: 8 });
    db = loyaltyDb(appPool);
    service = new LoyaltyMemberService(db, testCrypto(), trustedTestPurchases);
  }, integrationTestTimeout);

  afterAll(async () => {
    await appPool?.end();
    await adminPool?.end();
  });

  it('adhère, retrouve, crédite et dépense sans double effet ni fuite tenant', async () => {
    const tenantRef = `classfood-${randomUUID()}`;
    const otherTenantRef = `rival-${randomUUID()}`;
    const programId = randomUUID();
    const rewardId = randomUUID();

    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({
        id: programId,
        tenantRef,
        status: 'active',
      });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Classfood Club',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: 100,
        spendStepCents: 100,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: '1 point par euro dépensé.',
      });
      await tx.insert(rewards).values({
        id: rewardId,
        tenantRef,
        programId,
        name: 'Menu offert',
        description: 'Un menu Classfood offert.',
        costUnits: 15,
        kind: 'custom',
      });
    });

    const createOperation = randomUUID();
    const createInput = {
      operationId: createOperation,
      firstName: 'Mina',
      phone: '06 12 34 56 78',
      termsAccepted: true,
      termsNoticeVersion: 'loyalty-2026-09',
    } as const;
    const enrollmentActor: LoyaltyActorContext = { ...actor, source: 'pos' };
    await expect(
      service.prepareEnrollment(
        tenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).resolves.toMatchObject({
      operationId: createOperation,
      status: 'prepared',
    });
    await expect(
      service.recoverEnrollment(
        tenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).resolves.toMatchObject({ status: 'pending', operationId: createOperation });
    await expect(
      service.prepareEnrollment(
        tenantRef,
        { operationId: createOperation },
        { ...enrollmentActor, actorRef: 'cashier:next-shift' },
      ),
    ).resolves.toMatchObject({ status: 'prepared' });
    await expect(
      service.prepareEnrollment(
        tenantRef,
        { operationId: createOperation },
        { ...enrollmentActor, deviceRef: 'device:other' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const pendingEvidence = await adminPool.query<{
      result: unknown;
      request_fingerprint: string;
    }>(
      `SELECT result, request_fingerprint
         FROM loyalty.operations
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, createOperation],
    );
    expect(pendingEvidence.rows[0]?.result).toBeNull();
    expect(pendingEvidence.rows[0]?.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);

    const created = await service.createMember(
      tenantRef,
      createInput,
      enrollmentActor,
    );

    expect(created).toMatchObject({
      operationId: createOperation,
      replayed: false,
      member: {
        alias: 'Mina',
        maskedPhone: '•• •• •• 56 78',
        balanceUnits: 0,
      },
    });
    expect(created.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [profile] = await adminPool.query<{
      encrypted_payload: string;
      phone_lookup_hash: string;
    }>(
      `SELECT encrypted_payload, phone_lookup_hash
         FROM loyalty.member_profiles
        WHERE tenant_ref = $1 AND member_id = $2`,
      [tenantRef, created.member.id],
    ).then((result) => result.rows);
    expect(profile?.encrypted_payload).not.toContain('Mina');
    expect(profile?.encrypted_payload).not.toContain('0612345678');
    expect(profile?.encrypted_payload).not.toContain('+33612345678');
    expect(profile?.phone_lookup_hash).toMatch(/^[a-f0-9]{64}$/);
    const completedEvidence = await adminPool.query<{ result: unknown }>(
      `SELECT result FROM loyalty.operations
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, createOperation],
    );
    const storedEnrollment = JSON.stringify(completedEvidence.rows[0]?.result);
    expect(storedEnrollment).not.toContain('Mina');
    expect(storedEnrollment).not.toContain('0612345678');
    expect(storedEnrollment).not.toContain('+33612345678');
    expect(storedEnrollment).not.toContain(created.qrToken);

    const replayedCreate = await service.createMember(
      tenantRef,
      { ...createInput, phone: '+33612345678' },
      enrollmentActor,
    );
    expect(replayedCreate).toMatchObject({
      operationId: createOperation,
      replayed: true,
      member: { id: created.member.id },
    });
    expect(replayedCreate.qrToken).toBe(created.qrToken);
    await expect(
      service.recoverEnrollment(
        tenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).resolves.toEqual({
      status: 'ready',
      enrollment: { ...replayedCreate, replayed: true },
    });
    await expect(
      service.recoverEnrollment(
        otherTenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.recoverEnrollment(
        tenantRef,
        { operationId: createOperation },
        { ...enrollmentActor, deviceRef: 'device:other' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.acknowledgeEnrollment(
        tenantRef,
        { operationId: createOperation },
        { ...enrollmentActor, deviceRef: 'device:other' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.resolveMember(tenantRef, {
        by: 'phone',
        phone: '+33 (0)6.12.34.56.78',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getMemberDetail(tenantRef, created.member.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.listMembers(tenantRef, { limit: 20 })).resolves.toMatchObject({
      items: [],
    });
    await expect(service.dashboard(tenantRef)).resolves.toMatchObject({
      totalMembers: 0,
      newMembers30d: 0,
    });
    await expect(
      service.changeLifecycle(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          action: 'block',
          reasonCode: 'suspected_sharing',
        },
        { ...actor, source: 'admin' },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const acknowledged = await service.acknowledgeEnrollment(
      tenantRef,
      { operationId: createOperation },
      enrollmentActor,
    );
    expect(acknowledged).toEqual({
      operationId: createOperation,
      acknowledged: true,
      replayed: false,
    });
    await expect(
      service.acknowledgeEnrollment(
        tenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).resolves.toMatchObject({ acknowledged: true, replayed: true });
    await expect(
      service.recoverEnrollment(
        tenantRef,
        { operationId: createOperation },
        enrollmentActor,
      ),
    ).rejects.toBeInstanceOf(GoneException);
    await expect(
      service.createMember(
        tenantRef,
        { ...createInput, phone: '+33612345678' },
        enrollmentActor,
      ),
    ).rejects.toBeInstanceOf(GoneException);

    await expect(
      service.resolveMember(tenantRef, {
        by: 'phone',
        phone: '+33 (0)6.12.34.56.78',
      }),
    ).resolves.toMatchObject({ id: created.member.id, alias: 'Mina' });
    await expect(
      service.resolveMember(tenantRef, { by: 'qr_token', qrToken: created.qrToken }),
    ).resolves.toMatchObject({ id: created.member.id });
    await expect(
      service.resolveMember(otherTenantRef, {
        by: 'qr_token',
        qrToken: created.qrToken,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.resolveMember(tenantRef, {
        by: 'qr_token',
        qrToken: replayedCreate.qrToken,
      }),
    ).resolves.toMatchObject({ id: created.member.id });
    const tokenCount = await adminPool.query<{ count: string }>(
      `SELECT count(*) FROM loyalty.member_tokens
        WHERE tenant_ref = $1 AND member_id = $2`,
      [tenantRef, created.member.id],
    );
    expect(tokenCount.rows[0]?.count).toBe('1');

    await expect(
      service.createMember(
        tenantRef,
        { ...createInput, operationId: randomUUID(), phone: '+33612345678' },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.createMember(
        tenantRef,
        { ...createInput, operationId: randomUUID(), phone: '+32 470 12 34 56' },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.earn(
        tenantRef,
        created.member.id,
        { operationId: randomUUID(), purchaseCents: 1_000, externalRef: null },
        { ...actor, source: 'pos' },
      ),
    ).rejects.toThrow('La référence du ticket est obligatoire pour ce canal');

    const firstEarnOperation = randomUUID();
    const firstEarn = await service.earn(
      tenantRef,
      created.member.id,
      {
        operationId: firstEarnOperation,
        purchaseCents: 1_299,
        externalRef: 'ticket-1001',
      },
      actor,
    );
    expect(firstEarn).toMatchObject({
      replayed: false,
      outcome: 'earned',
      awardedUnits: 12,
      rulesVersion: 1,
      member: { balanceUnits: 12, lifetimeEarnedUnits: 12 },
      entry: { deltaUnits: 12, balanceAfter: 12, externalRef: 'ticket-1001' },
    });

    const replayedEarn = await service.earn(
      tenantRef,
      created.member.id,
      {
        operationId: firstEarnOperation,
        purchaseCents: 1_299,
        externalRef: 'ticket-1001',
      },
      actor,
    );
    expect(replayedEarn).toMatchObject({
      replayed: true,
      member: { balanceUnits: 12 },
      entry: { id: firstEarn.entry?.id },
    });
    await expect(
      service.earn(
        tenantRef,
        created.member.id,
        {
          operationId: firstEarnOperation,
          purchaseCents: 1_399,
          externalRef: 'ticket-1001',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.earn(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          purchaseCents: 1_299,
          externalRef: 'ticket-1001',
        },
        actor,
      ),
    ).rejects.toThrow('Ce ticket a déjà été traité en fidélité');

    const beforeNoop = await adminPool.query<{ version: string; ledger_count: string }>(
      `SELECT w.version,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref AND l.member_id = w.member_id) AS ledger_count
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [tenantRef, created.member.id],
    );
    const belowMinimumOperation = randomUUID();
    const belowMinimum = await service.earn(
      tenantRef,
      created.member.id,
      {
        operationId: belowMinimumOperation,
        purchaseCents: 99,
        externalRef: 'ticket-below-minimum',
      },
      actor,
    );
    expect(belowMinimum).toMatchObject({
      replayed: false,
      outcome: 'below_minimum',
      awardedUnits: 0,
      rulesVersion: 1,
      entry: null,
      member: { balanceUnits: 12 },
    });
    await expect(
      service.earn(
        tenantRef,
        created.member.id,
        {
          operationId: belowMinimumOperation,
          purchaseCents: 99,
          externalRef: 'ticket-below-minimum',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      outcome: 'below_minimum',
      awardedUnits: 0,
      entry: null,
      member: { balanceUnits: 12 },
    });
    const afterNoop = await adminPool.query<{ version: string; ledger_count: string }>(
      `SELECT w.version,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref AND l.member_id = w.member_id) AS ledger_count
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [tenantRef, created.member.id],
    );
    expect(afterNoop.rows[0]).toEqual(beforeNoop.rows[0]);
    const belowMinimumReceipt = await adminPool.query<{ count: string }>(
      `SELECT count(*)
         FROM loyalty.earn_receipts
        WHERE tenant_ref = $1 AND source = $2 AND external_ref = $3`,
      [tenantRef, actor.source, 'ticket-below-minimum'],
    );
    expect(belowMinimumReceipt.rows[0]?.count).toBe('1');

    const concurrentEarns = await Promise.all([
      service.earn(
        tenantRef,
        created.member.id,
        { operationId: randomUUID(), purchaseCents: 500, externalRef: 'ticket-1002' },
        actor,
      ),
      service.earn(
        tenantRef,
        created.member.id,
        { operationId: randomUUID(), purchaseCents: 300, externalRef: 'ticket-1003' },
        actor,
      ),
    ]);
    expect(concurrentEarns.map((result) => result.entry?.deltaUnits).sort()).toEqual([3, 5]);

    const redemptionOperation = randomUUID();
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          rewardId,
          expectedCostUnits: 15,
          externalRef: null,
        },
        { ...actor, source: 'pos' },
      ),
    ).rejects.toThrow('La référence de consommation de ce canal est invalide');
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          rewardId,
          expectedCostUnits: 14,
          externalRef: null,
        },
        actor,
      ),
    ).rejects.toThrow('Le coût de la récompense a changé (15 unités)');
    const redeemed = await service.redeem(
      tenantRef,
      created.member.id,
      {
        operationId: redemptionOperation,
        rewardId,
        expectedCostUnits: 15,
        externalRef: 'ticket-1001',
      },
      actor,
    );
    expect(redeemed).toMatchObject({
      replayed: false,
      member: {
        balanceUnits: 5,
        lifetimeEarnedUnits: 20,
        lifetimeRedeemedUnits: 15,
      },
      entry: { deltaUnits: -15, balanceAfter: 5, reason: 'Menu offert' },
      redemption: {
        status: 'consumed',
        externalRef: 'ticket-1001',
        rulesVersion: 1,
        reward: {
          id: rewardId,
          name: 'Menu offert',
          description: 'Un menu Classfood offert.',
          costUnits: 15,
        },
      },
    });
    const rejectedDuplicateRedemption = randomUUID();
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: rejectedDuplicateRedemption,
          rewardId,
          expectedCostUnits: 15,
          externalRef: 'ticket-1001',
        },
        actor,
      ),
    ).rejects.toThrow('Ce ticket a déjà consommé une récompense fidélité');
    const rejectedDuplicateOperation = await adminPool.query<{ count: string }>(
      `SELECT count(*) FROM loyalty.operations
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, rejectedDuplicateRedemption],
    );
    expect(rejectedDuplicateOperation.rows[0]?.count).toBe('0');
    await adminPool.query(
      `UPDATE loyalty.rewards SET cost_units = 16, updated_at = now()
        WHERE tenant_ref = $1 AND id = $2`,
      [tenantRef, rewardId],
    );
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: redemptionOperation,
          rewardId,
          expectedCostUnits: 15,
          externalRef: 'ticket-1001',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      member: { balanceUnits: 5 },
      entry: { id: redeemed.entry.id, deltaUnits: -15 },
      redemption: { id: redeemed.redemption.id, reward: { costUnits: 15 } },
    });
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          rewardId,
          expectedCostUnits: 15,
          externalRef: null,
        },
        actor,
      ),
    ).rejects.toThrow('Le coût de la récompense a changé (16 unités)');

    const adjustmentOperation = randomUUID();
    await expect(
      service.adjust(
        tenantRef,
        created.member.id,
        {
          operationId: adjustmentOperation,
          units: 5,
          reason: 'Geste commercial validé par le gérant',
        },
        { ...actor, source: 'admin', actorRef: 'owner:test', deviceRef: null },
      ),
    ).resolves.toMatchObject({
      replayed: false,
      member: { balanceUnits: 10 },
      entry: { kind: 'adjust_credit', deltaUnits: 5, balanceAfter: 10 },
    });
    await expect(
      service.adjust(
        tenantRef,
        created.member.id,
        {
          operationId: adjustmentOperation,
          units: 5,
          reason: 'Geste commercial validé par le gérant',
        },
        { ...actor, source: 'admin', actorRef: 'owner:test', deviceRef: null },
      ),
    ).resolves.toMatchObject({ replayed: true, member: { balanceUnits: 10 } });
    await expect(
      service.redeem(
        tenantRef,
        created.member.id,
        {
          operationId: redemptionOperation,
          rewardId,
          expectedCostUnits: 15,
          externalRef: 'ticket-1001',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      member: { balanceUnits: 5, lifetimeRedeemedUnits: 15 },
      entry: { id: redeemed.entry.id },
      redemption: { id: redeemed.redemption.id, reward: { costUnits: 15 } },
    });
    await expect(
      service.adjust(
        tenantRef,
        created.member.id,
        { operationId: randomUUID(), units: -20, reason: 'Correction impossible' },
        { ...actor, source: 'admin', actorRef: 'owner:test', deviceRef: null },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const disabledGrantOperation = randomUUID();
    const disabledGrantError = await service
      .recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: disabledGrantOperation,
          purpose: 'marketing_sms',
          decision: 'granted',
          noticeVersion: 'marketing-2026-09',
        },
        actor,
      )
      .catch((reason: unknown) => reason);
    expect(disabledGrantError).toBeInstanceOf(ConflictException);
    expect((disabledGrantError as ConflictException).getResponse()).toMatchObject({
      code: LOYALTY_SMS_GRANT_DISABLED_CODE,
      message: LOYALTY_SMS_GRANT_DISABLED_MESSAGE,
    });
    const disabledGrantResidue = await adminPool.query<{ count: string }>(
      `SELECT
         (SELECT count(*) FROM loyalty.operations
           WHERE tenant_ref = $1 AND operation_id = $2)
         +
         (SELECT count(*) FROM loyalty.consent_events
           WHERE tenant_ref = $1 AND operation_id = $2) AS count`,
      [tenantRef, disabledGrantOperation],
    );
    expect(disabledGrantResidue.rows[0]?.count).toBe('0');

    await seedHistoricalSmsGrant(tenantRef, created.member.id);
    const withdrawalOperation = randomUUID();
    await expect(
      service.recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: withdrawalOperation,
          purpose: 'marketing_sms',
          decision: 'withdrawn',
          noticeVersion: 'marketing-2026-09',
        },
        actor,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      consent: { purpose: 'marketing_sms', decision: 'withdrawn' },
    });
    await expect(
      service.recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: withdrawalOperation,
          purpose: 'marketing_sms',
          decision: 'withdrawn',
          noticeVersion: 'marketing-2026-09',
        },
        actor,
      ),
    ).resolves.toMatchObject({ replayed: true, consent: { decision: 'withdrawn' } });

    const qrOnly = await acknowledgeCreated(
      tenantRef,
      await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: null,
          phone: null,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        actor,
      ),
      actor,
    );
    const firstPage = await service.listMembers(tenantRef, { limit: 1 });
    expect(firstPage).toMatchObject({
      items: [{ id: qrOnly.member.id, balanceUnits: 0 }],
    });
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    await expect(
      service.listMembers(tenantRef, { limit: 1, cursor: firstPage.nextCursor! }),
    ).resolves.toMatchObject({ items: [{ id: created.member.id }], nextCursor: null });
    const detail = await service.getMemberDetail(tenantRef, created.member.id);
    expect(detail).toMatchObject({
      member: { id: created.member.id, balanceUnits: 10 },
      consents: [{ purpose: 'marketing_sms', decision: 'withdrawn' }],
    });
    expect(detail.ledger).toHaveLength(5);

    await expect(service.dashboard(tenantRef)).resolves.toMatchObject({
      totalMembers: 2,
      activeMembers30d: 1,
      newMembers30d: 2,
      outstandingUnits: 10,
      earnedUnits30d: 20,
      redeemedUnits30d: 15,
      redemptions30d: 1,
      recentActivity: expect.arrayContaining([
        expect.objectContaining({ memberId: created.member.id, memberAlias: 'Mina' }),
      ]),
    });

    const evidence = await adminPool.query<{
      balance_units: string;
      lifetime_earned_units: string;
      lifetime_redeemed_units: string;
      ledger_count: string;
      redemption_count: string;
      consent_event_count: string;
      consent_decision: string;
    }>(
      `SELECT w.balance_units, w.lifetime_earned_units, w.lifetime_redeemed_units,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref AND l.member_id = w.member_id) AS ledger_count,
              (SELECT count(*) FROM loyalty.redemptions r
                WHERE r.tenant_ref = w.tenant_ref AND r.member_id = w.member_id) AS redemption_count,
              (SELECT count(*) FROM loyalty.consent_events c
                WHERE c.tenant_ref = w.tenant_ref AND c.member_id = w.member_id) AS consent_event_count,
              (SELECT c.decision::text FROM loyalty.consent_state c
                WHERE c.tenant_ref = w.tenant_ref AND c.member_id = w.member_id
                  AND c.purpose = 'marketing_sms') AS consent_decision
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [tenantRef, created.member.id],
    );
    expect(evidence.rows[0]).toEqual({
      balance_units: '10',
      lifetime_earned_units: '20',
      lifetime_redeemed_units: '15',
      ledger_count: '5',
      redemption_count: '1',
      consent_event_count: '2',
      consent_decision: 'withdrawn',
    });

    const operationEvidence = await adminPool.query<{ result: string }>(
      `SELECT result::text AS result
         FROM loyalty.operations
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, createOperation],
    );
    const persistedCreate = operationEvidence.rows[0]?.result ?? '';
    expect(persistedCreate).not.toContain('Mina');
    expect(persistedCreate).not.toContain('56 78');
    expect(persistedCreate).not.toContain(created.qrToken);

    await adminPool.query(
      `DELETE FROM loyalty.wallets WHERE tenant_ref = $1 AND member_id = $2`,
      [tenantRef, qrOnly.member.id],
    );
    await expect(
      service.resolveMember(tenantRef, {
        by: 'member_ref',
        memberRef: qrOnly.member.id,
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      service.earn(
        tenantRef,
        qrOnly.member.id,
        { operationId: randomUUID(), purchaseCents: 1_000, externalRef: null },
        actor,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      service.redeem(
        tenantRef,
        qrOnly.member.id,
        {
          operationId: randomUUID(),
          rewardId,
          expectedCostUnits: 16,
          externalRef: null,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      service.adjust(
        tenantRef,
        qrOnly.member.id,
        { operationId: randomUUID(), units: 1, reason: 'Test de corruption wallet' },
        { ...actor, source: 'admin' },
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  }, integrationTestTimeout);

  it('clôture et anonymise chaque adhésion expirée avant de libérer son téléphone', async () => {
    const tenantRef = `expiry-${randomUUID()}`;
    const programId = randomUUID();
    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({ id: programId, tenantRef, status: 'active' });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Programme expiration',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 100,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Version expiration',
      });
    });

    const abandonedOperationId = randomUUID();
    await service.prepareEnrollment(tenantRef, { operationId: abandonedOperationId }, actor);
    await adminPool.query(
      `UPDATE loyalty.operations
          SET created_at = $3
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, abandonedOperationId, new Date(Date.now() - 31 * 60_000)],
    );
    await expect(
      service.recoverEnrollment(tenantRef, { operationId: abandonedOperationId }, actor),
    ).rejects.toBeInstanceOf(GoneException);
    const abandoned = await adminPool.query<{ status: string; result: unknown }>(
      `SELECT status::text AS status, result
         FROM loyalty.operations
        WHERE tenant_ref = $1 AND operation_id = $2`,
      [tenantRef, abandonedOperationId],
    );
    expect(abandoned.rows[0]).toMatchObject({
      status: 'completed',
      result: { enrollmentExpired: true },
    });

    const create = (phone: string) =>
      service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: 'Essai',
          phone,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        actor,
      );

    const expired = await create('06 31 41 59 26');
    const expiredAt = await forceEnrollmentExpired({
      tenantRef,
      operationId: expired.operationId,
      memberId: expired.member.id,
    });
    await expect(
      service.recoverEnrollment(
        tenantRef,
        { operationId: expired.operationId },
        actor,
      ),
    ).rejects.toBeInstanceOf(GoneException);

    const closed = await adminPool.query<{
      status: string;
      anonymized: boolean;
      profile_count: string;
      token_status: string;
      request_fingerprint: string;
      result: Record<string, unknown>;
      anonymized_events: string;
    }>(
      `SELECT m.status::text AS status,
              (m.anonymized_at IS NOT NULL) AS anonymized,
              (SELECT count(*) FROM loyalty.member_profiles p
                WHERE p.tenant_ref = m.tenant_ref AND p.member_id = m.id) AS profile_count,
              (SELECT t.status::text FROM loyalty.member_tokens t
                WHERE t.tenant_ref = m.tenant_ref AND t.member_id = m.id
                ORDER BY t.created_at DESC LIMIT 1) AS token_status,
              o.request_fingerprint,
              o.result,
              (SELECT count(*) FROM loyalty.membership_events e
                WHERE e.tenant_ref = m.tenant_ref AND e.member_id = m.id
                  AND e.kind = 'anonymized'
                  AND e.reason = 'enrollment_handoff_expired') AS anonymized_events
         FROM loyalty.members m
         JOIN loyalty.operations o
           ON o.tenant_ref = m.tenant_ref AND o.operation_id = $2
        WHERE m.tenant_ref = $1 AND m.id = $3`,
      [tenantRef, expired.operationId, expired.member.id],
    );
    expect(closed.rows[0]).toMatchObject({
      status: 'anonymized',
      anonymized: true,
      profile_count: '0',
      token_status: 'revoked',
      request_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      result: {
        enrollmentExpired: true,
        recoveryOwnerFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        recoveryExpiresAt: expiredAt,
      },
      anonymized_events: '1',
    });
    expect(closed.rows[0]?.result).not.toHaveProperty('memberId');
    expect(closed.rows[0]?.result).not.toHaveProperty('qrTokenHash');
    expect(closed.rows[0]?.result).not.toHaveProperty('createFingerprint');
    await expect(
      service.resolveMember(tenantRef, { by: 'qr_token', qrToken: expired.qrToken }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const replacement = await create('+33 6 31 41 59 26');
    expect(replacement.member.id).not.toBe(expired.member.id);
    await service.acknowledgeEnrollment(
      tenantRef,
      { operationId: replacement.operationId },
      actor,
    );

    const expiredAtAck = await create('06 27 18 28 18');
    await forceEnrollmentExpired({
      tenantRef,
      operationId: expiredAtAck.operationId,
      memberId: expiredAtAck.member.id,
    });
    await expect(
      service.acknowledgeEnrollment(
        tenantRef,
        { operationId: expiredAtAck.operationId },
        actor,
      ),
    ).rejects.toBeInstanceOf(GoneException);
    const ackCleanup = await adminPool.query<{ profile_count: string; status: string }>(
      `SELECT m.status::text AS status,
              (SELECT count(*) FROM loyalty.member_profiles p
                WHERE p.tenant_ref = m.tenant_ref AND p.member_id = m.id) AS profile_count
         FROM loyalty.members m
        WHERE m.tenant_ref = $1 AND m.id = $2`,
      [tenantRef, expiredAtAck.member.id],
    );
    expect(ackCleanup.rows[0]).toEqual({ status: 'anonymized', profile_count: '0' });

    const swept = await create('06 16 18 03 14');
    await forceEnrollmentExpired({
      tenantRef,
      operationId: swept.operationId,
      memberId: swept.member.id,
      // Reproduit PREPARE à T0 puis CREATE presque 30 minutes plus tard : la
      // deadline canonique est celle de l'opération, pas `members.joined_at`.
      ageOperation: true,
    });
    const sweepClocks = await adminPool.query<{ operation_created_at: Date; member_joined_at: Date }>(
      `SELECT o.created_at AS operation_created_at, m.joined_at AS member_joined_at
         FROM loyalty.operations o
         JOIN loyalty.membership_events e
           ON e.tenant_ref = o.tenant_ref AND e.operation_id = o.operation_id
         JOIN loyalty.members m
           ON m.tenant_ref = e.tenant_ref AND m.id = e.member_id
        WHERE o.tenant_ref = $1 AND o.operation_id = $2 AND e.kind = 'joined'`,
      [tenantRef, swept.operationId],
    );
    expect(sweepClocks.rows[0]!.member_joined_at.getTime()).toBeGreaterThan(
      sweepClocks.rows[0]!.operation_created_at.getTime(),
    );
    await expect(service.expireStaleEnrollments(tenantRef, new Date(), 10)).resolves.toBe(1);
    await expect(service.expireStaleEnrollments(tenantRef, new Date(), 10)).resolves.toBe(0);
  }, integrationTestTimeout);

  it('réserve durablement les tickets et arbitre les courses earn/redeem', async () => {
    const tenantRef = `receipt-${randomUUID()}`;
    const programId = randomUUID();
    const rewardId = randomUUID();
    const posActor: LoyaltyActorContext = { ...actor, source: 'pos' };

    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({ id: programId, tenantRef, status: 'active' });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Programme reçus v1',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 100,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Version initiale',
      });
      await tx.insert(rewards).values({
        id: rewardId,
        tenantRef,
        programId,
        name: 'Boisson offerte',
        description: '',
        costUnits: 2,
        kind: 'custom',
      });
    });
    const member = await acknowledgeCreated(
      tenantRef,
      await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: null,
          phone: null,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        actor,
      ),
      actor,
    );

    const belowOperation = randomUUID();
    await expect(
      service.earn(
        tenantRef,
        member.member.id,
        {
          operationId: belowOperation,
          purchaseCents: 99,
          externalRef: 'ticket-rejete-v1',
        },
        posActor,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      outcome: 'below_minimum',
      awardedUnits: 0,
      entry: null,
    });

    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 2,
        name: 'Programme reçus v2',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 1,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Chaque centime devient éligible',
      });
      await tx
        .update(programs)
        .set({ currentVersion: 2, updatedAt: new Date() })
        .where(and(eq(programs.tenantRef, tenantRef), eq(programs.id, programId)));
    });

    const rejectedAfterRuleChange = randomUUID();
    await expect(
      service.earn(
        tenantRef,
        member.member.id,
        {
          operationId: rejectedAfterRuleChange,
          purchaseCents: 99,
          externalRef: 'ticket-rejete-v1',
        },
        posActor,
      ),
    ).rejects.toThrow('Ce ticket a déjà été traité en fidélité');

    const earnOperationIds = [randomUUID(), randomUUID()] as const;
    const concurrentEarns = await Promise.allSettled(
      earnOperationIds.map((operationId) =>
        service.earn(
          tenantRef,
          member.member.id,
          { operationId, purchaseCents: 100, externalRef: 'ticket-course-earn' },
          posActor,
        ),
      ),
    );
    expect(concurrentEarns.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentEarns.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejectedEarnIndex = concurrentEarns.findIndex(
      (result) => result.status === 'rejected',
    );
    expect(concurrentEarns[rejectedEarnIndex]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });

    const redeemOperationIds = [randomUUID(), randomUUID()] as const;
    const concurrentRedeems = await Promise.allSettled(
      redeemOperationIds.map((operationId) =>
        service.redeem(
          tenantRef,
          member.member.id,
          {
            operationId,
            rewardId,
            expectedCostUnits: 2,
            externalRef: 'pos-redemption:70000000-0000-4000-8000-000000000099',
          },
          posActor,
        ),
      ),
    );
    expect(concurrentRedeems.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(concurrentRedeems.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const redeemedIndex = concurrentRedeems.findIndex(
      (result) => result.status === 'fulfilled',
    );
    const rejectedRedeemIndex = concurrentRedeems.findIndex(
      (result) => result.status === 'rejected',
    );
    expect(concurrentRedeems[rejectedRedeemIndex]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });
    const redeemed = concurrentRedeems[redeemedIndex];
    if (!redeemed || redeemed.status !== 'fulfilled') {
      throw new Error('La course redeem devait avoir un gagnant');
    }

    const earned = concurrentEarns.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<LoyaltyMemberService['earn']>>> =>
        result.status === 'fulfilled',
    );
    if (!earned) throw new Error('La course earn devait avoir un gagnant');
    const earnedEntry = earned.value.entry;
    if (!earnedEntry) throw new Error('Le gain concurrent devait produire un ledger');
    purchaseVerificationFailure = new ConflictException('Ticket désormais remboursé');
    try {
      await expect(
        service.earn(
          tenantRef,
          member.member.id,
          {
            operationId: earned.value.operationId,
            purchaseCents: 100,
            externalRef: 'ticket-course-earn',
          },
          {
            ...posActor,
            actorRef: 'cashier:next-shift',
            deviceRef: 'device:replacement',
          },
        ),
      ).resolves.toMatchObject({
        operationId: earned.value.operationId,
        replayed: true,
        entry: { id: earnedEntry.id },
      });
    } finally {
      purchaseVerificationFailure = null;
    }
    const [auditedEarn] = await withLoyaltyTenant(db, tenantRef, (tx) =>
      tx
        .select({
          actorRef: ledgerEntries.actorRef,
          deviceRef: ledgerEntries.deviceRef,
        })
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, earnedEntry.id))
        .limit(1),
    );
    expect(auditedEarn).toEqual({
      actorRef: posActor.actorRef,
      deviceRef: posActor.deviceRef,
    });
    await expect(
      service.redeem(
        tenantRef,
        member.member.id,
        {
          operationId: redeemOperationIds[redeemedIndex]!,
          rewardId,
          expectedCostUnits: 2,
          externalRef: 'pos-redemption:70000000-0000-4000-8000-000000000099',
        },
        posActor,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      entry: { id: redeemed.value.entry.id },
      redemption: { id: redeemed.value.redemption.id },
    });

    const rejectedOperationIds = [
      rejectedAfterRuleChange,
      earnOperationIds[rejectedEarnIndex]!,
      redeemOperationIds[rejectedRedeemIndex]!,
    ];
    const evidence = await adminPool.query<{
      balance_units: string;
      version: string;
      receipt_count: string;
      ledger_count: string;
      redemption_count: string;
      rejected_operation_count: string;
    }>(
      `SELECT w.balance_units,
              w.version,
              (SELECT count(*) FROM loyalty.earn_receipts er
                WHERE er.tenant_ref = w.tenant_ref) AS receipt_count,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref AND l.member_id = w.member_id) AS ledger_count,
              (SELECT count(*) FROM loyalty.redemptions r
                WHERE r.tenant_ref = w.tenant_ref AND r.member_id = w.member_id) AS redemption_count,
              (SELECT count(*) FROM loyalty.operations o
                WHERE o.tenant_ref = w.tenant_ref AND o.operation_id = ANY($3::uuid[])) AS rejected_operation_count
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [tenantRef, member.member.id, rejectedOperationIds],
    );
    expect(evidence.rows[0]).toEqual({
      balance_units: '98',
      version: '2',
      receipt_count: '2',
      ledger_count: '2',
      redemption_count: '1',
      rejected_operation_count: '0',
    });

    await expect(
      appPool.query('SELECT * FROM loyalty.earn_receipts WHERE tenant_ref = $1', [
        tenantRef,
      ]),
    ).resolves.toMatchObject({ rowCount: 0 });
    await withLoyaltyTenant(db, `other-${randomUUID()}`, async (tx) => {
      const hidden = await tx
        .select({ id: earnReceipts.id })
        .from(earnReceipts)
        .where(eq(earnReceipts.tenantRef, tenantRef));
      expect(hidden).toEqual([]);
    });
  }, integrationTestTimeout);

  it('bloque, remplace le QR puis anonymise sans effacer la preuve financière', async () => {
    const tenantRef = `lifecycle-${randomUUID()}`;
    const programId = randomUUID();
    const manager: LoyaltyActorContext = {
      source: 'admin',
      actorRef: 'owner:lifecycle-test',
      deviceRef: null,
    };
    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({ id: programId, tenantRef, status: 'active' });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Programme lifecycle',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 100,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Test du cycle de vie',
      });
    });

    const created = await acknowledgeCreated(
      tenantRef,
      await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: 'Nora',
          phone: '06 98 76 54 32',
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        manager,
      ),
      manager,
    );
    await service.earn(
      tenantRef,
      created.member.id,
      {
        operationId: randomUUID(),
        purchaseCents: 1_000,
        externalRef: 'ticket-lifecycle-1',
      },
      manager,
    );
    await seedHistoricalSmsGrant(tenantRef, created.member.id);

    const blockOperation = randomUUID();
    const blockInput = {
      operationId: blockOperation,
      action: 'block' as const,
      reasonCode: 'suspected_sharing' as const,
    };
    await expect(
      service.changeLifecycle(tenantRef, created.member.id, blockInput, manager),
    ).resolves.toMatchObject({
      replayed: false,
      action: 'block',
      memberId: created.member.id,
      status: 'blocked',
      revokedTokens: 0,
      withdrawnConsents: 0,
    });
    await expect(
      service.changeLifecycle(tenantRef, created.member.id, blockInput, manager),
    ).resolves.toMatchObject({ replayed: true, status: 'blocked' });
    await expect(
      service.recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          purpose: 'marketing_email',
          decision: 'granted',
          noticeVersion: 'marketing-2026-09',
        },
        manager,
      ),
    ).rejects.toThrow('Seule une carte active peut recevoir un consentement marketing');
    const blockedWithdrawalOperation = randomUUID();
    await expect(
      service.recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: blockedWithdrawalOperation,
          purpose: 'marketing_sms',
          decision: 'withdrawn',
          noticeVersion: 'marketing-2026-09',
        },
        manager,
      ),
    ).resolves.toMatchObject({
      replayed: false,
      consent: { purpose: 'marketing_sms', decision: 'withdrawn' },
    });
    await expect(
      service.getMemberDetail(tenantRef, created.member.id),
    ).resolves.toMatchObject({
      member: { status: 'blocked' },
      consents: [{ purpose: 'marketing_sms', decision: 'withdrawn' }],
    });
    await expect(
      service.earn(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          purchaseCents: 500,
          externalRef: 'ticket-lifecycle-bloque',
        },
        manager,
      ),
    ).rejects.toThrow('Cette carte fidélité est bloquée ou anonymisée');

    await expect(
      service.changeLifecycle(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          action: 'unblock',
          reasonCode: 'identity_verified',
        },
        manager,
      ),
    ).resolves.toMatchObject({ status: 'active' });

    const replaceOperation = randomUUID();
    const replacement = await service.replaceQr(
      tenantRef,
      created.member.id,
      {
        operationId: replaceOperation,
        reasonCode: 'lost_or_compromised',
        expectedGeneration: 1,
      },
      manager,
    );
    expect(replacement).toMatchObject({
      replayed: false,
      memberId: created.member.id,
      status: 'active',
      revokedTokens: 1,
      previousGeneration: 1,
      qrGeneration: 2,
    });
    expect(replacement.qrToken).not.toBe(created.qrToken);
    await expect(
      service.resolveMember(tenantRef, {
        by: 'qr_token',
        qrToken: created.qrToken,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.resolveMember(tenantRef, {
        by: 'qr_token',
        qrToken: replacement.qrToken,
      }),
    ).resolves.toMatchObject({ id: created.member.id, status: 'active' });
    await expect(
      service.replaceQr(
        tenantRef,
        created.member.id,
        {
          operationId: replaceOperation,
          reasonCode: 'lost_or_compromised',
          expectedGeneration: 1,
        },
        manager,
      ),
    ).resolves.toMatchObject({ replayed: true, qrToken: replacement.qrToken });

    const racingMember = await acknowledgeCreated(
      tenantRef,
      await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: null,
          phone: null,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        manager,
      ),
      manager,
    );
    const rotationInputs = [
      {
        operationId: randomUUID(),
        reasonCode: 'manager_correction',
        expectedGeneration: 1,
      },
      {
        operationId: randomUUID(),
        reasonCode: 'lost_or_compromised',
        expectedGeneration: 1,
      },
    ] as const;
    const rotations = await Promise.allSettled(
      rotationInputs.map((input) =>
        service.replaceQr(tenantRef, racingMember.member.id, input, manager),
      ),
    );
    expect(rotations.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rotations.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rotationWinnerIndex = rotations.findIndex(
      (result) => result.status === 'fulfilled',
    );
    const rotationLoserIndex = rotations.findIndex(
      (result) => result.status === 'rejected',
    );
    const rotationWinner = rotations[rotationWinnerIndex];
    if (!rotationWinner || rotationWinner.status !== 'fulfilled') {
      throw new Error('La course de rotation QR devait avoir un gagnant');
    }
    expect(rotations[rotationLoserIndex]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });
    expect(rotationWinner.value).toMatchObject({
      replayed: false,
      previousGeneration: 1,
      qrGeneration: 2,
      revokedTokens: 1,
    });
    await expect(
      service.replaceQr(
        tenantRef,
        racingMember.member.id,
        rotationInputs[rotationWinnerIndex]!,
        manager,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      qrToken: rotationWinner.value.qrToken,
      qrGeneration: 2,
    });
    await expect(
      service.getMemberDetail(tenantRef, racingMember.member.id),
    ).resolves.toMatchObject({ qrGeneration: 2 });
    const rotationEvidence = await adminPool.query<{
      qr_generation: string;
      active_tokens: string;
      loser_operations: string;
    }>(
      `SELECT m.qr_generation::text,
              (SELECT count(*) FROM loyalty.member_tokens t
                WHERE t.tenant_ref = m.tenant_ref
                  AND t.member_id = m.id
                  AND t.status = 'active') AS active_tokens,
              (SELECT count(*) FROM loyalty.operations o
                WHERE o.tenant_ref = m.tenant_ref
                  AND o.operation_id = $3) AS loser_operations
         FROM loyalty.members m
        WHERE m.tenant_ref = $1 AND m.id = $2`,
      [
        tenantRef,
        racingMember.member.id,
        rotationInputs[rotationLoserIndex]!.operationId,
      ],
    );
    expect(rotationEvidence.rows[0]).toEqual({
      qr_generation: '2',
      active_tokens: '1',
      loser_operations: '0',
    });

    const anonymizeOperation = randomUUID();
    const anonymized = await service.changeLifecycle(
      tenantRef,
      created.member.id,
      {
        operationId: anonymizeOperation,
        action: 'anonymize',
        reasonCode: 'customer_request',
        confirmation: 'ANONYMISER',
      },
      manager,
    );
    expect(anonymized).toMatchObject({
      replayed: false,
      action: 'anonymize',
      memberId: created.member.id,
      status: 'anonymized',
      revokedTokens: 1,
      withdrawnConsents: 0,
    });
    await expect(
      service.changeLifecycle(
        tenantRef,
        created.member.id,
        {
          operationId: anonymizeOperation,
          action: 'anonymize',
          reasonCode: 'customer_request',
          confirmation: 'ANONYMISER',
        },
        manager,
      ),
    ).resolves.toMatchObject({ replayed: true, status: 'anonymized' });
    await expect(
      service.resolveMember(tenantRef, {
        by: 'qr_token',
        qrToken: replacement.qrToken,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.resolveMember(tenantRef, {
        by: 'phone',
        phone: '06 98 76 54 32',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getMemberDetail(tenantRef, created.member.id)).resolves.toMatchObject({
      member: {
        alias: 'Carte anonymisée',
        maskedPhone: null,
        status: 'anonymized',
        balanceUnits: 10,
      },
      consents: [{ purpose: 'marketing_sms', decision: 'withdrawn' }],
      ledger: [expect.objectContaining({ kind: 'earn', deltaUnits: 10 })],
    });
    await expect(
      service.changeLifecycle(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          action: 'unblock',
          reasonCode: 'manager_correction',
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.recordConsent(
        tenantRef,
        created.member.id,
        {
          operationId: randomUUID(),
          purpose: 'marketing_sms',
          decision: 'withdrawn',
          noticeVersion: 'marketing-2026-09',
        },
        manager,
      ),
    ).rejects.toThrow('Cette carte fidélité est anonymisée');

    const evidence = await adminPool.query<{
      profile_count: string;
      active_token_count: string;
      balance_units: string;
      consent_decision: string;
      event_kinds: string[];
      event_reasons: Array<string | null>;
      operation_result: string;
    }>(
      `SELECT
          (SELECT count(*) FROM loyalty.member_profiles p
            WHERE p.tenant_ref = m.tenant_ref AND p.member_id = m.id) AS profile_count,
          (SELECT count(*) FROM loyalty.member_tokens t
            WHERE t.tenant_ref = m.tenant_ref AND t.member_id = m.id AND t.status = 'active') AS active_token_count,
          (SELECT w.balance_units::text FROM loyalty.wallets w
            WHERE w.tenant_ref = m.tenant_ref AND w.member_id = m.id) AS balance_units,
          (SELECT c.decision::text FROM loyalty.consent_state c
            WHERE c.tenant_ref = m.tenant_ref AND c.member_id = m.id
              AND c.purpose = 'marketing_sms') AS consent_decision,
          (SELECT array_agg(e.kind::text ORDER BY e.recorded_at, e.id)
             FROM loyalty.membership_events e
            WHERE e.tenant_ref = m.tenant_ref AND e.member_id = m.id) AS event_kinds,
          (SELECT array_agg(e.reason ORDER BY e.recorded_at, e.id)
             FROM loyalty.membership_events e
            WHERE e.tenant_ref = m.tenant_ref AND e.member_id = m.id) AS event_reasons,
          (SELECT o.result::text FROM loyalty.operations o
            WHERE o.tenant_ref = m.tenant_ref AND o.operation_id = $3) AS operation_result
         FROM loyalty.members m
        WHERE m.tenant_ref = $1 AND m.id = $2`,
      [tenantRef, created.member.id, anonymizeOperation],
    );
    expect(evidence.rows[0]).toMatchObject({
      profile_count: '0',
      active_token_count: '0',
      balance_units: '10',
      consent_decision: 'withdrawn',
      event_kinds: ['joined', 'blocked', 'unblocked', 'token_replaced', 'anonymized'],
    });
    expect(evidence.rows[0]?.event_reasons[0]).toBeNull();
    expect(evidence.rows[0]?.event_reasons.slice(1).every(Boolean)).toBe(true);
    expect(evidence.rows[0]?.operation_result).not.toContain('Nora');
    expect(evidence.rows[0]?.operation_result).not.toContain('54 32');
    expect(evidence.rows[0]?.operation_result).not.toContain(replacement.qrToken);
  }, integrationTestTimeout);

  it('compense earn/redeem une seule fois, sous course et sans fuite inter-tenant', async () => {
    const tenantRef = `reversal-${randomUUID()}`;
    const otherTenantRef = `reversal-other-${randomUUID()}`;
    const programId = randomUUID();
    const rewardId = randomUUID();
    const manager: LoyaltyActorContext = {
      source: 'admin',
      actorRef: 'owner:reversal-test',
      deviceRef: null,
    };
    const systemActor: LoyaltyActorContext = {
      source: 'system',
      actorRef: 'orders:refund-worker',
      deviceRef: null,
    };

    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({ id: programId, tenantRef, status: 'active' });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Programme compensations',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 100,
        unitsPerStep: 1,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Compensations testées sur PostgreSQL',
      });
      await tx.insert(rewards).values({
        id: rewardId,
        tenantRef,
        programId,
        name: 'Boisson offerte',
        description: '',
        costUnits: 5,
        kind: 'custom',
      });
    });

    const createMember = async () => {
      const created = await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: null,
          phone: null,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        actor,
      );
      return acknowledgeCreated(tenantRef, created, actor);
    };

    const member = await createMember();
    const earned = await service.earn(
      tenantRef,
      member.member.id,
      {
        operationId: randomUUID(),
        purchaseCents: 2_000,
        externalRef: 'ticket-reversal-earn',
      },
      actor,
    );
    const redeemed = await service.redeem(
      tenantRef,
      member.member.id,
      {
        operationId: randomUUID(),
        rewardId,
        expectedCostUnits: 5,
        externalRef: 'ticket-reversal-redeem',
      },
      actor,
    );
    expect(redeemed.member.balanceUnits).toBe(15);

    const crossTenantOperation = randomUUID();
    await expect(
      service.reverseLedgerEntry(
        otherTenantRef,
        member.member.id,
        redeemed.entry.id,
        {
          operationId: crossTenantOperation,
          reason: 'Tentative depuis un autre établissement',
        },
        manager,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const crossTenantResidue = await adminPool.query<{ count: string }>(
      `SELECT count(*) FROM loyalty.operations WHERE operation_id = $1`,
      [crossTenantOperation],
    );
    expect(crossTenantResidue.rows[0]?.count).toBe('0');

    const redeemReversalInput = {
      operationId: randomUUID(),
      reason: 'Commande annulée après encaissement',
    };
    const redeemReversal = await service.reverseLedgerEntry(
      tenantRef,
      member.member.id,
      redeemed.entry.id,
      redeemReversalInput,
      manager,
    );
    expect(redeemReversal).toMatchObject({
      replayed: false,
      member: { balanceUnits: 20, lifetimeRedeemedUnits: 0 },
      originalEntry: {
        id: redeemed.entry.id,
        kind: 'redeem',
        deltaUnits: -5,
        externalRef: 'ticket-reversal-redeem',
      },
      entry: {
        kind: 'reverse',
        deltaUnits: 5,
        balanceAfter: 20,
        source: 'admin',
        reason: redeemReversalInput.reason,
        externalRef: 'ticket-reversal-redeem',
      },
    });
    await expect(
      service.reverseLedgerEntry(
        tenantRef,
        member.member.id,
        redeemed.entry.id,
        redeemReversalInput,
        manager,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      member: { balanceUnits: 20, lifetimeRedeemedUnits: 0 },
      originalEntry: { id: redeemed.entry.id },
      entry: { id: redeemReversal.entry.id },
    });
    await expect(
      service.reverseLedgerEntry(
        tenantRef,
        member.member.id,
        redeemed.entry.id,
        { ...redeemReversalInput, reason: 'Même UUID mais motif divergent' },
        manager,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.reverseLedgerEntry(
        tenantRef,
        member.member.id,
        redeemed.entry.id,
        {
          operationId: randomUUID(),
          reason: 'Seconde compensation interdite',
        },
        manager,
      ),
    ).rejects.toThrow('Cette écriture fidélité a déjà été compensée');

    const redeemEvidence = await adminPool.query<{
      source: string;
      actor_ref: string;
      external_ref: string;
      reversed_entry_id: string;
      redemption_status: string;
      reversal_count: string;
    }>(
      `SELECT l.source::text,
              l.actor_ref,
              l.external_ref,
              l.reversed_entry_id::text,
              r.status::text AS redemption_status,
              (SELECT count(*) FROM loyalty.ledger_entries x
                WHERE x.tenant_ref = l.tenant_ref
                  AND x.reversed_entry_id = l.reversed_entry_id) AS reversal_count
         FROM loyalty.ledger_entries l
         JOIN loyalty.redemptions r
           ON r.tenant_ref = l.tenant_ref
          AND r.member_id = l.member_id
          AND r.ledger_entry_id = l.reversed_entry_id
        WHERE l.tenant_ref = $1 AND l.id = $2`,
      [tenantRef, redeemReversal.entry.id],
    );
    expect(redeemEvidence.rows[0]).toEqual({
      source: 'admin',
      actor_ref: manager.actorRef,
      external_ref: 'ticket-reversal-redeem',
      reversed_entry_id: redeemed.entry.id,
      redemption_status: 'reversed',
      reversal_count: '1',
    });

    const earnReversal = await service.reverseLedgerEntry(
      tenantRef,
      member.member.id,
      earned.entry!.id,
      {
        operationId: randomUUID(),
        reason: 'Ticket intégralement remboursé',
      },
      systemActor,
    );
    expect(earnReversal).toMatchObject({
      replayed: false,
      member: {
        balanceUnits: 0,
        lifetimeEarnedUnits: 0,
        lifetimeRedeemedUnits: 0,
      },
      originalEntry: {
        id: earned.entry!.id,
        kind: 'earn',
        deltaUnits: 20,
        externalRef: 'ticket-reversal-earn',
      },
      entry: {
        kind: 'reverse',
        deltaUnits: -20,
        balanceAfter: 0,
        source: 'system',
        externalRef: 'ticket-reversal-earn',
      },
    });
    await expect(service.dashboard(tenantRef)).resolves.toMatchObject({
      outstandingUnits: 0,
      earnedUnits30d: 0,
      redeemedUnits30d: 0,
      redemptions30d: 0,
    });
    const lateRedeemReplay = await service.reverseLedgerEntry(
      tenantRef,
      member.member.id,
      redeemed.entry.id,
      redeemReversalInput,
      manager,
    );
    expect(lateRedeemReplay).toEqual({ ...redeemReversal, replayed: true });

    const insufficientMember = await createMember();
    const insufficientEarn = await service.earn(
      tenantRef,
      insufficientMember.member.id,
      {
        operationId: randomUUID(),
        purchaseCents: 1_000,
        externalRef: 'ticket-reversal-insufficient-earn',
      },
      actor,
    );
    await service.redeem(
      tenantRef,
      insufficientMember.member.id,
      {
        operationId: randomUUID(),
        rewardId,
        expectedCostUnits: 5,
        externalRef: 'ticket-reversal-insufficient-redeem',
      },
      actor,
    );
    const insufficientOperation = randomUUID();
    await expect(
      service.reverseLedgerEntry(
        tenantRef,
        insufficientMember.member.id,
        insufficientEarn.entry!.id,
        {
          operationId: insufficientOperation,
          reason: 'Remboursement impossible faute de solde',
        },
        manager,
      ),
    ).rejects.toThrow('Compensation impossible');
    const insufficientEvidence = await adminPool.query<{
      balance_units: string;
      version: string;
      reversal_count: string;
      operation_count: string;
    }>(
      `SELECT w.balance_units::text,
              w.version::text,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref
                  AND l.reversed_entry_id = $3) AS reversal_count,
              (SELECT count(*) FROM loyalty.operations o
                WHERE o.tenant_ref = w.tenant_ref
                  AND o.operation_id = $4) AS operation_count
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [
        tenantRef,
        insufficientMember.member.id,
        insufficientEarn.entry!.id,
        insufficientOperation,
      ],
    );
    expect(insufficientEvidence.rows[0]).toMatchObject({
      balance_units: '5',
      version: '2',
      reversal_count: '0',
      operation_count: '0',
    });

    const racingMember = await createMember();
    const racingEarn = await service.earn(
      tenantRef,
      racingMember.member.id,
      {
        operationId: randomUUID(),
        purchaseCents: 1_000,
        externalRef: 'ticket-reversal-race',
      },
      actor,
    );
    const racingInputs = [
      { operationId: randomUUID(), reason: 'Course compensation A' },
      { operationId: randomUUID(), reason: 'Course compensation B' },
    ] as const;
    const racingResults = await Promise.allSettled(
      racingInputs.map((input) =>
        service.reverseLedgerEntry(
          tenantRef,
          racingMember.member.id,
          racingEarn.entry!.id,
          input,
          systemActor,
        ),
      ),
    );
    expect(racingResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(racingResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winnerIndex = racingResults.findIndex((result) => result.status === 'fulfilled');
    const loserIndex = racingResults.findIndex((result) => result.status === 'rejected');
    expect(racingResults[loserIndex]).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictException),
    });
    const winner = racingResults[winnerIndex];
    if (!winner || winner.status !== 'fulfilled') {
      throw new Error('La course de compensation devait avoir un gagnant');
    }
    await expect(
      service.reverseLedgerEntry(
        tenantRef,
        racingMember.member.id,
        racingEarn.entry!.id,
        racingInputs[winnerIndex]!,
        systemActor,
      ),
    ).resolves.toMatchObject({
      replayed: true,
      entry: { id: winner.value.entry.id, balanceAfter: 0 },
    });
    const raceEvidence = await adminPool.query<{
      balance_units: string;
      version: string;
      reversal_count: string;
      loser_operation_count: string;
    }>(
      `SELECT w.balance_units::text,
              w.version::text,
              (SELECT count(*) FROM loyalty.ledger_entries l
                WHERE l.tenant_ref = w.tenant_ref
                  AND l.reversed_entry_id = $3) AS reversal_count,
              (SELECT count(*) FROM loyalty.operations o
                WHERE o.tenant_ref = w.tenant_ref
                  AND o.operation_id = $4) AS loser_operation_count
         FROM loyalty.wallets w
        WHERE w.tenant_ref = $1 AND w.member_id = $2`,
      [
        tenantRef,
        racingMember.member.id,
        racingEarn.entry!.id,
        racingInputs[loserIndex]!.operationId,
      ],
    );
    expect(raceEvidence.rows[0]).toEqual({
      balance_units: '0',
      version: '2',
      reversal_count: '1',
      loser_operation_count: '0',
    });
  }, integrationTestTimeout);

  it('traverse Drizzle, PostgreSQL et les agrégats au-delà de INTEGER', async () => {
    const tenantRef = `bigint-${randomUUID()}`;
    const programId = randomUUID();
    await withLoyaltyTenant(db, tenantRef, async (tx) => {
      await tx.insert(programs).values({ id: programId, tenantRef, status: 'active' });
      await tx.insert(programVersions).values({
        tenantRef,
        programId,
        version: 1,
        name: 'Programme volume',
        mechanism: 'points',
        minimumPurchaseCents: 0,
        maximumUnitsPerPurchase: null,
        spendStepCents: 1,
        unitsPerStep: 10_000,
        unitsPerVisit: null,
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Test BIGINT',
      });
    });
    const created = await acknowledgeCreated(
      tenantRef,
      await service.createMember(
        tenantRef,
        {
          operationId: randomUUID(),
          firstName: null,
          phone: null,
          termsAccepted: true,
          termsNoticeVersion: 'loyalty-2026-09',
        },
        actor,
      ),
      actor,
    );
    const result = await service.earn(
      tenantRef,
      created.member.id,
      {
        operationId: randomUUID(),
        purchaseCents: 300_000,
        externalRef: 'ticket-bigint',
      },
      actor,
    );

    expect(result).toMatchObject({
      outcome: 'earned',
      awardedUnits: 3_000_000_000,
      member: { balanceUnits: 3_000_000_000 },
      entry: { deltaUnits: 3_000_000_000, balanceAfter: 3_000_000_000 },
    });
    await expect(service.dashboard(tenantRef)).resolves.toMatchObject({
      outstandingUnits: 3_000_000_000,
      earnedUnits30d: 3_000_000_000,
    });
  }, integrationTestTimeout);
});
