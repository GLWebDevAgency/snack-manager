import { describe, expect, it } from 'vitest';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes,
  CustomerVerificationPublicResultSchema, CustomerVerificationResultSchema } from './customer-account';

const id = '10000000-0000-4000-8000-000000000001';
const proof = 'A'.repeat(43);
const selection = { operationId: id, challengeId: id, checkId: id, expiresAt: 1_900_000_000_000 };
const view = { expiresAt: 1_900_000_000_000, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: 1_800_000_000_000, revision: 0 } };

describe('verification intent contracts', () => {
  it('keeps the candidate proof exclusively on the signed server envelope', () => {
    const request = { step: 'prepare', operationId: id };
    expect(CustomerAccountBrowserRequests.intent.safeParse({ ...request, candidateProof: proof }).success).toBe(false);
    expect(CustomerAccountEnvelopes.intent.safeParse({ request, browserRef: id, browserSecret: proof, candidateProof: proof }).success).toBe(true);
    expect(CustomerAccountEnvelopes.intent.safeParse({ request: { ...request, step: 'close' }, browserRef: id, browserSecret: proof, candidateProof: proof }).success).toBe(false);
  });
  it('requires an exact operation for checks and never asks a recovery reader for an OTP', () => {
    expect(CustomerAccountBrowserRequests.check.safeParse({ challengeId: id, checkId: id, code: '123456' }).success).toBe(false);
    expect(CustomerAccountBrowserRequests.recover.safeParse({ operationId: id, checkId: null }).success).toBe(true);
    expect(CustomerAccountBrowserRequests.recover.safeParse({ operationId: id, checkId: id, code: '123456' }).success).toBe(false);
  });
  it('never admits private data or tokens in unresolved states', () => {
    for (const state of ['unresolved', 'incorrect', 'closed', 'expired', 'failed']) {
      expect(CustomerVerificationResultSchema.safeParse({ ...selection, state }).success).toBe(true);
      expect(CustomerVerificationResultSchema.safeParse({ ...selection, state, view }).success).toBe(false);
      expect(CustomerVerificationPublicResultSchema.safeParse({ ...selection, state, token: proof }).success).toBe(false);
    }
  });
  it('publishes only the approved projection, with exact check and no raw session token', () => {
    const result = { ...selection, state: 'approved', view };
    expect(CustomerVerificationPublicResultSchema.safeParse(result).success).toBe(true);
    expect(CustomerVerificationPublicResultSchema.safeParse({ ...result, token: proof }).success).toBe(false);
    expect(CustomerVerificationResultSchema.safeParse({ ...result, token: proof }).success).toBe(true);
    expect(CustomerVerificationPublicResultSchema.safeParse({ ...result, checkId: null }).success).toBe(false);
  });
});
