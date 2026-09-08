import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { accessTestHash as hash, accessTestToken as token, prepareAccessTestIntent, protectedAccessTestAccount } from './access-test-fixture';
import type { CustomerAccessBinding } from './access-port';
import { confirmCustomerTestBrowser } from './browser-test-fixture';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('recovery grant — non-consuming until complete reprotection', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>, repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(f.app); }, 20_000);
  afterAll(async () => { await f?.close(); });
  const close = (b: CustomerAccessBinding) => repo.closeIntent({ parentRef: b.parentRef, tenantRef: b.tenantRef,
    browserRef: b.browserRef, browserHash: b.browserHash, operationId: b.operationId });
  async function begun(ttlMs?: number) {
    const account = await protectedAccessTestAccount(repo, f.admin);
    let binding: CustomerAccessBinding;
    if (ttlMs) {
      binding = { parentRef: account.input.parentRef, tenantRef: account.input.tenantRef, browserRef: randomUUID(), browserHash: hash(),
        operationId: randomUUID(), attemptId: randomUUID(), proofHash: hash() };
      await confirmCustomerTestBrowser(repo, binding);
      await f.admin.query(`WITH stamp AS MATERIALIZED(SELECT clock_timestamp() now)
        INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,browser_generation,state,created_at,expires_at)
        SELECT $1,$2,$3,$4,$5,$6,0,'open',stamp.now-interval '10 minutes'+$7*interval '1 millisecond',stamp.now+$7*interval '1 millisecond' FROM stamp`,
      [binding.parentRef, binding.tenantRef, binding.operationId, binding.browserRef, binding.browserHash, binding.proofHash, ttlMs]);
    } else binding = await prepareAccessTestIntent(repo, account.input);
    const begin = { ...binding, sourceHash: hash(), requestHash: hash(), codeHash: account.codeHash };
    expect(await repo.beginAccountRecovery(begin)).toMatchObject({ state: 'granted', grant: { recoveryVersion: 0, stage: 'registration_required' } });
    return { account, binding, begin };
  }
  async function protectedGrant(x: Awaited<ReturnType<typeof begun>>) {
    const registration = { ...x.binding, registrationId: randomUUID(), origin: x.account.origin, rpId: x.account.rpId, challenge: token(), userHandle: token() };
    expect(await repo.prepareRecoveryKey(registration)).not.toBeNull();
    const credential = { credentialId: token(), publicKey: new Uint8Array([4, 5, 6]), counter: 0,
      deviceType: 'multiDevice' as const, backedUp: true, transports: ['internal' as const] };
    const key = { ...x.binding, registrationId: registration.registrationId, requestHash: hash(), credential };
    expect(await repo.recordRecoveryKey(key)).toMatchObject({ stage: 'assertion_required' });
    const assertion = { ...x.binding, assertionId: randomUUID(), origin: registration.origin, rpId: registration.rpId, challenge: token() };
    expect(await repo.prepareRecoveryAssertion(assertion)).not.toBeNull();
    const proof = { ...x.binding, assertionId: assertion.assertionId, requestHash: hash(), credentialId: credential.credentialId,
      counter: 1, deviceType: credential.deviceType, backedUp: true };
    expect(await repo.recordRecoveryAssertion(proof)).toMatchObject({ stage: 'recovery_required' });
    const code = { ...x.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash: hash() };
    expect((await repo.issueRecoveryReplacement(code))?.emitCode).toBe(true);
    const activation = { ...x.binding, activationId: randomUUID(), requestHash: hash(), recoveryVersion: 1, codeHash: code.codeHash,
      sessionId: randomUUID(), sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000 };
    return { ...x, registration, key, assertion, proof, code, activation };
  }
  it('leaves source code, old key and sessions unchanged; only one live grant per account', async () => {
    const x = await begun();
    const original = await repo.authenticate(x.account.selection);
    expect(original?.sessionId).toBe(x.account.session.sessionId);
    const source = await f.admin.query('SELECT consumed_at,revoked_at FROM customer.recovery_codes WHERE code_hash=$1', [x.account.codeHash]);
    expect(source.rows[0]).toEqual({ consumed_at: null, revoked_at: null });
    expect(await repo.beginAccountRecovery(x.begin)).toMatchObject({ state: 'granted' });
    const other = { ...await prepareAccessTestIntent(repo, x.account.input), sourceHash: hash(), requestHash: hash(), codeHash: x.account.codeHash };
    expect(await repo.beginAccountRecovery(other)).toMatchObject({ state: 'denied' });
    expect((await f.admin.query("SELECT 1 FROM customer.account_recovery_grants WHERE account_id=$1 AND state='open'", [x.account.completion.accountId])).rowCount).toBe(1);
  });
  it('closing a grant permits an explicit new attempt without burning the code or refunding quotas', async () => {
    const x = await begun(); await close(x.binding);
    expect(await repo.readAccountRecovery(x.binding)).toMatchObject({ state: 'closed' });
    const other = { ...await prepareAccessTestIntent(repo, x.account.input), sourceHash: hash(), requestHash: hash(), codeHash: x.account.codeHash };
    expect(await repo.beginAccountRecovery(other)).toMatchObject({ state: 'granted' });
    expect((await f.admin.query('SELECT consumed_at FROM customer.recovery_codes WHERE code_hash=$1', [x.account.codeHash])).rows[0].consumed_at).toBeNull();
    expect((await f.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [x.binding.parentRef])).rowCount).toBe(2);
  });
  it('requires a real assertion, exact step IDs and immutable original counter snapshots', async () => {
    const x = await begun();
    expect(await repo.issueRecoveryReplacement({ ...x.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash: hash() })).toBeNull();
    const p = await protectedGrant(x);
    expect(await repo.prepareRecoveryKey({ ...p.registration, challenge: token(), userHandle: token() })).toMatchObject({ challenge: p.registration.challenge, userHandle: p.registration.userHandle });
    expect(await repo.readRecoveryKey({ ...p.binding, registrationId: randomUUID() })).toBeNull();
    expect(await repo.readRecoveryAssertion({ ...p.binding, assertionId: p.assertion.assertionId })).toMatchObject({ credential: { counter: 0 } });
    expect(await repo.recordRecoveryAssertion(p.proof)).not.toBeNull();
    expect(await repo.recordRecoveryAssertion({ ...p.proof, requestHash: hash() })).toBeNull();
    for (const patch of [{ tenantRef: 'other' }, { parentRef: 'other' }, { proofHash: hash() }, { browserHash: hash() }, { attemptId: randomUUID() }])
      expect(await repo.readAccountRecovery({ ...x.binding, ...patch })).toBeNull();
  });
  it('publishes one session, consumes source once, replaces keys and revokes every prior session atomically', async () => {
    const x = await protectedGrant(await begun());
    const outcomes = await Promise.all([repo.activateAccountRecovery(x.activation), repo.activateAccountRecovery(x.activation)]);
    expect(outcomes[0]?.profile.accountId).toBe(x.account.completion.accountId); expect(outcomes[1]).toEqual(outcomes[0]);
    expect(await repo.recoverAccountRecoveryActivation({ ...x.binding, activationId: x.activation.activationId, sessionHash: x.activation.sessionHash })).toEqual(outcomes[0]);
    expect(await repo.authenticate(x.account.selection)).toBeNull();
    const codes = (await f.admin.query('SELECT version,code_hash,consumed_at FROM customer.recovery_codes WHERE account_id=$1 ORDER BY version', [x.account.completion.accountId])).rows;
    expect(codes).toHaveLength(2); expect(codes[0].consumed_at).toBeInstanceOf(Date); expect(codes[1]).toMatchObject({ version: '2', code_hash: x.code.codeHash, consumed_at: null });
    const keys = (await f.admin.query('SELECT credential_id,revoked_at FROM customer.passkey_credentials WHERE account_id=$1 ORDER BY created_at', [x.account.completion.accountId])).rows;
    expect(keys).toHaveLength(2); expect(keys[0].revoked_at).toBeInstanceOf(Date); expect(keys[1].revoked_at).toBeNull();
    expect((await f.admin.query('SELECT method,check_id FROM customer.session_publications WHERE session_id=$1', [x.activation.sessionId])).rows[0])
      .toEqual({ method: 'recovery', check_id: x.activation.activationId });
    const retry = { ...await prepareAccessTestIntent(repo, x.account.input), sourceHash: hash(), requestHash: hash(), codeHash: x.account.codeHash };
    expect(await repo.beginAccountRecovery(retry)).toMatchObject({ state: 'denied' });
  });
  it('uses relative code versions, never re-emits old plaintext, and stores source version plus one', async () => {
    const x = await protectedGrant(await begun());
    expect((await repo.issueRecoveryReplacement({ ...x.code, codeHash: hash() }))?.emitCode).toBe(false);
    let replacement = x.code.codeHash;
    for (const expectedVersion of [1, 2]) { replacement = hash();
      expect((await repo.issueRecoveryReplacement({ ...x.code, rotationId: randomUUID(), expectedVersion, codeHash: replacement }))?.grant.recoveryVersion).toBe(expectedVersion + 1); }
    expect(await repo.issueRecoveryReplacement({ ...x.code, rotationId: randomUUID(), expectedVersion: 3 })).toBeNull();
    expect(await repo.activateAccountRecovery({ ...x.activation, recoveryVersion: 3, codeHash: replacement })).not.toBeNull();
    expect((await f.admin.query('SELECT version FROM customer.recovery_codes WHERE code_hash=$1', [replacement])).rows[0].version).toBe('2');
  });
  it('pins activation ID, bounds incorrect confirmations and never consumes after five failures', async () => {
    const x = await protectedGrant(await begun());
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.activateAccountRecovery({ ...x.activation, codeHash: hash() })));
    expect(results.every(r => r === null)).toBe(true);
    expect((await f.admin.query('SELECT failed_confirmations FROM customer.account_recovery_grants WHERE id=$1', [x.binding.attemptId])).rows[0].failed_confirmations).toBe(5);
    expect(await repo.activateAccountRecovery(x.activation)).toBeNull();
    expect(await repo.activateAccountRecovery({ ...x.activation, activationId: randomUUID() })).toBeNull();
    expect((await f.admin.query('SELECT consumed_at FROM customer.recovery_codes WHERE code_hash=$1', [x.account.codeHash])).rows[0].consumed_at).toBeNull();
  });
  it('rolls all replacements back if a unique credential conflicts, retaining the usable source code', async () => {
    const x = await begun(), p = await protectedGrant(x);
    // Another parent is not needed here: reusing the old immutable PK is itself
    // an exact credential collision, even after marking that key revoked.
    const y = await begun();
    const registration = { ...y.binding, registrationId: randomUUID(), origin: y.account.origin, rpId: y.account.rpId, challenge: token(), userHandle: token() };
    await repo.prepareRecoveryKey(registration);
    await repo.recordRecoveryKey({ ...y.binding, registrationId: registration.registrationId, requestHash: hash(), credential: y.account.credential });
    const assertion = { ...y.binding, assertionId: randomUUID(), origin: registration.origin, rpId: registration.rpId, challenge: token() };
    await repo.prepareRecoveryAssertion(assertion);
    await repo.recordRecoveryAssertion({ ...y.binding, assertionId: assertion.assertionId, requestHash: hash(), credentialId: y.account.credential.credentialId, counter: 1, deviceType: 'multiDevice', backedUp: true });
    const codeHash = hash(); await repo.issueRecoveryReplacement({ ...y.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash });
    await expect(repo.activateAccountRecovery({ ...p.activation, ...y.binding, codeHash, sessionId: randomUUID() })).rejects.toThrow();
    expect((await f.admin.query('SELECT consumed_at FROM customer.recovery_codes WHERE code_hash=$1', [y.account.codeHash])).rows[0].consumed_at).toBeNull();
    expect(await repo.authenticate(y.account.selection)).not.toBeNull();
    expect((await f.admin.query('SELECT 1 FROM customer.passkey_credentials WHERE account_id=$1', [y.account.completion.accountId])).rowCount).toBe(1);
  });
  it('close during reprotection prevents activation without modifying the existing account', async () => {
    const x = await protectedGrant(await begun()); await close(x.binding);
    expect(await repo.activateAccountRecovery(x.activation)).toBeNull();
    expect(await repo.authenticate(x.account.selection)).not.toBeNull();
  });
  it('an expired grant releases only exclusivity, not a consumed code or the durable attempt count', async () => {
    const x = await begun(300);
    await f.admin.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02)
      FROM customer.account_recovery_grants WHERE id=$1`, [x.binding.attemptId]);
    expect(await repo.readAccountRecovery(x.binding)).toMatchObject({ state: 'expired' });
    const next = { ...await prepareAccessTestIntent(repo, x.account.input), sourceHash: x.begin.sourceHash, requestHash: hash(), codeHash: x.account.codeHash };
    expect(await repo.beginAccountRecovery(next)).toMatchObject({ state: 'granted' });
    expect((await f.admin.query('SELECT state FROM customer.account_recovery_grants WHERE id=$1', [x.binding.attemptId])).rows[0].state).toBe('expired');
    expect((await f.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [x.binding.parentRef])).rowCount).toBe(2);
    expect(await repo.authenticate(x.account.selection)).not.toBeNull();
  });
  it('keeps the full session valid after the short grant expires, but never recovers it from the expired provisional proof', async () => {
    const x = await protectedGrant(await begun(1500));
    expect(await repo.activateAccountRecovery(x.activation)).not.toBeNull();
    await f.admin.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.02)
      FROM customer.account_recovery_grants WHERE id=$1`, [x.binding.attemptId]);
    expect(await repo.recoverAccountRecoveryActivation({ ...x.binding, activationId: x.activation.activationId, sessionHash: x.activation.sessionHash })).toBeNull();
    expect(await repo.authenticate({ ...x.binding, sessionHash: x.activation.sessionHash,
      expectedOperationId: x.binding.operationId, expectedCheckId: x.activation.activationId, now: Date.now() })).not.toBeNull();
  });
  it('an old key claim held in flight fails after recovery and cannot undo its new publication', async () => {
    const x = await protectedGrant(await begun());
    const login = await prepareAccessTestIntent(repo, x.account.input);
    await repo.preparePasskeyLogin({ ...login, sourceHash: hash(), origin: x.account.origin, rpId: x.account.rpId, challenge: token() });
    const claim = { ...login, requestHash: hash(), credentialId: x.account.credential.credentialId, userHandle: x.account.userHandle };
    expect(await repo.claimPasskeyLogin(claim)).not.toBeNull();
    expect(await repo.activateAccountRecovery(x.activation)).not.toBeNull();
    expect(await repo.completePasskeyLogin({ ...login, requestHash: claim.requestHash,
      assertion: { credentialId: claim.credentialId, counter: 1, deviceType: 'multiDevice', backedUp: true },
      sessionId: randomUUID(), sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000 })).toBeNull();
    expect(await repo.resultPasskeyLogin({ ...login, sessionHash: null })).toMatchObject({ state: 'failed' });
    expect(await repo.recoverAccountRecoveryActivation({ ...x.binding, activationId: x.activation.activationId, sessionHash: x.activation.sessionHash })).not.toBeNull();
  });
  it('rolls back consumption, key/session revocations and replacements when expiry occurs immediately before publication', async () => {
    const x = await protectedGrant(await begun(2000));
    const tables = ['accounts', 'recovery_codes', 'passkey_credentials', 'sessions', 'session_publications'];
    const snapshot = () => Promise.all(tables.map(async table => (await f.admin.query(`SELECT * FROM customer.${table} WHERE parent_ref=$1 ORDER BY 1`, [x.binding.parentRef])).rows));
    const before = await snapshot();
    await f.admin.query(`CREATE SEQUENCE customer.fixture_recovery_deadline_hits;
      GRANT USAGE ON SEQUENCE customer.fixture_recovery_deadline_hits TO "${f.role}";
      CREATE FUNCTION customer.fixture_recovery_deadline() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE deadline timestamptz; remaining double precision;
      BEGIN
        SELECT g.expires_at INTO deadline FROM customer.account_recovery_grants g
          JOIN customer.accounts a ON (a.parent_ref,a.tenant_ref,a.id)=(g.parent_ref,g.tenant_ref,g.account_id)
          JOIN customer.recovery_codes c ON (c.parent_ref,c.tenant_ref,c.account_id,c.version)=(g.parent_ref,g.tenant_ref,g.account_id,g.source_version)
          JOIN customer.passkey_credentials k ON (k.parent_ref,k.tenant_ref,k.account_id)=(g.parent_ref,g.tenant_ref,g.account_id)
          JOIN customer.sessions s ON (s.parent_ref,s.tenant_ref,s.account_id)=(g.parent_ref,g.tenant_ref,g.account_id)
          WHERE g.parent_ref=NEW.parent_ref AND g.tenant_ref=NEW.tenant_ref AND g.browser_hash=NEW.browser_hash
            AND g.state='open' AND s.id=NEW.current_session_id AND c.consumed_at IS NOT NULL
            AND a.session_version=g.account_version+1 AND k.credential_id=g.credential->>'credentialId' AND k.revoked_at IS NULL;
        remaining := extract(epoch FROM deadline-clock_timestamp());
        IF deadline IS NULL OR remaining<=0 OR remaining>2.5 THEN RAISE EXCEPTION 'Fixture checkpoint missing'; END IF;
        PERFORM nextval('customer.fixture_recovery_deadline_hits');
        PERFORM pg_sleep(remaining+0.02);
        IF clock_timestamp()<deadline THEN RAISE EXCEPTION 'Fixture expiry missing'; END IF;
        PERFORM nextval('customer.fixture_recovery_deadline_hits'); RETURN NEW;
      END; $$;
      CREATE TRIGGER fixture_recovery_deadline BEFORE UPDATE OF current_session_id ON customer.browser_contexts
        FOR EACH ROW WHEN(NEW.current_session_id IS NOT NULL) EXECUTE FUNCTION customer.fixture_recovery_deadline()`);
    try {
      await expect(repo.activateAccountRecovery(x.activation)).rejects.toThrow();
      expect((await f.admin.query('SELECT last_value,is_called FROM customer.fixture_recovery_deadline_hits')).rows[0]).toEqual({ last_value: '2', is_called: true });
      expect(await snapshot()).toEqual(before);
      expect(await repo.activateAccountRecovery(x.activation)).toBeNull();
      expect(await repo.authenticate(x.account.selection)).not.toBeNull();
      expect((await f.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [x.binding.parentRef])).rowCount).toBe(1);
    } finally { await f.admin.query(`DROP TRIGGER fixture_recovery_deadline ON customer.browser_contexts;
      DROP FUNCTION customer.fixture_recovery_deadline(); DROP SEQUENCE customer.fixture_recovery_deadline_hits`); }
  }, 10_000);
});
