import { z } from 'zod';

export const ORDER_PUSH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ORDER_PUSH_MAX_SUBSCRIPTIONS = 5;
export const ORDER_PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'] as const;

/** Frontière réseau commune à l'inscription et à chaque envoi. */
export function isOrderPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return value === value.trim() && value.length <= 2048 && url.protocol === 'https:' && !url.port
      && !url.username && !url.password && !url.hash && url.pathname.length > 1
      && (ORDER_PUSH_HOSTS as readonly string[]).includes(url.hostname);
  } catch { return false; }
}

export const OrderPushEndpointSchema = z.string().max(2048).refine(isOrderPushEndpoint, 'Service de notification non pris en charge');
export const OrderPushSubscriptionSchema = z.object({
  endpoint: OrderPushEndpointSchema,
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }).strict(),
}).strict();
export type OrderPushSubscription = z.infer<typeof OrderPushSubscriptionSchema>;

export const OrderReadySubscribeSchema = z.object({
  trackingToken: z.string().trim().min(1).max(128),
  subscription: OrderPushSubscriptionSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict();
export type OrderReadySubscribe = z.infer<typeof OrderReadySubscribeSchema>;
export const OrderReadyPreferenceSchema = z.object({
  trackingToken: z.string().trim().min(1).max(128),
  endpoint: OrderPushEndpointSchema,
}).strict();
export type OrderReadyPreference = z.infer<typeof OrderReadyPreferenceSchema>;

export type OrderPushConfigView = { available: boolean; publicKey: string | null };
export type OrderReadyPreferenceView = { state: 'active' | 'sent' | 'off'; expiresAt: string | null; revision: number };

/** Destination publique, sans preuve d'accès ni identifiant de commande. */
export function orderPushTarget(slug: string): string { return `/r/${encodeURIComponent(slug)}/commandes`; }
