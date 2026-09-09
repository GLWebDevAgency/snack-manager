import { CustomerRecoveryGrantSchema, CustomerRecoveryResponseSchema, CustomerPasskeyRegistrationOptionsSchema,
  CustomerPasskeyAssertionOptionsSchema, type CustomerRecoveryRequest, type CustomerRecoveryResponse } from '@sm/contracts';
import { createRecoveryCode, recoveryCodeHash } from '@sm/customer';
import { customerAccessNonce, customerCredentialContext, refuseCredentialAccess, type CustomerCredentialAccessPort } from './customer-credential-access.port';

/** A saved code admits only bounded re-protection. No account/profile/session
 * is exposed until a new asserted key and replacement code commit together. */
export async function recoverCustomerAccount(port: CustomerCredentialAccessPort, request: CustomerRecoveryRequest): Promise<CustomerRecoveryResponse> {
  const context = customerCredentialContext(port), { repository, binding } = port;
  await port.browser();
  if (request.step === 'activation-result' || request.step === 'activate') {
    const { token, sessionHash } = context.token('recovery', request.activationId);
    const current = await repository.recoverAccountRecoveryActivation({ ...binding, activationId: request.activationId, sessionHash });
    if (current) return CustomerRecoveryResponseSchema.parse(await context.finished(current, token, request.activationId));
    if (request.step === 'activation-result') return refuseCredentialAccess();
  }
  await port.intent();
  async function grant() {
    const value = await repository.readAccountRecovery(binding);
    if (!value || value.state !== 'granted') return refuseCredentialAccess();
    const result = CustomerRecoveryGrantSchema.parse(value.grant);
    if (result.operationId !== binding.operationId || result.attemptId !== binding.attemptId || result.expiresAt <= port.now()) return refuseCredentialAccess();
    return result;
  }
  let result: Exclude<CustomerRecoveryResponse, { state: 'authenticated' }>;
  switch (request.step) {
    case 'begin': {
      const value = await repository.beginAccountRecovery({ ...binding, sourceHash: context.sourceHash,
        requestHash: context.hash('customer-account-recovery-begin.v1', request), codeHash: recoveryCodeHash(port.crypto, binding, request.code) });
      if (!value || value.operationId !== binding.operationId || value.attemptId !== binding.attemptId || value.expiresAt <= port.now()
        || value.state === 'closed' || value.state === 'expired') return refuseCredentialAccess();
      result = value.state === 'granted' ? { state: 'recovery', recovery: await grant() }
        : { state: 'failed', operationId: binding.operationId, attemptId: binding.attemptId, expiresAt: value.expiresAt };
      break;
    }
    case 'state': {
      const value = await repository.readAccountRecovery(binding);
      if (value?.state === 'granted') result = { state: 'recovery', recovery: await grant() };
      else {
        if (value && (value.operationId !== binding.operationId || value.attemptId !== binding.attemptId || value.expiresAt <= port.now()
          || value.state === 'closed' || value.state === 'expired')) return refuseCredentialAccess();
        result = { state: value ? 'failed' : 'unresolved', operationId: binding.operationId,
          attemptId: binding.attemptId, expiresAt: value?.expiresAt ?? (await port.intent()).expiresAt };
      }
      break;
    }
    case 'registration-options': {
      const saved = await repository.prepareRecoveryKey({ ...binding, ...context.scope, registrationId: request.registrationId,
        challenge: customerAccessNonce(), userHandle: customerAccessNonce() });
      if (!saved || saved.registrationId !== request.registrationId || saved.origin !== context.scope.origin || saved.rpId !== context.scope.rpId
        || saved.expiresAt <= port.now()) return refuseCredentialAccess();
      const options = CustomerPasskeyRegistrationOptionsSchema.parse(await port.verifier.registrationOptions({ ...context.scope,
        rpName: 'Compte restaurant', challenge: saved.challenge, userHandle: saved.userHandle }));
      result = { state: 'registration-options', registrationId: request.registrationId, options, recovery: await grant() }; break;
    }
    case 'register': {
      const saved = await repository.readRecoveryKey({ ...binding, registrationId: request.registrationId });
      if (!saved || saved.registrationId !== request.registrationId || saved.origin !== context.scope.origin || saved.rpId !== context.scope.rpId
        || saved.expiresAt <= port.now()) return refuseCredentialAccess();
      const credential = await port.verifier.verifyRegistration({ ...context.scope, challenge: saved.challenge, response: request.response });
      const changed = await repository.recordRecoveryKey({ ...binding, registrationId: request.registrationId, credential,
        requestHash: context.hash('customer-account-recovery-registration.v1', request) });
      if (!changed) return refuseCredentialAccess();
      result = { state: 'recovery', recovery: CustomerRecoveryGrantSchema.parse(changed) }; break;
    }
    case 'assertion-options': {
      const saved = await repository.prepareRecoveryAssertion({ ...binding, ...context.scope, assertionId: request.assertionId, challenge: customerAccessNonce() });
      if (!saved || saved.assertionId !== request.assertionId || saved.origin !== context.scope.origin || saved.rpId !== context.scope.rpId
        || saved.expiresAt <= port.now()) return refuseCredentialAccess();
      const options = CustomerPasskeyAssertionOptionsSchema.parse(await port.verifier.authenticationOptions({ ...context.scope, challenge: saved.challenge,
        allowCredentials: [{ credentialId: saved.credential.credentialId, transports: saved.credential.transports }] }));
      result = { state: 'assertion-options', assertionId: request.assertionId, options, recovery: await grant() }; break;
    }
    case 'assert': {
      const saved = await repository.readRecoveryAssertion({ ...binding, assertionId: request.assertionId });
      if (!saved || saved.assertionId !== request.assertionId || saved.origin !== context.scope.origin || saved.rpId !== context.scope.rpId
        || saved.expiresAt <= port.now()) return refuseCredentialAccess();
      const verified = await port.verifier.verifyAuthentication({ ...context.scope, challenge: saved.challenge, response: request.response,
        credential: { credentialId: saved.credential.credentialId, publicKey: saved.credential.publicKey,
          counter: saved.credential.counter, transports: saved.credential.transports, userHandle: saved.userHandle } });
      const changed = await repository.recordRecoveryAssertion({ ...binding, assertionId: request.assertionId, ...verified,
        requestHash: context.hash('customer-account-recovery-assertion.v1', request) });
      if (!changed) return refuseCredentialAccess();
      result = { state: 'recovery', recovery: CustomerRecoveryGrantSchema.parse(changed) }; break;
    }
    case 'recovery-code': {
      const candidate = createRecoveryCode();
      const saved = await repository.issueRecoveryReplacement({ ...binding, rotationId: request.rotationId,
        expectedVersion: request.expectedVersion, codeHash: recoveryCodeHash(port.crypto, binding, candidate) });
      if (!saved || saved.grant.recoveryVersion !== request.expectedVersion + 1) return refuseCredentialAccess();
      result = { state: 'recovery-code', recovery: CustomerRecoveryGrantSchema.parse(saved.grant), code: saved.emitCode ? candidate : null }; break;
    }
    case 'activate': {
      const { token, sessionHash } = context.token('recovery', request.activationId);
      const session = await repository.activateAccountRecovery({ ...binding, ...await context.candidate(sessionHash),
        activationId: request.activationId, recoveryVersion: request.recoveryVersion,
        requestHash: context.hash('customer-account-recovery-activation.v1', request), codeHash: recoveryCodeHash(port.crypto, binding, request.code) });
      return CustomerRecoveryResponseSchema.parse(await context.finished(session, token, request.activationId));
    }
    default: return refuseCredentialAccess();
  }
  await port.intent();
  if ('recovery' in result) {
    if (result.recovery.operationId !== binding.operationId || result.recovery.attemptId !== binding.attemptId
      || result.recovery.expiresAt <= port.now()) return refuseCredentialAccess();
  } else if (result.expiresAt <= port.now()) return refuseCredentialAccess();
  return CustomerRecoveryResponseSchema.parse(result);
}
