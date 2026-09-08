import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes, CustomerAccountResponses, CustomerCheckPublicResponseSchema,
  CustomerProtectionPublicResponseSchema, customerAccountRequestLimit } from './customer-account';

const operationId = randomUUID(), checkId = randomUUID();
const enrollment = { operationId, checkId, expiresAt: 1_900_000_000_000, stage: 'registration_required', recoveryVersion: 0 };
const token = 'A'.repeat(43);
describe('protected registration transport boundary', () => {
  it('accepts provisional proof without a token, profile or publication', () => {
    const result = { state: 'enrollment', enrollment };
    expect(CustomerAccountResponses.check.parse(result)).toEqual(result);
    expect(CustomerCheckPublicResponseSchema.parse(result)).toEqual(result);
    expect(CustomerProtectionPublicResponseSchema.parse(result)).toEqual(result);
  });
  it.each(['token', 'view', 'accountId', 'phone', 'publication'])('rejects private %s injected into provisional enrollment', key => {
    expect(CustomerAccountResponses.check.safeParse({ state: 'enrollment', enrollment, [key]: token }).success).toBe(false);
    expect(CustomerAccountResponses.check.safeParse({ state: 'enrollment', enrollment: { ...enrollment, [key]: token } }).success).toBe(false);
  });
  it.each(['sessionToken', 'browserSecret', 'intentProof', 'tenantRef', 'rpId', 'origin'])('never accepts browser authority %s', key => {
    expect(CustomerAccountBrowserRequests.protection.safeParse({ step: 'state', operationId, checkId, [key]: token }).success).toBe(false);
  });
  it('binds the server envelope to the three independent browser/intention inputs', () => {
    const body = { browserRef: randomUUID(), browserSecret: token, intentProof: token, request: { step: 'state', operationId, checkId } };
    expect(CustomerAccountEnvelopes.protection.parse(body)).toEqual(body);
    for (const field of ['browserRef', 'browserSecret', 'intentProof']) {
      expect(CustomerAccountEnvelopes.protection.safeParse({ ...body, [field]: null }).success).toBe(false);
    }
  });
  it('does not overload an old approved or token-only check result', () => {
    expect(CustomerAccountResponses.check.safeParse({ token, view: {} }).success).toBe(false);
    expect(CustomerAccountResponses.check.safeParse({ state: 'approved', token, view: {} }).success).toBe(false);
  });
  it('uses bounded explicit commands, never a client account or generic next-step blob', () => {
    for (const step of ['state', 'registration-options', 'register', 'assertion-options', 'assert', 'recovery-code', 'activate', 'activation-result']) {
      expect(CustomerAccountBrowserRequests.protection.safeParse({ step, operationId, checkId, arbitrary: {} }).success).toBe(false);
    }
    expect(CustomerAccountBrowserRequests.protection.safeParse({ step: 'recovery-code', operationId, checkId, rotationId: randomUUID(), expectedVersion: 3 }).success).toBe(false);
    expect(CustomerAccountBrowserRequests.protection.safeParse({ step: 'activate', operationId, checkId, activationId: randomUUID(), recoveryVersion: 1, code: 'x'.repeat(129) }).success).toBe(false);
  });
  it('allows a larger bounded proof only on protection, not all account actions', () => {
    expect(customerAccountRequestLimit('protection')).toBe(65_536);
    for (const action of ['browser', 'start', 'check', 'intent', 'recover', 'session', 'name', 'logout'] as const) expect(customerAccountRequestLimit(action)).toBe(4096);
  });
  it('never leaks the private final token in the public protection DTO', () => {
    const response = { state: 'authenticated', operationId, activationId: randomUUID(), token,
      view: { expiresAt: enrollment.expiresAt, profile: { name: null, phoneE164: '+33612345678', phoneVerifiedAt: 1_800_000_000_000, revision: 0 } } };
    expect(CustomerAccountResponses.protection.safeParse(response).success).toBe(true);
    expect(CustomerProtectionPublicResponseSchema.safeParse(response).success).toBe(false);
    const { token: _secret, ...publicResponse } = response;
    expect(CustomerProtectionPublicResponseSchema.parse(publicResponse)).toEqual(publicResponse);
  });
});
