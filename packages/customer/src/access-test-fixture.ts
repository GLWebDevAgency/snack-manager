import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CustomerScope, VerificationReservation } from './port';
import type { PostgresCustomerIdentityRepository } from './repository';
import { confirmCustomerTestBrowser, prepareCustomerTestIntent } from './browser-test-fixture';
import { completeCustomerTestAccount } from './enrollment-test-fixture';
import type { EnrollmentPasskey } from './enrollment-port';
export const accessTestHash = () => randomBytes(32).toString('hex');
export const accessTestToken = () => randomBytes(32).toString('base64url');
export async function prepareAccessTestIntent(repo: PostgresCustomerIdentityRepository, scope: CustomerScope,
  browser?: { browserRef: string; browserHash: string }) {
  const input = { parentRef: scope.parentRef, tenantRef: scope.tenantRef,
    browserRef: browser?.browserRef ?? randomUUID(), browserHash: browser?.browserHash ?? accessTestHash(),
    operationId: randomUUID(), proofHash: accessTestHash(), attemptId: randomUUID() };
  await confirmCustomerTestBrowser(repo, input); await prepareCustomerTestIntent(repo, input); return input;
}
/** Full real repository enrollment. Only the upstream cryptographic verifier
 * is simulated, exactly as in the existing account fixture. No raw account seed. */
export async function protectedAccessTestAccount(repo: PostgresCustomerIdentityRepository, admin: Pool, patch: Partial<CustomerScope> = {}) {
  const now = Date.now();
  const input: VerificationReservation = { parentRef: `parent_${accessTestHash()}`, tenantRef: `tenant_${accessTestHash()}`, ...patch,
    browserRef: randomUUID(), browserHash: accessTestHash(), operationId: randomUUID(), proofHash: accessTestHash(), requestHash: accessTestHash(),
    challengeId: randomUUID(), phoneHash: accessTestHash(), globalPhoneHash: accessTestHash(), ipHash: accessTestHash(), encryptedPhone: 'fixture-encrypted-phone',
    serviceSid: `VA${randomBytes(16).toString('hex')}`, evidenceReference: 'fixture', planExpiresAt: now + 600_000, expiresAt: now + 600_000, now,
    limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1, freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } };
  await confirmCustomerTestBrowser(repo, input); await prepareCustomerTestIntent(repo, input);
  if ((await repo.reserve(input)).kind !== 'reserved') throw new Error('Fixture admission failed');
  await repo.settleSend({ ...input, verificationSid: `VE${randomBytes(16).toString('hex')}` });
  const check = { ...input, checkId: randomUUID(), requestHash: accessTestHash() };
  if (!await repo.claimCheck(check)) throw new Error('Fixture claim failed');
  const completion = { ...check, result: 'approved' as const, accountId: randomUUID(), sessionId: randomUUID(),
    sessionHash: accessTestHash(), sessionExpiresAt: now + 604_800_000, existingSessionHash: null };
  const session = await completeCustomerTestAccount(repo, completion);
  if (!session) throw new Error('Fixture protection failed');
  const key = (await admin.query<{ credential_id: string; public_key: Buffer; counter: string; user_handle: string; rp_id: string }>(
    'SELECT credential_id,public_key,counter,user_handle,rp_id FROM customer.passkey_credentials WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3',
    [input.parentRef, input.tenantRef, completion.accountId])).rows[0]!;
  const credential: EnrollmentPasskey = { credentialId: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter),
    deviceType: 'multiDevice', backedUp: true, transports: ['internal'] };
  return { input, completion, session, credential, userHandle: key.user_handle, origin: `https://${key.rp_id}`, rpId: key.rp_id,
    codeHash: completion.sessionHash,
    selection: { ...input, sessionHash: completion.sessionHash, expectedOperationId: input.operationId, expectedCheckId: check.checkId } };
}
