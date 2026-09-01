import { LOYALTY_QR_TOKEN_PATTERN } from "@sm/contracts";

export const LOYALTY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
export { LOYALTY_QR_TOKEN_PATTERN };

export function loyaltyCardCookieName(slug: string): string {
  return `sm_loyalty_${slug}`;
}

export function loyaltyCardCookiePath(slug: string): string {
  return `/r/${slug}/fidelite`;
}
