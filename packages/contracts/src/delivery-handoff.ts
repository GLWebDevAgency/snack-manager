import { z } from 'zod';
import { PublicOrderRecoveryProofSchema } from './order-recovery';

const id = z.string().regex(/^[a-f0-9]{24}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const DELIVERY_HANDOFF_MAX_OPERATIONS = 64;
export const DELIVERY_HANDOFF_MAX_FAILURES = 5;
export const DELIVERY_HANDOFF_TTL_MS = 24 * 60 * 60 * 1_000;
export const DELIVERY_HANDOFF_INCIDENT_CODES = ['customer_absent', 'unreachable', 'address_issue', 'proof_unavailable', 'customer_refused'] as const;
export const DeliveryHandoffIncidentCodeSchema = z.enum(DELIVERY_HANDOFF_INCIDENT_CODES);
export const DeliveryHandoffActionSchema = z.enum(['handoff', 'incident', 'override', 'rotate']);
export type DeliveryHandoffAction = z.infer<typeof DeliveryHandoffActionSchema>;

/** Separate capability already held by the purchaser; a tracking/loyalty QR is not authorization. */
export const DeliveryProofRequestSchema = z.object({ clientId: z.uuid(), recoveryProof: PublicOrderRecoveryProofSchema }).strict();
export type DeliveryProofRequest = z.infer<typeof DeliveryProofRequestSchema>;
export const DeliveryHandoffQrSchema = z.string().regex(/^sm-handoff:v1:[a-f0-9]{24}:[a-f0-9-]{36}:[A-Za-z0-9_-]{43}$/);
export const DeliveryHandoffProofSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pin'), value: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ kind: z.literal('qr'), value: DeliveryHandoffQrSchema }).strict(),
]);
export type DeliveryHandoffProof = z.infer<typeof DeliveryHandoffProofSchema>;
export const DeliveryHandoffOperationSchema = z.object({
  operationId: z.uuid(), expectedRevision: revision, expectedMissionRevision: revision,
}).strict();
export const DeliveryHandoffSubmitSchema = DeliveryHandoffOperationSchema.extend({ proof: DeliveryHandoffProofSchema }).strict();
export type DeliveryHandoffSubmit = z.infer<typeof DeliveryHandoffSubmitSchema>;
export const DeliveryHandoffIncidentSchema = DeliveryHandoffOperationSchema.extend({ code: DeliveryHandoffIncidentCodeSchema }).strict();
export type DeliveryHandoffIncident = z.infer<typeof DeliveryHandoffIncidentSchema>;
export const DeliveryHandoffReasonSchema = DeliveryHandoffOperationSchema.extend({ reason: z.string().trim().min(10).max(300) }).strict();
export type DeliveryHandoffReason = z.infer<typeof DeliveryHandoffReasonSchema>;
/** POST recovery must write a tombstone when absent; GET absence cannot fence an old request. */
export const DeliveryHandoffResolveSchema = DeliveryHandoffOperationSchema.extend({ action: DeliveryHandoffActionSchema }).strict();
export type DeliveryHandoffResolve = z.infer<typeof DeliveryHandoffResolveSchema>;

/** No PIN, QR, customer contact, free-text reason or bank identifiers in work/recovery views. */
export const DeliveryHandoffStateSchema = z.object({
  missionId: id, revision, missionRevision: revision,
  orderStatus: z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']),
  proof: z.object({ id: z.uuid(), expiresAt: z.iso.datetime(), locked: z.boolean() }).strict().nullable(),
  incident: z.object({ code: DeliveryHandoffIncidentCodeSchema, reportedAt: z.iso.datetime() }).strict().nullable(),
  canHandoff: z.boolean(), canOverride: z.boolean(), canRotate: z.boolean(),
}).strict();
export type DeliveryHandoffState = z.infer<typeof DeliveryHandoffStateSchema>;
export const DELIVERY_HANDOFF_REFUSAL_CODES = [
  'invalid', 'closed', 'not_departed', 'payment_blocked', 'proof_unavailable', 'proof_expired',
  'proof_locked', 'proof_incorrect', 'incident_required', 'operator_changed', 'abandoned',
] as const;
export const DeliveryHandoffRefusalCodeSchema = z.enum(DELIVERY_HANDOFF_REFUSAL_CODES);
export type DeliveryHandoffRefusalCode = z.infer<typeof DeliveryHandoffRefusalCodeSchema>;
const resultBase = z.object({
  missionId: id, operationId: z.uuid(), action: DeliveryHandoffActionSchema,
  appliedRevision: revision, replay: z.boolean(), state: DeliveryHandoffStateSchema,
}).strict();
export const DeliveryHandoffResultSchema = z.discriminatedUnion('outcome', [
  resultBase.extend({ outcome: z.literal('applied'), refusalCode: z.null() }).strict(),
  resultBase.extend({ outcome: z.literal('rejected'), refusalCode: DeliveryHandoffRefusalCodeSchema }).strict(),
  resultBase.extend({ outcome: z.literal('abandoned'), refusalCode: z.literal('abandoned') }).strict(),
]);
export type DeliveryHandoffResult = z.infer<typeof DeliveryHandoffResultSchema>;
export const DeliveryCustomerProofSchema = z.object({
  missionId: id, proofId: z.uuid(), pin: z.string().regex(/^\d{6}$/), qr: DeliveryHandoffQrSchema,
  expiresAt: z.iso.datetime(),
}).strict();
export type DeliveryCustomerProof = z.infer<typeof DeliveryCustomerProofSchema>;

/** The scanner accepts only our exact bounded payload; never navigate to an arbitrary scanned URL. */
export function parseDeliveryHandoffQr(raw: unknown): { orderId: string; proofId: string; token: string } | null {
  const parsed = DeliveryHandoffQrSchema.safeParse(raw);
  if (!parsed.success) return null;
  const [, , orderId, proofId, token] = parsed.data.split(':');
  if (!orderId || !proofId || !token || !z.uuid().safeParse(proofId).success) return null;
  return { orderId, proofId, token };
}
