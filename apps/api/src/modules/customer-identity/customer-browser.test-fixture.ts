import { vi } from 'vitest';
import type { CustomerIdentityRepository } from '@sm/customer';

/** Existing use-case fixtures assume a previously confirmed preparation.
 * These stubs do not prove cookie/PG CAS authority: the strict binding and
 * real PostgreSQL suites exercise those boundaries separately. */
export function confirmedCustomerBrowserFixture(browserRef: string, expiresAt: number) {
  return {
    prepareBrowser: vi.fn<CustomerIdentityRepository['prepareBrowser']>().mockResolvedValue(null),
    issueBrowser: vi.fn<CustomerIdentityRepository['issueBrowser']>().mockResolvedValue(null),
    confirmBrowser: vi.fn<CustomerIdentityRepository['confirmBrowser']>().mockResolvedValue(null),
    validateBrowser: vi.fn<CustomerIdentityRepository['validateBrowser']>().mockImplementation(async input =>
      input.browserRef === browserRef ? { expiresAt } : null),
  };
}
