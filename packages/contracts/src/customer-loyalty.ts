import { z } from 'zod';

// Account enrollment is explicit and separate from optional marketing consent.
export const CUSTOMER_LOYALTY_NOTICE_VERSION = 'customer-loyalty-2026-09';
export const CUSTOMER_LOYALTY_NOTICE = 'Je demande ma carte de fidélité gratuite pour ce restaurant et accepte les conditions du programme présentées sur cet écran. Cette adhésion ne m’inscrit à aucun message publicitaire.';
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CustomerLoyaltyRequestSchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('view') }),
  z.strictObject({ step: z.literal('join'), operationId: uuid, programId: uuid, rulesVersion: integer.min(1),
    termsNoticeVersion: z.literal(CUSTOMER_LOYALTY_NOTICE_VERSION), termsAccepted: z.literal(true) }),
  z.strictObject({ step: z.literal('card') }),
]);
export type CustomerLoyaltyRequest = z.infer<typeof CustomerLoyaltyRequestSchema>;
export const CustomerLoyaltyProgramSchema = z.strictObject({ id: uuid, version: integer.min(1), name: z.string().min(1).max(160),
  mechanism: z.enum(['points', 'stamps']), termsSummary: z.string().max(6000),
  unitLabelSingular: z.string().min(1).max(80), unitLabelPlural: z.string().min(1).max(80) });
export const CustomerLoyaltyMemberSchema = z.strictObject({ id: uuid, joinedAt: z.iso.datetime(), qrGeneration: integer.min(1),
  balanceUnits: integer, unitLabelSingular: z.string().min(1).max(80), unitLabelPlural: z.string().min(1).max(80) });
const expiresAt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 604_800_000);
const available = { program: CustomerLoyaltyProgramSchema, profileReady: z.boolean() };
export const CustomerLoyaltyResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('available'), expiresAt, ...available }),
  z.strictObject({ state: z.literal('terms_changed'), expiresAt, ...available }),
  z.strictObject({ state: z.literal('member'), expiresAt, member: CustomerLoyaltyMemberSchema }),
  z.strictObject({ state: z.literal('card'), expiresAt, member: CustomerLoyaltyMemberSchema,
    qrToken: z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/) }),
  z.strictObject({ state: z.enum(['unavailable', 'name_required', 'existing_card', 'conflict']), expiresAt }),
]);
export type CustomerLoyaltyResponse = z.infer<typeof CustomerLoyaltyResponseSchema>;
export type CustomerLoyaltyProgram = z.infer<typeof CustomerLoyaltyProgramSchema>;
export type CustomerLoyaltyMember = z.infer<typeof CustomerLoyaltyMemberSchema>;
