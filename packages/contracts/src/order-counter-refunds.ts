import { z } from 'zod';
import { OrderRefundAllocationSchema } from './order-refunds';

const cents = z.number().int().min(0).max(100_000_000);
export const COUNTER_REFUND_DISBURSE_WINDOW_MS = 5 * 60_000;
export const CounterRefundTenderSchema = z.enum(['cash', 'card']);
export const CounterRefundIntentSchema = z.strictObject({
  operationId: z.uuid(), amountCents: cents.positive(), reason: z.string().trim().min(3).max(200),
  tender: CounterRefundTenderSchema, allocation: OrderRefundAllocationSchema,
}).refine(value => value.allocation.merchandiseCents + value.allocation.deliveryCents === value.amountCents,
  { message: 'La ventilation doit correspondre au remboursement.' });
export type CounterRefundIntent = z.infer<typeof CounterRefundIntentSchema>;

export const CounterRefundAuthorizationSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owner_password'), password: z.string().min(1).max(1024) }),
  z.strictObject({ kind: z.literal('manager_pin'), pin: z.string().regex(/^\d{4,6}$/) }),
]);
export const CounterRefundRequestSchema = CounterRefundIntentSchema.safeExtend({
  clientProtocolVersion: z.literal(1), authorization: CounterRefundAuthorizationSchema,
});
export type CounterRefundRequest = z.infer<typeof CounterRefundRequestSchema>;
export const CounterRefundConfirmationSchema = CounterRefundRequestSchema.safeExtend({
  attestation: z.enum(['cash_returned', 'terminal_refund_confirmed']),
}).refine(value => value.attestation === (value.tender === 'cash' ? 'cash_returned' : 'terminal_refund_confirmed'),
  { message: 'Confirmez le moyen de remboursement réellement utilisé.' });
export type CounterRefundConfirmation = z.infer<typeof CounterRefundConfirmationSchema>;
export const CounterRefundNoEffectSchema = CounterRefundRequestSchema.safeExtend({
  attestation: z.literal('no_money_returned'), resolutionReason: z.string().trim().min(3).max(200),
});
export type CounterRefundNoEffect = z.infer<typeof CounterRefundNoEffectSchema>;

const canonicalReason = z.string().min(3).max(200).refine(value => value === value.trim(), { message: 'Le motif du reçu doit être canonique.' });
export const CounterRefundOperationViewSchema = CounterRefundIntentSchema.safeExtend({
  reason: canonicalReason,
  state: z.enum(['prepared', 'started', 'confirmed', 'withdrawn', 'not_executed']),
  preparedAt: z.iso.datetime(), startedAt: z.iso.datetime().nullable(), confirmedAt: z.iso.datetime().nullable(),
  disburseExpiresAt: z.iso.datetime().nullable(),
  resolvedAt: z.iso.datetime().nullable(), resolutionReason: canonicalReason.nullable(), canResume: z.boolean(),
}).refine(operation => {
  const started = ['started', 'confirmed', 'not_executed'].includes(operation.state);
  const resolved = ['withdrawn', 'not_executed'].includes(operation.state);
  if (started !== (operation.startedAt !== null) || started !== (operation.disburseExpiresAt !== null)
    || (operation.state === 'confirmed') !== (operation.confirmedAt !== null)
    || resolved !== (operation.resolvedAt !== null)
    || (operation.state === 'not_executed') !== (operation.resolutionReason !== null)
    || (!['prepared', 'started'].includes(operation.state) && operation.canResume)) return false;
  if (operation.startedAt && (Date.parse(operation.startedAt) < Date.parse(operation.preparedAt)
    || Date.parse(operation.disburseExpiresAt!) - Date.parse(operation.startedAt) !== COUNTER_REFUND_DISBURSE_WINDOW_MS)) return false;
  if (operation.confirmedAt && Date.parse(operation.confirmedAt) < Date.parse(operation.startedAt!)) return false;
  if (operation.resolvedAt && Date.parse(operation.resolvedAt) < Date.parse(operation.startedAt ?? operation.preparedAt)) return false;
  return operation.state !== 'not_executed' || Date.parse(operation.resolvedAt!) >= Date.parse(operation.disburseExpiresAt!);
}, { message: 'Le reçu comptoir ne prouve pas cet état terminal.' });
export type CounterRefundOperationView = z.infer<typeof CounterRefundOperationViewSchema>;
export const CounterRefundJournalSchema = z.strictObject({
  orderId: z.string().regex(/^[a-f0-9]{24}$/), enabled: z.boolean(), available: z.boolean(),
  observedAt: z.iso.datetime(),
  tender: CounterRefundTenderSchema.nullable(),
  unavailableReason: z.enum(['payment_proof_missing', 'unsupported_tender', 'financial_conflict']).nullable(),
  originalPaidCents: cents, refundedCents: cents, pendingRefundCents: cents, remainingCents: cents,
  basis: z.strictObject({ merchandiseCents: cents, deliveryCents: cents }),
  remaining: z.strictObject({ merchandiseCents: cents, deliveryCents: cents }),
  canResolveNoEffect: z.boolean(), operations: z.array(CounterRefundOperationViewSchema).max(128),
});
export type CounterRefundJournal = z.infer<typeof CounterRefundJournalSchema>;
/** A true permission belongs only to the winning start call. Never persist it
 * as an authority to repeat a physical refund after reload or a lost response. */
export const CounterRefundResultSchema = z.strictObject({ journal: CounterRefundJournalSchema, mayDisburse: z.boolean() });
export type CounterRefundResult = z.infer<typeof CounterRefundResultSchema>;
