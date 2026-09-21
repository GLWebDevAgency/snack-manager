import { z } from 'zod';
import { OrderRewardSelectionSchema } from './order-reward';

import { DeliveryRequestSchema, FulfillmentSchema } from './delivery';
import { PublicOrderRecoveryProofSchema } from './order-recovery';

/** Shared order inputs without barrel imports. Public and authenticated
 * checkout reuse these exact schemas regardless of CommonJS import order. */
export const PAYMENT_METHODS = ['online', 'counter'] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;


export const OrderLineInputSchema = z.object({
  productId: z.string().min(1),
  variantKey: z.string().optional(),
  options: z
    .array(z.object({ groupKey: z.string(), choiceKey: z.string() }))
    .default([]),
  /**
   * Les retraits « sans oignons » — BORNÉS, comme la note deux lignes plus bas.
   *
   * C'était un tableau sans longueur de chaînes sans longueur, recopié tel quel
   * sur la commande et imprimé tel quel sur le ticket cuisine. Un appel direct
   * envoyait donc mille lignes de mille caractères vers l'imprimante du
   * comptoir — et la note, elle, était plafonnée à deux cents caractères depuis
   * toujours dans le même schéma.
   */
  removed: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  note: z.string().max(200).optional(),
  /**
   * Un plafond haut, mais un plafond.
   *
   * Sans lui, un appel anonyme posait `qty: 1000000` sur un tacos à 8,90 € et
   * créait une commande à 8 900 000 € qui partait en cuisine. Cinquante est
   * au-delà de toute commande de comptoir réelle et en deçà de l'absurde ; une
   * commande de groupe se saisit en plusieurs lignes.
   */
  qty: z.number().int().positive().max(50).default(1),
});
export type OrderLineInput = z.infer<typeof OrderLineInputSchema>;

export const PickupQuoteRequestSchema = z.strictObject({
  lines: z.array(OrderLineInputSchema.strict()).min(1).max(50),
  promoCode: z.string().trim().min(1).max(24).optional(), reward: OrderRewardSelectionSchema.optional(),
});
export type PickupQuoteRequest = z.infer<typeof PickupQuoteRequestSchema>;
export const PickupQuoteSchema = z.strictObject({
  fulfillment: z.literal('pickup'), originalSubtotalCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(), totalCents: z.number().int().nonnegative(),
  discount: z.strictObject({ amount: z.number().int().nonnegative(), reason: z.string() }).nullable(),
});
export type PickupQuote = z.infer<typeof PickupQuoteSchema>;


export const CreatePublicOrderSchema = z
  .object({
    clientId: z.uuid(),
    /** Facultatif seulement pour compatibilité des anciens navigateurs. */
    recoveryProof: PublicOrderRecoveryProofSchema.optional(),
    /** Absent pour les anciens clients : retrait au restaurant. */
    fulfillment: FulfillmentSchema.optional(),
    delivery: DeliveryRequestSchema.optional(),
    lines: z.array(OrderLineInputSchema.strict()).min(1).max(50),
    payment: z
      .object({
        /** Intention du client ; le statut reste toujours calcule serveur. */
        method: PaymentMethodSchema,
      })
      .strict(),
    pickup: z
      .object({
        slot: z.iso.datetime(),
        customerName: z.string().trim().min(2).max(80),
        customerPhone: z.string().trim().min(6).max(32),
      })
      .strict(),
    note: z.string().trim().max(500).optional(),
    reward: OrderRewardSelectionSchema.optional(),
    expectedTotalCents: z.number().int().nonnegative().max(100_000_000).optional(),
    promoCode: z.string().trim().min(1).max(24).optional(),
    /** Jeton Cloudflare Turnstile : 2 048 caracteres maximum selon Siteverify. */
    turnstileToken: z.string().min(1).max(2_048),
  })
  .strict().superRefine((order, ctx) => {
    if (order.reward && order.clientId !== order.clientId.toLowerCase()) ctx.addIssue({ code: 'custom', path: ['clientId'], message: 'Identifiant de commande non canonique.' });
    if (order.reward && order.promoCode) ctx.addIssue({ code: 'custom', path: ['reward'], message: 'Choisissez une récompense ou un code promotionnel.' });
    const delivery = order.fulfillment === 'delivery';
    if (delivery !== (order.delivery !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['delivery'], message: 'Une adresse est requise uniquement pour une livraison' });
    }
    if (delivery && order.payment.method !== 'online') {
      ctx.addIssue({ code: 'custom', path: ['payment', 'method'], message: 'La livraison nécessite un paiement en ligne' });
    }
  });
export type CreatePublicOrder = z.infer<typeof CreatePublicOrderSchema>;
