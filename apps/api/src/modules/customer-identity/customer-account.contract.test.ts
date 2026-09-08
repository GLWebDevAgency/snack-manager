import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes, CustomerAccountResponses,
  CustomerAccountViewSchema } from '@sm/contracts';

describe('customer browser DTO versus private relay envelope', () => {
  it.each(['browserSecret', 'sessionToken', 'tenantRef', 'humanVerified', 'clientIp', 'policy', 'accountId'])('never accepts server authority %s in browser DTOs', field => {
    const request = { phone: '+33612345678', operationId: randomUUID(), turnstileToken: 'fixture-human-token' };
    expect(CustomerAccountBrowserRequests.start.safeParse({ ...request, [field]: 'forged' }).success).toBe(false);
  });
  it('accepts canonical 32-byte capabilities and rejects a noncanonical alias', () => {
    for (let i = 0; i < 32; i++) {
      const token = randomBytes(32).toString('base64url');
      expect(CustomerAccountEnvelopes.session.safeParse({ sessionToken: token, request: {} }).success).toBe(true);
    }
    const token = Buffer.alloc(32).toString('base64url');
    expect(CustomerAccountEnvelopes.session.safeParse({ sessionToken: `${token.slice(0, -1)}B`, request: {} }).success).toBe(false);
  });
  it('does not accept OTP fields in recover or a QR in place of a session', () => {
    const request = { challengeId: randomUUID(), checkId: randomUUID() };
    expect(CustomerAccountBrowserRequests.recover.safeParse(request).success).toBe(true);
    expect(CustomerAccountBrowserRequests.recover.safeParse({ ...request, code: '123456' }).success).toBe(false);
    expect(CustomerAccountEnvelopes.session.safeParse({ sessionToken: 'sm-loyalty:fixture', request: {} }).success).toBe(false);
  });
  it('requires versioned name updates and exact logout intent', () => {
    expect(CustomerAccountBrowserRequests.name.safeParse({ name: 'Fixture' }).success).toBe(false);
    expect(CustomerAccountBrowserRequests.name.safeParse({ name: null, expectedRevision: 0 }).success).toBe(true);
    expect(CustomerAccountBrowserRequests.logout.safeParse({}).success).toBe(false);
  });
  it('rejects private identifiers or capability fields in the public profile view', () => {
    const view = { expiresAt: Date.now() + 604_800_000,
      profile: { name: null, phoneE164: '+33612345678', phoneVerifiedAt: Date.now(), revision: 0 } };
    expect(CustomerAccountViewSchema.safeParse(view).success).toBe(true);
    expect(CustomerAccountViewSchema.safeParse({ ...view, sessionId: randomUUID() }).success).toBe(false);
    expect(CustomerAccountViewSchema.safeParse({ ...view, profile: { ...view.profile, accountId: randomUUID() } }).success).toBe(false);
    expect(CustomerAccountResponses.check.safeParse({ token: randomBytes(32).toString('base64url'), view }).success).toBe(true);
    expect(CustomerAccountResponses.session.safeParse({ ...view, token: randomBytes(32).toString('base64url') }).success).toBe(false);
  });
});
