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
  /**
   * Panier minimum, en centimes. `0` = aucune condition.
   *
   * Absent du modèle d'origine, et c'est le champ qui manquait le plus : sans
   * lui, « 5 € offerts » s'applique à une commande de 5,50 €. Le restaurateur
   * ne l'apprend pas d'une alerte — il l'apprend de sa marge.
   */
  minSubtotalCents: z.number().int().min(0),
  /**
   * Plafond de la remise, en centimes. `0` = non plafonnée.
   *
   * Le garde-fou d'un pourcentage : « −50 % » sur une commande de groupe à
   * 200 € coûte cent euros. Un plafond transforme une offre d'appel en offre
   * d'appel bornée.
   */
  maxDiscountCents: z.number().int().min(0),
  /** Nombre d'utilisations autorisées. `0` = illimité. */
  maxUsage: z.number().int().min(0),
  /**
   * Le produit offert — `offered_item` seulement.
   *
   * Sans lui, la nature était INAPPLICABLE par construction : le formulaire
   * proposait « produit offert » et le modèle ne disait jamais lequel.
   */
  offeredProductId: z.string().trim().min(1).nullable(),
};

const promoRules = (
  v: {
    kind?: PromoKind;
    value?: number;
    startsAt?: Date | null;
    endsAt?: Date | null;
    offeredProductId?: string | null;
    maxDiscountCents?: number;
    code?: string | null;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.kind === 'percent' && (v.value ?? 0) > 100) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'Un pourcentage ne dépasse pas 100' });
  }
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Fin antérieure au début' });
  }
  // Une offre « produit offert » sans produit désigné ne peut RIEN offrir : le
  // refus vient ici plutôt qu'au moment de la commande, où il serait découvert
  // par un client à qui l'offre a été promise.
  if (v.kind === 'offered_item' && !v.offeredProductId) {
    ctx.addIssue({
      code: 'custom',
      path: ['offeredProductId'],
      message: 'Choisissez le produit offert',
    });
  }
  // Un pourcentage à 100 % sans plafond, c'est la commande entière offerte à
  // qui connaît le code. On l'autorise — c'est parfois voulu — mais jamais
  // pour une offre publique dont le code circule.
  if (v.kind === 'percent' && v.value === 100 && !v.maxDiscountCents && v.code) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxDiscountCents'],
      message: 'Une offre à 100 % avec un code public demande un plafond',
    });
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
    minSubtotalCents: promoShape.minSubtotalCents.default(0),
    maxDiscountCents: promoShape.maxDiscountCents.default(0),
    maxUsage: promoShape.maxUsage.default(0),
    offeredProductId: promoShape.offeredProductId.default(null),
  })
  .superRefine(promoRules);
export type PromotionCreate = z.infer<typeof PromotionCreateSchema>;

export const PromotionUpdateSchema = z.object(promoShape).partial().superRefine(promoRules);
export type PromotionUpdate = z.infer<typeof PromotionUpdateSchema>;

export const ReviewReplySchema = z.object({
  text: z.string().trim().min(1, 'Réponse vide').max(1000),
});
export type ReviewReply = z.infer<typeof ReviewReplySchema>;
