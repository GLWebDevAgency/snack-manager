import { z } from 'zod';

/** A selection is intent only. Membership, value and eligibility belong to the server. */
export const OrderRewardSelectionSchema = z.strictObject({ rewardId: z.uuid(), expectedCostUnits: z.number().int().min(1).max(1_000_000) });
export type OrderRewardSelection = z.infer<typeof OrderRewardSelectionSchema>;
export const OrderRewardBenefitSchema = z.strictObject({
  rewardId: z.uuid(), name: z.string().min(2).max(80), costUnits: z.number().int().min(1).max(1_000_000),
  kind: z.enum(['fixed_discount', 'product']), amountCents: z.number().int().positive().max(100_000_000),
  productRef: z.string().regex(/^[a-f0-9]{24}$/).nullable(),
  policy: z.literal('one-reward-no-promotion-v1'),
});
export type OrderRewardBenefit = z.infer<typeof OrderRewardBenefitSchema>;

/** Private, server-built reservation snapshot. Never accepted as browser input. */
export const OrderRewardSnapshotSchema = z.strictObject({
  version: z.literal(1), reservationId: z.uuid(), clientId: z.uuid().refine(value => value === value.toLowerCase()),
  owner: z.strictObject({ tenantRef: z.string().regex(/^[a-f0-9]{24}$/), parentRef: z.string().min(1).max(160), accountId: z.uuid() }),
  memberId: z.uuid(), programId: z.uuid(), rulesVersion: z.number().int().positive(),
  pricingHash: z.string().regex(/^[a-f0-9]{64}$/), benefit: OrderRewardBenefitSchema,
});
export type OrderRewardSnapshot = z.infer<typeof OrderRewardSnapshotSchema>;
