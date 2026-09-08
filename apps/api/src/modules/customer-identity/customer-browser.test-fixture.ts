import { vi } from 'vitest';
import type { CustomerIdentityRepository, CustomerSession } from '@sm/customer';

/** Existing use-case fixtures assume a previously confirmed preparation.
 * These stubs do not prove cookie/PG CAS authority: the strict binding and
 * real PostgreSQL suites exercise those boundaries separately. */
export function confirmedCustomerBrowserFixture(browserRef: string, expiresAt: number) {
  return {
    readEnrollment: vi.fn<CustomerIdentityRepository['readEnrollment']>().mockResolvedValue(null),
    prepareEnrollmentKey: vi.fn<CustomerIdentityRepository['prepareEnrollmentKey']>().mockResolvedValue(null),
    readEnrollmentKey: vi.fn<CustomerIdentityRepository['readEnrollmentKey']>().mockResolvedValue(null),
    recordEnrollmentKey: vi.fn<CustomerIdentityRepository['recordEnrollmentKey']>().mockResolvedValue(null),
    prepareEnrollmentAssertion: vi.fn<CustomerIdentityRepository['prepareEnrollmentAssertion']>().mockResolvedValue(null),
    readEnrollmentAssertion: vi.fn<CustomerIdentityRepository['readEnrollmentAssertion']>().mockResolvedValue(null),
    recordEnrollmentAssertion: vi.fn<CustomerIdentityRepository['recordEnrollmentAssertion']>().mockResolvedValue(null),
    issueEnrollmentRecovery: vi.fn<CustomerIdentityRepository['issueEnrollmentRecovery']>().mockResolvedValue(null),
    activateEnrollment: vi.fn<CustomerIdentityRepository['activateEnrollment']>().mockResolvedValue(null),
    recoverEnrollmentActivation: vi.fn<CustomerIdentityRepository['recoverEnrollmentActivation']>().mockResolvedValue(null),
    prepareBrowser: vi.fn<CustomerIdentityRepository['prepareBrowser']>().mockResolvedValue(null),
    issueBrowser: vi.fn<CustomerIdentityRepository['issueBrowser']>().mockResolvedValue(null),
    confirmBrowser: vi.fn<CustomerIdentityRepository['confirmBrowser']>().mockResolvedValue(null),
    restoreBrowser: vi.fn<CustomerIdentityRepository['restoreBrowser']>().mockResolvedValue(null),
    validateBrowser: vi.fn<CustomerIdentityRepository['validateBrowser']>().mockImplementation(async input =>
      input.browserRef === browserRef ? { expiresAt } : null),
  };
}

/** A separate open intention is assumed only by legacy orchestration fixtures.
 * Strict proof/ref and close races are covered by the verification suites. */
export function confirmedCustomerIntentFixture(operationId: string, expiresAt: number) {
  return {
    prepareIntent: vi.fn<CustomerIdentityRepository['prepareIntent']>().mockResolvedValue(null),
    closeIntent: vi.fn<CustomerIdentityRepository['closeIntent']>().mockResolvedValue(null),
    validateIntent: vi.fn<CustomerIdentityRepository['validateIntent']>().mockImplementation(async input =>
      input.operationId === operationId ? { expiresAt } : null),
    resultIntent: vi.fn<CustomerIdentityRepository['resultIntent']>().mockResolvedValue(null),
  };
}

export function approvedCustomerIntentResult(identity: { operationId: string; challengeId: string; checkId: string; expiresAt: number },
  session: CustomerSession): CustomerIdentityRepository['resultIntent'] {
  return async input => input.operationId !== identity.operationId || input.checkId !== identity.checkId ? null
    : { ...identity, state: 'approved', session: input.sessionHash === null ? null : session };
}
