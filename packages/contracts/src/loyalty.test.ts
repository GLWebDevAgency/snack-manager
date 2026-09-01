import { describe, expect, it } from 'vitest';
import {
  LoyaltyAdminAdjustmentSchema,
  LoyaltyConsentEventSchema,
  LoyaltyCustomerCardSchema,
  LoyaltyEnrollmentAcknowledgementResultSchema,
  LoyaltyEnrollmentAcknowledgementSchema,
  LoyaltyEnrollmentPrepareResultSchema,
  LoyaltyEnrollmentPrepareSchema,
  LoyaltyEnrollmentRecoveryResultSchema,
  LoyaltyEnrollmentRecoverySchema,
  LoyaltyEarnResultSchema,
  LoyaltyEarnSchema,
  LoyaltyLedgerReversalResultSchema,
  LoyaltyLedgerReversalSchema,
  LoyaltyMemberCreateResultSchema,
  LoyaltyMemberCreateSchema,
  LoyaltyMemberLifecycleResultSchema,
  LoyaltyMemberLifecycleSchema,
  LoyaltyMemberListQuerySchema,
  LoyaltyMemberQrReplaceSchema,
  LoyaltyProgramPutSchema,
  LoyaltyRedeemResultSchema,
  LoyaltyRedeemSchema,
  LoyaltyRewardCreateSchema,
} from './loyalty';

describe('contrats fidélité', () => {
  it('impose un seul mécanisme de gain cohérent', () => {
    const base = {
      name: 'La carte Classfood',
      status: 'active',
      unitLabelSingular: 'point',
      unitLabelPlural: 'points',
      termsSummary: '',
    };
    expect(
      LoyaltyProgramPutSchema.safeParse({
        ...base,
        earn: {
          mechanism: 'points',
          minimumPurchaseCents: 800,
          maximumUnitsPerPurchase: 100,
          spendStepCents: 100,
          unitsPerStep: 1,
        },
      }).success,
    ).toBe(true);
    expect(
      LoyaltyProgramPutSchema.safeParse({
        ...base,
        earn: {
          mechanism: 'stamps',
          minimumPurchaseCents: 800,
          maximumUnitsPerPurchase: null,
          unitsPerVisit: 1,
          // Une règle points glissée dans « tampons » est refusée, pas ignorée.
          spendStepCents: 100,
        },
      }).success,
    ).toBe(false);
  });

  it('n’accepte jamais un delta choisi par la caisse pour un gain normal', () => {
    expect(
      LoyaltyEarnSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        purchaseCents: 1_850,
        units: 50,
      }).success,
    ).toBe(false);
  });

  it('sépare explicitement l’adhésion et chaque consentement marketing', () => {
    const enrollment = {
      operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
      firstName: null,
      phone: null,
      termsNoticeVersion: 'loyalty-2026-09',
    };
    expect(LoyaltyMemberCreateSchema.safeParse(enrollment).success).toBe(false);
    expect(
      LoyaltyMemberCreateSchema.safeParse({ ...enrollment, termsAccepted: false }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberCreateSchema.safeParse({ ...enrollment, termsAccepted: true }).success,
    ).toBe(true);

    expect(
      LoyaltyConsentEventSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        purpose: 'marketing_sms',
        noticeVersion: '2026-09',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyConsentEventSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        purpose: 'marketing_sms',
        decision: 'withdrawn',
        noticeVersion: '2026-09',
      }).success,
    ).toBe(true);
  });

  it("ne reprend une adhésion qu'avec son UUID opaque", () => {
    expect(
      LoyaltyEnrollmentRecoverySchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEnrollmentRecoverySchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        phone: '06 12 34 56 78',
      }).success,
    ).toBe(false);
  });

  it("prépare, reprend et acquitte une adhésion sans transporter de PII", () => {
    const operationId = '7f298b7f-96d5-4f0d-8b10-c9069acaaec4';
    for (const schema of [
      LoyaltyEnrollmentPrepareSchema,
      LoyaltyEnrollmentRecoverySchema,
      LoyaltyEnrollmentAcknowledgementSchema,
    ]) {
      expect(schema.safeParse({ operationId }).success).toBe(true);
      expect(schema.safeParse({ operationId, phone: '06 12 34 56 78' }).success).toBe(
        false,
      );
    }
  });

  it("décrit chaque état strict du handoff d'adhésion", () => {
    const operationId = '7f298b7f-96d5-4f0d-8b10-c9069acaaec4';
    const expiresAt = '2026-09-01T10:05:00.000Z';
    const enrollment = {
      operationId,
      replayed: false,
      member: {
        id: '8f298b7f-96d5-4f0d-8b10-c9069acaaec5',
        alias: 'Mina',
        maskedPhone: null,
        status: 'active',
        balanceUnits: 0,
        lifetimeEarnedUnits: 0,
        lifetimeRedeemedUnits: 0,
        lastActivityAt: null,
        joinedAt: '2026-09-01T10:00:00.000Z',
      },
      qrToken: 'A'.repeat(43),
      handoffExpiresAt: expiresAt,
    };

    expect(LoyaltyMemberCreateResultSchema.safeParse(enrollment).success).toBe(true);
    expect(
      LoyaltyMemberCreateResultSchema.safeParse({
        ...enrollment,
        handoffExpiresAt: undefined,
      }).success,
    ).toBe(false);
    expect(
      LoyaltyEnrollmentPrepareResultSchema.safeParse({
        operationId,
        status: 'prepared',
        expiresAt,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEnrollmentRecoveryResultSchema.safeParse({
        status: 'pending',
        operationId,
        retryAfterMs: 1_000,
        expiresAt,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEnrollmentRecoveryResultSchema.safeParse({
        status: 'ready',
        enrollment,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEnrollmentRecoveryResultSchema.safeParse({
        status: 'ready',
        enrollment,
        retryAfterMs: 1_000,
      }).success,
    ).toBe(false);
    expect(
      LoyaltyEnrollmentAcknowledgementResultSchema.safeParse({
        operationId,
        acknowledged: true,
        replayed: false,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEnrollmentAcknowledgementResultSchema.safeParse({
        operationId,
        acknowledged: false,
        replayed: false,
      }).success,
    ).toBe(false);
  });

  it('refuse une récompense automatique incomplète', () => {
    expect(
      LoyaltyRewardCreateSchema.safeParse({
        name: '5 euros offerts',
        costUnits: 100,
        kind: 'fixed_discount',
      }).success,
    ).toBe(false);
  });

  it('borne les recherches manager et réserve le PIN aux corrections caisse', () => {
    expect(
      LoyaltyMemberListQuerySchema.parse({ limit: '30' }),
    ).toMatchObject({ limit: 30 });
    expect(
      LoyaltyMemberListQuerySchema.safeParse({
        limit: '30',
        phone: '06 12 34 56 78',
      }).success,
    ).toBe(false);
    expect(LoyaltyMemberListQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(
      LoyaltyAdminAdjustmentSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        units: -10,
        reason: 'Correction après remboursement',
        managerPin: '1234',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyAdminAdjustmentSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        units: -10,
        reason: 'Retrait manuel interdit',
      }).success,
    ).toBe(false);
  });

  it('rend le lifecycle explicite et protège l’anonymisation terminale', () => {
    const operationId = '7f298b7f-96d5-4f0d-8b10-c9069acaaec4';
    expect(
      LoyaltyMemberLifecycleSchema.safeParse({
        operationId,
        action: 'block',
        reasonCode: 'suspected_sharing',
      }).success,
    ).toBe(true);
    expect(
      LoyaltyMemberLifecycleSchema.safeParse({
        operationId,
        action: 'block',
        reason: 'Suspicion de partage de la carte',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberLifecycleSchema.safeParse({
        operationId,
        action: 'unblock',
        reasonCode: 'suspected_sharing',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberLifecycleSchema.safeParse({
        operationId,
        action: 'anonymize',
        reasonCode: 'customer_request',
        confirmation: true,
      }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberLifecycleSchema.safeParse({
        operationId,
        action: 'anonymize',
        reasonCode: 'customer_request',
        confirmation: 'ANONYMISER',
      }).success,
    ).toBe(true);
    expect(
      LoyaltyMemberQrReplaceSchema.safeParse({
        operationId,
        reasonCode: 'lost_or_compromised',
        expectedGeneration: 1,
        qrToken: 'injecté-par-le-client',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberQrReplaceSchema.safeParse({
        operationId,
        reasonCode: 'lost_or_compromised',
        expectedGeneration: 1,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyMemberQrReplaceSchema.safeParse({
        operationId,
        reasonCode: 'lost_or_compromised',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyMemberQrReplaceSchema.safeParse({
        operationId,
        reasonCode: 'identity_verified',
        expectedGeneration: 1,
      }).success,
    ).toBe(false);
  });

  it('refuse un résultat de lifecycle incohérent avec son statut', () => {
    const memberId = '8f298b7f-96d5-4f0d-8b10-c9069acaaec5';
    expect(
      LoyaltyMemberLifecycleResultSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        replayed: false,
        action: 'anonymize',
        memberId,
        status: 'anonymized',
        revokedTokens: 1,
        withdrawnConsents: 1,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyMemberLifecycleResultSchema.safeParse({
        operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
        replayed: false,
        action: 'block',
        memberId,
        status: 'anonymized',
        revokedTokens: 0,
        withdrawnConsents: 0,
      }).success,
    ).toBe(false);
  });

  it('verrouille le coût attendu et la référence externe d’une consommation', () => {
    const operationId = '7f298b7f-96d5-4f0d-8b10-c9069acaaec4';
    const rewardId = '8f298b7f-96d5-4f0d-8b10-c9069acaaec5';
    expect(LoyaltyRedeemSchema.safeParse({ operationId, rewardId }).success).toBe(false);
    expect(
      LoyaltyRedeemSchema.parse({
        operationId,
        rewardId,
        expectedCostUnits: 15,
      }),
    ).toEqual({ operationId, rewardId, expectedCostUnits: 15, externalRef: null });
    expect(
      LoyaltyRedeemSchema.safeParse({
        operationId,
        rewardId,
        expectedCostUnits: 15,
        externalRef: `pos-redemption:${operationId}`,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyRedeemSchema.safeParse({
        operationId,
        rewardId,
        expectedCostUnits: 15,
        externalRef: 'Client 06 12 34 56 78',
      }).success,
    ).toBe(false);
  });

  it('rend impossible un résultat de gain nul accompagné d’un ledger', () => {
    const base = {
      operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
      replayed: false,
      rulesVersion: 1,
      member: {
        id: '8f298b7f-96d5-4f0d-8b10-c9069acaaec5',
        alias: 'Mina',
        maskedPhone: null,
        status: 'active',
        balanceUnits: 0,
        lifetimeEarnedUnits: 0,
        lifetimeRedeemedUnits: 0,
        lastActivityAt: null,
        joinedAt: '2026-09-01T10:00:00.000Z',
      },
    } as const;
    expect(
      LoyaltyEarnResultSchema.safeParse({
        ...base,
        outcome: 'below_minimum',
        awardedUnits: 0,
        entry: null,
      }).success,
    ).toBe(true);
    expect(
      LoyaltyEarnResultSchema.safeParse({
        ...base,
        outcome: 'earned',
        awardedUnits: 0,
        entry: null,
      }).success,
    ).toBe(false);
  });

  it('définit une compensation sans delta falsifiable et avec un motif borné', () => {
    const operationId = '7f298b7f-96d5-4f0d-8b10-c9069acaaec4';
    expect(
      LoyaltyLedgerReversalSchema.safeParse({
        operationId,
        reason: 'Commande annulée après encaissement',
      }).success,
    ).toBe(true);
    expect(
      LoyaltyLedgerReversalSchema.safeParse({
        operationId,
        reason: 'x',
      }).success,
    ).toBe(false);
    expect(
      LoyaltyLedgerReversalSchema.safeParse({
        operationId,
        reason: 'Commande annulée',
        deltaUnits: 999,
      }).success,
    ).toBe(false);
  });

  it('impose une compensation exacte qui conserve la référence originale', () => {
    const member = {
      id: '8f298b7f-96d5-4f0d-8b10-c9069acaaec5',
      alias: 'Mina',
      maskedPhone: null,
      status: 'active',
      balanceUnits: 20,
      lifetimeEarnedUnits: 20,
      lifetimeRedeemedUnits: 0,
      lastActivityAt: '2026-09-01T10:01:00.000Z',
      joinedAt: '2026-08-01T10:00:00.000Z',
    } as const;
    const originalEntry = {
      id: '9f298b7f-96d5-4f0d-8b10-c9069acaaec6',
      kind: 'redeem',
      deltaUnits: -15,
      balanceAfter: 5,
      source: 'pos',
      reason: 'Menu offert',
      externalRef: 'ticket-42',
      recordedAt: '2026-09-01T10:00:00.000Z',
    } as const;
    const entry = {
      id: 'af298b7f-96d5-4f0d-8b10-c9069acaaec7',
      kind: 'reverse',
      deltaUnits: 15,
      balanceAfter: 20,
      source: 'admin',
      reason: 'Commande annulée après encaissement',
      externalRef: 'ticket-42',
      recordedAt: '2026-09-01T10:01:00.000Z',
    } as const;
    const result = {
      operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
      replayed: false,
      member,
      originalEntry,
      entry,
    };
    expect(LoyaltyLedgerReversalResultSchema.safeParse(result).success).toBe(true);
    expect(
      LoyaltyLedgerReversalResultSchema.safeParse({
        ...result,
        entry: { ...entry, externalRef: 'autre-ticket' },
      }).success,
    ).toBe(false);
    expect(
      LoyaltyLedgerReversalResultSchema.safeParse({
        ...result,
        entry: { ...entry, deltaUnits: 14 },
      }).success,
    ).toBe(false);
  });

  it('valide une preuve de consommation autoritative et cohérente', () => {
    const parsed = LoyaltyRedeemResultSchema.safeParse({
      operationId: '7f298b7f-96d5-4f0d-8b10-c9069acaaec4',
      replayed: false,
      member: {
        id: '8f298b7f-96d5-4f0d-8b10-c9069acaaec5',
        alias: 'Mina',
        maskedPhone: null,
        status: 'active',
        balanceUnits: 5,
        lifetimeEarnedUnits: 20,
        lifetimeRedeemedUnits: 15,
        lastActivityAt: '2026-09-01T10:00:00.000Z',
        joinedAt: '2026-08-01T10:00:00.000Z',
      },
      entry: {
        id: '9f298b7f-96d5-4f0d-8b10-c9069acaaec6',
        kind: 'redeem',
        deltaUnits: -15,
        balanceAfter: 5,
        source: 'pos',
        reason: 'Menu offert',
        externalRef: 'ticket-42',
        recordedAt: '2026-09-01T10:00:00.000Z',
      },
      redemption: {
        id: 'af298b7f-96d5-4f0d-8b10-c9069acaaec7',
        status: 'consumed',
        externalRef: 'ticket-42',
        rulesVersion: 3,
        reward: {
          id: 'bf298b7f-96d5-4f0d-8b10-c9069acaaec8',
          name: 'Menu offert',
          description: 'Un menu au choix',
          kind: 'custom',
          costUnits: 15,
          valueCents: null,
          productRef: null,
        },
        consumedAt: '2026-09-01T10:00:00.000Z',
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('borne la carte publique aux données réellement utiles au client', () => {
    const card = {
      restaurant: { slug: 'classfood', name: 'Classfood', brandColor: '#c9a15a' },
      program: {
        name: 'La carte Classfood',
        mechanism: 'points',
        unitLabelSingular: 'point',
        unitLabelPlural: 'points',
        termsSummary: 'Conditions du programme',
      },
      member: { alias: 'Mina', balanceUnits: 42 },
      rewards: [],
      activity: [
        {
          kind: 'earn',
          deltaUnits: 12,
          balanceAfter: 42,
          label: 'Achat enregistré',
          recordedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    };
    expect(LoyaltyCustomerCardSchema.safeParse(card).success).toBe(true);
    expect(
      LoyaltyCustomerCardSchema.safeParse({
        ...card,
        member: { ...card.member, id: '8f298b7f-96d5-4f0d-8b10-c9069acaaec5' },
      }).success,
    ).toBe(false);
    expect(
      LoyaltyCustomerCardSchema.safeParse({
        ...card,
        activity: [{ ...card.activity[0], externalRef: 'ticket-interne-42' }],
      }).success,
    ).toBe(false);
  });
});
