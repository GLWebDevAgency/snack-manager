import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { accessTestHash as hash, accessTestToken as token, prepareAccessTestIntent, protectedAccessTestAccount } from './access-test-fixture';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('passkey login — real publication and browser fences', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>, repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(f.app); }, 20_000);
  afterAll(async () => { await f?.close(); });
  const close = (b: { parentRef: string; tenantRef: string; browserRef: string; browserHash: string; operationId: string }) =>
    repo.closeIntent({ parentRef: b.parentRef, tenantRef: b.tenantRef, browserRef: b.browserRef, browserHash: b.browserHash, operationId: b.operationId });
  async function prepared() {
    const account = await protectedAccessTestAccount(repo, f.admin), binding = await prepareAccessTestIntent(repo, account.input);
    const options = { ...binding, sourceHash: hash(), origin: account.origin, rpId: account.rpId, challenge: token() };
    expect(await repo.preparePasskeyLogin(options)).not.toBeNull();
    const claim = { ...binding, requestHash: hash(), credentialId: account.credential.credentialId, userHandle: account.userHandle };
    const completion = { ...binding, requestHash: claim.requestHash,
      assertion: { credentialId: claim.credentialId, counter: 1, deviceType: account.credential.deviceType, backedUp: true },
      sessionId: randomUUID(), sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000 };
    return { account, binding, options, claim, completion };
  }
  it('single-flights the exact assertion and publishes/retrieves only its current receipt', async () => {
    const x = await prepared();
    const claimed = await Promise.all([repo.claimPasskeyLogin(x.claim), repo.claimPasskeyLogin(x.claim)]);
    expect(claimed.filter(Boolean)).toHaveLength(1);
    expect(claimed.find(Boolean)).toMatchObject({ challenge: x.options.challenge, userHandle: x.account.userHandle,
      credential: { counter: 0, credentialId: x.claim.credentialId } });
    expect(await repo.claimPasskeyLogin({ ...x.claim, requestHash: hash() })).toBeNull();
    const results = await Promise.all([repo.completePasskeyLogin(x.completion), repo.completePasskeyLogin(x.completion)]);
    expect(results[0]?.profile.accountId).toBe(x.account.completion.accountId); expect(results[1]).toEqual(results[0]);
    const receipt = await repo.resultPasskeyLogin({ ...x.binding, sessionHash: x.completion.sessionHash });
    expect(receipt).toMatchObject({ state: 'approved', session: results[0] });
    expect(await repo.resultPasskeyLogin({ ...x.binding, sessionHash: null })).toMatchObject({ state: 'approved', session: null });
    expect(await repo.resultPasskeyLogin({ ...x.binding, sessionHash: hash() })).toBeNull();
    expect(await repo.completePasskeyLogin({ ...x.completion, requestHash: hash() })).toBeNull();
    const pub = (await f.admin.query('SELECT method,check_id FROM customer.session_publications WHERE session_id=$1', [x.completion.sessionId])).rows[0];
    expect(pub).toEqual({ method: 'passkey', check_id: x.binding.attemptId });
    expect((await f.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [x.binding.parentRef])).rows[0].reserved_sends).toBe('1');
  });
  it.each(['credential', 'userHandle', 'tenant', 'proof'] as const)('rejects wrong %s without publishing', async field => {
    const x = await prepared();
    const patch = field === 'credential' ? { credentialId: token() } : field === 'userHandle' ? { userHandle: token() }
      : field === 'tenant' ? { tenantRef: 'foreign' } : { proofHash: hash() };
    expect(await repo.claimPasskeyLogin({ ...x.claim, ...patch })).toBeNull();
    expect(await repo.completePasskeyLogin(x.completion)).toBeNull();
    expect((await f.admin.query('SELECT 1 FROM customer.sessions WHERE id=$1', [x.completion.sessionId])).rowCount).toBe(0);
  });
  it('keeps a verifier rejection terminal and a zero-counter success bound to one challenge', async () => {
    const x = await prepared(); await repo.claimPasskeyLogin(x.claim);
    expect(await repo.completePasskeyLogin({ ...x.completion, assertion: null })).toBeNull();
    expect(await repo.resultPasskeyLogin({ ...x.binding, sessionHash: null })).toMatchObject({ state: 'failed' });
    expect(await repo.completePasskeyLogin(x.completion)).toBeNull();
    const y = await prepared(); await repo.claimPasskeyLogin(y.claim);
    expect(await repo.completePasskeyLogin({ ...y.completion, assertion: { ...y.completion.assertion, counter: 0 } })).not.toBeNull();
  });
  it('closure and revocation during local verification prevent delayed publication', async () => {
    const x = await prepared(); await repo.claimPasskeyLogin(x.claim);
    await close(x.binding);
    expect(await repo.completePasskeyLogin(x.completion)).toBeNull();
    expect(await repo.resultPasskeyLogin({ ...x.binding, sessionHash: null })).toMatchObject({ state: 'closed' });
    const y = await prepared(); await repo.claimPasskeyLogin(y.claim);
    await repo.revoke({ ...y.account.selection, all: true });
    expect(await repo.completePasskeyLogin(y.completion)).toBeNull();
    expect(await repo.resultPasskeyLogin({ ...y.binding, sessionHash: null })).toMatchObject({ state: 'failed' });
  });
  it('old A after publication B or logout never regains private authority', async () => {
    const x = await prepared(); await repo.claimPasskeyLogin(x.claim); await repo.completePasskeyLogin(x.completion);
    const b = await prepareAccessTestIntent(repo, x.binding, x.binding);
    await repo.preparePasskeyLogin({ ...b, sourceHash: hash(), origin: x.account.origin, rpId: x.account.rpId, challenge: token() });
    const claim = { ...b, requestHash: hash(), credentialId: x.claim.credentialId, userHandle: x.claim.userHandle };
    await repo.claimPasskeyLogin(claim);
    const completion = { ...x.completion, ...b, requestHash: claim.requestHash, sessionId: randomUUID(), sessionHash: hash(),
      assertion: { ...x.completion.assertion, counter: 2 } };
    expect(await repo.completePasskeyLogin(completion)).not.toBeNull();
    expect(await repo.resultPasskeyLogin({ ...x.binding, sessionHash: x.completion.sessionHash })).toMatchObject({ state: 'failed' });
    await close(x.binding);
    expect(await repo.resultPasskeyLogin({ ...b, sessionHash: completion.sessionHash })).toMatchObject({ state: 'approved' });
    await repo.revoke({ ...b, sessionHash: completion.sessionHash, expectedOperationId: b.operationId, expectedCheckId: b.attemptId, now: Date.now(), all: false });
    expect(await repo.resultPasskeyLogin({ ...b, sessionHash: completion.sessionHash })).toMatchObject({ state: 'failed' });
  });
});
