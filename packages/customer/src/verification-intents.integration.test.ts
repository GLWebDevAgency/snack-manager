import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { confirmCustomerTestBrowser } from './browser-test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { completeCustomerTestAccount } from './enrollment-test-fixture';
import { CustomerRepositoryError, withCustomerScope } from './client';
import type { Pool } from 'pg';
import { migrateCustomer } from './migration';
import type { CustomerIntentBinding, VerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const binding = (): CustomerIntentBinding => ({ parentRef: `parent_${hash().slice(0, 16)}`, tenantRef: `tenant_${hash().slice(0, 16)}`,
  browserRef: randomUUID(), browserHash: hash(), operationId: randomUUID(), proofHash: hash() });
const closeInput = (i: CustomerIntentBinding) => ({ parentRef: i.parentRef, tenantRef: i.tenantRef,
  browserRef: i.browserRef, browserHash: i.browserHash, operationId: i.operationId });
const reservation = (i: CustomerIntentBinding): VerificationReservation => ({ ...i, challengeId: randomUUID(), requestHash: hash(),
  phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-only', serviceSid: `VA${hash().slice(0, 32)}`,
  evidenceReference: 'fixture', now: Date.now(), planExpiresAt: Date.now() + 60_000, expiresAt: Date.now() + 600_000,
  limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1, freeSmsUnitsRemainingAtObservation: 100,
    freeVerificationUnitsRemainingAtObservation: 100, cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10,
    tenantSendReservations: 10, phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } });

integration('verification intentions — PostgreSQL, no provider', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(fixture.app); }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function ready() { const i = binding(); await confirmCustomerTestBrowser(repo, i); return i; }
  async function admitted(i: CustomerIntentBinding) {
    await repo.prepareIntent(i);
    const r = reservation(i);
    expect((await repo.reserve(r)).kind).toBe('reserved');
    await repo.settleSend({ ...r, verificationSid: `VE${hash().slice(0, 32)}` });
    const claim = { ...r, requestHash: hash(), checkId: randomUUID() };
    expect(await repo.claimCheck(claim)).not.toBeNull();
    return { ...claim, expectedOperationId: claim.operationId, expectedCheckId: claim.checkId, result: 'approved' as const, sessionId: randomUUID(), sessionHash: hash(),
      accountId: randomUUID(), existingSessionHash: null, sessionExpiresAt: Date.now() + 604_800_000 };
  }
  async function historical(i: CustomerIntentBinding, remainingMs: number) {
    await fixture.admin.query(`WITH stamp AS (SELECT clock_timestamp() AS now)
      INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,
        browser_generation,state,created_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,0,'open',stamp.now+($7-600000)*interval '1 millisecond',stamp.now+$7*interval '1 millisecond' FROM stamp`,
    [i.parentRef, i.tenantRef, i.operationId, i.browserRef, i.browserHash, i.proofHash, remainingMs]);
  }

  it('issues one private proof only and never creates a budget during preparation or closure', async () => {
    const i = await ready();
    const attempts = await Promise.all([repo.prepareIntent(i), repo.prepareIntent({ ...i, proofHash: hash() })]);
    expect(attempts.filter(value => value?.emitCookie)).toHaveLength(1);
    expect((await repo.prepareIntent(i))?.emitCookie).toBe(false);
    expect((await repo.closeIntent(closeInput(i)))?.state).toBe('closed');
    for (const table of ['parent_budgets', 'reservations', 'browser_contexts']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [i.parentRef])).rowCount).toBe(0);
    }
  });

  it('closes before preparation/admission, permanently refusing the delayed start without a charge', async () => {
    const i = await ready(); const closed = await repo.closeIntent(closeInput(i));
    expect(closed?.state).toBe('closed');
    expect(await repo.prepareIntent(i)).toEqual({ intent: closed, emitCookie: false });
    expect(await repo.reserve(reservation(i))).toEqual({ kind: 'denied' });
    expect(await repo.closeIntent(closeInput(i))).toEqual(closed);
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
  });

  it('requires the private proof and never treats a missing check as terminal or approved', async () => {
    const i = await ready(); await repo.prepareIntent(i);
    expect(await repo.validateIntent({ ...i, proofHash: hash() })).toBeNull();
    expect(await repo.resultIntent({ ...i, proofHash: hash(), checkId: null, sessionHash: null })).toBeNull();
    const initial = await repo.resultIntent({ ...i, checkId: null, sessionHash: null });
    expect(initial?.state).toBe('unresolved');
    const r = reservation(i); expect((await repo.reserve(r)).kind).toBe('reserved');
    await repo.settleSend({ ...r, verificationSid: `VE${hash().slice(0, 32)}` });
    expect((await repo.resultIntent({ ...i, checkId: null, sessionHash: null }))?.state).toBe('code_required');
    expect((await repo.resultIntent({ ...i, checkId: randomUUID(), sessionHash: null }))?.state).toBe('unresolved');
  });

  it('recovers provisional OTP separately from exact protected activation without another check', async () => {
    const i = await ready(); const done = await admitted(i);
    const provisional = await repo.completeCheck(done); expect(provisional?.kind).toBe('enrollment');
    const selected = { ...i, checkId: done.checkId, sessionHash: null };
    expect(await repo.resultIntent(selected)).toMatchObject({ state: 'enrollment', challengeId: done.challengeId });
    expect(await repo.resultIntent({ ...selected, proofHash: hash() })).toBeNull();
    expect((await repo.resultIntent({ ...selected, checkId: randomUUID() }))?.state).toBe('unresolved');
    expect((await repo.resultIntent({ ...selected, checkId: null }))?.state).not.toBe('approved');
    expect(await repo.recoverCheck(done)).toEqual(provisional);
    expect(await repo.recoverCheck({ ...done, requestHash: hash() })).toBeNull();
    expect(await repo.completeCheck({ ...done, requestHash: hash() })).toBeNull();
    const published = await completeCustomerTestAccount(repo, done); expect(published).not.toBeNull();
    expect(await repo.recoverCheck(done)).toBeNull(); // OTP receipt never becomes a protected session.
    const binding = { parentRef: i.parentRef, tenantRef: i.tenantRef, browserRef: i.browserRef, browserHash: i.browserHash,
      operationId: i.operationId, proofHash: i.proofHash, checkId: done.checkId, activationId: done.checkId, sessionHash: done.sessionHash };
    expect(await repo.recoverEnrollmentActivation(binding)).toEqual(published);
    expect(await repo.recoverEnrollmentActivation({ ...binding, sessionHash: hash() })).toBeNull();
    expect((await fixture.admin.query('SELECT id FROM customer.check_attempts WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(1);
  });

  it('closes an admitted check before its delayed approval and keeps its budget spent', async () => {
    const i = await ready(); const done = await admitted(i);
    const before = (await fixture.admin.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rows;
    expect((await repo.closeIntent(closeInput(i)))?.state).toBe('closed');
    expect(await repo.completeCheck(done)).toBeNull();
    expect(await repo.claimCheck({ ...done, checkId: randomUUID() })).toBeNull();
    expect((await repo.resultIntent({ ...i, checkId: done.checkId, sessionHash: null }))?.state).toBe('closed');
    expect((await fixture.admin.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rows).toEqual(before);
    expect((await fixture.admin.query('SELECT id FROM customer.sessions WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
  });

  it('closes only its own still-current publication, never another intention B', async () => {
    const i = await ready(); const a = await admitted(i); await completeCustomerTestAccount(repo, a);
    const j = { ...i, operationId: randomUUID(), proofHash: hash() };
    const b = await admitted(j); const sessionB = await completeCustomerTestAccount(repo, b); expect(sessionB).not.toBeNull();
    await repo.closeIntent(closeInput(i));
    expect(await repo.authenticate(b)).toEqual(sessionB);
    expect(await repo.recoverCheck(a)).toBeNull();
    await repo.closeIntent(closeInput(j));
    expect(await repo.authenticate(b)).toBeNull();
    expect(await repo.recoverCheck(b)).toBeNull();
    expect((await fixture.admin.query('SELECT reserved_sends::int AS n FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rows[0].n).toBe(2);
  });

  it('serializes close versus approval and leaves no accessible closed publication whichever commits first', async () => {
    const i = await ready(); const done = await admitted(i);
    const results = await Promise.all([completeCustomerTestAccount(repo, done), repo.closeIntent(closeInput(i))]);
    expect(results[1]?.state).toBe('closed');
    expect(await repo.authenticate(done)).toBeNull();
    expect(await repo.recoverCheck(done)).toBeNull();
  });

  it('requires the selected publication for profile and mutations, so a late cookie cannot adopt another journal', async () => {
    const i = await ready(); const a = await admitted(i); await completeCustomerTestAccount(repo, a);
    const b = await admitted({ ...i, operationId: randomUUID(), proofHash: hash() });
    const current = await completeCustomerTestAccount(repo, b); expect(current).not.toBeNull();
    for (const wrong of [{ ...b, expectedOperationId: a.operationId, expectedCheckId: a.checkId },
      { ...b, expectedOperationId: randomUUID() }, { ...b, expectedCheckId: randomUUID() }]) {
      expect(await repo.authenticate(wrong)).toBeNull();
      expect(await repo.updateName({ ...wrong, encryptedName: 'must-not-write', expectedRevision: 0 })).toBeNull();
      for (const all of [false, true]) await repo.revoke({ ...wrong, all });
      expect(await repo.authenticate(b)).toEqual(current);
    }
    const { expectedOperationId: _op, expectedCheckId: _check, ...withoutJournal } = b;
    expect(() => repo.authenticate(withoutJournal as typeof b)).toThrow(CustomerRepositoryError);
  });

  it('keeps the selected seven-day session usable after the ten-minute recovery proof expires', async () => {
    const i = await ready(); await historical(i, 500);
    const done = await admitted(i); const published = await completeCustomerTestAccount(repo, done); expect(published).not.toBeNull();
    await fixture.admin.query('SELECT pg_sleep(0.55)');
    expect((await repo.resultIntent({ ...i, checkId: done.checkId, sessionHash: done.sessionHash }))?.state).toBe('expired');
    expect(await repo.authenticate(done)).toEqual(published);
    expect((await repo.updateName({ ...done, encryptedName: 'still-authorized', expectedRevision: 0 }))?.profile.revision).toBe(1);
    await repo.revoke({ ...done, all: false });
    expect(await repo.authenticate(done)).toBeNull();
  });

  it('captures generation before admission and refuses a previously prepared intent after another publication', async () => {
    const i = await ready(); await repo.prepareIntent(i);
    const b = await admitted({ ...i, operationId: randomUUID(), proofHash: hash() }); await completeCustomerTestAccount(repo, b);
    expect(await repo.reserve(reservation(i))).toEqual({ kind: 'denied' });
    expect(await repo.validateIntent(i)).toBeNull();
    await repo.closeIntent(closeInput(i));
    expect(await repo.authenticate(b)).not.toBeNull();
    expect((await fixture.admin.query('SELECT reserved_sends::int AS n FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rows[0].n).toBe(1);
  });

  it('does not let a wrong private proof finish or poison the real in-flight check', async () => {
    const i = await ready(); const done = await admitted(i);
    expect(await repo.completeCheck({ ...done, proofHash: hash() })).toBeNull();
    expect((await repo.resultIntent({ ...i, checkId: done.checkId, sessionHash: null }))?.state).toBe('unresolved');
    expect(await repo.completeCheck(done)).not.toBeNull();
  });

  it('rolls back account creation if intent expiry crosses the final publication statement', async () => {
    const i = await ready(); await historical(i, 500); const done = await admitted(i); let waited = 0;
    const expiry = (await repo.prepareIntent(i))!.intent.expiresAt;
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        if (sql.includes('INSERT INTO customer.sessions')) {
          waited++; await client.query('SELECT pg_sleep($1)', [Math.max(0, (expiry - Date.now()) / 1000) + 0.02]);
        }
        return client.query(sql, parameters);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(completeCustomerTestAccount(new PostgresCustomerIdentityRepository(interposed), done)).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect(waited).toBe(1);
    expect((await fixture.admin.query('SELECT id FROM customer.accounts WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT current_session_id,generation FROM customer.browser_contexts WHERE parent_ref=$1', [i.parentRef])).rows[0])
      .toEqual({ current_session_id: null, generation: '0' });
    expect((await fixture.admin.query('SELECT reserved_sends::int AS n FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rows[0].n).toBe(1);
  });

  it('retains one immutable body per check and exposes incorrect versus unresolved without retrying it', async () => {
    const i = await ready(); const done = await admitted(i);
    expect(await repo.claimCheck({ ...done, requestHash: hash() })).toBeNull();
    expect(await repo.completeCheck({ ...done, requestHash: hash() })).toBeNull();
    expect((await repo.resultIntent({ ...i, checkId: done.checkId, sessionHash: null }))?.state).toBe('unresolved');
    await repo.completeCheck({ ...done, result: 'pending' });
    expect((await repo.resultIntent({ ...i, checkId: done.checkId, sessionHash: null }))?.state).toBe('incorrect');
    expect(await repo.claimCheck(done)).toBeNull();
    await expect(fixture.admin.query('UPDATE customer.check_attempts SET request_hash=$2 WHERE id=$1', [done.checkId, hash()]))
      .rejects.toMatchObject({ code: '23514' });
    const next = { ...done, checkId: randomUUID(), requestHash: hash() };
    expect(await repo.claimCheck(next)).not.toBeNull();
    await repo.completeCheck({ ...next, result: 'uncertain' });
    expect((await repo.resultIntent({ ...i, checkId: next.checkId, sessionHash: null }))?.state).toBe('failed');
    expect(await repo.claimCheck({ ...next, checkId: randomUUID() })).toBeNull();
  });

  it('bounds live private proofs under concurrency and preserves tombstones/replays at lifetime capacity', async () => {
    const i = await ready();
    const candidates = Array.from({ length: 5 }, () => ({ ...i, operationId: randomUUID(), proofHash: hash() }));
    const results = await Promise.all(candidates.map(candidate => repo.prepareIntent(candidate)));
    expect(results.filter(result => result?.emitCookie)).toHaveLength(3);
    const issuedIndex = results.findIndex(result => result?.emitCookie);
    await repo.closeIntent(closeInput(candidates[issuedIndex]!));
    expect(await repo.prepareIntent(i)).toBeNull(); // Closing doesn't remove a possible late cookie.
    for (let n = 0; n < 124; n++) expect(await repo.closeIntent(closeInput({ ...i, operationId: randomUUID() }))).not.toBeNull();
    const race = await Promise.all([repo.closeIntent(closeInput(i)), repo.closeIntent(closeInput({ ...i, operationId: randomUUID() }))]);
    expect(race.filter(Boolean)).toHaveLength(1);
    expect((await repo.prepareIntent(candidates[issuedIndex]!))?.emitCookie).toBe(false);
    expect(await repo.closeIntent(closeInput({ ...i, operationId: randomUUID() }))).toBeNull();
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM customer.verification_intents WHERE parent_ref=$1', [i.parentRef])).rows[0].n).toBe(128);
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
  });

  it('makes expiration terminal and rechecks SQL time after a held row lock without creating a budget', async () => {
    const i = await ready(); await historical(i, 250);
    const blocker = await fixture.admin.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT operation_id FROM customer.verification_intents WHERE operation_id=$1 FOR UPDATE', [i.operationId]);
    const waiting = repo.reserve(reservation(i));
    await blocker.query('SELECT pg_sleep(0.35)'); await blocker.query('COMMIT'); blocker.release();
    expect(await waiting).toEqual({ kind: 'denied' });
    expect((await repo.prepareIntent(i))?.intent.state).toBe('expired');
    expect((await repo.prepareIntent({ ...i, proofHash: hash() }))?.emitCookie).toBe(false);
    expect(await repo.validateIntent(i)).toBeNull();
    expect((await repo.resultIntent({ ...i, checkId: null, sessionHash: null }))?.state).toBe('expired');
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
  });

  it('never re-emits a proof after a successful COMMIT whose response is lost', async () => {
    const i = await ready(); let commits = 0;
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: async (sql: string, parameters?: unknown[]) => {
        const result = await client.query(sql, parameters);
        if (sql === 'COMMIT') { commits++; throw new Error('fixture lost response'); }
        return result;
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(interposed).prepareIntent(i)).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect(commits).toBe(1);
    expect((await repo.prepareIntent(i))?.emitCookie).toBe(false);
    expect((await repo.closeIntent(closeInput(i)))?.state).toBe('closed');
  });

  it('enforces RLS, immutable proofs, tenant binding and idempotent additive migration', async () => {
    const i = await ready(); await repo.prepareIntent(i);
    expect((await fixture.app.query('SELECT 1 FROM customer.verification_intents')).rowCount).toBe(0);
    for (const wrong of [{ ...i, parentRef: 'other' }, { ...i, tenantRef: 'other' }, { ...i, browserRef: randomUUID() }, { ...i, browserHash: hash() }]) {
      expect(await repo.validateIntent(wrong)).toBeNull();
      expect(await repo.closeIntent(closeInput(wrong))).toBeNull();
      expect(await withCustomerScope(fixture.app, wrong, async client => (await client.query('SELECT 1 FROM customer.verification_intents WHERE operation_id=$1', [i.operationId])).rowCount))
        .toBe(wrong.tenantRef === i.tenantRef && wrong.parentRef === i.parentRef ? 1 : 0);
    }
    for (const sql of ['DELETE FROM customer.verification_intents WHERE operation_id=$1',
      "UPDATE customer.verification_intents SET proof_hash=repeat('a',64) WHERE operation_id=$1",
      "UPDATE customer.verification_intents SET expires_at=expires_at+interval '1 second' WHERE operation_id=$1"]) {
      await expect(fixture.admin.query(sql, [i.operationId])).rejects.toMatchObject({ code: '23514' });
    }
    const before = (await fixture.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
    expect(before).toHaveLength(9); await migrateCustomer(fixture.admin);
    expect((await fixture.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(before);
  });
});
