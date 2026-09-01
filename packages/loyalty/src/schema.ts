/**
 * Contexte « Loyalty » — PostgreSQL, schéma SQL isolé `loyalty`.
 *
 * Le ledger est la vérité ; `wallets` en est la projection transactionnelle et
 * reconstruisible. Les références `tenantRef`, `actorRef`, `deviceRef` et
 * `externalRef` traversent la frontière Mongo sous forme de texte, jamais de
 * pseudo-clé étrangère impossible à garantir entre deux moteurs.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const loyaltySchema = pgSchema('loyalty');

export const programStatusEnum = loyaltySchema.enum('program_status', [
  'draft',
  'active',
  'paused',
]);
export const mechanismEnum = loyaltySchema.enum('mechanism', ['points', 'stamps']);
export const rewardKindEnum = loyaltySchema.enum('reward_kind', [
  'custom',
  'fixed_discount',
  'product',
]);
export const memberStatusEnum = loyaltySchema.enum('member_status', [
  'active',
  'blocked',
  'anonymized',
]);
export const tokenStatusEnum = loyaltySchema.enum('token_status', ['active', 'revoked']);
export const operationStatusEnum = loyaltySchema.enum('operation_status', [
  'pending',
  'completed',
]);
export const operationKindEnum = loyaltySchema.enum('operation_kind', [
  'member_create',
  'earn',
  'redeem',
  'adjust',
  'consent',
  'member_lifecycle',
  'token_replace',
  'reservation',
  'consume',
  'reverse',
  'program_publish',
]);
export const ledgerKindEnum = loyaltySchema.enum('ledger_kind', [
  'earn',
  'redeem',
  'adjust_credit',
  'adjust_debit',
  'reverse',
  'expire',
]);
export const ledgerSourceEnum = loyaltySchema.enum('ledger_source', [
  'standalone',
  'pos',
  'online',
  'admin',
  'system',
]);
export const redemptionStatusEnum = loyaltySchema.enum('redemption_status', [
  'reserved',
  'consumed',
  'reversed',
  'expired',
]);
export const consentPurposeEnum = loyaltySchema.enum('consent_purpose', [
  'marketing_sms',
  'marketing_email',
]);
export const consentDecisionEnum = loyaltySchema.enum('consent_decision', [
  'granted',
  'withdrawn',
]);
export const membershipEventKindEnum = loyaltySchema.enum('membership_event_kind', [
  'joined',
  'blocked',
  'unblocked',
  'anonymized',
  'token_replaced',
]);

export const programs = loyaltySchema.table(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    status: programStatusEnum('status').notNull().default('draft'),
    currentVersion: bigint('current_version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('programs_tenant_uq').on(table.tenantRef),
    uniqueIndex('programs_tenant_id_uq').on(table.tenantRef, table.id),
    check('programs_current_version_positive', sql`${table.currentVersion} > 0`),
    check(
      'programs_current_version_safe_integer',
      sql`${table.currentVersion} <= 9007199254740991`,
    ),
  ],
);

/** Chaque modification publie une version ; aucun historique n'est recalculé. */
export const programVersions = loyaltySchema.table(
  'program_versions',
  {
    tenantRef: text('tenant_ref').notNull(),
    programId: uuid('program_id').notNull(),
    version: bigint('version', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    mechanism: mechanismEnum('mechanism').notNull(),
    minimumPurchaseCents: integer('minimum_purchase_cents').notNull().default(0),
    maximumUnitsPerPurchase: integer('maximum_units_per_purchase'),
    spendStepCents: integer('spend_step_cents'),
    unitsPerStep: integer('units_per_step'),
    unitsPerVisit: integer('units_per_visit'),
    unitLabelSingular: text('unit_label_singular').notNull(),
    unitLabelPlural: text('unit_label_plural').notNull(),
    termsSummary: text('terms_summary').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.programId, table.version] }),
    uniqueIndex('program_versions_tenant_identity_uq').on(
      table.tenantRef,
      table.programId,
      table.version,
    ),
    foreignKey({
      columns: [table.tenantRef, table.programId],
      foreignColumns: [programs.tenantRef, programs.id],
      name: 'program_versions_tenant_program_fk',
    }).onDelete('restrict'),
    check('program_versions_version_positive', sql`${table.version} > 0`),
    check(
      'program_versions_version_safe_integer',
      sql`${table.version} <= 9007199254740991`,
    ),
    check(
      'program_versions_minimum_nonnegative',
      sql`${table.minimumPurchaseCents} >= 0`,
    ),
    check(
      'program_versions_cap_positive',
      sql`${table.maximumUnitsPerPurchase} IS NULL OR ${table.maximumUnitsPerPurchase} > 0`,
    ),
    check(
      'program_versions_mechanism_shape',
      sql`(
        (${table.mechanism} = 'points' AND ${table.spendStepCents} > 0 AND ${table.unitsPerStep} > 0 AND ${table.unitsPerVisit} IS NULL)
        OR
        (${table.mechanism} = 'stamps' AND ${table.unitsPerVisit} > 0 AND ${table.spendStepCents} IS NULL AND ${table.unitsPerStep} IS NULL)
      )`,
    ),
  ],
);

export const rewards = loyaltySchema.table(
  'rewards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    programId: uuid('program_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    costUnits: integer('cost_units').notNull(),
    kind: rewardKindEnum('kind').notNull().default('custom'),
    valueCents: integer('value_cents'),
    productRef: text('product_ref'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('rewards_tenant_id_uq').on(table.tenantRef, table.id),
    uniqueIndex('rewards_tenant_program_id_uq').on(
      table.tenantRef,
      table.programId,
      table.id,
    ),
    index('rewards_tenant_program_idx').on(table.tenantRef, table.programId, table.active),
    foreignKey({
      columns: [table.tenantRef, table.programId],
      foreignColumns: [programs.tenantRef, programs.id],
      name: 'rewards_tenant_program_fk',
    }).onDelete('restrict'),
    check('rewards_cost_positive', sql`${table.costUnits} > 0`),
    check(
      'rewards_kind_shape',
      sql`(
        (${table.kind} = 'custom' AND ${table.valueCents} IS NULL AND ${table.productRef} IS NULL)
        OR (${table.kind} = 'fixed_discount' AND ${table.valueCents} > 0 AND ${table.productRef} IS NULL)
        OR (${table.kind} = 'product' AND ${table.productRef} IS NOT NULL AND ${table.valueCents} IS NULL)
      )`,
    ),
  ],
);

export const members = loyaltySchema.table(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    status: memberStatusEnum('status').notNull().default('active'),
    /** Jeton de concurrence optimiste des rotations QR. */
    qrGeneration: bigint('qr_generation', { mode: 'number' }).notNull().default(1),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** Date à laquelle le secret initial a été remis ; NULL tant que le handoff reste ouvert. */
    enrollmentHandoffAt: timestamp('enrollment_handoff_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('members_tenant_id_uq').on(table.tenantRef, table.id),
    index('members_tenant_activity_idx').on(table.tenantRef, table.lastActivityAt),
    index('members_unhanded_enrollment_idx')
      .on(table.tenantRef, table.joinedAt)
      .where(sql`${table.enrollmentHandoffAt} IS NULL`),
    check('members_qr_generation_positive', sql`${table.qrGeneration} > 0`),
    check(
      'members_qr_generation_safe_integer',
      sql`${table.qrGeneration} <= 9007199254740991`,
    ),
    check(
      'members_enrollment_handoff_after_joined',
      sql`${table.enrollmentHandoffAt} IS NULL OR ${table.enrollmentHandoffAt} >= ${table.joinedAt}`,
    ),
    check(
      'members_status_timestamps_shape',
      sql`(
        (${table.status} = 'active' AND ${table.blockedAt} IS NULL AND ${table.anonymizedAt} IS NULL)
        OR (${table.status} = 'blocked' AND ${table.blockedAt} IS NOT NULL AND ${table.anonymizedAt} IS NULL)
        OR (${table.status} = 'anonymized' AND ${table.anonymizedAt} IS NOT NULL)
      )`,
    ),
  ],
);

/** PII chiffrée ; seul l'index HMAC du téléphone permet une recherche exacte. */
export const memberProfiles = loyaltySchema.table(
  'member_profiles',
  {
    memberId: uuid('member_id').primaryKey(),
    tenantRef: text('tenant_ref').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    phoneLookupHash: text('phone_lookup_hash'),
    keyVersion: integer('key_version').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'member_profiles_tenant_member_fk',
    }).onDelete('cascade'),
    uniqueIndex('member_profiles_tenant_phone_uq')
      .on(table.tenantRef, table.phoneLookupHash)
      .where(sql`${table.phoneLookupHash} IS NOT NULL`),
    check('member_profiles_key_version_positive', sql`${table.keyVersion} > 0`),
  ],
);

export const memberTokens = loyaltySchema.table(
  'member_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: tokenStatusEnum('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('member_tokens_hash_uq').on(table.tokenHash),
    uniqueIndex('member_tokens_one_active_uq')
      .on(table.tenantRef, table.memberId)
      .where(sql`${table.status} = 'active'`),
    index('member_tokens_tenant_member_idx').on(table.tenantRef, table.memberId),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'member_tokens_tenant_member_fk',
    }).onDelete('cascade'),
    check(
      'member_tokens_status_timestamp_shape',
      sql`(
        (${table.status} = 'active' AND ${table.revokedAt} IS NULL)
        OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export const wallets = loyaltySchema.table(
  'wallets',
  {
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    programId: uuid('program_id').notNull(),
    balanceUnits: bigint('balance_units', { mode: 'number' }).notNull().default(0),
    lifetimeEarnedUnits: bigint('lifetime_earned_units', { mode: 'number' })
      .notNull()
      .default(0),
    lifetimeRedeemedUnits: bigint('lifetime_redeemed_units', { mode: 'number' })
      .notNull()
      .default(0),
    version: bigint('version', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantRef, table.memberId, table.programId] }),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'wallets_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.programId],
      foreignColumns: [programs.tenantRef, programs.id],
      name: 'wallets_tenant_program_fk',
    }).onDelete('restrict'),
    check('wallets_balance_nonnegative', sql`${table.balanceUnits} >= 0`),
    check('wallets_lifetime_earned_nonnegative', sql`${table.lifetimeEarnedUnits} >= 0`),
    check('wallets_lifetime_redeemed_nonnegative', sql`${table.lifetimeRedeemedUnits} >= 0`),
    check('wallets_version_nonnegative', sql`${table.version} >= 0`),
    check('wallets_balance_safe_integer', sql`${table.balanceUnits} <= 9007199254740991`),
    check(
      'wallets_lifetime_earned_safe_integer',
      sql`${table.lifetimeEarnedUnits} <= 9007199254740991`,
    ),
    check(
      'wallets_lifetime_redeemed_safe_integer',
      sql`${table.lifetimeRedeemedUnits} <= 9007199254740991`,
    ),
    check('wallets_version_safe_integer', sql`${table.version} <= 9007199254740991`),
  ],
);

/** Inbox transactionnelle : même UUID + autre corps = conflit, jamais double effet. */
export const operations = loyaltySchema.table(
  'operations',
  {
    tenantRef: text('tenant_ref').notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: operationKindEnum('kind').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    status: operationStatusEnum('status').notNull().default('pending'),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantRef, table.operationId] }),
    check(
      'operations_status_result_shape',
      sql`(
        (${table.status} = 'pending' AND ${table.result} IS NULL AND ${table.completedAt} IS NULL)
        OR (${table.status} = 'completed' AND ${table.result} IS NOT NULL AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
  ],
);

/**
 * Reçu métier append-only d'un ticket présenté au gain.
 *
 * Il est volontairement distinct du ledger : un achat sous le minimum ne
 * produit aucun mouvement, mais sa référence doit tout de même rester
 * consommée afin qu'une nouvelle operationId ne puisse pas le rejouer après
 * un changement de règle.
 */
export const earnReceipts = loyaltySchema.table(
  'earn_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    source: ledgerSourceEnum('source').notNull(),
    externalRef: text('external_ref').notNull(),
    operationId: uuid('operation_id').notNull(),
    memberId: uuid('member_id').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('earn_receipts_tenant_source_external_ref_uq').on(
      table.tenantRef,
      table.source,
      table.externalRef,
    ),
    uniqueIndex('earn_receipts_tenant_operation_uq').on(
      table.tenantRef,
      table.operationId,
    ),
    index('earn_receipts_tenant_member_idx').on(
      table.tenantRef,
      table.memberId,
      table.claimedAt,
    ),
    foreignKey({
      columns: [table.tenantRef, table.operationId],
      foreignColumns: [operations.tenantRef, operations.operationId],
      name: 'earn_receipts_tenant_operation_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'earn_receipts_tenant_member_fk',
    }).onDelete('restrict'),
  ],
);

export const ledgerEntries = loyaltySchema.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    programId: uuid('program_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: ledgerKindEnum('kind').notNull(),
    deltaUnits: bigint('delta_units', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),
    source: ledgerSourceEnum('source').notNull(),
    externalRef: text('external_ref'),
    actorRef: text('actor_ref'),
    deviceRef: text('device_ref'),
    rulesVersion: bigint('rules_version', { mode: 'number' }).notNull(),
    walletVersion: bigint('wallet_version', { mode: 'number' }).notNull(),
    reason: text('reason').notNull().default(''),
    rewardSnapshot: jsonb('reward_snapshot'),
    reversedEntryId: uuid('reversed_entry_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ledger_tenant_operation_uq').on(table.tenantRef, table.operationId),
    uniqueIndex('ledger_tenant_id_uq').on(table.tenantRef, table.id),
    uniqueIndex('ledger_wallet_version_uq').on(
      table.tenantRef,
      table.memberId,
      table.programId,
      table.walletVersion,
    ),
    uniqueIndex('ledger_tenant_member_program_id_uq').on(
      table.tenantRef,
      table.memberId,
      table.programId,
      table.id,
    ),
    uniqueIndex('ledger_reversed_entry_uq')
      .on(table.reversedEntryId)
      .where(sql`${table.reversedEntryId} IS NOT NULL`),
    index('ledger_member_history_idx').on(
      table.tenantRef,
      table.memberId,
      table.recordedAt,
      table.id,
    ),
    index('ledger_external_ref_idx').on(table.tenantRef, table.externalRef),
    uniqueIndex('ledger_earn_external_ref_uq')
      .on(table.tenantRef, table.source, table.externalRef)
      .where(sql`${table.kind} = 'earn' AND ${table.externalRef} IS NOT NULL`),
    uniqueIndex('ledger_redeem_external_ref_uq')
      .on(table.tenantRef, table.source, table.externalRef)
      .where(sql`${table.kind} = 'redeem' AND ${table.externalRef} IS NOT NULL`),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'ledger_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.programId],
      foreignColumns: [programs.tenantRef, programs.id],
      name: 'ledger_tenant_program_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.programId, table.rulesVersion],
      foreignColumns: [
        programVersions.tenantRef,
        programVersions.programId,
        programVersions.version,
      ],
      name: 'ledger_tenant_program_rules_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.operationId],
      foreignColumns: [operations.tenantRef, operations.operationId],
      name: 'ledger_tenant_operation_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.memberId, table.programId, table.reversedEntryId],
      // Référence auto-récursive sans rappeler `ledgerEntries` pendant son
      // initialisation (ce qui ferait perdre le typage TypeScript à la table).
      foreignColumns: [table.tenantRef, table.memberId, table.programId, table.id],
      name: 'ledger_reversal_origin_fk',
    }).onDelete('restrict'),
    check('ledger_delta_nonzero', sql`${table.deltaUnits} <> 0`),
    check('ledger_balance_nonnegative', sql`${table.balanceAfter} >= 0`),
    check('ledger_rules_version_positive', sql`${table.rulesVersion} > 0`),
    check('ledger_wallet_version_positive', sql`${table.walletVersion} > 0`),
    check(
      'ledger_delta_safe_integer',
      sql`${table.deltaUnits} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
    check(
      'ledger_balance_safe_integer',
      sql`${table.balanceAfter} <= 9007199254740991`,
    ),
    check(
      'ledger_rules_version_safe_integer',
      sql`${table.rulesVersion} <= 9007199254740991`,
    ),
    check(
      'ledger_wallet_version_safe_integer',
      sql`${table.walletVersion} <= 9007199254740991`,
    ),
    check(
      'ledger_reversal_shape',
      sql`(
        (${table.kind} = 'reverse' AND ${table.reversedEntryId} IS NOT NULL)
        OR (${table.kind} <> 'reverse' AND ${table.reversedEntryId} IS NULL)
      )`,
    ),
    check(
      'ledger_kind_delta_shape',
      sql`(
        (${table.kind} IN ('earn', 'adjust_credit') AND ${table.deltaUnits} > 0)
        OR (${table.kind} IN ('redeem', 'adjust_debit', 'expire') AND ${table.deltaUnits} < 0)
        OR ${table.kind} = 'reverse'
      )`,
    ),
  ],
);

export const redemptions = loyaltySchema.table(
  'redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    programId: uuid('program_id').notNull(),
    rewardId: uuid('reward_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    ledgerEntryId: uuid('ledger_entry_id'),
    externalRef: text('external_ref'),
    status: redemptionStatusEnum('status').notNull(),
    rewardSnapshot: jsonb('reward_snapshot').notNull(),
    reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('redemptions_tenant_operation_uq').on(table.tenantRef, table.operationId),
    uniqueIndex('redemptions_ledger_uq')
      .on(table.ledgerEntryId)
      .where(sql`${table.ledgerEntryId} IS NOT NULL`),
    index('redemptions_tenant_member_idx').on(table.tenantRef, table.memberId, table.consumedAt),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'redemptions_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.programId, table.rewardId],
      foreignColumns: [rewards.tenantRef, rewards.programId, rewards.id],
      name: 'redemptions_tenant_reward_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.memberId, table.programId, table.ledgerEntryId],
      foreignColumns: [
        ledgerEntries.tenantRef,
        ledgerEntries.memberId,
        ledgerEntries.programId,
        ledgerEntries.id,
      ],
      name: 'redemptions_tenant_ledger_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.operationId],
      foreignColumns: [operations.tenantRef, operations.operationId],
      name: 'redemptions_tenant_operation_fk',
    }).onDelete('restrict'),
    check(
      'redemptions_status_timestamps_shape',
      sql`(
        (${table.status} = 'reserved' AND ${table.ledgerEntryId} IS NULL AND ${table.consumedAt} IS NULL AND ${table.reversedAt} IS NULL AND ${table.expiresAt} IS NOT NULL)
        OR (${table.status} = 'consumed' AND ${table.ledgerEntryId} IS NOT NULL AND ${table.consumedAt} IS NOT NULL AND ${table.reversedAt} IS NULL)
        OR (${table.status} = 'reversed' AND ${table.ledgerEntryId} IS NOT NULL AND ${table.consumedAt} IS NOT NULL AND ${table.reversedAt} IS NOT NULL)
        OR (${table.status} = 'expired' AND ${table.ledgerEntryId} IS NULL AND ${table.consumedAt} IS NULL AND ${table.reversedAt} IS NULL AND ${table.expiresAt} IS NOT NULL)
      )`,
    ),
    check(
      'redemptions_timestamp_order',
      sql`(
        (${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.reservedAt})
        AND (${table.consumedAt} IS NULL OR ${table.consumedAt} >= ${table.reservedAt})
        AND (${table.reversedAt} IS NULL OR (${table.consumedAt} IS NOT NULL AND ${table.reversedAt} >= ${table.consumedAt}))
      )`,
    ),
  ],
);

export const consentEvents = loyaltySchema.table(
  'consent_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    purpose: consentPurposeEnum('purpose').notNull(),
    decision: consentDecisionEnum('decision').notNull(),
    noticeVersion: text('notice_version').notNull(),
    source: ledgerSourceEnum('source').notNull(),
    actorRef: text('actor_ref'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('consent_events_tenant_operation_uq').on(table.tenantRef, table.operationId),
    uniqueIndex('consent_events_tenant_identity_uq').on(
      table.tenantRef,
      table.id,
      table.memberId,
      table.purpose,
      table.decision,
      table.noticeVersion,
    ),
    index('consent_events_member_history_idx').on(
      table.tenantRef,
      table.memberId,
      table.recordedAt,
    ),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'consent_events_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.operationId],
      foreignColumns: [operations.tenantRef, operations.operationId],
      name: 'consent_events_tenant_operation_fk',
    }).onDelete('restrict'),
  ],
);

/** Preuve append-only d'adhésion et de cycle de vie, avec version des conditions. */
export const membershipEvents = loyaltySchema.table(
  'membership_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    operationId: uuid('operation_id').notNull(),
    kind: membershipEventKindEnum('kind').notNull(),
    termsNoticeVersion: text('terms_notice_version'),
    reason: text('reason'),
    source: ledgerSourceEnum('source').notNull(),
    actorRef: text('actor_ref'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('membership_events_tenant_operation_uq').on(
      table.tenantRef,
      table.operationId,
    ),
    index('membership_events_member_history_idx').on(
      table.tenantRef,
      table.memberId,
      table.recordedAt,
    ),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'membership_events_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.tenantRef, table.operationId],
      foreignColumns: [operations.tenantRef, operations.operationId],
      name: 'membership_events_tenant_operation_fk',
    }).onDelete('restrict'),
    check(
      'membership_events_terms_shape',
      sql`(
        (${table.kind} = 'joined' AND ${table.termsNoticeVersion} IS NOT NULL AND ${table.reason} IS NULL)
        OR (
          ${table.kind} <> 'joined'
          AND ${table.termsNoticeVersion} IS NULL
          AND ${table.reason} IS NOT NULL
          AND length(trim(${table.reason})) BETWEEN 3 AND 300
        )
      )`,
    ),
  ],
);

export const consentState = loyaltySchema.table(
  'consent_state',
  {
    tenantRef: text('tenant_ref').notNull(),
    memberId: uuid('member_id').notNull(),
    purpose: consentPurposeEnum('purpose').notNull(),
    decision: consentDecisionEnum('decision').notNull(),
    noticeVersion: text('notice_version').notNull(),
    eventId: uuid('event_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantRef, table.memberId, table.purpose] }),
    foreignKey({
      columns: [table.tenantRef, table.memberId],
      foreignColumns: [members.tenantRef, members.id],
      name: 'consent_state_tenant_member_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [
        table.tenantRef,
        table.eventId,
        table.memberId,
        table.purpose,
        table.decision,
        table.noticeVersion,
      ],
      foreignColumns: [
        consentEvents.tenantRef,
        consentEvents.id,
        consentEvents.memberId,
        consentEvents.purpose,
        consentEvents.decision,
        consentEvents.noticeVersion,
      ],
      name: 'consent_state_tenant_event_fk',
    }).onDelete('restrict'),
  ],
);
