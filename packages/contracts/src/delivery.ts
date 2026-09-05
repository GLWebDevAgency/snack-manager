import { z } from 'zod';

export const FulfillmentSchema = z.enum(['pickup', 'delivery']);
export type Fulfillment = z.infer<typeof FulfillmentSchema>;

export const DeliveryAddressSchema = z.object({
  line1: z.string().trim().min(5, 'Adresse complète obligatoire').max(160),
  line2: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().regex(/^\d{5}$/, 'Code postal à 5 chiffres'),
  city: z.string().trim().min(2).max(100),
  country: z.literal('FR'),
}).strict();
export type DeliveryAddress = z.infer<typeof DeliveryAddressSchema>;

export const DeliveryRequestSchema = z.object({
  address: DeliveryAddressSchema,
  instructions: z.string().trim().max(300).optional(),
}).strict();
export type DeliveryRequest = z.infer<typeof DeliveryRequestSchema>;

export const DeliveryZoneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/),
  name: z.string().trim().min(2).max(60),
  postalCodes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(100),
  feeCents: z.number().int().min(0).max(10_000),
  minimumOrderCents: z.number().int().min(0).max(100_000),
  /** Seuil NET après promotion, hors frais. Null/absent conserve les frais fixes. */
  freeDeliveryFromCents: z.number().int().positive().max(100_000).nullable().optional(),
}).strict();
export type DeliveryZone = z.infer<typeof DeliveryZoneSchema>;

export const DeliverySettingsSchema = z.object({
  enabled: z.boolean(),
  zones: z.array(DeliveryZoneSchema).max(30),
  /** Préparation et trajet compris ; le créneau est une heure de remise estimée. */
  leadTimeMin: z.number().int().min(20).max(180),
  slotCapacity: z.number().int().min(1).max(50),
}).strict().superRefine((settings, ctx) => {
  if (settings.enabled && settings.zones.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['zones'], message: 'Ajoutez une zone avant d’activer la livraison' });
  }
  const ids = new Set<string>();
  const codes = new Set<string>();
  settings.zones.forEach((zone, index) => {
    if (ids.has(zone.id)) ctx.addIssue({ code: 'custom', path: ['zones', index, 'id'], message: 'Identifiant de zone déjà utilisé' });
    ids.add(zone.id);
    for (const code of zone.postalCodes) {
      if (codes.has(code)) ctx.addIssue({ code: 'custom', path: ['zones', index, 'postalCodes'], message: `Le code postal ${code} figure déjà dans une zone` });
      codes.add(code);
    }
  });
});
export type DeliverySettings = z.infer<typeof DeliverySettingsSchema>;
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = { enabled: false, zones: [], leadTimeMin: 45, slotCapacity: 2 };

export interface PublicDeliverySettings {
  available: boolean;
  zones: DeliveryZone[];
  leadTimeMin: number;
  paymentRequired: 'online';
}

export interface DeliveryQuote {
  zoneId: string;
  zoneName: string;
  feeCents: number;
  /** Tarif configuré avant une éventuelle gratuité ; feeCents reste le montant effectif. */
  standardFeeCents?: number;
  freeDeliveryFromCents?: number | null;
  /** Null sans seuil ; zéro si déjà gratuite ; sinon montant net manquant. */
  remainingForFreeDeliveryCents?: number | null;
  minimumOrderCents: number;
  /** Produits NETS après promotion, hors frais ; quota revérifié à la création. */
  subtotalCents: number;
  /** Sous-total des produits avant remise ; facultatif pour les anciennes réponses. */
  originalSubtotalCents?: number;
  /** Promotion informative, jamais une réservation ni un identifiant interne public. */
  discount?: { amount: number; reason: string } | null;
  totalCents: number;
  estimatedMinutes: number;
}

export const DeliveryDispatchSchema = z.object({
  driverName: z.string().trim().min(2).max(80).optional(),
}).strict();
export type DeliveryDispatch = z.infer<typeof DeliveryDispatchSchema>;

/** Snapshot figé lors de la vente ; jamais recalculé après un changement de tarif. */
export interface OrderDelivery extends DeliveryRequest {
  zoneId: string;
  zoneName: string;
  feeCents: number;
  estimatedMinutes: number;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  driverName: string | null;
}
