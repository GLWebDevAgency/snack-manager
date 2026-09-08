import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes, CustomerAccountResponses, CustomerPasskeyLoginPublicResponseSchema,
  CustomerRecoveryPublicResponseSchema, customerAccountRequestLimit } from './customer-account';

const operationId = randomUUID(), attemptId = randomUUID();
const opaque = () => randomBytes(32).toString('base64url');
const grant = { operationId, attemptId, expiresAt: Date.now() + 600_000, stage: 'registration_required', recoveryVersion: 0 };
describe('credential access public contract', () => {
  it.each(['passkey', 'recovery'] as const)('binds %s to the exact private browser/intention envelope', action => {
    const request = { step: action === 'passkey' ? 'result' : 'state', operationId, attemptId };
    const body = { browserRef: randomUUID(), browserSecret: opaque(), intentProof: opaque(), request };
    expect(CustomerAccountEnvelopes[action].safeParse(body).success).toBe(true);
    for (const name of ['browserRef', 'browserSecret', 'intentProof']) expect(CustomerAccountEnvelopes[action].safeParse({ ...body, [name]: null }).success).toBe(false);
    for (const field of ['accountId', 'sourceHash', 'phone', 'origin', 'rpId', 'sessionToken', 'tenantRef', 'checkId']) {
      expect(CustomerAccountBrowserRequests[action].safeParse({ ...request, [field]: opaque() }).success).toBe(false);
    }
  });
  it('requires a discoverable user handle for login, not just a credential ID', () => {
    const response = { id: 'AA', rawId: 'AA', type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: 'AA', authenticatorData: 'AA', signature: 'AA' } };
    const command = { step: 'assert', operationId, attemptId, response };
    expect(CustomerAccountBrowserRequests.passkey.safeParse(command).success).toBe(false);
    expect(CustomerAccountBrowserRequests.passkey.safeParse({ ...command,
      response: { ...response, response: { ...response.response, userHandle: opaque() } } }).success).toBe(true);
  });
  it.each(['token', 'view', 'accountId', 'phoneE164', 'sourceVersion'])('refuses private %s before recovery activation', field => {
    const result = { state: 'recovery', recovery: grant };
    expect(CustomerAccountResponses.recovery.safeParse(result).success).toBe(true);
    expect(CustomerRecoveryPublicResponseSchema.safeParse({ ...result, [field]: opaque() }).success).toBe(false);
    expect(CustomerRecoveryPublicResponseSchema.safeParse({ ...result, recovery: { ...grant, [field]: opaque() } }).success).toBe(false);
  });
  it.each(['passkey', 'recovery'] as const)('exposes an exact %s publication without its credential', action => {
    const result = { state: 'authenticated', operationId, publicationId: randomUUID(), token: opaque(),
      view: { expiresAt: Date.now() + 604_800_000, profile: { name: null, phoneE164: '+33612345678', phoneVerifiedAt: Date.now(), revision: 0 } } };
    const publicSchema = action === 'passkey' ? CustomerPasskeyLoginPublicResponseSchema : CustomerRecoveryPublicResponseSchema;
    expect(CustomerAccountResponses[action].safeParse(result).success).toBe(true);
    expect(publicSchema.safeParse(result).success).toBe(false);
    const { token: _token, ...publicResult } = result;
    expect(publicSchema.parse(publicResult)).toEqual(publicResult);
    expect(publicSchema.safeParse({ ...publicResult, publicationId: undefined }).success).toBe(false);
  });
  it('does not widen simple account action bodies for WebAuthn', () => {
    for (const action of ['protection', 'passkey', 'recovery'] as const) expect(customerAccountRequestLimit(action)).toBe(65_536);
    expect(customerAccountRequestLimit('check')).toBe(4096); expect(customerAccountRequestLimit('name')).toBe(4096);
  });
});
