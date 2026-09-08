import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CustomerEnrollmentSchema, CustomerProtectionResponseSchema, CustomerPasskeyRegistrationOptionsSchema,
  CustomerPasskeyAssertionOptionsSchema, type CustomerProtectionRequest,
  type CustomerProtectionResponse, type CustomerAccountView } from '@sm/contracts';
import { createRecoveryCode, recoveryCodeHash, type CustomerIdentityCrypto, type CustomerIdentityRepository,
  type CustomerSession, type EnrollmentBinding } from '@sm/customer';
import type { PasskeyVerifier } from './passkey-verifier.port';

export class CustomerProtectionError extends Error {
  constructor() { super('Protection du compte invalide ou expirée.'); this.name = 'CustomerProtectionError'; }
}
type Port = {
  repository: Pick<CustomerIdentityRepository, 'readEnrollment' | 'prepareEnrollmentKey' | 'readEnrollmentKey' | 'recordEnrollmentKey'
    | 'prepareEnrollmentAssertion' | 'readEnrollmentAssertion' | 'recordEnrollmentAssertion' | 'issueEnrollmentRecovery'
    | 'activateEnrollment' | 'recoverEnrollmentActivation'>; crypto: CustomerIdentityCrypto; verifier: PasskeyVerifier;
  binding: EnrollmentBinding; browserSecret: string; intentProof: string; origin: string;
  now: () => number; browser: () => Promise<{ expiresAt: number }>;
  intent: () => Promise<{ expiresAt: number }>; view: (session: CustomerSession) => Promise<CustomerAccountView>;
};
const opaque = () => randomBytes(32).toString('base64url');

/** Durable protection only: no provider, no profile before atomic activation.
 * Cryptographic work is outside SQL locks; repository CAS rechecks all authority
 * and deadlines before storing its result. A result read never repeats a write. */
export async function protectCustomerEnrollment(port: Port, request: CustomerProtectionRequest): Promise<CustomerProtectionResponse> {
  const { repository, binding, crypto } = port;
  const fail = (): never => { throw new CustomerProtectionError(); };
  const origin = new URL(port.origin);
  if (origin.protocol !== 'https:' || origin.origin !== port.origin || origin.username || origin.password) fail();
  const scope = { origin: origin.origin, rpId: origin.hostname };
  const hash = (purpose: string, body: unknown) => crypto.hash('request', binding.tenantRef,
    JSON.stringify([purpose, binding.operationId, binding.checkId, createHash('sha256').update(JSON.stringify(body)).digest('hex')]));
  const enrollment = async () => {
    const value = CustomerEnrollmentSchema.parse(await repository.readEnrollment(binding));
    if (value.operationId !== binding.operationId || value.checkId !== binding.checkId || value.expiresAt <= port.now()) fail();
    return value;
  };
  const finished = async (session: CustomerSession | null, activationId: string, token: string) => {
    if (!session) return fail();
    return CustomerProtectionResponseSchema.parse({ state: 'authenticated', operationId: binding.operationId,
      activationId, token, view: await port.view(session) });
  };
  const tokenFor = (id: string) => crypto.tokenForProtectedPublication(binding.tenantRef, port.browserSecret,
    binding.operationId, port.intentProof, 'passkey', id);

  await port.browser();
  // Consumed intentions are valid only for an exact, still-current receipt.
  if (request.step === 'activation-result' || request.step === 'activate') {
    const token = tokenFor(request.activationId);
    const saved = await repository.recoverEnrollmentActivation({ ...binding, activationId: request.activationId,
      sessionHash: crypto.hash('session', binding.tenantRef, token) });
    if (saved) return finished(saved, request.activationId, token);
    if (request.step === 'activation-result') return fail();
  }
  await port.intent();
  let result: Exclude<CustomerProtectionResponse, { state: 'authenticated' }>;
  switch (request.step) {
    case 'state': result = { state: 'enrollment', enrollment: await enrollment() }; break;
    case 'registration-options': {
      const saved = await repository.prepareEnrollmentKey({ ...binding, ...scope, registrationId: request.registrationId,
        challenge: opaque(), userHandle: opaque() });
      if (!saved || saved.registrationId !== request.registrationId || saved.origin !== scope.origin || saved.rpId !== scope.rpId
        || saved.expiresAt <= port.now()) return fail();
      const options = CustomerPasskeyRegistrationOptionsSchema.parse(await port.verifier.registrationOptions({ ...scope, challenge: saved.challenge,
        userHandle: saved.userHandle, rpName: 'Compte restaurant' }));
      result = { state: 'registration-options', registrationId: request.registrationId, options, enrollment: await enrollment() }; break;
    }
    case 'register': {
      const saved = await repository.readEnrollmentKey({ ...binding, registrationId: request.registrationId });
      if (!saved || saved.registrationId !== request.registrationId || saved.origin !== scope.origin || saved.rpId !== scope.rpId
        || saved.expiresAt <= port.now()) return fail();
      const credential = await port.verifier.verifyRegistration({ ...scope, challenge: saved.challenge, response: request.response });
      const changed = await repository.recordEnrollmentKey({ ...binding, registrationId: request.registrationId,
        requestHash: hash('customer-enrollment-registration-v1', request), credential });
      if (!changed) return fail();
      result = { state: 'enrollment', enrollment: changed }; break;
    }
    case 'assertion-options': {
      const saved = await repository.prepareEnrollmentAssertion({ ...binding, ...scope, assertionId: request.assertionId, challenge: opaque() });
      if (!saved || saved.assertionId !== request.assertionId || saved.origin !== scope.origin || saved.rpId !== scope.rpId
        || saved.expiresAt <= port.now()) return fail();
      const options = CustomerPasskeyAssertionOptionsSchema.parse(await port.verifier.authenticationOptions({ ...scope, challenge: saved.challenge,
        allowCredentials: [{ credentialId: saved.credential.credentialId, transports: saved.credential.transports }] }));
      result = { state: 'assertion-options', assertionId: request.assertionId, options, enrollment: await enrollment() }; break;
    }
    case 'assert': {
      const saved = await repository.readEnrollmentAssertion({ ...binding, assertionId: request.assertionId });
      if (!saved || saved.assertionId !== request.assertionId || saved.origin !== scope.origin || saved.rpId !== scope.rpId
        || saved.expiresAt <= port.now()) return fail();
      const verified = await port.verifier.verifyAuthentication({ ...scope, challenge: saved.challenge,
        response: request.response, credential: { credentialId: saved.credential.credentialId,
          publicKey: saved.credential.publicKey, counter: saved.credential.counter, userHandle: saved.userHandle,
          transports: saved.credential.transports } });
      const changed = await repository.recordEnrollmentAssertion({ ...binding, assertionId: request.assertionId,
        requestHash: hash('customer-enrollment-assertion-v1', request), ...verified });
      if (!changed) return fail();
      result = { state: 'enrollment', enrollment: changed }; break;
    }
    case 'recovery-code': {
      const candidate = createRecoveryCode();
      const saved = await repository.issueEnrollmentRecovery({ ...binding, rotationId: request.rotationId,
        expectedVersion: request.expectedVersion, codeHash: recoveryCodeHash(crypto, binding, candidate) });
      if (!saved || saved.enrollment.recoveryVersion !== request.expectedVersion + 1) return fail();
      result = { state: 'recovery-code', enrollment: saved.enrollment, code: saved.emitCode ? candidate : null }; break;
    }
    case 'activate': {
      const browser = await port.browser();
      const token = tokenFor(request.activationId);
      const session = await repository.activateEnrollment({ ...binding, activationId: request.activationId,
        requestHash: hash('customer-enrollment-activation-v1', request), recoveryVersion: request.recoveryVersion,
        codeHash: recoveryCodeHash(crypto, binding, request.code), accountId: randomUUID(), sessionId: randomUUID(),
        sessionHash: crypto.hash('session', binding.tenantRef, token), sessionExpiresAt: Math.min(browser.expiresAt, port.now() + 604_800_000) });
      return finished(session, request.activationId, token);
    }
    default: return fail();
  }
  await port.intent();
  if (result.enrollment.expiresAt <= port.now()) return fail();
  return CustomerProtectionResponseSchema.parse(result);
}
