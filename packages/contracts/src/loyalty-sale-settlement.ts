import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const LoyaltySaleReasonSchema = z.enum(['not_observed', 'observation_superseded', 'payment_or_handoff_pending', 'refund_pending', 'program_inactive', 'member_inactive', 'allocation_unknown', 'insufficient_balance', 'historical_proof_conflict', 'canonical_sale_conflict', 'financial_regression', 'financial_proof_conflict', 'financial_proof_too_large']);
export const LoyaltySaleAmountsSchema = z.strictObject({
  initialUnits: units.nullable(), reversedUnits: units, waivedUnits: units, retainedUnits: units, dueUnits: units,
});
export const LoyaltySaleResolutionIntentSchema = z.strictObject({
  operationId: z.uuid(), caseId: z.uuid(), expectedVersion: units.positive(),
  decision: z.enum(['retry', 'waive_current']), reason: z.string().trim().min(3).max(500),
});
export type LoyaltySaleResolutionIntent = z.infer<typeof LoyaltySaleResolutionIntentSchema>;
export const LoyaltySaleResolutionRequestSchema = LoyaltySaleResolutionIntentSchema.extend({ password: z.string().min(1).max(256) });
export type LoyaltySaleResolutionRequest = z.infer<typeof LoyaltySaleResolutionRequestSchema>;
export const LoyaltySaleResolutionReceiptSchema = z.strictObject({
  request: LoyaltySaleResolutionIntentSchema,
  result: LoyaltySaleAmountsSchema.extend({ state: z.enum(['recorded', 'reconciliation']), reason: LoyaltySaleReasonSchema.nullable(), version: units.positive() }),
  recordedAt: z.iso.datetime(),
});
export type LoyaltySaleResolutionReceipt = z.infer<typeof LoyaltySaleResolutionReceiptSchema>;
const settlement = LoyaltySaleAmountsSchema.extend({
  orderId: objectId, orderNumber: z.number().int().positive(),
  caseId: z.uuid().nullable(), version: units.positive().nullable(),
  state: z.enum(['waiting', 'recorded', 'reconciliation']), reason: LoyaltySaleReasonSchema.nullable(),
  canResolve: z.boolean(), canAllocate: z.boolean(),
  resolutions: z.array(LoyaltySaleResolutionReceiptSchema).max(128),
});
export const LoyaltySaleSettlementSchema = settlement.superRefine((value, ctx) => {
  if ((value.state === 'recorded') !== (value.reason === null)
    || (value.canResolve && (value.state !== 'reconciliation' || value.reason !== 'insufficient_balance' || !value.caseId || !value.version || value.dueUnits <= 0))
    || (value.canAllocate && value.reason !== 'allocation_unknown')
    || new Set(value.resolutions.map(entry => entry.request.operationId)).size !== value.resolutions.length) {
    ctx.addIssue({ code: 'custom', message: 'Rapprochement fidélité incohérent' });
  }
});
export type LoyaltySaleSettlement = z.infer<typeof LoyaltySaleSettlementSchema>;
export const LoyaltySaleSettlementListSchema = z.strictObject({ items: z.array(LoyaltySaleSettlementSchema).max(30), nextCursor: objectId.nullable() });
export type LoyaltySaleSettlementList = z.infer<typeof LoyaltySaleSettlementListSchema>;
export const LoyaltySaleSettlementV2Schema = z.union([LoyaltySaleSettlementSchema, settlement.extend({
  state: z.literal('not_earned'), reason: z.literal('cancelled_before_handoff'),
  caseId: z.uuid(), version: units.positive(), initialUnits: z.null(),
  reversedUnits: z.literal(0), waivedUnits: z.literal(0), retainedUnits: z.literal(0), dueUnits: z.literal(0),
  canResolve: z.literal(false), canAllocate: z.literal(false), resolutions: z.array(LoyaltySaleResolutionReceiptSchema).length(0),
})]);
export type LoyaltySaleSettlementV2 = z.infer<typeof LoyaltySaleSettlementV2Schema>;
export const LoyaltySaleSettlementListV2Schema = z.strictObject({ items: z.array(LoyaltySaleSettlementV2Schema).max(30), nextCursor: objectId.nullable() });
export type LoyaltySaleSettlementListV2 = z.infer<typeof LoyaltySaleSettlementListV2Schema>;
// New presentation states are opt-in: an already open v1 UI keeps its strict
// response contract during an API-first deployment.
const presentationVersion = z.literal('2').optional();
export const LoyaltySaleSettlementQuerySchema = z.strictObject({ cursor: objectId.optional(), limit: z.coerce.number().int().min(1).max(30).default(20), presentationVersion });
export type LoyaltySaleSettlementQuery = z.infer<typeof LoyaltySaleSettlementQuerySchema>;

export const LoyaltySaleSettlementReadQuerySchema = z.strictObject({ resolutionId: z.uuid().optional(), presentationVersion });
export type LoyaltySaleSettlementReadQuery = z.infer<typeof LoyaltySaleSettlementReadQuerySchema>;
