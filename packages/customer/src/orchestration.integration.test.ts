import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto } from './crypto';
import { PostgresCustomerIdentityRepository } from './repository';
import { customerTestFixture } from './test-fixture';
import type { CustomerSession } from './port';
import type { PhoneVerificationTransport } from '../../../apps/api/src/modules/customer-identity/phone-verification.port';
import type { CustomerProtectionRequest, CustomerProtectionResponse } from '@sm/contracts';
import { customerPasskeyFixture } from '../../../apps/api/src/modules/customer-identity/customer-passkey.test-fixture';

// Provider is deliberately simulated; only persistence/transactions are real.
// These tests neither send an OTP nor establish live Twilio entitlement.
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const PHONE = '+33612345678';
const BROWSER = Buffer.alloc(32, 57).toString('base64url');
const INTENT_PROOF = Buffer.alloc(32, 58).toString('base64url');
const crypto = new CustomerIdentityCrypto(Buffer.alloc(32, 22).toString('base64'));

integration('customer use cases with real PostgreSQL and simulated Verify', () => {
  let database: Awaited<ReturnType<typeof customerTestFixture>>;
  let keys: Awaited<ReturnType<typeof customerPasskeyFixture>>;
  let CustomerIdentityService: typeof import('../../../apps/api/src/modules/customer-identity/customer-identity.service').CustomerIdentityService;
  beforeAll(async () => {
    ({ CustomerIdentityService } = await import('../../../apps/api/src/modules/customer-identity/customer-identity.service'));
    database = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
  }, 20_000);
  afterAll(async () => { try { await keys?.close(); } finally { await database?.close(); } });
  async function fixture() {
    // Each case has an independent native authenticator/document, like a new
    // device. Never accumulate resident credentials or browser prompt quotas.
    await keys?.close(); keys = await customerPasskeyFixture('https://customer.fixture');
    const tenantRef = `tenant_${randomUUID()}`;
    const parentRef = `AC${randomUUID().replaceAll('-', '')}`;
    const serviceSid = `VA${randomUUID().replaceAll('-', '')}`;
    const now = Date.now();
    const config = { environment: 'staging', mode: 'closed_trial' as const, parentRef,
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
    const browserRef = randomUUID();
    await service.browser({ tenantRef, request: { step: 'prepare', browserRef }, browserSecret: null, candidateSecret: null });
    expect((await service.browser({ tenantRef, request: { step: 'issue', browserRef }, browserSecret: null, candidateSecret: BROWSER })).emitCookie).toBe(true);
    await service.browser({ tenantRef, request: { step: 'confirm', browserRef }, browserSecret: BROWSER, candidateSecret: null });
    const operationId = randomUUID();
    expect((await service.intent({ tenantRef, browserRef, browserSecret: BROWSER,
      request: { step: 'prepare', operationId }, candidateProof: INTENT_PROOF })).emitCookie).toBe(true);
    const start = { tenantRef, phone: PHONE, operationId, intentProof: INTENT_PROOF, browserRef, browserSecret: BROWSER,
      clientIp: '127.0.0.1', humanVerified: true };
    const check = (challengeId: string) => ({ tenantRef, operationId, intentProof: INTENT_PROOF, challengeId, checkId: randomUUID(),
      browserRef, browserSecret: BROWSER, code: '123456', existingSessionToken: null });
    async function prepareProtection(checked: ReturnType<typeof check>) {
      const selected = { operationId, checkId: checked.checkId };
      const call = (request: CustomerProtectionRequest) => service.protection({ tenantRef, browserRef, browserSecret: BROWSER,
        intentProof: INTENT_PROOF, origin: 'https://customer.fixture', request });
      const registrationId = randomUUID(), assertionId = randomUUID(), activationId = randomUUID();
      const registration = await call({ ...selected, step: 'registration-options', registrationId });
      if (registration.state !== 'registration-options') throw new Error('Expected registration options');
      await call({ ...selected, step: 'register', registrationId, response: await keys.register(registration.options) });
      const assertion = await call({ ...selected, step: 'assertion-options', assertionId });
      if (assertion.state !== 'assertion-options') throw new Error('Expected assertion options');
      await call({ ...selected, step: 'assert', assertionId, response: await keys.authenticate(assertion.options) });
      const recovery = await call({ ...selected, step: 'recovery-code', rotationId: randomUUID(), expectedVersion: 0 });
      if (recovery.state !== 'recovery-code' || !recovery.code) throw new Error('Expected one-time recovery display');
      const activate = { ...selected, step: 'activate' as const, activationId, recoveryVersion: recovery.enrollment.recoveryVersion, code: recovery.code };
      const requireSession = (result: CustomerProtectionResponse) => {
        if (result.state !== 'authenticated') throw new Error('Expected protected account activation');
        return result;
      };
      return { activationId, activate: async () => requireSession(await call(activate)),
        recover: async () => requireSession(await call({ ...selected, step: 'activation-result', activationId })),
        selection: { expectedOperationId: operationId, expectedCheckId: activationId } };
    }
    return { tenantRef, parentRef, browserRef, service, repository, transport, start, check, config, prepareProtection };
  }

  it('replays an admission after a lost response, despite a fresh server candidate UUID', async () => {
    const f = await fixture();
    const first = await f.service.start(f.start);
    const replay = await f.service.start(f.start);
    expect(replay).toEqual(first);
    expect(f.transport.start).toHaveBeenCalledTimes(1);
  });

  it('creates and restores the exact private session, updates the name, then revokes the receipt', async () => {
    const f = await fixture();
    const pending = await f.service.start(f.start);
    const check = f.check(pending.challengeId);
    const provisional = await f.service.check(check);
    expect(provisional.state).toBe('enrollment');
    expect(await f.service.check(check)).toEqual(provisional);
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    const protection = await f.prepareProtection(check), first = await protection.activate();
    expect(first.view.profile).toMatchObject({ name: null, phoneE164: PHONE, revision: 0 });
    const selection = protection.selection;
    const updated = await f.service.updateName({ ...selection, tenantRef: f.tenantRef, browserRef: f.browserRef, browserSecret: BROWSER, token: first.token, name: 'Mina', expectedRevision: 0 });
    expect(updated.profile).toMatchObject({ name: 'Mina', revision: 1 });
    expect((await f.service.session({ ...selection, tenantRef: f.tenantRef, browserRef: f.browserRef, browserSecret: BROWSER, token: first.token })).profile).toEqual(updated.profile);
    await f.service.logout({ ...selection, tenantRef: f.tenantRef, browserRef: f.browserRef, browserSecret: BROWSER, token: first.token, all: true });
    await expect(f.service.session({ ...selection, tenantRef: f.tenantRef, browserRef: f.browserRef, browserSecret: BROWSER, token: first.token })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).toHaveBeenCalledTimes(1);
  });

  it('recovers only the exact committed session after the application response is lost, without an OTP', async () => {
    const role = await database.app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const f = await fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    const committed: { session: CustomerSession | null } = { session: null };
    await f.service.check(check);
    const protection = await f.prepareProtection(check);
    const complete = f.repository.activateEnrollment.bind(f.repository);
    vi.spyOn(f.repository, 'activateEnrollment').mockImplementationOnce(async input => {
      committed.session = await complete(input); // Real PostgreSQL COMMIT finishes before the simulated loss.
      throw new Error('fixture response lost after commit');
    });
    await expect(protection.activate()).rejects.toMatchObject({ reason: 'unavailable' });
    expect(committed.session !== null).toBe(true);
    const { tenantRef, checkId, browserRef, browserSecret, operationId, intentProof } = check;
    const receipt = { tenantRef, operationId, intentProof, checkId, browserRef, browserSecret };
    const claim = vi.spyOn(f.repository, 'claimCheck');
    const completionCalls = vi.mocked(f.repository.activateEnrollment).mock.calls.length;
    f.transport.start.mockClear(); f.transport.check.mockClear();
    // Credit freshness authorizes a new provider operation, not reading a committed private receipt.
    f.config.evidence.observedAt = Date.now() - 86_400_000;
    for (const forged of [
      { ...receipt, browserSecret: Buffer.alloc(32, 1).toString('base64url') },
      { ...receipt, tenantRef: 'other-tenant' },
    ]) {
      const denied = await f.service.recover(forged).then(() => false, error => error.reason === 'unauthorized');
      expect(denied).toBe(true);
    }
    expect((await f.service.recover({ ...receipt, checkId: randomUUID() })).state).toBe('unresolved');
    const recovered = await protection.recover();
    expect(recovered.token === crypto.tokenForProtectedPublication(tenantRef, browserSecret, operationId, intentProof, 'passkey', protection.activationId)).toBe(true);
    expect(recovered.state).toBe('authenticated');
    expect((await database.admin.query('SELECT id FROM customer.sessions WHERE tenant_ref=$1', [tenantRef])).rows[0].id === committed.session?.sessionId).toBe(true);
    expect(recovered.view.expiresAt).toBe(committed.session?.expiresAt);
    const repeated = await protection.recover();
    expect(repeated.token === recovered.token).toBe(true);
    expect(repeated.view.expiresAt).toBe(recovered.view.expiresAt);
    expect(claim.mock.calls.length).toBe(0);
    expect(vi.mocked(f.repository.activateEnrollment).mock.calls.length).toBe(completionCalls);
    expect(f.transport.start.mock.calls.length + f.transport.check.mock.calls.length).toBe(0);
    const rows = await database.admin.query(`SELECT
      (SELECT count(*)::int FROM customer.accounts WHERE tenant_ref=$1) AS accounts,
      (SELECT count(*)::int FROM customer.sessions WHERE tenant_ref=$1) AS sessions,
      (SELECT count(*)::int FROM customer.check_attempts WHERE tenant_ref=$1) AS checks`, [tenantRef]);
    expect(rows.rows[0]).toEqual({ accounts: 1, sessions: 1, checks: 1 });
  });

  it('recover cannot consume a pending challenge or accept a code, then the real check still succeeds', async () => {
    const f = await fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    const { tenantRef, challengeId, checkId, browserRef, browserSecret, operationId, intentProof } = check;
    const claim = vi.spyOn(f.repository, 'claimCheck');
    const receipt = { tenantRef, operationId, intentProof, checkId, browserRef, browserSecret };
    expect((await f.service.recover(receipt)).state).toBe('unresolved');
    await expect(f.service.recover({ ...receipt, code: check.code })).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(claim.mock.calls.length + f.transport.check.mock.calls.length).toBe(0);
    const untouched = await database.admin.query('SELECT state,checks_used FROM customer.challenges WHERE tenant_ref=$1 AND id=$2', [tenantRef, challengeId]);
    expect(untouched.rows[0]).toEqual({ state: 'pending', checks_used: 0 });
    const first = await f.service.check(check);
    expect(first.state).toBe('enrollment');
    if (first.state !== 'enrollment') throw new Error('Expected provisional registration');
    expect(first.enrollment.expiresAt > Date.now()).toBe(true);
    expect(f.transport.check.mock.calls.length).toBe(1);
  });

  it.each([false, true])('recover never revives a revoked session (all=%s)', async all => {
    const f = await fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    await f.service.check(check);
    const protection = await f.prepareProtection(check), first = await protection.activate();
    const { tenantRef, browserRef, browserSecret } = check;
    await f.service.logout({ ...protection.selection, tenantRef, browserRef, browserSecret, token: first.token, all });
    const claim = vi.spyOn(f.repository, 'claimCheck'); const complete = vi.spyOn(f.repository, 'completeCheck');
    f.transport.start.mockClear(); f.transport.check.mockClear();
    await expect(protection.recover()).rejects.toBeDefined();
    expect(claim.mock.calls.length + complete.mock.calls.length).toBe(0);
    expect(f.transport.start.mock.calls.length + f.transport.check.mock.calls.length).toBe(0);
    const rows = await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [tenantRef]);
    expect(rows.rows[0].n).toBe(1);
  });

  it('cannot use a captured challenge from another browser or tenant', async () => {
    const f = await fixture(); const pending = await f.service.start(f.start);
    const check = f.check(pending.challengeId);
    await expect(f.service.check({ ...check, browserSecret: Buffer.alloc(32, 1).toString('base64url') })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service.check({ ...check, tenantRef: 'other-tenant' })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).not.toHaveBeenCalled();
    await f.service.check(check);
    const protection = await f.prepareProtection(check), access = await protection.activate();
    await expect(f.service.session({ ...protection.selection, tenantRef: 'other-tenant', browserRef: f.browserRef, browserSecret: BROWSER, token: access.token })).rejects.toMatchObject({ reason: 'unauthorized' });
  });

  it('single-flights concurrent OTP approval, then activates exactly one account/session', async () => {
    const f = await fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    const results = await Promise.allSettled([f.service.check(check), f.service.check(check)]);
    expect(results.some(result => result.status === 'fulfilled')).toBe(true);
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(0);
    const protection = await f.prepareProtection(check);
    const activations = await Promise.allSettled([protection.activate(), protection.activate()]);
    expect(activations.some(result => result.status === 'fulfilled')).toBe(true);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.accounts WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(1);
  });

  it('keeps a provider send timeout spent and never makes a replacement request automatically', async () => {
    const f = await fixture(); f.transport.start.mockRejectedValue(new Error('timeout after provider may have sent'));
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.transport.start).toHaveBeenCalledTimes(1);
    const budget = (await database.admin.query('SELECT reserved_sends::int AS n FROM customer.parent_budgets WHERE parent_ref=$1', [f.parentRef])).rows[0];
    expect(budget.n).toBe(1);
  });

  it('does not resurrect a possible provider approval after a lost check response', async () => {
    const f = await fixture(); const pending = await f.service.start(f.start); const check = f.check(pending.challengeId);
    f.transport.check.mockRejectedValue(new Error('approved response lost'));
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(f.service.check(check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect((await database.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE tenant_ref=$1', [f.tenantRef])).rows[0].n).toBe(0);
  });
});
