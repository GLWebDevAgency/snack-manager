import { z } from 'zod';
import { BrandSchema } from './marque';

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const name = z.string().trim().min(2, 'Indiquez au moins 2 caractères').max(80);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Un accès opérationnel, jamais un nouveau rôle caisse ou un compte RH. */
export const DeliveryOperatorCreateSchema = z.object({
  requestId: z.uuid(),
  name: name.optional(),
  staffId: objectId.optional(),
}).strict().refine(value => (value.name !== undefined) !== (value.staffId !== undefined), {
  message: 'Choisissez un équipier existant ou indiquez le nom du livreur.',
});
export type DeliveryOperatorCreate = z.infer<typeof DeliveryOperatorCreateSchema>;

export const DeliveryOperatorUpdateSchema = z.object({
  expectedRevision: revision,
  active: z.boolean(),
}).strict();
export type DeliveryOperatorUpdate = z.infer<typeof DeliveryOperatorUpdateSchema>;

export const DeliveryOperatorInviteSchema = z.object({ expectedRevision: revision }).strict();
export type DeliveryOperatorInvite = z.infer<typeof DeliveryOperatorInviteSchema>;

export const DeliveryOperatorsQuerySchema = z.object({ after: objectId.optional() }).strict();
export type DeliveryOperatorsQuery = z.infer<typeof DeliveryOperatorsQuerySchema>;

export const DeliveryOperatorViewSchema = z.object({
  id: objectId,
  name: z.string().min(1).max(160),
  staffId: objectId.nullable(),
  active: z.boolean(),
  effectiveActive: z.boolean(),
  blockedReason: z.enum(['staff_inactive', 'staff_changed']).nullable(),
  revision,
  sessionState: z.enum(['not_connected', 'connected', 'expired']),
  inviteExpiresAt: z.iso.datetime().nullable(),
}).strict();
export type DeliveryOperatorView = z.infer<typeof DeliveryOperatorViewSchema>;

export const DeliveryOperatorsViewSchema = z.object({
  operators: z.array(DeliveryOperatorViewSchema),
  candidates: z.array(z.object({ id: objectId, name: z.string().min(1).max(160) }).strict()),
  truncated: z.boolean(),
  nextCursor: objectId.nullable().optional(),
}).strict();
export type DeliveryOperatorsView = z.infer<typeof DeliveryOperatorsViewSchema>;

/** 256 bits générés cryptographiquement ; ni PIN à deviner ni identité dans le lien. */
export const DeliveryAccessSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const DeliveryOperatorInvitationSchema = z.object({
  operator: DeliveryOperatorViewSchema,
  token: DeliveryAccessSecretSchema,
  expiresAt: z.iso.datetime(),
}).strict();
export type DeliveryOperatorInvitation = z.infer<typeof DeliveryOperatorInvitationSchema>;

export const DeliverySessionExchangeSchema = z.object({
  token: DeliveryAccessSecretSchema,
  nonce: DeliveryAccessSecretSchema,
}).strict();
export type DeliverySessionExchange = z.infer<typeof DeliverySessionExchangeSchema>;

export const DeliverySessionViewSchema = z.object({
  operatorId: objectId,
  name: z.string().min(1).max(160),
  restaurantName: z.string().min(1).max(160),
  restaurantSlug: z.string().min(1).max(100),
  /** Public restaurant identity only; access credentials never enter this view. */
  brand: BrandSchema.optional(),
  restaurantAddress: z.string().max(200).optional(),
  restaurantPhones: z.array(z.string().max(40)).max(10).optional(),
  expiresAt: z.iso.datetime(),
}).strict();
export type DeliverySessionView = z.infer<typeof DeliverySessionViewSchema>;

export const DELIVERY_INVITE_TTL_MS = 10 * 60 * 1_000;
export const DELIVERY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
