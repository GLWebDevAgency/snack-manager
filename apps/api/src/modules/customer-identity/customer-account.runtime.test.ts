import { approvedCustomerIntentResult, confirmedCustomerBrowserFixture, confirmedCustomerIntentFixture } from './customer-browser.test-fixture';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { CustomerIdentityCrypto, type CustomerIdentityRepository, type CustomerSession } from '@sm/customer';
import { describe, expect, it, vi } from 'vitest';
import { CustomerAccountRuntime } from './customer-account.runtime';
import type { CustomerAccountHumanVerifier } from './customer-account.human';
import type { CustomerRelay } from './customer-account.guard';
import { customerPaidTestEnvironment, customerTestEnvironment } from './customer-account.test-fixture';

function fixture(paid = false) {
  const browserRef = randomUUID(), operationId = randomUUID();
  const now = Date.now(); const env = paid ? customerPaidTestEnvironment(now) : customerTestEnvironment(now);
  const crypto = new CustomerIdentityCrypto(env.SM_CUSTOMER_IDENTITY_KEY!);
  const tenantRef = env.SM_CUSTOMER_PILOT_TENANT_ID!; const phone = '+33612345678';
  const phoneHash = crypto.hash('phone', tenantRef, phone);
  const pending = { challengeId: randomUUID(), phoneHash, serviceSid: `VA${'b'.repeat(32)}`,
    funding: paid ? { mode: 'paid' as const, authorizationRef: 'fixture-authorization', currency: 'USD' as const,
      reservedMicrousd: 70, expiresAt: now + 86_400_000 } : { mode: 'trial' as const },
    verificationSid: `VE${'c'.repeat(32)}`, expiresAt: now + 600_000,
    encryptedPhone: crypto.seal('phone', tenantRef, phoneHash, phone) };
  const session: CustomerSession = { sessionId: randomUUID(), expiresAt: now + 604_800_000,
    profile: { accountId: randomUUID(), phoneHash, encryptedPhone: pending.encryptedPhone,
      encryptedName: null, phoneVerifiedAt: now, revision: 0 } };
  const repository = {
    ...confirmedCustomerBrowserFixture(browserRef, now + 604_800_000),
    ...confirmedCustomerIntentFixture(operationId, now + 600_000),
    reserve: vi.fn<CustomerIdentityRepository['reserve']>().mockResolvedValue({ kind: 'reserved', challengeId: pending.challengeId }),
    settleSend: vi.fn<CustomerIdentityRepository['settleSend']>().mockResolvedValue(pending),
    claimCheck: vi.fn<CustomerIdentityRepository['claimCheck']>().mockResolvedValue(pending),
    recoverCheck: vi.fn<CustomerIdentityRepository['recoverCheck']>().mockResolvedValue(null),
    completeCheck: vi.fn<CustomerIdentityRepository['completeCheck']>().mockResolvedValue(session),
    authenticate: vi.fn<CustomerIdentityRepository['authenticate']>().mockResolvedValue(session),
    updateName: vi.fn<CustomerIdentityRepository['updateName']>().mockResolvedValue(session),
    revoke: vi.fn<CustomerIdentityRepository['revoke']>().mockResolvedValue(undefined),
  } satisfies CustomerIdentityRepository;
  const row = { _id: tenantRef, slug: 'fixture', account: { status: 'trial' } };
  const executeQuery = vi.fn().mockImplementation(async () => row);
  const query = { read: vi.fn().mockReturnThis(), readConcern: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(), exec: executeQuery };
  const tenants = { findOne: vi.fn().mockReturnValue(query) };
  const human = { verify: vi.fn().mockResolvedValue(true) };
  const provider = { start: vi.fn().mockResolvedValue({ verificationSid: pending.verificationSid }), check: vi.fn().mockResolvedValue('approved') };
  const transportFactory = vi.fn().mockReturnValue(provider);
  const config = new ConfigService(env);
  vi.spyOn(config, 'get').mockImplementation(name => env[String(name)]);
  const runtime = new CustomerAccountRuntime(config, tenants as unknown as Model<Tenant>, repository,
    human as unknown as CustomerAccountHumanVerifier, transportFactory);
  const relay: CustomerRelay = { slug: 'fixture', action: 'start', origin: 'https://fixture.example', client: Buffer.alloc(32, 41).toString('base64url') };
  const browserSecret = Buffer.alloc(32, 42).toString('base64url');
  const intentProof = Buffer.alloc(32, 46).toString('base64url');
  const start = { browserRef, browserSecret, intentProof, request: { phone, operationId, turnstileToken: 'fixture-human-token' } };
  const check = { browserRef, browserSecret, intentProof, sessionToken: null, request: { operationId, challengeId: pending.challengeId, checkId: randomUUID(), code: '123456' } };
  const publication = { expectedOperationId: operationId, expectedCheckId: check.request.checkId };
  return { env, row, query, tenants, human, provider, transportFactory, runtime, repository, relay, start, check, session, pending, publication };
}
describe('customer runtime tenant and purpose boundary', () => {
  it.each(['session', 'name', 'logout'] as const)('requires and forwards the browser binding on %s without constructing a provider', async action => {
    const f = fixture();
    const request = action === 'name' ? { name: 'Fixture', expectedRevision: 0 } : action === 'logout' ? { all: true } : {};
    const envelope = { ...f.publication, sessionToken: Buffer.alloc(32, 11).toString('base64url'), request };
    await expect(f.runtime.execute({ ...f.relay, action }, envelope)).rejects.toMatchObject({ status: 400 });
    expect(f.repository.authenticate).not.toHaveBeenCalled();
    expect(f.repository.updateName).not.toHaveBeenCalled(); expect(f.repository.revoke).not.toHaveBeenCalled();
    await f.runtime.execute({ ...f.relay, action }, { ...envelope, browserRef: f.start.browserRef, browserSecret: f.start.browserSecret });
    const crypto = new CustomerIdentityCrypto(f.env.SM_CUSTOMER_IDENTITY_KEY!);
    const expected = expect.objectContaining({
      browserHash: crypto.hash('browser', f.env.SM_CUSTOMER_PILOT_TENANT_ID!, f.start.browserSecret),
      sessionHash: crypto.hash('session', f.env.SM_CUSTOMER_PILOT_TENANT_ID!, envelope.sessionToken),
    });
    if (action !== 'logout') expect(f.repository.authenticate).toHaveBeenCalledExactlyOnceWith(expected);
    if (action === 'name') expect(f.repository.updateName).toHaveBeenCalledExactlyOnceWith(expected);
    if (action === 'logout') expect(f.repository.revoke).toHaveBeenCalledExactlyOnceWith(expected);
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('requires human validation and durable reservation before the only send', async () => {
    const f = fixture();
    await expect(f.runtime.execute(f.relay, f.start)).resolves.toEqual({ challengeId: f.pending.challengeId, expiresAt: f.pending.expiresAt });
    expect(f.human.verify.mock.invocationCallOrder[0]).toBeLessThan(f.repository.reserve.mock.invocationCallOrder[0]!);
    expect(f.repository.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.provider.start.mock.invocationCallOrder[0]!);
    expect(f.provider.start).toHaveBeenCalledTimes(1);
    const reserved = f.repository.reserve.mock.calls[0]![0];
    expect(reserved.tenantRef).toBe(f.env.SM_CUSTOMER_PILOT_TENANT_ID);
    expect(JSON.stringify(reserved).includes(f.start.browserSecret)).toBe(false);
    expect(f.query.read).toHaveBeenCalledWith('primary'); expect(f.query.readConcern).toHaveBeenCalledWith('majority');
  });
  it('does not send if the tenant is suspended while the durable reservation waits', async () => {
    const f = fixture(); f.repository.reserve.mockImplementation(async () => {
      f.row.account.status = 'suspended'; return { kind: 'reserved', challengeId: f.pending.challengeId };
    });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.start.mock.calls.length).toBe(0);
  });
  it('does not check OTP if the tenant is suspended while the check claim waits', async () => {
    const f = fixture(); f.repository.claimCheck.mockImplementation(async () => {
      f.row.account.status = 'suspended'; return f.pending;
    });
    await expect(f.runtime.execute({ ...f.relay, action: 'check' }, f.check)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.check.mock.calls.length).toBe(0);
  });
  it.each(['segments', 'reference', 'ceiling'])('does not spend an old reservation when %s changes during the final tenant read', async kind => {
    const f = fixture(); let reads = 0;
    f.query.exec.mockImplementation(async () => {
      if (++reads === 3) {
        const evidence = JSON.parse(f.env.SM_CUSTOMER_VERIFY_EVIDENCE!) as Record<string, unknown>;
        if (kind === 'segments') evidence.maxSmsSegmentsPerSend = 2;
        if (kind === 'reference') evidence.reference = 'another-evidence';
        if (kind === 'ceiling') evidence.freeVerificationUnitsRemaining = 1;
        f.env.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(evidence);
      }
      return f.row;
    });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.start.mock.calls.length).toBe(0);
  });
  it.each(['suspended', 'churned', 'unknown'])('rejects tenant status %s before any provider or PG work', async status => {
    const f = fixture(); f.row.account.status = status;
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
    expect(f.transportFactory).not.toHaveBeenCalled();
  });
  it.each(['id', 'slug', 'absent', 'read-failed'])('fails closed for a mismatched or unavailable tenant: %s', async kind => {
    const f = fixture();
    if (kind === 'id') f.row._id = 'b'.repeat(24);
    if (kind === 'slug') f.row.slug = 'different';
    if (kind === 'absent') f.query.exec.mockResolvedValue(null);
    if (kind === 'read-failed') f.query.exec.mockRejectedValue(new Error('fixture-private-mongo-url'));
    const error: unknown = await f.runtime.execute(f.relay, f.start).catch(value => value);
    expect(error).toMatchObject({ status: 503 }); expect(JSON.stringify(error).includes('fixture-private-mongo-url')).toBe(false);
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('refuses failed human proof before durable spend or provider calls', async () => {
    const f = fixture(); f.human.verify.mockResolvedValue(false);
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 400 });
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('does not begin registration when evidence is unavailable, even with active tenant', async () => {
    const f = fixture(); f.env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}';
    await expect(f.runtime.execute({ ...f.relay, action: 'status' }, { request: {} })).resolves.toEqual({ available: false });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.human.verify).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('recovers only a private committed receipt despite stale credit, without provider construction', async () => {
    const f = fixture(); f.env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}'; delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    f.repository.resultIntent.mockImplementation(approvedCustomerIntentResult({ operationId: f.start.request.operationId,
      challengeId: f.pending.challengeId, checkId: f.check.request.checkId, expiresAt: f.pending.expiresAt }, f.session));
    const { checkId } = f.check.request;
    const result = await f.runtime.execute({ ...f.relay, action: 'recover' }, {
      browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, intentProof: f.start.intentProof, request: { operationId: f.start.request.operationId, checkId },
    });
    expect(result).toMatchObject({ view: { profile: { name: null, revision: 0 } } });
    const serialized = JSON.stringify(result);
    expect(serialized.includes(f.session.sessionId) || serialized.includes(f.session.profile.accountId)).toBe(false);
    expect(f.repository.resultIntent).toHaveBeenCalledTimes(2); expect(f.repository.recoverCheck).not.toHaveBeenCalled(); expect(f.repository.claimCheck).not.toHaveBeenCalled();
    expect(f.repository.completeCheck).not.toHaveBeenCalled(); expect(f.transportFactory).not.toHaveBeenCalled();
    expect(f.human.verify).not.toHaveBeenCalled();
  });
  it.each(['session', 'name', 'logout'] as const)('keeps %s independent from expiring send evidence', async action => {
    const f = fixture(); f.env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}'; delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const request = action === 'name' ? { name: 'Fixture', expectedRevision: 0 } : action === 'logout' ? { all: true } : {};
    const result = await f.runtime.execute({ ...f.relay, action }, { ...f.publication, sessionToken: f.start.browserSecret, browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, request });
    if (action === 'logout') expect(result).toBeUndefined();
    else expect(result).toMatchObject({ profile: { revision: 0 } });
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
  });
  it('does not return private data when tenant revocation occurs during the session read', async () => {
    const f = fixture(); f.repository.authenticate.mockImplementation(async () => { f.row.account.status = 'suspended'; return f.session; });
    await expect(f.runtime.execute({ ...f.relay, action: 'session' }, { ...f.publication, sessionToken: f.start.browserSecret, browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, request: {} }))
      .rejects.toMatchObject({ status: 503 });
  });
  it('sanitizes arbitrary storage or adapter exceptions before Ops can see them', async () => {
    const f = fixture(); const marker = 'fixture-private-connection-string';
    f.repository.resultIntent.mockRejectedValue(new Error(marker));
    const { checkId } = f.check.request;
    const error = await f.runtime.execute({ ...f.relay, action: 'recover' }, {
      browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, intentProof: f.start.intentProof, request: { operationId: f.start.request.operationId, checkId },
    }).catch((value: Error) => value);
    expect(error).toMatchObject({ status: 503 });
    expect(JSON.stringify(error).includes(marker) || String((error as Error).stack).includes(marker)).toBe(false);
  });
});

describe('browser preparation runtime boundary', () => {
  it('restores a confirmed selector without sending configuration, provider, or private profile access', async () => {
    const f = fixture(); delete f.env.SM_CUSTOMER_VERIFY_POLICY; delete f.env.SM_CUSTOMER_VERIFY_EVIDENCE;
    const preparation = { browserRef: f.start.browserRef, state: 'confirmed' as const,
      admissionExpiresAt: f.session.expiresAt - 604_200_000, expiresAt: f.session.expiresAt };
    f.repository.restoreBrowser.mockResolvedValue(preparation);
    await expect(f.runtime.execute({ ...f.relay, action: 'browser' }, { request: { step: 'restore' },
      browserSecret: f.start.browserSecret, candidateSecret: null })).resolves.toEqual({ preparation, emitCookie: false });
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
    expect(f.repository.authenticate).not.toHaveBeenCalled(); expect(f.repository.resultIntent).not.toHaveBeenCalled();
    expect(f.repository.prepareBrowser).not.toHaveBeenCalled(); expect(f.repository.confirmBrowser).not.toHaveBeenCalled();
  });
  it('refuses restoration when tenant authorization changes during the public selector read', async () => {
    const f = fixture();
    f.repository.restoreBrowser.mockImplementation(async () => {
      f.row.account.status = 'suspended';
      return { browserRef: f.start.browserRef, state: 'confirmed', admissionExpiresAt: f.session.expiresAt - 604_200_000,
        expiresAt: f.session.expiresAt };
    });
    await expect(f.runtime.execute({ ...f.relay, action: 'browser' }, { request: { step: 'restore' },
      browserSecret: f.start.browserSecret, candidateSecret: null })).rejects.toMatchObject({ status: 503 });
  });
  it('rechecks restored preparation expiry after the final tenant read', async () => {
    const f = fixture(); const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
    try {
      const expiresAt = now + 1_000;
      f.repository.restoreBrowser.mockResolvedValue({ browserRef: f.start.browserRef, state: 'confirmed',
        admissionExpiresAt: now - 1_000, expiresAt });
      f.repository.validateBrowser.mockResolvedValue({ expiresAt });
      let reads = 0;
      f.query.exec.mockImplementation(async () => { if (++reads === 2) vi.setSystemTime(expiresAt); return f.row; });
      await expect(f.runtime.execute({ ...f.relay, action: 'browser' }, { request: { step: 'restore' },
        browserSecret: f.start.browserSecret, candidateSecret: null })).rejects.toMatchObject({ status: 401 });
    } finally { vi.useRealTimers(); }
  });
  it.each(['prepare', 'issue', 'confirm'] as const)('runs %s without a send policy, Turnstile or a provider', async step => {
    const f = fixture(); delete f.env.SM_CUSTOMER_VERIFY_POLICY; delete f.env.SM_CUSTOMER_VERIFY_EVIDENCE;
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const browserRef = f.start.browserRef, now = Date.now();
    const preparation = { browserRef, state: 'prepared' as const, admissionExpiresAt: now + 600_000, expiresAt: now + 604_800_000 };
    f.repository.prepareBrowser.mockResolvedValue(preparation);
    f.repository.issueBrowser.mockResolvedValue({ preparation: { ...preparation, state: 'issued' }, emitCookie: true });
    f.repository.confirmBrowser.mockResolvedValue({ ...preparation, state: 'confirmed' });
    const result = await f.runtime.execute({ ...f.relay, action: 'browser' }, { request: { step, browserRef },
      browserSecret: step === 'confirm' ? f.start.browserSecret : null,
      candidateSecret: step === 'issue' ? Buffer.alloc(32, 57).toString('base64url') : null });
    expect(result).toMatchObject({ preparation: { browserRef, state: step === 'prepare' ? 'prepared' : step === 'issue' ? 'issued' : 'confirmed' },
      emitCookie: step === 'issue' });
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.repository.claimCheck).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(f.start.browserSecret);
  });
  it.each(['missing', 'wrong', 'unconfirmed', 'expired'] as const)('refuses a %s preparation before even verifying the human challenge', async kind => {
    const f = fixture(); const body: Record<string, unknown> = { ...f.start };
    if (kind === 'missing') delete body.browserRef;
    if (kind === 'wrong') body.browserRef = randomUUID();
    if (kind === 'unconfirmed') f.repository.validateBrowser.mockResolvedValue(null);
    if (kind === 'expired') f.repository.validateBrowser.mockResolvedValue({ expiresAt: Date.now() - 1 });
    await expect(f.runtime.execute(f.relay, body)).rejects.toMatchObject({ status: kind === 'missing' ? 400 : 401 });
    expect(f.human.verify).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled();
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('rechecks the cookie preparation after Turnstile, before reserving a send', async () => {
    const f = fixture(); f.human.verify.mockImplementation(async () => { f.repository.validateBrowser.mockResolvedValue(null); return true; });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 401 });
    expect(f.human.verify).toHaveBeenCalledTimes(1); expect(f.repository.reserve).not.toHaveBeenCalled();
    expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('revalidates fresh funding after the final asynchronous intent validation', async () => {
    const f = fixture(true); let reads = 0;
    f.repository.validateIntent.mockImplementation(async () => {
      if (++reads === 2) reviseCosts(f, 32);
      return { expiresAt: f.pending.expiresAt };
    });
    await expect(f.runtime.execute({ ...f.relay, action: 'check' }, f.check)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.check).not.toHaveBeenCalled();
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ result: 'uncertain' }));
  });
  it('does not release private data if the preparation expires during the final tenant response check', async () => {
    const f = fixture(); let reads = 0;
    f.query.exec.mockImplementation(async () => { if (++reads === 2) f.repository.validateBrowser.mockResolvedValue(null); return f.row; });
    await expect(f.runtime.execute({ ...f.relay, action: 'session' }, { browserRef: f.start.browserRef,
      browserSecret: f.start.browserSecret, ...f.publication, sessionToken: f.start.browserSecret, request: {} })).rejects.toMatchObject({ status: 401 });
    expect(f.repository.authenticate).toHaveBeenCalledTimes(1); expect(f.transportFactory).not.toHaveBeenCalled();
  });
  it('rechecks session expiry after the last tenant wait, even while the browser remains valid', async () => {
    const f = fixture(); const initial = Date.now(); let now = initial, reads = 0;
    f.session.expiresAt = initial + 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      f.query.exec.mockImplementation(async () => { if (++reads === 2) now = initial + 2000; return f.row; });
      await expect(f.runtime.execute({ ...f.relay, action: 'session' }, { browserRef: f.start.browserRef,
        browserSecret: f.start.browserSecret, ...f.publication, sessionToken: f.start.browserSecret, request: {} })).rejects.toMatchObject({ status: 401 });
      expect(f.repository.authenticate).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
});

describe('verification intent runtime boundary', () => {
  it.each(['prepare', 'close'] as const)('runs intent %s without Turnstile, sending configuration or a session token', async step => {
    const f = fixture(); delete f.env.SM_CUSTOMER_VERIFY_POLICY; delete f.env.SM_CUSTOMER_VERIFY_EVIDENCE;
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const intent = { operationId: f.start.request.operationId, state: 'open' as const, expiresAt: f.pending.expiresAt };
    f.repository.prepareIntent.mockResolvedValue({ intent, emitCookie: true });
    f.repository.closeIntent.mockResolvedValue({ ...intent, state: 'closed' });
    const result = await f.runtime.execute({ ...f.relay, action: 'intent' }, { browserRef: f.start.browserRef,
      browserSecret: f.start.browserSecret, candidateProof: step === 'prepare' ? f.start.intentProof : null,
      request: { step, operationId: intent.operationId } });
    expect(result).toEqual({ intent: { ...intent, state: step === 'prepare' ? 'open' : 'closed' }, emitCookie: step === 'prepare' });
    expect(f.human.verify).not.toHaveBeenCalled(); expect(f.transportFactory).not.toHaveBeenCalled();
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.repository.revoke).not.toHaveBeenCalled();
  });
  it.each(['missing', 'closed'] as const)('rejects a %s intent before Turnstile and before a send reservation', async kind => {
    const f = fixture(); const body: Record<string, unknown> = { ...f.start };
    if (kind === 'missing') delete body.intentProof;
    else f.repository.validateIntent.mockResolvedValue(null);
    await expect(f.runtime.execute(f.relay, body)).rejects.toMatchObject({ status: kind === 'missing' ? 400 : 401 });
    expect(f.human.verify).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('revalidates closure after the human verifier returns before admitting a delayed start', async () => {
    const f = fixture(); f.human.verify.mockImplementation(async () => { f.repository.validateIntent.mockResolvedValue(null); return true; });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 401 });
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it.each(['unresolved', 'code_required', 'closed', 'expired', 'failed'] as const)('reads a %s result without current sending policy or a provider', async state => {
    const f = fixture(); delete f.env.SM_CUSTOMER_VERIFY_EVIDENCE; delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const result = { operationId: f.start.request.operationId, state, checkId: null,
      challengeId: state === 'code_required' ? f.pending.challengeId : null,
      expiresAt: state === 'expired' ? Date.now() - 1 : f.pending.expiresAt };
    f.repository.resultIntent.mockResolvedValue(result);
    await expect(f.runtime.execute({ ...f.relay, action: 'recover' }, { browserRef: f.start.browserRef,
      browserSecret: f.start.browserSecret, intentProof: f.start.intentProof,
      request: { operationId: f.start.request.operationId, checkId: null } })).resolves.toEqual(result);
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
    expect(f.repository.validateIntent).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled();
  });
});

describe('closed paid pilot runtime funding', () => {
  it('reserves the authorized money and cost evidence before sending, without any Trial alias', async () => {
    const f = fixture(true);
    await f.runtime.execute(f.relay, f.start);
    const reserved = f.repository.reserve.mock.calls[0]![0];
    expect(reserved.limits).toMatchObject({ maxSendReservations: 10, smsUnitsReservedPerSend: 2,
      paidBudget: { mode: 'paid', authorizationRef: 'fixture-authorization', currency: 'USD',
        costEvidenceReference: 'fixture-cost', authorizedSpendMicrousd: 1010, reservePerSendMicrousd: 70 } });
    for (const field of ['challengeTtlMs', 'trialSendReservations', 'freeSmsUnitsRemainingAtObservation',
      'freeVerificationUnitsRemainingAtObservation']) expect(reserved.limits).not.toHaveProperty(field);
    expect(f.repository.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.provider.start.mock.invocationCallOrder[0]!);
    expect(f.provider.start).toHaveBeenCalledTimes(1);
  });
  it('replays a correctly funded pending start without sending again', async () => {
    const f = fixture(true); f.repository.reserve.mockResolvedValue({ kind: 'pending', challenge: f.pending });
    await expect(f.runtime.execute(f.relay, f.start)).resolves.toEqual({ challengeId: f.pending.challengeId, expiresAt: f.pending.expiresAt });
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.repository.settleSend).not.toHaveBeenCalled();
  });
  for (const action of ['start', 'check'] as const) {
    it.each(['trial', 'missing', 'foreign-authorization', 'currency', 'expired', 'underfunded', 'zero', 'extra'])
      (`refuses %s funding on ${action}, never calling the provider or re-provisioning a check`, async kind => {
        const f = fixture(true); const funding: Record<string, unknown> = { ...f.pending.funding };
        if (kind === 'foreign-authorization') funding.authorizationRef = 'other-authorization';
        if (kind === 'currency') funding.currency = 'EUR';
        if (kind === 'expired') funding.expiresAt = Date.now() - 1;
        if (kind === 'underfunded') funding.reservedMicrousd = 69;
        if (kind === 'zero') funding.reservedMicrousd = 0;
        if (kind === 'extra') funding.untrusted = true;
        const invalid = { ...f.pending, funding: kind === 'missing' ? undefined : kind === 'trial' ? { mode: 'trial' } : funding } as typeof f.pending;
        f.repository.claimCheck.mockResolvedValue(invalid);
        f.repository.reserve.mockResolvedValue({ kind: 'pending', challenge: invalid });
        const rejected = await f.runtime.execute({ ...f.relay, action }, action === 'start' ? f.start : f.check)
          .then(() => false, (error: { status?: number }) => error.status === 503);
        expect(rejected).toBe(true);
        expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
        if (action === 'check') {
          expect(f.repository.reserve).not.toHaveBeenCalled();
          expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ result: 'uncertain' }));
        }
      });
  }
  it.each(['same', 'lower'])('checks with %s covered cost after a new cost attestation, without reserving again', async cost => {
    const f = fixture(true); reviseCosts(f, cost === 'same' ? 31 : 30);
    const result = await f.runtime.execute({ ...f.relay, action: 'check' }, f.check);
    expect(result).toMatchObject({ view: { profile: { revision: 0 } } });
    expect(f.provider.check).toHaveBeenCalledTimes(1); expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('accepts a fresh covered cost reference after the final tenant wait, not just before the request', async () => {
    const f = fixture(true); let reads = 0;
    f.query.exec.mockImplementation(async () => { if (++reads === 2) reviseCosts(f, 31); return f.row; });
    const accepted = await f.runtime.execute({ ...f.relay, action: 'check' }, f.check).then(() => true, () => false);
    expect(accepted).toBe(true); expect(f.provider.check).toHaveBeenCalledTimes(1);
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('rejects a higher cost appearing during the final tenant wait before checking', async () => {
    const f = fixture(true); let reads = 0;
    f.query.exec.mockImplementation(async () => { if (++reads === 2) reviseCosts(f, 32); return f.row; });
    const rejected = await f.runtime.execute({ ...f.relay, action: 'check' }, f.check)
      .then(() => false, (error: { status?: number }) => error.status === 503);
    expect(rejected).toBe(true); expect(f.provider.check).not.toHaveBeenCalled();
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it.each(['claim', 'last-read'])('rejects an authorization changed during %s before checking', async timing => {
    const f = fixture(true); const change = () => {
      const policy = JSON.parse(f.env.SM_CUSTOMER_VERIFY_POLICY!);
      policy.authorization.reference = 'new-authorization'; f.env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
    };
    if (timing === 'claim') f.repository.claimCheck.mockImplementation(async () => { change(); return f.pending; });
    else { let reads = 0; f.query.exec.mockImplementation(async () => { if (++reads === 2) change(); return f.row; }); }
    const rejected = await f.runtime.execute({ ...f.relay, action: 'check' }, f.check)
      .then(() => false, (error: { status?: number }) => error.status === 503);
    expect(rejected).toBe(true); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it.each(['reserve', 'last-read'])('does not send if the cost evidence reference changes during %s, even at the same amount', async timing => {
    const f = fixture(true);
    if (timing === 'reserve') f.repository.reserve.mockImplementation(async () => {
      reviseCosts(f, 31); return { kind: 'reserved', challengeId: f.pending.challengeId };
    });
    else { let reads = 0; f.query.exec.mockImplementation(async () => { if (++reads === 3) reviseCosts(f, 31); return f.row; }); }
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.start).not.toHaveBeenCalled();
    expect(f.repository.settleSend).toHaveBeenCalledWith(expect.objectContaining({ verificationSid: null }));
  });
  it('cannot silently switch mode while waiting on a durable reservation', async () => {
    const f = fixture(true); f.repository.reserve.mockImplementation(async () => {
      const trial = customerTestEnvironment();
      for (const key of ['SM_CUSTOMER_ACCOUNT_MODE', 'SM_CUSTOMER_VERIFY_POLICY', 'SM_CUSTOMER_VERIFY_EVIDENCE']) f.env[key] = trial[key]!;
      return { kind: 'pending', challenge: f.pending };
    });
    await expect(f.runtime.execute(f.relay, f.start)).rejects.toMatchObject({ status: 503 });
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  for (const action of ['start', 'check'] as const) {
    it.each(['mode', 'key', 'turnstile-key', 'expiry'])(`fails closed when %s changes during the final ${action} tenant read`, async field => {
      const f = fixture(true); let reads = 0;
      f.query.exec.mockImplementation(async () => {
        if (++reads === (action === 'start' ? 3 : 2)) {
          if (field === 'mode') {
            const trial = customerTestEnvironment();
            for (const key of ['SM_CUSTOMER_ACCOUNT_MODE', 'SM_CUSTOMER_VERIFY_POLICY', 'SM_CUSTOMER_VERIFY_EVIDENCE']) f.env[key] = trial[key]!;
          } else if (field === 'key') f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET = 'changed-fixture-key';
          else if (field === 'turnstile-key') f.env.SM_CUSTOMER_TURNSTILE_SECRET_KEY = 'changed-fixture-human-key';
          else {
            const policy = JSON.parse(f.env.SM_CUSTOMER_VERIFY_POLICY!);
            policy.authorization.expiresAt = Date.now() - 1; f.env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
          }
        }
        return f.row;
      });
      const rejected = await f.runtime.execute({ ...f.relay, action }, action === 'start' ? f.start : f.check)
        .then(() => false, (error: { status?: number }) => error.status === 503);
      expect(rejected).toBe(true); expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
    });
  }
  it.each(['recover', 'session', 'name', 'logout'] as const)('keeps paid %s available without spending evidence or provider credentials', async action => {
    const f = fixture(true); delete f.env.SM_CUSTOMER_VERIFY_EVIDENCE; delete f.env.SM_CUSTOMER_VERIFY_POLICY;
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    f.repository.resultIntent.mockImplementation(approvedCustomerIntentResult({ operationId: f.start.request.operationId,
      challengeId: f.pending.challengeId, checkId: f.check.request.checkId, expiresAt: f.pending.expiresAt }, f.session));
    const { checkId } = f.check.request;
    const request = action === 'name' ? { name: 'Fixture', expectedRevision: 0 }
      : action === 'logout' ? { all: true } : action === 'recover' ? { operationId: f.start.request.operationId, checkId } : {};
    const envelope = action === 'recover' ? { intentProof: f.start.intentProof, browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, request }
      : { ...f.publication, sessionToken: f.start.browserSecret, browserRef: f.start.browserRef, browserSecret: f.start.browserSecret, request };
    const result = await f.runtime.execute({ ...f.relay, action }, envelope);
    if (action === 'logout') expect(result).toBeUndefined();
    else expect(typeof result).toBe('object');
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
    expect(f.provider.check).not.toHaveBeenCalled(); expect(f.repository.reserve).not.toHaveBeenCalled();
    expect(f.repository.claimCheck).not.toHaveBeenCalled();
  });
});

function reviseCosts(f: ReturnType<typeof fixture>, smsUpperBound: number): void {
  const policy = JSON.parse(f.env.SM_CUSTOMER_VERIFY_POLICY!);
  const evidence = JSON.parse(f.env.SM_CUSTOMER_VERIFY_EVIDENCE!);
  policy.costEvidenceReference = 'updated-cost-reference';
  evidence.costs.reference = 'updated-cost-reference'; evidence.costs.smsSegmentUpperBoundMicrousd = smsUpperBound;
  f.env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy); f.env.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(evidence);
}
