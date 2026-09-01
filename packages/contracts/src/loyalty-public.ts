import { z } from 'zod';
import {
  LoyaltyMechanismSchema,
  LoyaltyRewardKindSchema,
} from './loyalty';
// Import de valeur : `marque.ts` n'importe rien de `loyalty-public.ts`, pas de cycle.
import { BrandSchema } from './marque';

export const LOYALTY_QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Le secret QR voyage uniquement dans le corps d'un POST, jamais dans l'URL. */
export const LoyaltyCustomerCardResolveSchema = z
  .object({ qrToken: z.string().regex(LOYALTY_QR_TOKEN_PATTERN) })
  .strict();
export type LoyaltyCustomerCardResolve = z.infer<
  typeof LoyaltyCustomerCardResolveSchema
>;

/** Catalogue public avant authentification de la carte, sans donnée membre. */
export const LoyaltyPublicProgramSchema = z
  .object({
    restaurant: z
      .object({
        slug: z.string(),
        name: z.string(),
        brand: BrandSchema,
        brandColor: z.string(),
        logoUrl: z.string().nullable(),
      })
      .strict(),
    program: z
      .object({
        name: z.string(),
        mechanism: LoyaltyMechanismSchema,
        unitLabelSingular: z.string(),
        unitLabelPlural: z.string(),
        termsSummary: z.string(),
      })
      .strict(),
    rewards: z.array(
      z
        .object({
          id: z.string().uuid(),
          name: z.string(),
          description: z.string(),
          costUnits: z.number().int().positive(),
          kind: LoyaltyRewardKindSchema,
          valueCents: z.number().int().positive().nullable(),
          productRef: z.string().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type LoyaltyPublicProgram = z.infer<typeof LoyaltyPublicProgramSchema>;

/**
 * Accepte le secret brut lu par un scanner ou une deep-link dont le fragment
 * n'est jamais envoyé au serveur HTTP. Les query strings sont volontairement
 * refusées : elles finissent dans les journaux, historiques et analytics.
 */
export function loyaltyTokenFromQrPayload(
  payload: string,
  expectedSlug?: string,
): string | null {
  const raw = payload.trim();
  if (LOYALTY_QR_TOKEN_PATTERN.test(raw)) return raw;
  if (raw.length === 0 || raw.length > 2_048) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.search) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (
      parts.length !== 3 ||
      parts[0] !== 'r' ||
      parts[2] !== 'fidelite' ||
      (expectedSlug !== undefined && parts[1] !== expectedSlug)
    ) {
      return null;
    }
    const fragment = new URLSearchParams(url.hash.slice(1));
    const token = fragment.get('card');
    return token && LOYALTY_QR_TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function loyaltyCardDeepLink(
  origin: string,
  slug: string,
  qrToken: string,
): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug)) {
    throw new Error('Slug fidélité invalide');
  }
  if (!LOYALTY_QR_TOKEN_PATTERN.test(qrToken)) {
    throw new Error('Jeton fidélité invalide');
  }
  const url = new URL(`/r/${slug}/fidelite`, origin);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Origine fidélité invalide');
  }
  url.search = '';
  url.hash = `card=${qrToken}`;
  return url.toString();
}
