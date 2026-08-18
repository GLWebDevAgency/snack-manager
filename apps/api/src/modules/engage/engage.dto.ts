import { z } from 'zod';

/**
 * DTO zod locaux au module Engage (promos + avis) — pas dans @sm/contracts,
 * décision mission : le périmètre est interne au back-office gérant.
 * Rappel conventions : montants en CENTIMES (int), tenantId JAMAIS dans le body.
 */

export const PROMO_KINDS = ['percent', 'amount', 'offered_item'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const PROMO_CHANNELS = ['online', 'pos', 'phone'] as const;
export type PromoChannel = (typeof PROMO_CHANNELS)[number];

/** Code promo : 2-24 caractères alphanumériques, normalisé en MAJUSCULES. */
const promoCode = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{2,24}$/, 'Code invalide (2-24 caractères, lettres/chiffres)')
  .transform((s) => s.toUpperCase());

/**
 * Champs SANS défauts : les défauts ne s'appliquent qu'à la création — sur un
 * PATCH partiel ils réinitialiseraient silencieusement les champs absents.
 */
const promoShape = {
  name: z.string().trim().min(1, 'Nom requis').max(80),
  description: z.string().trim().max(200),
  kind: z.enum(PROMO_KINDS),
  /** percent : 0-100 · amount : CENTIMES · offered_item : ignoré (0). */
  value: z.number().int().min(0),
  code: promoCode.nullable(),
  channels: z.array(z.enum(PROMO_CHANNELS)).min(1, 'Au moins un canal'),
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  active: z.boolean(),
};

const promoRules = (
  v: { kind?: PromoKind; value?: number; startsAt?: Date | null; endsAt?: Date | null },
  ctx: z.RefinementCtx,
) => {
  if (v.kind === 'percent' && (v.value ?? 0) > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Un pourcentage ne dépasse pas 100' });
  }
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Fin antérieure au début' });
  }
};

export const PromotionCreateSchema = z
  .object({
    ...promoShape,
    description: promoShape.description.default(''),
    value: promoShape.value.default(0),
    code: promoShape.code.default(null),
    channels: promoShape.channels.default(['online', 'pos']),
    startsAt: promoShape.startsAt.default(null),
    endsAt: promoShape.endsAt.default(null),
    active: promoShape.active.default(true),
  })
  .superRefine(promoRules);
export type PromotionCreate = z.infer<typeof PromotionCreateSchema>;

export const PromotionUpdateSchema = z.object(promoShape).partial().superRefine(promoRules);
export type PromotionUpdate = z.infer<typeof PromotionUpdateSchema>;

export const ReviewReplySchema = z.object({
  text: z.string().trim().min(1, 'Réponse vide').max(1000),
});
export type ReviewReply = z.infer<typeof ReviewReplySchema>;
