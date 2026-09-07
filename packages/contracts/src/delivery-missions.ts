import { z } from 'zod';
import { DeliveryAddressSchema } from './delivery';

const id = z.string().regex(/^[a-f0-9]{24}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const at = z.iso.datetime();
export const DELIVERY_MISSION_PAGE_SIZE = 50;
export const DELIVERY_MISSION_MAX_OPERATIONS = 128;

export const DeliveryMissionsQuerySchema = z.object({ after: id.optional() }).strict();
export type DeliveryMissionsQuery = z.infer<typeof DeliveryMissionsQuerySchema>;

/** UUID durable pour la même intention ; ne jamais en recréer sur un timeout. */
export const DeliveryMissionDispatchSchema = z.object({
  operationId: z.uuid(), expectedRevision: revision,
}).strict();
export type DeliveryMissionDispatch = z.infer<typeof DeliveryMissionDispatchSchema>;

export const DeliveryMissionAssignSchema = DeliveryMissionDispatchSchema.extend({
  operatorId: id.nullable(),
  /** Révision de l'accès choisi, relue par le serveur avant affectation. */
  expectedOperatorRevision: revision.nullable(),
  reason: z.string().trim().min(3).max(200),
}).strict().refine(value => (value.operatorId === null) === (value.expectedOperatorRevision === null), {
  message: 'Choisissez un accès actuel ou retirez explicitement l’affectation.',
});
export type DeliveryMissionAssign = z.infer<typeof DeliveryMissionAssignSchema>;

/** Projection de travail dédiée, jamais le document Order, ni un secret de suivi. */
export const DeliveryMissionViewSchema = z.object({
  id, number: z.number().int().positive(), createdAt: at, scheduledAt: at.nullable(),
  orderStatus: z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']),
  revision,
  operator: z.object({ id, name: z.string().min(1).max(160) }).strict().nullable(),
  assignmentId: z.uuid().nullable(), assignedAt: at.nullable(), dispatchedAt: at.nullable(),
  paymentReady: z.boolean(), canAssign: z.boolean(), canDispatch: z.boolean(),
  customer: z.object({ name: z.string().max(160), phone: z.string().max(40).nullable() }).strict(),
  address: DeliveryAddressSchema,
  instructions: z.string().max(300).nullable(),
  items: z.array(z.object({ name: z.string().max(200), variantName: z.string().max(200).nullable(), qty: z.number().int().positive() }).strict()).max(200),
}).strict();
export type DeliveryMissionView = z.infer<typeof DeliveryMissionViewSchema>;

export const DeliveryMissionsViewSchema = z.object({
  missions: z.array(DeliveryMissionViewSchema).max(DELIVERY_MISSION_PAGE_SIZE),
  nextCursor: id.nullable(),
}).strict();
export type DeliveryMissionsView = z.infer<typeof DeliveryMissionsViewSchema>;

export const DELIVERY_MISSION_REFUSAL_CODES = [
  'delivery.mission.invalid', 'delivery.mission.closed', 'delivery.mission.departed',
  'delivery.mission.unassigned', 'delivery.mission.not_ready', 'delivery.mission.payment_blocked',
  'DELIVERY_OPERATOR_CHANGED',
] as const;
export const DeliveryMissionRefusalCodeSchema = z.enum(DELIVERY_MISSION_REFUSAL_CODES);
export type DeliveryMissionRefusalCode = z.infer<typeof DeliveryMissionRefusalCodeSchema>;

/** Retour courant, pas une ancienne photographie susceptible de réaffecter la mission. */
const resultBase = z.object({
  operationId: z.uuid(), appliedRevision: revision, replay: z.boolean(), mission: DeliveryMissionViewSchema,
}).strict();
/** Un refus acquitté consomme aussi la révision : un ancien POST ne peut plus agir. */
export const DeliveryMissionResultSchema = z.discriminatedUnion('outcome', [
  resultBase.extend({ outcome: z.literal('applied'), refusalCode: z.null() }).strict(),
  resultBase.extend({ outcome: z.literal('rejected'), refusalCode: DeliveryMissionRefusalCodeSchema }).strict(),
]);
export type DeliveryMissionResult = z.infer<typeof DeliveryMissionResultSchema>;
