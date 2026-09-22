import type { CustomerAccountAction } from './customer-account';

export const CUSTOMER_ACCOUNT_CLOCK_SKEW_MS = 30_000;

/** Response plausibility only: tolerate a small difference between clocks.
 * Callers still enforce expiry/minimum lifetime and exact receipt bounds.
 * Never change a timestamp, cookie expiry or server-side authorization. */
export function customerAccountTimestampWithinFutureBound(timestamp: number, now: number, maxAheadMs: number): boolean {
  if (![timestamp, now, maxAheadMs].every(value => Number.isSafeInteger(value) && value >= 0)) return false;
  const ahead = timestamp - now;
  // Subtract only after the ordinary bound fails, avoiding overflow when a
  // caller supplies a safe integer close to Number.MAX_SAFE_INTEGER.
  return ahead <= maxAheadMs || ahead - maxAheadMs <= CUSTOMER_ACCOUNT_CLOCK_SKEW_MS;
}

/** HTTP waiting budgets, never OTP validity, spend limits or retry permission.
 * Kept browser/Expo-safe so every client can use the same action boundary. */
export const CUSTOMER_VERIFICATION_TIMING = {
  preflightMs: 10_000,
  settlementMs: 10_000,
  relayPreflightMs: 5_000,
  start: { providerMs: 30_000, apiMs: 50_000, bffMs: 60_000, browserMs: 70_000 },
  check: { providerMs: 10_000, apiMs: 30_000, bffMs: 40_000, browserMs: 50_000 },
} as const;

export function customerAccountRequestTimeoutMs(action: CustomerAccountAction, boundary: 'bff' | 'browser'): number {
  if (action === 'start' || action === 'check') {
    return CUSTOMER_VERIFICATION_TIMING[action][boundary === 'bff' ? 'bffMs' : 'browserMs'];
  }
  return boundary === 'bff' ? 10_000 : 12_000;
}
