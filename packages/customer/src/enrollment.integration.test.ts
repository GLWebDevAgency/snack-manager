import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { confirmCustomerTestBrowser, prepareCustomerTestIntent } from './browser-test-fixture';
import type { VerificationReservation } from './port';
import type { EnrollmentBinding } from './enrollment-port';
import { withCustomerScope } from './client';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const token = () => randomBytes(32).toString('base64url');
function reservation(): VerificationReservation {
  const now = Date.now();
  return { tenantRef: `tenant_${hash().slice(0, 12)}`, parentRef: `parent_${hash().slice(0, 12)}`,
    browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash(), requestHash: hash(),
    challengeId: randomUUID(), phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-ciphertext',
    serviceSid: `VA${randomBytes(16).toString('hex')}`, evidenceReference: 'fixture', planExpiresAt: now + 600_000,
    expiresAt: now + 600_000, now, limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1,
      freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } };
}

integration('protected enrollment — real PostgreSQL', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(fixture.app); }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function verified(patch: Partial<VerificationReservation> = {}, ttl?: number) {
    const input = { ...reservation(), ...patch } as VerificationReservation;
    await confirmCustomerTestBrowser(repo, input);
    if (ttl) await fixture.admin.query(`WITH t AS (SELECT clock_timestamp() at)
      INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,browser_generation,state,created_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,0,'open',at-interval '10 minutes'+$7*interval '1 millisecond',at+$7*interval '1 millisecond' FROM t`,
    [input.parentRef, input.tenantRef, input.operationId, input.browserRef, input.browserHash, input.proofHash, ttl]);
    await prepareCustomerTestIntent(repo, input);
    expect((await repo.reserve(input)).kind).toBe('reserved');
    await repo.settleSend({ ...input, verificationSid: `VE${randomBytes(16).toString('hex')}` });
    const check = { ...input, checkId: randomUUID(), requestHash: hash() };
    expect(await repo.claimCheck(check)).not.toBeNull();
    const completion = { ...check, result: 'approved' as const, accountId: randomUUID(), sessionId: randomUUID(),
      sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000, existingSessionHash: null };
    const binding: EnrollmentBinding = { parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: input.browserRef,
      browserHash: input.browserHash, operationId: input.operationId, proofHash: input.proofHash, checkId: check.checkId };
    return { input, check, completion, binding, result: await repo.completeCheck(completion) };
  }
  async function protectedCandidate(patch: Partial<VerificationReservation> = {}) {
    const f = await verified(patch);
    const registration = { ...f.binding, registrationId: randomUUID(), origin: 'https://restaurant.example', rpId: 'restaurant.example', challenge: token(), userHandle: token() };
    expect(await repo.prepareEnrollmentKey(registration)).not.toBeNull();
    const credential = { credentialId: token(), publicKey: new Uint8Array([1, 2, 3]), counter: 0,
      deviceType: 'multiDevice' as const, backedUp: true, transports: ['internal' as const] };
    const key = { ...f.binding, registrationId: registration.registrationId, requestHash: hash(), credential };
    expect((await repo.recordEnrollmentKey(key))?.stage).toBe('assertion_required');
    const assertion = { ...f.binding, assertionId: randomUUID(), origin: registration.origin, rpId: registration.rpId, challenge: token() };
    expect(await repo.prepareEnrollmentAssertion(assertion)).not.toBeNull();
    const proof = { ...f.binding, assertionId: assertion.assertionId, requestHash: hash(), credentialId: credential.credentialId,
      counter: 0, deviceType: credential.deviceType, backedUp: true };
    expect((await repo.recordEnrollmentAssertion(proof))?.stage).toBe('recovery_required');
    const code = { ...f.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash: hash() };
    expect((await repo.issueEnrollmentRecovery(code))?.emitCode).toBe(true);
    const activation = { ...f.binding, activationId: randomUUID(), requestHash: hash(), recoveryVersion: 1, codeHash: code.codeHash,
      accountId: randomUUID(), sessionId: randomUUID(), sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000 };
    return { ...f, registration, key, assertion, proof, code, activation };
  }
  it('OTP alone creates only a provisional receipt, never an account, contact, session or publication', async () => {
    const f = await verified();
    expect(f.result).toMatchObject({ kind: 'enrollment', enrollment: { operationId: f.input.operationId,
      checkId: f.check.checkId, stage: 'registration_required', recoveryVersion: 0 } });
    for (const table of ['accounts', 'verified_contacts', 'sessions', 'session_publications']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [f.input.parentRef])).rowCount).toBe(0);
    }
  });
  it('requires the exact private intention, scope and check; replay never calls or reconsumes OTP', async () => {
    const f = await verified();
    expect(await repo.completeCheck(f.completion)).toEqual(f.result);
    expect(await repo.recoverCheck({ ...f.check, sessionHash: f.completion.sessionHash })).toEqual(f.result);
    for (const patch of [{ tenantRef: 'other' }, { parentRef: 'other' }, { proofHash: hash() }, { browserHash: hash() }, { checkId: randomUUID() }]) {
      expect(await repo.readEnrollment({ ...f.binding, ...patch })).toBeNull();
    }
    expect(await repo.authenticate({ ...f.input, sessionHash: f.completion.sessionHash,
      expectedOperationId: f.input.operationId, expectedCheckId: f.check.checkId })).toBeNull();
    expect((await fixture.app.query('SELECT 1 FROM customer.registration_enrollments')).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT checks_used FROM customer.challenges WHERE id=$1', [f.input.challengeId])).rows[0].checks_used).toBe(1);
  });
  it('binds registration/assertion and never treats registration alone as usable protection', async () => {
    const f = await verified();
    expect(await repo.issueEnrollmentRecovery({ ...f.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash: hash() })).toBeNull();
    const registration = { ...f.binding, registrationId: randomUUID(), origin: 'https://restaurant.example', rpId: 'restaurant.example', challenge: token(), userHandle: token() };
    const first = await repo.prepareEnrollmentKey(registration);
    expect(await repo.prepareEnrollmentKey({ ...registration, challenge: token(), userHandle: token() })).toEqual(first);
    expect(await repo.prepareEnrollmentKey({ ...registration, registrationId: randomUUID() })).toBeNull();
    expect(() => repo.prepareEnrollmentKey({ ...registration, origin: 'https://other.example' })).toThrow();
    const key = { ...f.binding, registrationId: registration.registrationId, requestHash: hash(), credential: {
      credentialId: token(), publicKey: new Uint8Array([1]), counter: 1, deviceType: 'singleDevice' as const, backedUp: false, transports: [] } };
    expect(await repo.recordEnrollmentKey(key)).not.toBeNull();
    expect(await repo.recordEnrollmentKey({ ...key, requestHash: hash() })).toBeNull();
    expect(await repo.issueEnrollmentRecovery({ ...f.binding, rotationId: randomUUID(), expectedVersion: 0, codeHash: hash() })).toBeNull();
    const assertion = { ...f.binding, assertionId: randomUUID(), origin: registration.origin, rpId: registration.rpId, challenge: token() };
    expect(await repo.prepareEnrollmentAssertion({ ...assertion, origin: 'https://other.example', rpId: 'other.example' })).toBeNull();
    expect(await repo.prepareEnrollmentAssertion(assertion)).not.toBeNull();
    expect(await repo.recordEnrollmentAssertion({ ...f.binding, assertionId: assertion.assertionId, requestHash: hash(),
      credentialId: key.credential.credentialId, counter: 1, deviceType: 'singleDevice', backedUp: false })).toBeNull();
  });
  it('rotates only explicitly up to three versions; a lost response never emits an old or new candidate', async () => {
    const f = await protectedCandidate();
    expect((await repo.issueEnrollmentRecovery({ ...f.code, codeHash: hash() }))?.emitCode).toBe(false);
    expect(await repo.issueEnrollmentRecovery({ ...f.code, rotationId: randomUUID() })).toBeNull();
    for (const version of [1, 2]) expect((await repo.issueEnrollmentRecovery({ ...f.code, rotationId: randomUUID(), expectedVersion: version, codeHash: hash() }))?.emitCode).toBe(true);
    expect(await repo.issueEnrollmentRecovery({ ...f.code, rotationId: randomUUID(), expectedVersion: 3, codeHash: hash() })).toBeNull();
    expect(await repo.activateEnrollment(f.activation)).toBeNull();
    expect((await fixture.admin.query('SELECT 1 FROM customer.accounts WHERE parent_ref=$1', [f.input.parentRef])).rowCount).toBe(0);
  });
  it('atomically activates exactly once and recovers the exact current session after response loss', async () => {
    const f = await protectedCandidate();
    const results = await Promise.all([repo.activateEnrollment(f.activation), repo.activateEnrollment(f.activation)]);
    expect(results[0]).not.toBeNull(); expect(results[1]).toEqual(results[0]);
    expect(await repo.recoverEnrollmentActivation({ ...f.binding, activationId: f.activation.activationId, sessionHash: f.activation.sessionHash })).toEqual(results[0]);
    expect(await repo.activateEnrollment({ ...f.activation, requestHash: hash() })).toBeNull();
    expect(await repo.readEnrollment(f.binding)).toBeNull();
    for (const table of ['accounts', 'verified_contacts', 'passkey_credentials', 'recovery_codes', 'sessions', 'session_publications']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [f.input.parentRef])).rowCount).toBe(1);
    }
    const selection = { ...f.input, sessionHash: f.activation.sessionHash, expectedOperationId: f.input.operationId, expectedCheckId: f.activation.activationId };
    expect(await repo.authenticate(selection)).toEqual(results[0]);
    expect(await repo.authenticate({ ...selection, expectedCheckId: f.check.checkId })).toBeNull();
    await repo.revoke({ ...selection, all: false });
    expect(await repo.recoverEnrollmentActivation({ ...f.binding, activationId: f.activation.activationId, sessionHash: f.activation.sessionHash })).toBeNull();
  });
  it('pins one activation ID; explicit corrected code can finish but cannot rotate or replace the attempt', async () => {
    const f = await protectedCandidate();
    expect(await repo.activateEnrollment({ ...f.activation, codeHash: hash(), requestHash: hash() })).toBeNull();
    expect(await repo.activateEnrollment({ ...f.activation, activationId: randomUUID() })).toBeNull();
    expect(await repo.issueEnrollmentRecovery({ ...f.code, rotationId: randomUUID(), expectedVersion: 1, codeHash: hash() })).toBeNull();
    expect(await repo.activateEnrollment(f.activation)).not.toBeNull();
    const row = (await fixture.admin.query('SELECT failed_confirmations,activation_attempts FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows[0];
    expect(row.failed_confirmations).toBe(1); expect(row.activation_attempts).toHaveLength(1);
  });
  it('bounds failed confirmations durably at five, including concurrent explicit submissions', async () => {
    const f = await protectedCandidate();
    await Promise.all(Array.from({ length: 8 }, () => repo.activateEnrollment({ ...f.activation, codeHash: hash(), requestHash: hash() })));
    expect(await repo.activateEnrollment(f.activation)).toBeNull();
    expect((await fixture.admin.query('SELECT failed_confirmations FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows[0].failed_confirmations).toBe(5);
    expect((await fixture.admin.query('SELECT 1 FROM customer.accounts WHERE parent_ref=$1', [f.input.parentRef])).rowCount).toBe(0);
  });
  it('closes before activation and rolls back all account writes if publication fails', async () => {
    const closed = await protectedCandidate();
    await repo.closeIntent({ parentRef: closed.input.parentRef, tenantRef: closed.input.tenantRef, browserRef: closed.input.browserRef,
      browserHash: closed.input.browserHash, operationId: closed.input.operationId });
    expect(await repo.activateEnrollment(closed.activation)).toBeNull();
    const f = await protectedCandidate();
    await fixture.admin.query(`CREATE FUNCTION customer.fixture_fail_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$;
      CREATE TRIGGER fixture_fail_publication BEFORE INSERT ON customer.session_publications FOR EACH ROW EXECUTE FUNCTION customer.fixture_fail_publication()`);
    try { await expect(repo.activateEnrollment(f.activation)).rejects.toThrow(); }
    finally { await fixture.admin.query('DROP TRIGGER fixture_fail_publication ON customer.session_publications; DROP FUNCTION customer.fixture_fail_publication()'); }
    for (const table of ['accounts', 'verified_contacts', 'passkey_credentials', 'recovery_codes', 'sessions', 'session_publications']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [f.input.parentRef])).rowCount).toBe(0);
    }
    expect((await repo.readEnrollment(f.binding))?.stage).toBe('recovery_required');
    expect(await repo.activateEnrollment(f.activation)).not.toBeNull();
  });
  it('fences the exact 0005 INSERT and forbids a partial activation even with a real enrollment reference', async () => {
    const f = await protectedCandidate();
    await expect(withCustomerScope(fixture.app, f.input, c => c.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)',
      [randomUUID(), f.input.parentRef, f.input.tenantRef]))).rejects.toThrow();
    let insertedBeforeCommit = false;
    await expect(withCustomerScope(fixture.app, f.input, async c => {
      await c.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref,enrollment_id) VALUES($1,$2,$3,$4)',
        [randomUUID(), f.input.parentRef, f.input.tenantRef, f.check.checkId]);
      insertedBeforeCommit = true;
    })).rejects.toThrow();
    expect(insertedBeforeCommit).toBe(true); // The deferred guard, not an earlier FK, refused COMMIT.
    expect((await fixture.admin.query('SELECT 1 FROM customer.accounts WHERE parent_ref=$1', [f.input.parentRef])).rowCount).toBe(0);
  });
  it('preserves immutable OTP/protection evidence and refuses unexpected private input before SQL', async () => {
    const f = await protectedCandidate();
    expect(() => repo.readEnrollment({ ...f.binding, extra: 'private-fixture' } as EnrollmentBinding)).toThrow();
    for (const sql of ['DELETE FROM customer.registration_enrollments WHERE id=$1',
      "UPDATE customer.registration_enrollments SET expires_at=expires_at+interval '1 second' WHERE id=$1",
      "UPDATE customer.registration_enrollments SET registration_challenge=repeat('A',43) WHERE id=$1",
      "UPDATE customer.check_attempts SET state='rejected' WHERE id=$1"]) {
      await expect(fixture.admin.query(sql, [f.check.checkId])).rejects.toMatchObject({ code: '23514' });
    }
    expect(await repo.activateEnrollment(f.activation)).not.toBeNull();
    for (const table of ['passkey_credentials', 'recovery_codes']) {
      expect((await fixture.app.query(`SELECT 1 FROM customer.${table}`)).rowCount).toBe(0);
      await expect(fixture.admin.query(`DELETE FROM customer.${table} WHERE account_id=$1`, [f.activation.accountId])).rejects.toMatchObject({ code: '23514' });
    }
  });
  it('reads only existing challenge snapshots and preserves the original assertion counter after success', async () => {
    const f = await verified(); const registrationId = randomUUID(); const assertionId = randomUUID();
    const before = (await fixture.admin.query('SELECT * FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows;
    expect(await repo.readEnrollmentKey({ ...f.binding, registrationId })).toBeNull();
    expect(await repo.readEnrollmentAssertion({ ...f.binding, assertionId })).toBeNull();
    expect((await fixture.admin.query('SELECT * FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows).toEqual(before);
    await repo.prepareEnrollmentKey({ ...f.binding, registrationId, origin: 'https://fixture.example', rpId: 'fixture.example', challenge: token(), userHandle: token() });
    const credential = { credentialId: token(), publicKey: new Uint8Array([1]), counter: 0, deviceType: 'singleDevice' as const, backedUp: false, transports: [] };
    await repo.recordEnrollmentKey({ ...f.binding, registrationId, requestHash: hash(), credential });
    const first = await repo.prepareEnrollmentAssertion({ ...f.binding, assertionId, origin: 'https://fixture.example', rpId: 'fixture.example', challenge: token() });
    const receipt = { ...f.binding, assertionId, requestHash: hash(), credentialId: credential.credentialId, counter: 1, deviceType: credential.deviceType, backedUp: false };
    expect(await repo.recordEnrollmentAssertion(receipt)).not.toBeNull();
    expect(await repo.readEnrollmentAssertion({ ...f.binding, assertionId })).toEqual(first);
    expect(await repo.recordEnrollmentAssertion(receipt)).not.toBeNull();
    expect(await repo.recordEnrollmentAssertion({ ...receipt, requestHash: hash() })).toBeNull();
    expect((await fixture.admin.query('SELECT credential FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows[0].credential.counter).toBe(1);
  });
  it('rechecks SQL expiry after waiting on the parent lock, with no late key preparation or TTL renewal', async () => {
    const f = await verified({}, 400);
    const before = (await fixture.admin.query('SELECT * FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows;
    const blocker = await fixture.admin.connect(); await blocker.query('BEGIN');
    try {
      await blocker.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [f.input.parentRef]);
      const pending = repo.prepareEnrollmentKey({ ...f.binding, registrationId: randomUUID(), origin: 'https://fixture.example', rpId: 'fixture.example', challenge: token(), userHandle: token() });
      await blocker.query('SELECT pg_sleep(0.45)'); await blocker.query('COMMIT');
      expect(await pending).toBeNull();
      expect((await fixture.admin.query('SELECT * FROM customer.registration_enrollments WHERE id=$1', [f.check.checkId])).rows).toEqual(before);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });
  it('serializes competing publications captured at the same browser generation', async () => {
    const a = await protectedCandidate();
    const b = await protectedCandidate({ parentRef: a.input.parentRef, tenantRef: a.input.tenantRef,
      browserRef: a.input.browserRef, browserHash: a.input.browserHash });
    const results = await Promise.all([repo.activateEnrollment(a.activation), repo.activateEnrollment(b.activation)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const selected = results[0] ? a : b; const refused = results[0] ? b : a;
    expect(await repo.activateEnrollment(refused.activation)).toBeNull();
    await repo.closeIntent({ parentRef: refused.input.parentRef, tenantRef: refused.input.tenantRef, browserRef: refused.input.browserRef,
      browserHash: refused.input.browserHash, operationId: refused.input.operationId });
    expect(await repo.recoverEnrollmentActivation({ ...selected.binding, activationId: selected.activation.activationId,
      sessionHash: selected.activation.sessionHash })).not.toBeNull();
    expect((await fixture.admin.query('SELECT 1 FROM customer.accounts WHERE parent_ref=$1', [a.input.parentRef])).rowCount).toBe(1);
  });
  it('never duplicates or adopts the same tenant phone across provider parents, including concurrent activation', async () => {
    const a = await protectedCandidate();
    const b = await protectedCandidate({ tenantRef: a.input.tenantRef, phoneHash: a.input.phoneHash });
    const results = await Promise.all([repo.activateEnrollment(a.activation), repo.activateEnrollment(b.activation)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await fixture.admin.query('SELECT 1 FROM customer.accounts WHERE tenant_ref=$1', [a.input.tenantRef])).rowCount).toBe(1);
    expect((await fixture.admin.query('SELECT sum(reserved_sends)::int AS total FROM customer.parent_budgets WHERE parent_ref=ANY($1)',
      [[a.input.parentRef, b.input.parentRef]])).rows[0].total).toBe(2);
  });
});
