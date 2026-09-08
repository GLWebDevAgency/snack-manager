import { createHash, randomBytes } from 'node:crypto';
import type { CustomerIdentityRepository, CustomerSession } from './port';
import type { EnrollmentBinding } from './enrollment-port';

type Completion = Parameters<CustomerIdentityRepository['completeCheck']>[0] & { expectedCheckId?: string };
const digest = (purpose: string, value: string) => createHash('sha256').update(JSON.stringify([purpose, value])).digest('hex');
/** Repository-fixture only: traverses EVERY real protection transaction. Key
 * verification is an injected upstream boundary, not a WebAuthn browser proof.
 * Existing concurrency tests retain their selected public attempt UUID as the
 * activation UUID; no additional or synthetic Verify check is inserted. */
export async function completeCustomerTestAccount(repo: CustomerIdentityRepository, input: Completion): Promise<CustomerSession | null> {
  const { parentRef, tenantRef, browserRef, browserHash, operationId, proofHash, checkId } = input;
  const binding: EnrollmentBinding = { parentRef, tenantRef, browserRef, browserHash, operationId, proofHash, checkId };
  const activationId = input.expectedCheckId ?? checkId;
  const recovered = await repo.recoverEnrollmentActivation({ ...binding, activationId, sessionHash: input.sessionHash });
  if (recovered) return recovered;
  const result = await repo.completeCheck(input);
  if (!result || result.kind === 'session') return result?.session ?? null;
  const registration = await repo.prepareEnrollmentKey({ ...binding, registrationId: checkId,
    origin: 'https://customer.fixture', rpId: 'customer.fixture', challenge: randomBytes(32).toString('base64url'),
    userHandle: randomBytes(32).toString('base64url') });
  if (!registration) return null;
  const recorded = await repo.recordEnrollmentKey({ ...binding, registrationId: checkId, requestHash: digest('registration', input.requestHash),
    credential: { credentialId: Buffer.from(digest('credential', input.accountId), 'hex').toString('base64url'), publicKey: new Uint8Array([1, 2, 3]),
      counter: 0, deviceType: 'multiDevice', backedUp: true, transports: ['internal'] } });
  if (!recorded) return null;
  const assertion = await repo.prepareEnrollmentAssertion({ ...binding, assertionId: input.sessionId,
    origin: registration.origin, rpId: registration.rpId, challenge: randomBytes(32).toString('base64url') });
  if (!assertion || !await repo.recordEnrollmentAssertion({ ...binding, assertionId: assertion.assertionId,
    requestHash: digest('assertion', input.requestHash), credentialId: assertion.credential.credentialId,
    counter: 0, deviceType: 'multiDevice', backedUp: true })) return null;
  const code = await repo.issueEnrollmentRecovery({ ...binding, rotationId: input.accountId, expectedVersion: 0, codeHash: input.sessionHash });
  if (!code) return null;
  return repo.activateEnrollment({ ...binding, activationId, requestHash: digest('activation', input.requestHash), recoveryVersion: 1,
    codeHash: input.sessionHash, accountId: input.accountId, sessionId: input.sessionId, sessionHash: input.sessionHash, sessionExpiresAt: input.sessionExpiresAt });
}
