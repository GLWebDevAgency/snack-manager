import type { CustomerAccountAction } from './customer-account';

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
