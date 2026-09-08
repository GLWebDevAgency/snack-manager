import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { CustomerIdentityCrypto, type CustomerIdentityRepository, type CustomerSession } from '@sm/customer';
import { describe, expect, it, vi } from 'vitest';
import { CustomerAccountRuntime } from './customer-account.runtime';
import type { CustomerAccountHumanVerifier } from './customer-account.human';
import type { CustomerRelay } from './customer-account.guard';
import { customerTestEnvironment } from './customer-account.test-fixture';

function fixture() {
  const now = Date.now(); const env = customerTestEnvironment(now);
  const crypto = new CustomerIdentityCrypto(env.SM_CUSTOMER_IDENTITY_KEY!);
  const tenantRef = env.SM_CUSTOMER_PILOT_TENANT_ID!; const phone = '+33612345678';
  const phoneHash = crypto.hash('phone', tenantRef, phone);
  const pending = { challengeId: randomUUID(), phoneHash, serviceSid: `VA${'b'.repeat(32)}`,
    verificationSid: `VE${'c'.repeat(32)}`, expiresAt: now + 600_000,
    encryptedPhone: crypto.seal('phone', tenantRef, phoneHash, phone) };
  const session: CustomerSession = { sessionId: randomUUID(), expiresAt: now + 604_800_000,
    profile: { accountId: randomUUID(), phoneHash, encryptedPhone: pending.encryptedPhone,
      encryptedName: null, phoneVerifiedAt: now, revision: 0 } };
  const repository = {
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
  const start = { browserSecret, request: { phone, operationId: randomUUID(), turnstileToken: 'fixture-human-token' } };
  const check = { browserSecret, sessionToken: null, request: { challengeId: pending.challengeId, checkId: randomUUID(), code: '123456' } };
  return { env, row, query, tenants, human, provider, transportFactory, runtime, repository, relay, start, check, session, pending };
}
describe('customer runtime tenant and purpose boundary', () => {
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
    f.repository.recoverCheck.mockResolvedValue(f.session);
    const { challengeId, checkId } = f.check.request;
    const result = await f.runtime.execute({ ...f.relay, action: 'recover' }, {
      browserSecret: f.start.browserSecret, request: { challengeId, checkId },
    });
    expect(result).toMatchObject({ view: { profile: { name: null, revision: 0 } } });
    const serialized = JSON.stringify(result);
    expect(serialized.includes(f.session.sessionId) || serialized.includes(f.session.profile.accountId)).toBe(false);
    expect(f.repository.recoverCheck).toHaveBeenCalledTimes(1); expect(f.repository.claimCheck).not.toHaveBeenCalled();
    expect(f.repository.completeCheck).not.toHaveBeenCalled(); expect(f.transportFactory).not.toHaveBeenCalled();
    expect(f.human.verify).not.toHaveBeenCalled();
  });
  it.each(['session', 'name', 'logout'] as const)('keeps %s independent from expiring send evidence', async action => {
    const f = fixture(); f.env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}'; delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const request = action === 'name' ? { name: 'Fixture', expectedRevision: 0 } : action === 'logout' ? { all: true } : {};
    const result = await f.runtime.execute({ ...f.relay, action }, { sessionToken: f.start.browserSecret, request });
    if (action === 'logout') expect(result).toBeUndefined();
    else expect(result).toMatchObject({ profile: { revision: 0 } });
    expect(f.transportFactory).not.toHaveBeenCalled(); expect(f.human.verify).not.toHaveBeenCalled();
  });
  it('does not return private data when tenant revocation occurs during the session read', async () => {
    const f = fixture(); f.repository.authenticate.mockImplementation(async () => { f.row.account.status = 'suspended'; return f.session; });
    await expect(f.runtime.execute({ ...f.relay, action: 'session' }, { sessionToken: f.start.browserSecret, request: {} }))
      .rejects.toMatchObject({ status: 503 });
  });
  it('sanitizes arbitrary storage or adapter exceptions before Ops can see them', async () => {
    const f = fixture(); const marker = 'fixture-private-connection-string';
    f.repository.recoverCheck.mockRejectedValue(new Error(marker));
    const { challengeId, checkId } = f.check.request;
    const error = await f.runtime.execute({ ...f.relay, action: 'recover' }, {
      browserSecret: f.start.browserSecret, request: { challengeId, checkId },
    }).catch((value: Error) => value);
    expect(error).toMatchObject({ status: 503 });
    expect(JSON.stringify(error).includes(marker) || String((error as Error).stack).includes(marker)).toBe(false);
  });
});
