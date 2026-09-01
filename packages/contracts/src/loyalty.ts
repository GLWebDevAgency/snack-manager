import { z } from 'zod';

export const LOYALTY_MECHANISMS = ['points', 'stamps'] as const;
export const LoyaltyMechanismSchema = z.enum(LOYALTY_MECHANISMS);
export type LoyaltyMechanism = z.infer<typeof LoyaltyMechanismSchema>;

export const LOYALTY_PROGRAM_STATUSES = ['draft', 'active', 'paused'] as const;
export const LoyaltyProgramStatusSchema = z.enum(LOYALTY_PROGRAM_STATUSES);
export type LoyaltyProgramStatus = z.infer<typeof LoyaltyProgramStatusSchema>;

const unitsCap = z.number().int().positive().max(100_000).nullable().default(null);
const minimumPurchase = z.number().int().nonnegative().max(10_000_000).default(0);

export const LoyaltyPointsRuleSchema = z
  .object({
    mechanism: z.literal('points'),
    minimumPurchaseCents: minimumPurchase,
    maximumUnitsPerPurchase: unitsCap,
    spendStepCents: z.number().int().positive().max(1_000_000),
    unitsPerStep: z.number().int().positive().max(10_000),
  })
  .strict();

export const LoyaltyStampsRuleSchema = z
  .object({
    mechanism: z.literal('stamps'),
    minimumPurchaseCents: minimumPurchase,
    maximumUnitsPerPurchase: unitsCap,
    unitsPerVisit: z.number().int().positive().max(100),
  })
  .strict();

export const LoyaltyEarnRuleSchema = z.discriminatedUnion('mechanism', [
  LoyaltyPointsRuleSchema,
  LoyaltyStampsRuleSchema,
]);
export type LoyaltyEarnRule = z.infer<typeof LoyaltyEarnRuleSchema>;

/**
 * Configuration publiée par le gérant.
 *
 * Les règles sont remplacées par une nouvelle version côté serveur ; elles ne
 * recalculent jamais l'historique. Le client ne fournit donc ni identifiant,
 * ni numéro de version, ni tenant.
 */
export const LoyaltyProgramPutSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    status: LoyaltyProgramStatusSchema,
    earn: LoyaltyEarnRuleSchema,
    unitLabelSingular: z.string().trim().min(1).max(24),
    unitLabelPlural: z.string().trim().min(1).max(24),
    termsSummary: z.string().trim().max(1_000).default(''),
  })
  .strict();
export type LoyaltyProgramPut = z.infer<typeof LoyaltyProgramPutSchema>;

export interface LoyaltyProgramView extends LoyaltyProgramPut {
  id: string;
  rulesVersion: number;
  createdAt: string;
  updatedAt: string;
}

export const LOYALTY_REWARD_KINDS = ['custom', 'fixed_discount', 'product'] as const;
export const LoyaltyRewardKindSchema = z.enum(LOYALTY_REWARD_KINDS);
export type LoyaltyRewardKind = z.infer<typeof LoyaltyRewardKindSchema>;

const rewardName = z.string().trim().min(2).max(80);
const rewardDescription = z.string().trim().max(300);
const rewardCost = z.number().int().positive().max(1_000_000);
const rewardValue = z.number().int().positive().max(10_000_000).nullable();
const rewardProduct = z.string().trim().min(1).max(120).nullable();

function validateCompleteReward(
  reward: {
    kind: LoyaltyRewardKind;
    valueCents: number | null;
    productRef: string | null;
  },
  ctx: z.RefinementCtx,
) {
    if (reward.kind === 'fixed_discount' && reward.valueCents === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['valueCents'],
        message: 'Le montant de la remise est obligatoire',
      });
    }
    if (reward.kind === 'product' && reward.productRef === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['productRef'],
        message: 'Le produit offert est obligatoire',
      });
    }
    if (reward.kind === 'custom' && (reward.valueCents !== null || reward.productRef !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['kind'],
        message: 'Une récompense personnalisée ne porte ni montant ni produit automatique',
      });
    }
}

export const LoyaltyRewardCreateSchema = z
  .object({
    name: rewardName,
    description: rewardDescription.default(''),
    costUnits: rewardCost,
    kind: LoyaltyRewardKindSchema.default('custom'),
    valueCents: rewardValue.default(null),
    productRef: rewardProduct.default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine(validateCompleteReward);
export type LoyaltyRewardCreate = z.infer<typeof LoyaltyRewardCreateSchema>;

export const LoyaltyRewardUpdateSchema = z
  .object({
    name: rewardName.optional(),
    description: rewardDescription.optional(),
    costUnits: rewardCost.optional(),
    kind: LoyaltyRewardKindSchema.optional(),
    valueCents: rewardValue.optional(),
    productRef: rewardProduct.optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (Object.keys(body).length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Au moins un champ doit être modifié' });
      return;
    }
    // Changer de nature doit fournir toutes les données exigées par la
    // nouvelle nature. Sans changement de nature, le service fusionnera avec
    // l'état courant puis revalidera la récompense complète.
    if (body.kind) {
      validateCompleteReward(
        {
          kind: body.kind,
          valueCents: body.valueCents ?? null,
          productRef: body.productRef ?? null,
        },
        ctx,
      );
    }
  });
export type LoyaltyRewardUpdate = z.infer<typeof LoyaltyRewardUpdateSchema>;

export interface LoyaltyRewardView extends LoyaltyRewardCreate {
  id: string;
  programId: string;
  createdAt: string;
  updatedAt: string;
}

/** Identifiant d'une mutation rejouable depuis une tablette. */
export const LoyaltyOperationIdSchema = z.string().uuid();

export const LoyaltyMemberCreateSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    firstName: z.string().trim().min(1).max(80).nullable().default(null),
    /** Facultatif : une carte QR-only minimise les données collectées. */
    phone: z.string().trim().min(6).max(32).nullable().default(null),
    /** Preuve explicite d'acceptation, distincte de tout consentement marketing. */
    termsAccepted: z.literal(true),
    termsNoticeVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export type LoyaltyMemberCreate = z.infer<typeof LoyaltyMemberCreateSchema>;

export const LoyaltyMemberResolveSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('member_ref'), memberRef: z.string().uuid() }).strict(),
  z.object({ by: z.literal('qr_token'), qrToken: z.string().min(32).max(512) }).strict(),
  z.object({ by: z.literal('phone'), phone: z.string().trim().min(6).max(32) }).strict(),
]);
export type LoyaltyMemberResolve = z.infer<typeof LoyaltyMemberResolveSchema>;

export const LoyaltyMemberSummarySchema = z
  .object({
    id: z.string().uuid(),
    alias: z.string().min(1).max(120),
    maskedPhone: z.string().max(40).nullable(),
    status: z.enum(['active', 'blocked', 'anonymized']),
    balanceUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lifetimeEarnedUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lifetimeRedeemedUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lastActivityAt: z.iso.datetime().nullable(),
    joinedAt: z.iso.datetime(),
  })
  .strict();
export type LoyaltyMemberSummary = z.infer<typeof LoyaltyMemberSummarySchema>;

export const LoyaltyEarnSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    /** Le serveur calcule les unités depuis la règle active. */
    purchaseCents: z.number().int().nonnegative().max(10_000_000),
    externalRef: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict();
export type LoyaltyEarn = z.infer<typeof LoyaltyEarnSchema>;

export const LoyaltyRedeemSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    rewardId: z.string().uuid(),
    /** Coût affiché à l'opérateur : le serveur refuse une récompense devenue plus chère. */
    expectedCostUnits: z.number().int().positive().max(1_000_000),
    externalRef: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict();
export type LoyaltyRedeem = z.infer<typeof LoyaltyRedeemSchema>;

const LoyaltyAdjustmentBaseSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    units: z
      .number()
      .int()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((value) => value !== 0),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

/** Correction depuis le back-office : le JWT propriétaire/gérant est la preuve d'autorité. */
export const LoyaltyAdminAdjustmentSchema = LoyaltyAdjustmentBaseSchema;
export type LoyaltyAdminAdjustment = z.infer<typeof LoyaltyAdminAdjustmentSchema>;

/** Correction au comptoir : variante future avec élévation par PIN manager. */
export const LoyaltyAdjustmentSchema = LoyaltyAdjustmentBaseSchema.extend({
  managerPin: z.string().regex(/^\d{4,8}$/),
})
  .strict();
export type LoyaltyAdjustment = z.infer<typeof LoyaltyAdjustmentSchema>;

export const LOYALTY_CONSENT_PURPOSES = ['marketing_sms', 'marketing_email'] as const;
export const LoyaltyConsentPurposeSchema = z.enum(LOYALTY_CONSENT_PURPOSES);
export type LoyaltyConsentPurpose = z.infer<typeof LoyaltyConsentPurposeSchema>;
export const LoyaltyConsentEventSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    purpose: LoyaltyConsentPurposeSchema,
    decision: z.enum(['granted', 'withdrawn']),
    noticeVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export type LoyaltyConsentEvent = z.infer<typeof LoyaltyConsentEventSchema>;

export const LoyaltyConsentStateViewSchema = z
  .object({
    purpose: LoyaltyConsentPurposeSchema,
    decision: z.enum(['granted', 'withdrawn']),
    noticeVersion: z.string().min(1).max(40),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type LoyaltyConsentStateView = z.infer<typeof LoyaltyConsentStateViewSchema>;

export const LoyaltyLedgerEntryViewSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['earn', 'redeem', 'adjust_credit', 'adjust_debit', 'reverse', 'expire']),
    deltaUnits: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .refine((value) => value !== 0),
    balanceAfter: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    source: z.enum(['standalone', 'pos', 'online', 'admin', 'system']),
    reason: z.string(),
    externalRef: z.string().nullable(),
    recordedAt: z.iso.datetime(),
  })
  .strict();
export type LoyaltyLedgerEntryView = z.infer<typeof LoyaltyLedgerEntryViewSchema>;

export const LoyaltyMutationResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    member: LoyaltyMemberSummarySchema,
    entry: LoyaltyLedgerEntryViewSchema.nullable(),
  })
  .strict();
export type LoyaltyMutationResult = z.infer<typeof LoyaltyMutationResultSchema>;

/**
 * Compensation d'une écriture métier existante.
 *
 * L'identifiant de l'écriture cible reste dans l'URL afin d'éviter deux
 * sources de vérité. Le body ne porte que l'intention rejouable et son motif
 * d'audit ; ni delta, ni solde, ni référence externe ne sont choisis par le
 * client.
 */
export const LoyaltyLedgerReversalSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    reason: z.string().trim().min(3).max(300),
  })
  .strict();
export type LoyaltyLedgerReversal = z.infer<typeof LoyaltyLedgerReversalSchema>;

export const LoyaltyLedgerReversalResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    member: LoyaltyMemberSummarySchema,
    originalEntry: LoyaltyLedgerEntryViewSchema,
    entry: LoyaltyLedgerEntryViewSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.originalEntry.kind !== 'earn' && result.originalEntry.kind !== 'redeem') {
      ctx.addIssue({
        code: 'custom',
        path: ['originalEntry', 'kind'],
        message: 'Seuls un gain ou une consommation peuvent être compensés',
      });
    }
    if (
      result.entry.kind !== 'reverse' ||
      result.entry.deltaUnits !== -result.originalEntry.deltaUnits
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['entry', 'deltaUnits'],
        message: "La compensation doit inverser exactement l'écriture d'origine",
      });
    }
    if (result.entry.externalRef !== result.originalEntry.externalRef) {
      ctx.addIssue({
        code: 'custom',
        path: ['entry', 'externalRef'],
        message: "La compensation doit préserver la référence externe d'origine",
      });
    }
    if (result.member.balanceUnits !== result.entry.balanceAfter) {
      ctx.addIssue({
        code: 'custom',
        path: ['member', 'balanceUnits'],
        message: 'Le solde membre doit être le solde post-compensation du registre',
      });
    }
  });
export type LoyaltyLedgerReversalResult = z.infer<
  typeof LoyaltyLedgerReversalResultSchema
>;

/** Résultat explicite d'un gain, y compris le cas métier valide sans crédit. */
export const LoyaltyEarnResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    outcome: z.enum(['earned', 'below_minimum']),
    awardedUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    rulesVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    member: LoyaltyMemberSummarySchema,
    entry: LoyaltyLedgerEntryViewSchema.nullable(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.outcome === 'earned') {
      if (result.awardedUnits <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['awardedUnits'],
          message: 'Un gain doit attribuer au moins une unité',
        });
      }
      if (result.entry?.kind !== 'earn' || result.entry.deltaUnits !== result.awardedUnits) {
        ctx.addIssue({
          code: 'custom',
          path: ['entry'],
          message: "L'entrée de registre doit refléter exactement le gain",
        });
      }
      if (result.entry && result.member.balanceUnits !== result.entry.balanceAfter) {
        ctx.addIssue({
          code: 'custom',
          path: ['member', 'balanceUnits'],
          message: 'Le solde membre doit être le solde post-gain du registre',
        });
      }
    } else if (result.awardedUnits !== 0 || result.entry !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['entry'],
        message: 'Un achat sous le minimum ne doit produire aucune écriture de registre',
      });
    }
  });
export type LoyaltyEarnResult = z.infer<typeof LoyaltyEarnResultSchema>;

export const LoyaltyRewardSnapshotSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(80),
    description: z.string().max(300),
    kind: LoyaltyRewardKindSchema,
    costUnits: z.number().int().positive().max(1_000_000),
    valueCents: z.number().int().positive().max(10_000_000).nullable(),
    productRef: z.string().min(1).max(120).nullable(),
  })
  .strict()
  .superRefine(validateCompleteReward);
export type LoyaltyRewardSnapshot = z.infer<typeof LoyaltyRewardSnapshotSchema>;

/** Preuve autoritative de la consommation, figée même si la récompense change ensuite. */
export const LoyaltyRedemptionViewSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal('consumed'),
    externalRef: z.string().nullable(),
    rulesVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    reward: LoyaltyRewardSnapshotSchema,
    consumedAt: z.iso.datetime(),
  })
  .strict();
export type LoyaltyRedemptionView = z.infer<typeof LoyaltyRedemptionViewSchema>;

export const LoyaltyRedeemResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    member: LoyaltyMemberSummarySchema,
    entry: LoyaltyLedgerEntryViewSchema,
    redemption: LoyaltyRedemptionViewSchema,
  })
  .strict()
  .superRefine((result, ctx) => {
    const expectedDelta = -result.redemption.reward.costUnits;
    if (
      result.entry.kind !== 'redeem' ||
      result.entry.deltaUnits !== expectedDelta ||
      result.entry.externalRef !== result.redemption.externalRef
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['entry'],
        message: 'Le registre doit refléter exactement la consommation autoritative',
      });
    }
    if (result.member.balanceUnits !== result.entry.balanceAfter) {
      ctx.addIssue({
        code: 'custom',
        path: ['member', 'balanceUnits'],
        message: 'Le solde membre doit être le solde post-consommation du registre',
      });
    }
  });
export type LoyaltyRedeemResult = z.infer<typeof LoyaltyRedeemResultSchema>;

export const LoyaltyMemberCreateResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    member: LoyaltyMemberSummarySchema,
    /** Secret remis une fois ; la base ne conserve que son SHA-256. */
    qrToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
export type LoyaltyMemberCreateResult = z.infer<typeof LoyaltyMemberCreateResultSchema>;

export const LoyaltyConsentMutationResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    consent: LoyaltyConsentStateViewSchema,
  })
  .strict();
export type LoyaltyConsentMutationResult = z.infer<
  typeof LoyaltyConsentMutationResultSchema
>;

export const LOYALTY_BLOCK_REASON_CODES = [
  'suspected_sharing',
  'lost_or_compromised',
  'customer_request',
  'manager_correction',
] as const;
export const LOYALTY_UNBLOCK_REASON_CODES = [
  'identity_verified',
  'customer_request',
  'manager_correction',
] as const;
export const LOYALTY_ANONYMIZE_REASON_CODES = [
  'customer_request',
  'legal_obligation',
  'manager_correction',
] as const;
export const LOYALTY_QR_REPLACEMENT_REASON_CODES = [
  'lost_or_compromised',
  'customer_request',
  'manager_correction',
] as const;

export const LoyaltyBlockReasonCodeSchema = z.enum(LOYALTY_BLOCK_REASON_CODES);
export const LoyaltyUnblockReasonCodeSchema = z.enum(LOYALTY_UNBLOCK_REASON_CODES);
export const LoyaltyAnonymizeReasonCodeSchema = z.enum(
  LOYALTY_ANONYMIZE_REASON_CODES,
);
export const LoyaltyQrReplacementReasonCodeSchema = z.enum(
  LOYALTY_QR_REPLACEMENT_REASON_CODES,
);

/**
 * Cycle de vie déclenché uniquement par un propriétaire ou un gérant.
 *
 * L'anonymisation est terminale et demande une confirmation explicite. Un
 * simple booléen serait trop facile à envoyer par erreur depuis une interface.
 */
export const LoyaltyMemberLifecycleSchema = z.discriminatedUnion('action', [
  z
    .object({
      operationId: LoyaltyOperationIdSchema,
      action: z.literal('block'),
      reasonCode: LoyaltyBlockReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      operationId: LoyaltyOperationIdSchema,
      action: z.literal('unblock'),
      reasonCode: LoyaltyUnblockReasonCodeSchema,
    })
    .strict(),
  z
    .object({
      operationId: LoyaltyOperationIdSchema,
      action: z.literal('anonymize'),
      reasonCode: LoyaltyAnonymizeReasonCodeSchema,
      confirmation: z.literal('ANONYMISER'),
    })
    .strict(),
]);
export type LoyaltyMemberLifecycle = z.infer<typeof LoyaltyMemberLifecycleSchema>;

export const LoyaltyMemberLifecycleResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    action: z.enum(['block', 'unblock', 'anonymize']),
    memberId: z.string().uuid(),
    status: z.enum(['active', 'blocked', 'anonymized']),
    revokedTokens: z.number().int().nonnegative(),
    withdrawnConsents: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((result, ctx) => {
    const expectedStatus =
      result.action === 'block'
        ? 'blocked'
        : result.action === 'unblock'
          ? 'active'
          : 'anonymized';
    if (result.status !== expectedStatus) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: "Le statut membre ne correspond pas à l'action de cycle de vie",
      });
    }
    if (
      result.action !== 'anonymize' &&
      (result.revokedTokens !== 0 || result.withdrawnConsents !== 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['revokedTokens'],
        message: "Seule l'anonymisation révoque les accès et consentements",
      });
    }
  });
export type LoyaltyMemberLifecycleResult = z.infer<
  typeof LoyaltyMemberLifecycleResultSchema
>;

/** Remplace tous les QR actifs d'une carte par un nouveau secret remis une fois. */
export const LoyaltyMemberQrReplaceSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    reasonCode: LoyaltyQrReplacementReasonCodeSchema,
    /** Version observée sur la fiche manager, pour refuser une rotation devenue obsolète. */
    expectedGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export type LoyaltyMemberQrReplace = z.infer<typeof LoyaltyMemberQrReplaceSchema>;

export const LoyaltyMemberQrReplaceResultSchema = z
  .object({
    operationId: LoyaltyOperationIdSchema,
    replayed: z.boolean(),
    memberId: z.string().uuid(),
    status: z.literal('active'),
    qrToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    revokedTokens: z.literal(1),
    previousGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    qrGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.qrGeneration !== result.previousGeneration + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['qrGeneration'],
        message: 'Une rotation QR doit avancer la génération exactement une fois',
      });
    }
  });
export type LoyaltyMemberQrReplaceResult = z.infer<
  typeof LoyaltyMemberQrReplaceResultSchema
>;

export const LoyaltyMemberListQuerySchema = z
  .object({
    status: z.enum(['active', 'blocked', 'anonymized']).optional(),
    memberRef: z.string().uuid().optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type LoyaltyMemberListQuery = z.infer<typeof LoyaltyMemberListQuerySchema>;

export const LoyaltyMemberListSchema = z
  .object({
    items: z.array(LoyaltyMemberSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type LoyaltyMemberList = z.infer<typeof LoyaltyMemberListSchema>;

export const LoyaltyMemberDetailSchema = z
  .object({
    member: LoyaltyMemberSummarySchema,
    qrGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    consents: z.array(LoyaltyConsentStateViewSchema),
    ledger: z.array(LoyaltyLedgerEntryViewSchema),
  })
  .strict();
export type LoyaltyMemberDetail = z.infer<typeof LoyaltyMemberDetailSchema>;

export const LoyaltyDashboardActivitySchema = z
  .object({
    memberId: z.string().uuid(),
    memberAlias: z.string().min(1).max(120),
    entry: LoyaltyLedgerEntryViewSchema,
  })
  .strict();

export const LoyaltyDashboardSchema = z
  .object({
    totalMembers: z.number().int().nonnegative(),
    activeMembers30d: z.number().int().nonnegative(),
    newMembers30d: z.number().int().nonnegative(),
    outstandingUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    earnedUnits30d: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    redeemedUnits30d: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    redemptions30d: z.number().int().nonnegative(),
    recentActivity: z.array(LoyaltyDashboardActivitySchema),
  })
  .strict();
export type LoyaltyDashboard = z.infer<typeof LoyaltyDashboardSchema>;

/** Vue minimale de la carte client : aucun téléphone ni identifiant interne exposé. */
export const LoyaltyCustomerCardSchema = z
  .object({
    restaurant: z.object({ slug: z.string(), name: z.string(), brandColor: z.string() }).strict(),
    program: z
      .object({
        name: z.string(),
        mechanism: LoyaltyMechanismSchema,
        unitLabelSingular: z.string(),
        unitLabelPlural: z.string(),
        termsSummary: z.string(),
      })
      .strict(),
    member: z
      .object({
        alias: z.string().min(1).max(120),
        balanceUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    rewards: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          description: z.string(),
          costUnits: z.number().int().positive(),
          kind: LoyaltyRewardKindSchema,
          valueCents: z.number().int().positive().nullable(),
          productRef: z.string().nullable(),
          affordable: z.boolean(),
        })
        .strict(),
    ),
    activity: z
      .array(
        z
          .object({
            kind: LoyaltyLedgerEntryViewSchema.shape.kind,
            deltaUnits: LoyaltyLedgerEntryViewSchema.shape.deltaUnits,
            balanceAfter: LoyaltyLedgerEntryViewSchema.shape.balanceAfter,
            label: z.string().min(1).max(120),
            recordedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type LoyaltyCustomerCard = z.infer<typeof LoyaltyCustomerCardSchema>;
