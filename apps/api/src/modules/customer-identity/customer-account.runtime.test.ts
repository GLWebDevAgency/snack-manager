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
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET; f.repository.recoverCheck.mockResolvedValue(f.session);
    const { challengeId, checkId } = f.check.request;
    const request = action === 'name' ? { name: 'Fixture', expectedRevision: 0 }
      : action === 'logout' ? { all: true } : action === 'recover' ? { challengeId, checkId } : {};
    const envelope = action === 'recover' ? { browserSecret: f.start.browserSecret, request }
      : { sessionToken: f.start.browserSecret, request };
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
