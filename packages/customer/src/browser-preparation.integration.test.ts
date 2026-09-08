import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { prepareCustomerTestIntent } from './browser-test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { withCustomerScope } from './client';
import type { VerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const input = () => ({ parentRef: `parent_${hash().slice(0, 16)}`, tenantRef: `tenant_${hash().slice(0, 16)}`,
  browserRef: randomUUID(), browserHash: hash() });
const scope = (i: ReturnType<typeof input>) => ({ parentRef: i.parentRef, tenantRef: i.tenantRef, browserRef: i.browserRef });
const verification = (i: ReturnType<typeof input>): VerificationReservation => ({ ...i, operationId: randomUUID(), proofHash: hash(), challengeId: randomUUID(),
  requestHash: hash(), phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-only',
  serviceSid: `VA${hash().slice(0, 32)}`, evidenceReference: 'fixture', now: Date.now(), expiresAt: Date.now() + 600_000,
  planExpiresAt: Date.now() + 60_000, limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1,
    freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
    cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
    phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 } });

integration('browser preparation — PostgreSQL authority without any SMS budget', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(fixture.app);
  }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function historical(i: ReturnType<typeof input>, ageMs: number, confirmed = false) {
    await fixture.admin.query(`WITH stamp AS (SELECT clock_timestamp()-$5::double precision*interval '1 millisecond' AS at)
      INSERT INTO customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash,created_at,admission_expires_at,expires_at,issued_at,confirmed_at)
      SELECT $1,$2,$3,CASE WHEN $6 THEN $4 ELSE NULL END,at,at+interval '10 minutes',at+interval '168 hours',
        CASE WHEN $6 THEN at+interval '1 second' ELSE NULL END,CASE WHEN $6 THEN at+interval '2 seconds' ELSE NULL END FROM stamp`,
    [i.parentRef, i.tenantRef, i.browserRef, i.browserHash, ageMs, confirmed]);
  }
  async function approval(i: ReturnType<typeof input>) {
    const request = verification(i);
    await prepareCustomerTestIntent(repo, request);
    expect((await repo.reserve(request)).kind).toBe('reserved');
    await repo.settleSend({ ...request, verificationSid: `VE${hash().slice(0, 32)}` });
    const claim = { ...request, checkId: randomUUID() };
    expect(await repo.claimCheck(claim)).not.toBeNull();
    return { ...claim, expectedOperationId: claim.operationId, expectedCheckId: claim.checkId, result: 'approved' as const, sessionId: randomUUID(), sessionHash: hash(),
      sessionExpiresAt: Date.now() + 604_800_000, accountId: randomUUID(), existingSessionHash: null };
  }

  it('replays the public preparation with immutable SQL deadlines and no budget, identity or secret', async () => {
    const i = input();
    const first = await repo.prepareBrowser(scope(i));
    expect(first).toMatchObject({ browserRef: i.browserRef, state: 'prepared' });
    expect(await repo.prepareBrowser(scope(i))).toEqual(first);
    expect(first!.expiresAt - first!.admissionExpiresAt).toBe(604_200_000);
    expect(Object.keys(first!).sort()).toEqual(['admissionExpiresAt', 'browserRef', 'expiresAt', 'state']);
    for (const table of ['parent_budgets', 'paid_budgets', 'reservations', 'browser_contexts', 'accounts', 'sessions']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [i.parentRef])).rowCount).toBe(0);
    }
    expect(await repo.validateBrowser(i)).toBeNull();
  });

  it('serializes the final preparation place, preserving replay and all SMS budgets at the hard cap', async () => {
    const i = input();
    const refs = Array.from({ length: 127 }, () => randomUUID());
    await fixture.admin.query(`WITH stamp AS (SELECT clock_timestamp() AS at)
      INSERT INTO customer.browser_preparations(parent_ref,tenant_ref,browser_ref,created_at,admission_expires_at,expires_at)
      SELECT $1,$2,ref,at,at+interval '10 minutes',at+interval '168 hours' FROM unnest($3::uuid[]) ref CROSS JOIN stamp`,
    [i.parentRef, i.tenantRef, refs]);
    const scopes = [scope(i), { ...scope(i), browserRef: randomUUID() }];
    const results = await Promise.all(scopes.map(value => repo.prepareBrowser(value)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = scopes[results.findIndex(Boolean)]!;
    expect(await repo.prepareBrowser(winner)).toEqual(results.find(Boolean));
    expect(await repo.prepareBrowser({ ...winner, browserRef: randomUUID() })).toBeNull();
    expect((await fixture.admin.query('SELECT 1 FROM customer.browser_preparations WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(128);
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
    expect((await repo.prepareBrowser({ ...winner, tenantRef: 'independent_tenant' }))?.state).toBe('prepared');
  });

  it('issues only once under concurrency, and only the matching cookie confirms', async () => {
    const i = input(); await repo.prepareBrowser(scope(i));
    const attempts = [i, { ...i, browserHash: hash() }];
    const outcomes = await Promise.all(attempts.map(attempt => repo.issueBrowser({ ...attempt, currentBrowserHash: null })));
    expect(outcomes.filter(value => value?.emitCookie)).toHaveLength(1);
    const winner = attempts[outcomes.findIndex(value => value?.emitCookie)]!;
    const loser = attempts.find(value => value.browserHash !== winner.browserHash)!;
    expect((await repo.issueBrowser({ ...winner, currentBrowserHash: null }))?.emitCookie).toBe(false);
    expect(await repo.confirmBrowser(loser)).toBeNull();
    const confirmed = await repo.confirmBrowser(winner);
    expect(confirmed?.state).toBe('confirmed');
    expect(await repo.confirmBrowser(winner)).toEqual(confirmed);
    expect(await repo.validateBrowser(winner)).toEqual({ expiresAt: confirmed!.expiresAt });
  });

  it('refuses unknown or another live confirmed current cookie without consuming the target', async () => {
    const a = input(); await repo.prepareBrowser(scope(a)); await repo.issueBrowser({ ...a, currentBrowserHash: null });
    await repo.confirmBrowser(a);
    const b = { ...a, browserRef: randomUUID(), browserHash: hash() }; await repo.prepareBrowser(scope(b));
    for (const currentBrowserHash of [hash(), a.browserHash]) {
      expect(await repo.issueBrowser({ ...b, currentBrowserHash })).toBeNull();
      expect((await repo.prepareBrowser(scope(b)))?.state).toBe('prepared');
    }
    expect((await repo.validateBrowser(a))?.expiresAt).toBeDefined();
  });

  it('isolates references and hashes by tenant and parent, including direct runtime SQL', async () => {
    const i = input(); await repo.prepareBrowser(scope(i)); await repo.issueBrowser({ ...i, currentBrowserHash: null });
    await repo.confirmBrowser(i);
    expect((await fixture.app.query('SELECT * FROM customer.browser_preparations')).rowCount).toBe(0);
    for (const patch of [{ tenantRef: 'foreign' }, { parentRef: 'foreign' }, { browserRef: randomUUID() }, { browserHash: hash() }]) {
      expect(await repo.confirmBrowser({ ...i, ...patch })).toBeNull();
      expect(await repo.validateBrowser({ ...i, ...patch })).toBeNull();
    }
    expect(await withCustomerScope(fixture.app, { ...i, tenantRef: 'foreign' }, async client =>
      (await client.query('SELECT * FROM customer.browser_preparations')).rowCount)).toBe(0);
  });

  it('rolls back a failed commit rather than returning permission to emit a cookie', async () => {
    const i = input(); await repo.prepareBrowser(scope(i));
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: (sql: string, params?: unknown[]) => {
        if (sql === 'COMMIT') throw new Error('fixture commit failure');
        return client.query(sql, params);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(interposed).issueBrowser({ ...i, currentBrowserHash: null }))
      .rejects.toThrow('Identité client indisponible');
    expect((await repo.prepareBrowser(scope(i)))?.state).toBe('prepared');
    expect(await repo.validateBrowser(i)).toBeNull();
  });

  it('never re-emits after the real issue COMMIT succeeded but its response was lost', async () => {
    const i = input(); await repo.prepareBrowser(scope(i));
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: async (sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        if (sql === 'COMMIT') throw new Error('fixture response lost');
        return result;
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(interposed).issueBrowser({ ...i, currentBrowserHash: null })).rejects.toThrow();
    expect((await repo.prepareBrowser(scope(i)))?.state).toBe('issued');
    expect((await repo.issueBrowser({ ...i, currentBrowserHash: null }))?.emitCookie).toBe(false);
    expect((await repo.issueBrowser({ ...i, browserHash: hash(), currentBrowserHash: null }))?.emitCookie).toBe(false);
    expect(await repo.validateBrowser(i)).toBeNull();
  });

  it('keeps admission expiry terminal, while a confirmed preparation remains valid past admission', async () => {
    const expired = input(); await historical(expired, 601_000);
    const before = await repo.prepareBrowser(scope(expired));
    expect(before?.state).toBe('expired');
    expect(await repo.issueBrowser({ ...expired, currentBrowserHash: null })).toEqual({ preparation: before, emitCookie: false });
    expect(await repo.confirmBrowser(expired)).toBeNull();
    expect(await repo.prepareBrowser(scope(expired))).toEqual(before);
    const confirmed = input(); await historical(confirmed, 601_000, true);
    expect((await repo.confirmBrowser(confirmed))?.state).toBe('confirmed');
    expect((await repo.validateBrowser(confirmed))?.expiresAt).toBeDefined();
    const old = input(); await historical(old, 604_801_000, true);
    expect((await repo.prepareBrowser(scope(old)))?.state).toBe('expired');
    expect(await repo.confirmBrowser(old)).toBeNull(); expect(await repo.validateBrowser(old)).toBeNull();
    const replacement = { ...old, browserRef: randomUUID(), browserHash: hash() };
    await repo.prepareBrowser(scope(replacement));
    expect((await repo.issueBrowser({ ...replacement, currentBrowserHash: old.browserHash }))?.emitCookie).toBe(true);
  });

  it.each(['issue', 'confirm'] as const)('rechecks admission expiry after waiting for the %s row lock', async step => {
    const i = input(); await historical(i, 599_400);
    if (step === 'confirm') await repo.issueBrowser({ ...i, currentBrowserHash: null });
    const blocker = await fixture.admin.connect();
    let waiting: Promise<unknown> | undefined;
    const application = `preparation_${randomUUID()}`;
    const pool = { connect: async () => {
      const client = await fixture.app.connect();
      await client.query("SELECT set_config('application_name',$1,false)", [application]);
      return client;
    } } as unknown as Pool;
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT browser_ref FROM customer.browser_preparations WHERE parent_ref=$1 FOR UPDATE', [i.parentRef]);
      const contender = new PostgresCustomerIdentityRepository(pool);
      waiting = step === 'issue' ? contender.issueBrowser({ ...i, currentBrowserHash: null }) : contender.confirmBrowser(i);
      let locked = false;
      for (let n = 0; n < 100 && !locked; n++) {
        locked = (await fixture.admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1 AND wait_event_type='Lock'", [application])).rowCount === 1;
        if (!locked) await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(locked).toBe(true);
      await blocker.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM admission_expires_at-clock_timestamp()))+0.02)
        FROM customer.browser_preparations WHERE parent_ref=$1`, [i.parentRef]);
      await blocker.query('COMMIT');
      const result = await waiting;
      if (step === 'issue') expect(result).toMatchObject({ emitCookie: false, preparation: { state: 'expired' } });
      else expect(result).toBeNull();
      expect(await repo.validateBrowser(i)).toBeNull();
    } finally { await blocker.query('ROLLBACK'); blocker.release(); await waiting; }
  });

  it('rejects changing a bound secret/deadline, deletion and truncation, and enforces hash uniqueness', async () => {
    const i = input(); await repo.prepareBrowser(scope(i)); await repo.issueBrowser({ ...i, currentBrowserHash: null });
    await repo.confirmBrowser(i);
    for (const sql of [
      'UPDATE customer.browser_preparations SET expires_at=expires_at+interval \'1 day\' WHERE parent_ref=$1',
      'UPDATE customer.browser_preparations SET browser_hash=repeat(\'0\',64) WHERE parent_ref=$1',
      'UPDATE customer.browser_preparations SET confirmed_at=NULL WHERE parent_ref=$1',
      'DELETE FROM customer.browser_preparations WHERE parent_ref=$1',
    ]) await expect(fixture.admin.query(sql, [i.parentRef])).rejects.toMatchObject({ code: '23514' });
    await expect(fixture.admin.query('TRUNCATE customer.browser_preparations CASCADE')).rejects.toMatchObject({ code: '23514' });
    const duplicate = { ...i, browserRef: randomUUID() }; await repo.prepareBrowser(scope(duplicate));
    await expect(repo.issueBrowser({ ...duplicate, currentBrowserHash: null })).rejects.toThrow();
    expect((await repo.prepareBrowser(scope(duplicate)))?.state).toBe('prepared');
    expect((await repo.validateBrowser(i))?.expiresAt).toBeDefined();
  });

  it('requires confirmed ref plus cookie before a reservation and caps the published session at browser expiry', async () => {
    const i = input(); const request = verification(i);
    expect(await repo.reserve(request)).toEqual({ kind: 'denied' });
    await repo.prepareBrowser(scope(i));
    await repo.issueBrowser({ ...i, currentBrowserHash: null });
    expect(await repo.reserve(request)).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [i.parentRef])).rowCount).toBe(0);
    const active = input(); await historical(active, 86_400_000, true);
    const done = await approval(active);
    expect(await repo.completeCheck({ ...done, browserRef: randomUUID() })).toBeNull();
    const session = await repo.completeCheck(done);
    expect(session?.expiresAt).toBe((await repo.validateBrowser(active))?.expiresAt);
    const wrong = { ...done, browserRef: randomUUID() };
    expect(await repo.authenticate(wrong)).toBeNull(); expect(await repo.recoverCheck(wrong)).toBeNull();
    expect(await repo.updateName({ ...wrong, encryptedName: 'forbidden', expectedRevision: 0 })).toBeNull();
    await repo.revoke({ ...wrong, all: true });
    expect((await repo.authenticate(done))?.sessionId).toBe(done.sessionId);
  });

  it.each(['name', 'revoke-one', 'revoke-all'] as const)('checks browser expiry inside the final %s mutation', async action => {
    const i = input(); await historical(i, 604_798_500, true);
    const done = await approval(i); expect(await repo.completeCheck(done)).not.toBeNull();
    // Deliberately longer stored session: browser expiry must independently fence
    // the final mutation, rather than merely inheriting the session time check.
    await fixture.admin.query("UPDATE customer.sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE id=$1", [done.sessionId]);
    let intercepted = 0;
    const pool = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: async (sql: string, params?: unknown[]) => {
        if (/^UPDATE customer\.(accounts|sessions)\b/.test(sql)) {
          intercepted++;
          await fixture.admin.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM expires_at-clock_timestamp()))+0.02)
            FROM customer.browser_preparations WHERE parent_ref=$1`, [i.parentRef]);
        }
        return client.query(sql, params);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    const guarded = new PostgresCustomerIdentityRepository(pool);
    if (action === 'name') expect(await guarded.updateName({ ...done, encryptedName: 'forbidden', expectedRevision: 0 })).toBeNull();
    else await guarded.revoke({ ...done, all: action === 'revoke-all' });
    expect(intercepted).toBe(1);
    expect((await fixture.admin.query(`SELECT a.encrypted_name,a.revision,a.session_version,s.revoked_at
      FROM customer.accounts a JOIN customer.sessions s ON s.account_id=a.id WHERE s.id=$1`, [done.sessionId])).rows[0])
      .toEqual({ encrypted_name: null, revision: '0', session_version: '0', revoked_at: null });
    expect(await repo.authenticate(done)).toBeNull(); expect(await repo.recoverCheck(done)).toBeNull();
  });
});
