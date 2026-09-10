import { z } from 'zod';
import { LoyaltyEarnRuleSchema } from './loyalty';

const tenantRef = z.string().regex(/^[a-f0-9]{24}$/);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const basis = z.strictObject({
  policyVersion: z.literal('merchandise-net-v1'),
  eligiblePurchaseCents: cents,
  excludedChargeCents: cents,
  chargedTotalCents: cents,
}).refine(value => BigInt(value.eligiblePurchaseCents) + BigInt(value.excludedChargeCents) === BigInt(value.chargedTotalCents),
  { message: 'Assiette de fidélité incohérente.' });
const common = {
  version: z.literal(1), tenantRef, clientId: z.uuid(),
  owner: z.strictObject({ parentRef: z.string().regex(/^AC[0-9a-fA-F]{32}$/), tenantRef, accountId: z.uuid() }),
  capturedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  basis,
};

/** Internal server snapshot, not a public request or a credit authorization.
 * Null on historical orders stays null. IDs come from protected SQL ownership;
 * prices come from server pricing. No phone, QR, profile or session credential. */
export const CustomerSaleAttributionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ ...common, decision: z.literal('none'),
    reason: z.enum(['not_enrolled', 'program_inactive', 'feature_unavailable', 'member_inactive']) }),
  z.strictObject({ ...common, decision: z.literal('attributed'), memberId: z.uuid(), membershipOperationId: z.uuid(),
    programId: z.uuid(), rulesVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), rule: LoyaltyEarnRuleSchema }),
]).refine(value => value.owner.tenantRef === value.tenantRef, { message: 'Établissement de fidélité incohérent.' });

export type CustomerSaleAttribution = z.infer<typeof CustomerSaleAttributionSchema>;
