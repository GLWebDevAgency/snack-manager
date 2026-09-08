import { CustomerPasskeyAssertionOptionsSchema, CustomerPasskeyLoginResponseSchema,
  type CustomerPasskeyLoginRequest, type CustomerPasskeyLoginResponse } from '@sm/contracts';
import { PasskeyVerificationError, type VerifiedPasskeyAssertion } from './passkey-verifier.port';
import { customerAccessNonce, customerCredentialContext, refuseCredentialAccess, type CustomerCredentialAccessPort } from './customer-credential-access.port';

/** Discoverable-key login. The signature is checked outside SQL locks; its
 * immutable claim, credential counter and account version are rechecked by the
 * repository before a session is published. No phone or SMS is consulted. */
export async function loginCustomerPasskey(port: CustomerCredentialAccessPort, request: CustomerPasskeyLoginRequest): Promise<CustomerPasskeyLoginResponse> {
  const context = customerCredentialContext(port), { repository, binding } = port;
  const { token, sessionHash } = context.token('passkey', binding.attemptId);
  await port.browser();
  async function result() {
    const saved = await repository.resultPasskeyLogin({ ...binding, sessionHash });
    if (!saved) return null;
    if (saved.operationId !== binding.operationId || saved.attemptId !== binding.attemptId
      || ['closed', 'expired'].includes(saved.state)) return refuseCredentialAccess();
    if (saved.state === 'approved') return CustomerPasskeyLoginResponseSchema.parse(
      await context.finished(saved.session, token, binding.attemptId));
    if (saved.session !== null || saved.expiresAt <= port.now()) return refuseCredentialAccess();
    return CustomerPasskeyLoginResponseSchema.parse({ state: saved.state, operationId: saved.operationId,
      attemptId: saved.attemptId, expiresAt: saved.expiresAt });
  }
  const prior = await result();
  if (prior && prior.state !== 'unresolved') return prior;
  if (request.step === 'result') {
    if (prior) return prior;
    const intent = await port.intent();
    return { state: 'unresolved', operationId: binding.operationId, attemptId: binding.attemptId, expiresAt: intent.expiresAt };
  }
  await port.intent();
  if (request.step === 'options') {
    const saved = await repository.preparePasskeyLogin({ ...binding, ...context.scope,
      sourceHash: context.sourceHash, challenge: customerAccessNonce() });
    if (!saved || saved.operationId !== binding.operationId || saved.attemptId !== binding.attemptId
      || saved.origin !== context.scope.origin || saved.rpId !== context.scope.rpId || saved.expiresAt <= port.now()) return refuseCredentialAccess();
    const options = CustomerPasskeyAssertionOptionsSchema.parse(await port.verifier.authenticationOptions({ ...context.scope,
      challenge: saved.challenge, allowCredentials: [] }));
    await port.intent();
    if (saved.expiresAt <= port.now()) return refuseCredentialAccess();
    return { state: 'options', operationId: binding.operationId, attemptId: binding.attemptId, expiresAt: saved.expiresAt, options };
  }
  const requestHash = context.hash('customer-passkey-login-assertion.v1', request);
  const claim = await repository.claimPasskeyLogin({ ...binding, requestHash, credentialId: request.response.id,
    userHandle: request.response.response.userHandle });
  if (!claim) return await result() ?? refuseCredentialAccess();
  if (claim.operationId !== binding.operationId || claim.attemptId !== binding.attemptId || claim.origin !== context.scope.origin
    || claim.rpId !== context.scope.rpId || claim.expiresAt <= port.now()) return refuseCredentialAccess();
  let assertion: VerifiedPasskeyAssertion | null = null;
  try {
    assertion = await port.verifier.verifyAuthentication({ ...context.scope, challenge: claim.challenge, response: request.response,
      credential: { credentialId: claim.credential.credentialId, publicKey: claim.credential.publicKey,
        counter: claim.credential.counter, transports: claim.credential.transports, userHandle: claim.userHandle } });
  } catch (error) {
    // A known invalid signature is terminal. Unexpected infrastructure failures
    // leave the durable claim uncertain; they never authorize another assertion.
    if (!(error instanceof PasskeyVerificationError)) throw error;
  }
  const session = await repository.completePasskeyLogin({ ...binding, ...await context.candidate(sessionHash), requestHash, assertion });
  if (session) return CustomerPasskeyLoginResponseSchema.parse(await context.finished(session, token, binding.attemptId));
  return await result() ?? refuseCredentialAccess();
}
