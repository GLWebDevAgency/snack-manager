import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto } from './crypto';
import { PostgresCustomerIdentityRepository } from './repository';
import { customerTestFixture } from './test-fixture';
import type { PhoneVerificationTransport } from '../../../apps/api/src/modules/customer-identity/phone-verification.port';

// Provider is deliberately simulated; only persistence/transactions are real.
// These tests neither send an OTP nor establish live Twilio entitlement.
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const PHONE = '+33612345678';
const BROWSER = Buffer.alloc(32, 57).toString('base64url');
const crypto = new CustomerIdentityCrypto(Buffer.alloc(32, 22).toString('base64'));

integration('customer use cases with real PostgreSQL and simulated Verify', () => {
  let database: Awaited<ReturnType<typeof customerTestFixture>>;
  let CustomerIdentityService: typeof import('../../../apps/api/src/modules/customer-identity/customer-identity.service').CustomerIdentityService;
  beforeAll(async () => {
    ({ CustomerIdentityService } = await import('../../../apps/api/src/modules/customer-identity/customer-identity.service'));
    database = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
  }, 20_000);
  afterAll(async () => { await database?.close(); });
  function fixture() {
    const tenantRef = `tenant_${randomUUID()}`;
    const parentRef = `AC${randomUUID().replaceAll('-', '')}`;
    const serviceSid = `VA${randomUUID().replaceAll('-', '')}`;
    const now = Date.now();
    const config = { environment: 'staging', parentRef,
      policy: { mode: 'closed_trial', environment: 'staging', accountSid: parentRef, serviceSid,
        tenantRef, allowedPhones: [PHONE], maxSendReservations: 10, expiresAt: now + 86_400_000 },
      evidence: { reference: 'simulated-provider-allowance', accountSid: parentRef, serviceSid,
        accountType: 'Trial', accountStatus: 'active', smsEnabled: true, fraudGuardEnabled: true,
        codeLength: 6, verifiedPhones: [PHONE], freeSmsUnitsRemaining: 10,
        maxTokenValiditySeconds: 600,
        maxSmsSegmentsPerSend: 1, freeVerificationUnitsRemaining: 10,
        observedAt: now, trialExpiresAt: now + 86_400_000 },
    };
    const transport = {
      start: vi.fn<PhoneVerificationTransport['start']>().mockResolvedValue({ verificationSid: `VE${randomUUID().replaceAll('-', '')}` }),
      check: vi.fn<PhoneVerificationTransport['check']>().mockResolvedValue('approved'),
    };
    const repository = new PostgresCustomerIdentityRepository(database.app);
    const service = new CustomerIdentityService(repository, crypto, transport, () => config);
    const start = { tenantRef, phone: PHONE, operationId: randomUUID(), browserSecret: BROWSER,
      clientIp: '127.0.0.1', humanVerified: true };
    const check = (challengeId: string) => ({ tenantRef, challengeId, checkId: randomUUID(),
      browserSecret: BROWSER, code: '123456', existingSessionToken: null });
    return { tenantRef, parentRef, service, repository, transport, start, check };
  }

  it('replays an admission after a lost response, despite a fresh server candidate UUID', async () => {
    const f = fixture();
    const first = await f.service.start(f.start);
    const replay = await f.service.start(f.start);
    expect(replay).toEqual(first);
    expect(f.transport.start).toHaveBeenCalledTimes(1);
  });

  it('creates and restores the exact private session, updates the name, then revokes the receipt', async () => {
    const f = fixture();
    const pending = await f.service.start(f.start);
    const check = f.check(pending.challengeId);
    const first = await f.service.check(check);
    expect(await f.service.check(check)).toEqual(first);
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect(first.view.profile).toMatchObject({ name: null, phoneE164: PHONE, revision: 0 });
    const updated = await f.service.updateName({ tenantRef: f.tenantRef, token: first.token, name: 'Mina', expectedRevision: 0 });
    expect(updated.profile).toMatchObject({ name: 'Mina', revision: 1 });
    expect((await f.service.session({ tenantRef: f.tenantRef, token: first.token })).profile).toEqual(updated.profile);
    await f.service.logout({ tenantRef: f.tenantRef, token: first.token, all: true });
    await expect(f.service.session({ tenantRef: f.tenantRef, token: first.token })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).toHaveBeenCalledTimes(1);
  });

  it('cannot use a captured challenge from another browser or tenant', async () => {
    const f = fixture(); const pending = await f.service.start(f.start);
    const check = f.check(pending.challengeId);
    await expect(f.service.check({ ...check, browserSecret: Buffer.alloc(32, 1).toString('base64url') })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service.check({ ...check, tenantRef: 'other-tenant' })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).not.toHaveBeenCalled();
    const access = await f.service.check(check);
    await expect(f.service.session({ tenantRef: 'other-tenant', token: access.token })).rejects.toMatchObject({ reason: 'unauthorized' });
  });

  it('single-flights concurrent approval and creates exactly one account/session', async () => {
    const f = fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    const results = await Promise.allSettled([f.service.check(check), f.service.check(check)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.accounts WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(1);
  });

  it('keeps a provider send timeout spent and never makes a replacement request automatically', async () => {
    const f = fixture(); f.transport.start.mockRejectedValue(new Error('timeout after provider may have sent'));
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.transport.start).toHaveBeenCalledTimes(1);
    const budget = (await database.admin.query('SELECT reserved_sends::int AS n FROM customer.parent_budgets WHERE parent_ref=$1', [f.parentRef])).rows[0];
    expect(budget.n).toBe(1);
  });

  it('does not resurrect a possible provider approval after a lost check response', async () => {
    const f = fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    f.transport.check.mockRejectedValue(new Error('approved response lost'));
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(0);
  });
});
