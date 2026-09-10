import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerAccountBrowserRequests, CustomerAccountEnvelopes, CustomerAccountResponses, customerAccountResponseLimit } from './customer-account';
import { CUSTOMER_LOYALTY_NOTICE_VERSION, CustomerLoyaltyRequestSchema, CustomerLoyaltyResponseSchema } from './customer-loyalty';

const join = () => ({ step: 'join' as const, operationId: randomUUID(), programId: randomUUID(), rulesVersion: 1,
  termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true });
describe('protected customer loyalty transport', () => {
  it.each(['界', '\u0001'])('fits the largest valid terms and labels in the bounded JSON response (%j)', character => {
    const response = { state: 'available', expiresAt: Date.now() + 60_000, profileReady: true,
      program: { id: randomUUID(), version: Number.MAX_SAFE_INTEGER, name: character.repeat(160), mechanism: 'points',
        termsSummary: character.repeat(6000), unitLabelSingular: character.repeat(80), unitLabelPlural: character.repeat(80) } };
    expect(CustomerLoyaltyResponseSchema.safeParse(response).success).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThan(customerAccountResponseLimit('loyalty'));
  });
  it('accepts explicit enrollment and strictly separates read from QR disclosure', () => {
    for (const request of [join(), { step: 'view' }, { step: 'card' }]) expect(CustomerLoyaltyRequestSchema.safeParse(request).success).toBe(true);
    expect(CustomerAccountBrowserRequests.loyalty).toBe(CustomerLoyaltyRequestSchema);
    expect(CustomerAccountResponses.loyalty).toBe(CustomerLoyaltyResponseSchema);
  });
  it.each(['phone', 'phoneHash', 'accountId', 'memberId', 'parentRef', 'tenantRef', 'qrToken', 'balanceUnits', 'marketingConsent'])
    ('refuses browser-supplied authority or unintended consent: %s', field => {
      expect(CustomerLoyaltyRequestSchema.safeParse({ ...join(), [field]: 'untrusted' }).success).toBe(false);
    });
  it('requires exact current notice and explicit true, not implicit or stale consent', () => {
    const { termsAccepted: _accepted, ...missing } = join();
    expect(CustomerLoyaltyRequestSchema.safeParse(missing).success).toBe(false);
    for (const patch of [{ termsAccepted: false }, { termsAccepted: 'true' }, { termsNoticeVersion: 'old' }, { rulesVersion: 0 }]) {
      expect(CustomerLoyaltyRequestSchema.safeParse({ ...join(), ...patch }).success).toBe(false);
    }
  });
  it('requires the complete private browser/session publication envelope', () => {
    const token = Buffer.alloc(32, 12).toString('base64url');
    const envelope = { browserRef: randomUUID(), browserSecret: token, sessionToken: token,
      expectedOperationId: randomUUID(), expectedCheckId: randomUUID(), request: join() };
    expect(CustomerAccountEnvelopes.loyalty.safeParse(envelope).success).toBe(true);
    for (const key of ['browserRef', 'browserSecret', 'sessionToken', 'expectedOperationId', 'expectedCheckId'] as const) {
      const incomplete = { ...envelope }; delete (incomplete as Partial<typeof envelope>)[key];
      expect(CustomerAccountEnvelopes.loyalty.safeParse(incomplete).success).toBe(false);
    }
  });
  it('does not leak a QR in join/member/failure responses', () => {
    const expiresAt = Date.now() + 60_000;
    const member = { id: randomUUID(), joinedAt: new Date().toISOString(), qrGeneration: 1, balanceUnits: 0,
      unitLabelSingular: 'point', unitLabelPlural: 'points' };
    const qrToken = Buffer.alloc(32, 15).toString('base64url');
    expect(CustomerLoyaltyResponseSchema.safeParse({ state: 'member', expiresAt, member }).success).toBe(true);
    expect(CustomerLoyaltyResponseSchema.safeParse({ state: 'member', expiresAt, member, qrToken }).success).toBe(false);
    expect(CustomerLoyaltyResponseSchema.safeParse({ state: 'card', expiresAt, member, qrToken }).success).toBe(true);
    for (const state of ['unavailable', 'name_required', 'existing_card', 'conflict']) {
      expect(CustomerLoyaltyResponseSchema.safeParse({ state, expiresAt, member, qrToken }).success).toBe(false);
    }
  });
});
