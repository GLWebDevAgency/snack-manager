import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture, assertCustomerTestTarget } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { CustomerRepositoryError, withCustomerScope } from './client';
import { assertCustomerMigrationsCurrent } from './migration-state';
import type { CheckClaim, CustomerIdentityRepository, VerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
const sid = () => `VE${randomUUID().replaceAll('-', '')}`;
function reservation(patch: Partial<VerificationReservation> = {}): VerificationReservation {
  const now = Date.now();
  return { tenantRef: `tenant_${hash().slice(0, 12)}`, parentRef: `parent_${hash().slice(0, 12)}`,
    operationId: randomUUID(), requestHash: hash(), challengeId: randomUUID(), browserHash: hash(),
    phoneHash: hash(), globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'encrypted-fixture-only',
    serviceSid: `VA${'1'.repeat(32)}`, evidenceReference: 'fixture', planExpiresAt: now + 60_000,
    expiresAt: now + 600_000, now, limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1,
      freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 }, ...patch };
}
function claim(input: VerificationReservation): CheckClaim {
  return { parentRef: input.parentRef, tenantRef: input.tenantRef, challengeId: input.challengeId,
    browserHash: input.browserHash, checkId: randomUUID(), now: Date.now() };
}
function completion(input: CheckClaim): Parameters<CustomerIdentityRepository['completeCheck']>[0] {
  return { ...input, result: 'approved', sessionId: randomUUID(), sessionHash: hash(),
    accountId: randomUUID(), sessionExpiresAt: Date.now() + 604_800_000, existingSessionHash: null };
}

describe('customer disposable PostgreSQL guard', () => {
  it.each(['postgresql://remote.example/postgres', 'postgresql://127.0.0.1/production',
    'postgresql://127.0.0.1/postgres?host=remote.example', 'postgresql://127.0.0.1/postgres#ignored', undefined])('refuses unsafe targets before connecting', raw => {
    expect(() => assertCustomerTestTarget(raw)).toThrow();
  });
});

integration('customer repository — real PostgreSQL with ordinary RLS role', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(fixture.app); }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function pending(input: VerificationReservation) {
    expect(await repo.reserve(input)).toEqual({ kind: 'reserved', challengeId: input.challengeId });
    const result = await repo.settleSend({ ...input, verificationSid: sid() });
    expect(result?.challengeId).toBe(input.challengeId);
    return result!;
  }

  it('migrates, requires both scopes, and cannot see another tenant or parent', async () => {
    await assertCustomerMigrationsCurrent(fixture.app);
    const input = reservation();
    await pending(input);
    expect((await fixture.app.query('SELECT id FROM customer.challenges')).rowCount).toBe(0);
    for (const scope of [{ ...input, tenantRef: 'foreign' }, { ...input, parentRef: 'foreign' }]) {
      expect(await withCustomerScope(fixture.app, scope, async client => (await client.query('SELECT id FROM customer.challenges')).rowCount)).toBe(0);
    }
    await expect(withCustomerScope(fixture.app, { ...input, tenantRef: 'foreign' }, client => client.query(
      'INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)', [randomUUID(), input.parentRef, input.tenantRef]))).rejects.toBeInstanceOf(CustomerRepositoryError);
  });

  it('reserves exactly once under concurrent duplicate operations and never re-sends an unsettled operation', async () => {
    const input = reservation();
    const results = await Promise.all([repo.reserve(input), repo.reserve(input)]);
    expect(results.filter(value => value.kind === 'reserved')).toHaveLength(1);
    expect(results.filter(value => value.kind === 'uncertain')).toHaveLength(1);
    expect(await repo.reserve({ ...input, requestHash: hash() })).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT reserved_sends::int AS count FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].count).toBe(1);
  });

  it('serializes the last parent budget across tenants and preserves it after uncertainty/new evidence/service', async () => {
    const input = reservation();
    input.limits.trialSendReservations = 1;
    const other = reservation({ parentRef: input.parentRef, limits: { ...input.limits } });
    const results = await Promise.all([repo.reserve(input), repo.reserve(other)]);
    expect(results.filter(value => value.kind === 'reserved')).toHaveLength(1);
    const winner = results[0].kind === 'reserved' ? input : other;
    await repo.settleSend({ ...winner, verificationSid: null });
    const retry = reservation({ parentRef: input.parentRef, serviceSid: `VA${'2'.repeat(32)}`, evidenceReference: 'refreshed' });
    expect(await repo.reserve(retry)).toEqual({ kind: 'denied' });
    await expect(fixture.admin.query('DELETE FROM customer.reservations WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
    await expect(fixture.admin.query('UPDATE customer.parent_budgets SET reserved_sends=0 WHERE parent_ref=$1', [input.parentRef])).rejects.toMatchObject({ code: '23514' });
  });

  it('reserves SMS segments conservatively and never resets lifetime budget on a refreshed observation', async () => {
    const input = reservation();
    input.limits = { ...input.limits, freeSmsUnitsRemainingAtObservation: 3, smsUnitsReservedPerSend: 2 };
    await pending(input);
    const next = reservation({ parentRef: input.parentRef, limits: { ...input.limits, freeSmsUnitsRemainingAtObservation: 100 } });
    expect(await repo.reserve(next)).toEqual({ kind: 'denied' });
    const row = (await fixture.admin.query('SELECT reserved_sms::int AS sms,sms_limit::int AS cap FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0];
    expect(row).toEqual({ sms: 2, cap: 3 });
  });

  it('blocks simultaneous challenges for the same global phone, including another tenant', async () => {
    const input = reservation();
    await pending(input);
    const other = reservation({ parentRef: input.parentRef, globalPhoneHash: input.globalPhoneHash });
    expect(await repo.reserve(other)).toEqual({ kind: 'denied' });
  });

  it('never attaches a provider SID to two challenges and retains both reservations', async () => {
    const input = reservation();
    const other = reservation({ parentRef: input.parentRef });
    await repo.reserve(input); await repo.reserve(other);
    const verificationSid = sid();
    expect(await repo.settleSend({ ...input, verificationSid })).not.toBeNull();
    expect(await repo.settleSend({ ...input, verificationSid })).not.toBeNull();
    expect(await repo.settleSend({ ...other, verificationSid })).toBeNull();
    expect((await fixture.admin.query('SELECT reserved_sends::int AS count FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].count).toBe(2);
  });

  it('single-flights checks, permanently spends a checkId, and releases only a known pending result', async () => {
    const input = reservation(); await pending(input);
    const check = claim(input);
    const claims = await Promise.all([repo.claimCheck(check), repo.claimCheck(check)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await repo.completeCheck({ ...completion(check), result: 'pending' })).toBeNull();
    expect(await repo.claimCheck(check)).toBeNull();
    const next = claim(input);
    expect(await repo.claimCheck(next)).not.toBeNull();
    await repo.completeCheck({ ...completion(next), result: 'uncertain' });
    expect(await repo.claimCheck(claim(input))).toBeNull();
  });

  it('atomically creates account/contact/session, recovers the exact receipt, and never revives a revoked session', async () => {
    const input = reservation(); await pending(input);
    const check = claim(input); await repo.claimCheck(check);
    const complete = completion(check);
    const result = await repo.completeCheck(complete);
    expect(result?.profile.accountId).toBe(complete.accountId);
    expect(result?.profile.phoneHash).toBe(input.phoneHash);
    expect(await repo.recoverCheck({ ...check, sessionHash: complete.sessionHash })).toEqual(result);
    expect(await repo.recoverCheck({ ...check, sessionHash: hash() })).toBeNull();
    expect(await repo.recoverCheck({ ...check, browserHash: hash(), sessionHash: complete.sessionHash })).toBeNull();
    expect(await repo.claimCheck(check)).toBeNull();
    await repo.revoke({ ...input, sessionHash: complete.sessionHash, all: false });
    expect(await repo.authenticate({ ...input, sessionHash: complete.sessionHash })).toBeNull();
    expect(await repo.recoverCheck({ ...check, sessionHash: complete.sessionHash })).toBeNull();
    expect(await repo.completeCheck(complete)).toBeNull();
  });

  it('does not recover an existing account by phone alone; continuity permits a new session without changing identity', async () => {
    const input = reservation(); await pending(input);
    const firstClaim = claim(input); await repo.claimCheck(firstClaim);
    const first = completion(firstClaim); await repo.completeCheck(first);
    const second = reservation({ tenantRef: input.tenantRef, parentRef: input.parentRef, phoneHash: input.phoneHash });
    await pending(second); const secondClaim = claim(second); await repo.claimCheck(secondClaim);
    expect(await repo.completeCheck(completion(secondClaim))).toBeNull();
    const third = reservation({ tenantRef: input.tenantRef, parentRef: input.parentRef, phoneHash: input.phoneHash });
    await pending(third); const thirdClaim = claim(third); await repo.claimCheck(thirdClaim);
    const result = await repo.completeCheck({ ...completion(thirdClaim), existingSessionHash: first.sessionHash });
    expect(result?.profile.accountId).toBe(first.accountId);
    expect((await fixture.admin.query('SELECT count(*)::int AS count FROM customer.accounts WHERE tenant_ref=$1', [input.tenantRef])).rows[0].count).toBe(1);
  });

  it('CAS-updates name and invalidates every session through account version without deleting proofs', async () => {
    const input = reservation(); await pending(input);
    const check = claim(input); await repo.claimCheck(check); const complete = completion(check); await repo.completeCheck(complete);
    const updated = await repo.updateName({ ...input, sessionHash: complete.sessionHash, expectedRevision: 0, encryptedName: 'ciphertext-name' });
    expect(updated?.profile.revision).toBe(1);
    expect(await repo.updateName({ ...input, sessionHash: complete.sessionHash, expectedRevision: 0, encryptedName: 'stale' })).toBeNull();
    await repo.revoke({ ...input, sessionHash: complete.sessionHash, all: true });
    expect(await repo.authenticate({ ...input, sessionHash: complete.sessionHash })).toBeNull();
    expect((await fixture.admin.query('SELECT count(*)::int AS count FROM customer.check_attempts WHERE challenge_id=$1', [input.challengeId])).rows[0].count).toBe(1);
  });

  it('uses database time instead of a caller-provided stale timestamp', async () => {
    const input = reservation({ now: 1, planExpiresAt: Date.now() - 1000 });
    expect(await repo.reserve(input)).toEqual({ kind: 'denied' });
    const active = reservation(); await pending(active);
    await fixture.admin.query("UPDATE customer.challenges SET created_at=statement_timestamp()-interval '11 minutes', expires_at=statement_timestamp()-interval '1 minute' WHERE id=$1", [active.challengeId]);
    expect(await repo.claimCheck({ ...claim(active), now: 1 })).toBeNull();
  });

  it('returns the original pending challenge when an identical operation supplies a fresh candidate UUID', async () => {
    const input = reservation(); const original = await pending(input);
    expect(await repo.reserve({ ...input, challengeId: randomUUID() })).toEqual({ kind: 'pending', challenge: original });
    expect(await repo.reserve({ ...input, browserHash: hash() })).toEqual({ kind: 'denied' });
  });

  it('never returns sessions through another tenant/parent and refuses expired or inactive accounts', async () => {
    const input = reservation(); await pending(input);
    const check = claim(input); await repo.claimCheck(check); const done = completion(check); await repo.completeCheck(done);
    for (const scope of [{ tenantRef: 'other', parentRef: input.parentRef }, { tenantRef: input.tenantRef, parentRef: 'other' }]) {
      expect(await repo.authenticate({ ...scope, sessionHash: done.sessionHash, now: Date.now() })).toBeNull();
      expect(await repo.recoverCheck({ ...check, ...scope, sessionHash: done.sessionHash })).toBeNull();
    }
    await fixture.admin.query('UPDATE customer.accounts SET active=false WHERE id=$1', [done.accountId]);
    expect(await repo.authenticate({ ...input, sessionHash: done.sessionHash })).toBeNull();
    await fixture.admin.query("UPDATE customer.sessions SET created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '2 days' WHERE id=$1", [done.sessionId]);
    await fixture.admin.query('UPDATE customer.accounts SET active=true WHERE id=$1', [done.accountId]);
    expect(await repo.authenticate({ ...input, sessionHash: done.sessionHash })).toBeNull();
  });

  it('permanently locks after five known pending checks and rejects a delayed old approval', async () => {
    const input = reservation(); await pending(input);
    let first: ReturnType<typeof completion> | undefined;
    for (let count = 0; count < 5; count++) {
      const check = claim(input); expect(await repo.claimCheck(check)).not.toBeNull();
      const done = completion(check); first ??= done;
      await repo.completeCheck({ ...done, result: 'pending' });
    }
    expect(await repo.claimCheck(claim(input))).toBeNull();
    expect(await repo.completeCheck(first!)).toBeNull();
    expect((await fixture.admin.query('SELECT checks_used,state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0]).toEqual({ checks_used: 5, state: 'locked' });
  });

  it('rolls back a failed session insertion including the new account/contact and leaves no false approval', async () => {
    const first = reservation(); await pending(first); const firstClaim = claim(first); await repo.claimCheck(firstClaim);
    const firstDone = completion(firstClaim); await repo.completeCheck(firstDone);
    const input = reservation(); await pending(input); const check = claim(input); await repo.claimCheck(check);
    const done = { ...completion(check), sessionHash: firstDone.sessionHash };
    await expect(repo.completeCheck(done)).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect((await fixture.admin.query('SELECT id FROM customer.accounts WHERE id=$1', [done.accountId])).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT account_id FROM customer.verified_contacts WHERE account_id=$1', [done.accountId])).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0].state).toBe('checking');
    expect(await repo.claimCheck(claim(input))).toBeNull();
    expect(await repo.recoverCheck({ ...check, sessionHash: done.sessionHash })).toBeNull();
  });

  it('bounds challenge and session lifetimes using one SQL timestamp without extending replay', async () => {
    const input = reservation({ expiresAt: Date.now() + 86_400_000 }); const challenge = await pending(input);
    expect(challenge.expiresAt).toBeLessThanOrEqual(Date.now() + 600_000);
    const check = claim(input); await repo.claimCheck(check);
    const done = { ...completion(check), sessionExpiresAt: Date.now() + 30 * 86_400_000 };
    const current = await repo.completeCheck(done);
    expect(current?.expiresAt).toBeLessThanOrEqual(Date.now() + 604_800_000);
    expect(await repo.recoverCheck({ ...check, sessionHash: done.sessionHash })).toEqual(current);
    const lifetime = (await fixture.admin.query('SELECT EXTRACT(EPOCH FROM (expires_at-created_at))::int AS seconds FROM customer.sessions WHERE id=$1', [done.sessionId])).rows[0];
    expect(lifetime.seconds).toBe(604800);
  });

  it('rechecks challenge expiry after waiting for the parent lock, never the old caller timestamp', async () => {
    const input = reservation(); await pending(input);
    const blocker = await fixture.admin.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef]);
      await blocker.query("UPDATE customer.challenges SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1", [input.challengeId]);
      const waiting = repo.claimCheck({ ...claim(input), now: 1 });
      await blocker.query('SELECT pg_sleep(0.2)');
      await blocker.query('COMMIT');
      expect(await waiting).toBeNull();
      expect((await fixture.admin.query('SELECT id FROM customer.check_attempts WHERE challenge_id=$1', [input.challengeId])).rowCount).toBe(0);
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it('serializes concurrent name CAS and revoke-all versus continuity approval', async () => {
    const input = reservation(); await pending(input); const initial = claim(input); await repo.claimCheck(initial);
    const first = completion(initial); await repo.completeCheck(first);
    const names = await Promise.all(['one', 'two'].map(encryptedName => repo.updateName({ ...input,
      sessionHash: first.sessionHash, expectedRevision: 0, encryptedName })));
    expect(names.filter(Boolean)).toHaveLength(1);
    const next = reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef, phoneHash: input.phoneHash });
    await pending(next); const check = claim(next); await repo.claimCheck(check);
    const done = { ...completion(check), existingSessionHash: first.sessionHash };
    await Promise.all([repo.revoke({ ...input, sessionHash: first.sessionHash, all: true }), repo.completeCheck(done)]);
    expect(await repo.authenticate({ ...input, sessionHash: first.sessionHash })).toBeNull();
    expect(await repo.authenticate({ ...input, sessionHash: done.sessionHash })).toBeNull();
  });

  it('does not duplicate or disclose a tenant phone when the configured provider parent changes', async () => {
    const input = reservation(); await pending(input); const first = claim(input); await repo.claimCheck(first);
    const done = completion(first); await repo.completeCheck(done);
    const other = reservation({ tenantRef: input.tenantRef, phoneHash: input.phoneHash });
    await pending(other); const check = claim(other); await repo.claimCheck(check);
    const attempted = { ...completion(check), existingSessionHash: done.sessionHash };
    expect(await repo.completeCheck(attempted)).toBeNull();
    expect((await fixture.admin.query('SELECT id FROM customer.accounts WHERE tenant_ref=$1', [input.tenantRef])).rowCount).toBe(1);
    expect((await fixture.admin.query('SELECT state FROM customer.challenges WHERE id=$1', [other.challengeId])).rows[0].state).toBe('rejected');
  });

  it('holds the provider phone exclusion beyond a short application challenge and preserves a late SID', async () => {
    const input = reservation({ expiresAt: Date.now() + 30_000 }); await repo.reserve(input);
    const guard = (await fixture.admin.query('SELECT active_until FROM customer.phone_guards WHERE parent_ref=$1', [input.parentRef])).rows[0];
    expect(guard.active_until.getTime()).toBeGreaterThan(input.expiresAt + 500_000);
    await fixture.admin.query("UPDATE customer.challenges SET created_at=statement_timestamp()-interval '2 minutes', expires_at=statement_timestamp()-interval '1 minute' WHERE id=$1", [input.challengeId]);
    const verificationSid = sid();
    expect(await repo.settleSend({ ...input, verificationSid })).toBeNull();
    expect((await fixture.admin.query('SELECT challenge_id FROM customer.provider_verifications WHERE parent_ref=$1 AND verification_sid=$2',
      [input.parentRef, verificationSid])).rows[0].challenge_id).toBe(input.challengeId);
    expect(await repo.reserve(reservation({ parentRef: input.parentRef, globalPhoneHash: input.globalPhoneHash }))).toEqual({ kind: 'denied' });
    const after = (await fixture.admin.query('SELECT active_until FROM customer.phone_guards WHERE parent_ref=$1', [input.parentRef])).rows[0];
    expect(after.active_until.getTime()).toBeGreaterThanOrEqual(guard.active_until.getTime());
  });

  it('records a lower lifetime observation even when the request only recovers an existing pending challenge', async () => {
    const input = reservation(); const original = await pending(input);
    const replay = { ...input, challengeId: randomUUID(), limits: { ...input.limits, freeSmsUnitsRemainingAtObservation: 1 } };
    expect(await repo.reserve(replay)).toEqual({ kind: 'pending', challenge: original });
    expect(await repo.reserve(reservation({ parentRef: input.parentRef }))).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT sms_limit::int AS cap FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].cap).toBe(1);
  });

  it.each(['name', 'revoke-all'] as const)('cannot mutate %s after session expiry while waiting on the account lock', async action => {
    const input = reservation(); await pending(input); const check = claim(input); await repo.claimCheck(check);
    const done = completion(check); await repo.completeCheck(done);
    const blocker = await fixture.admin.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM customer.accounts WHERE id=$1 FOR UPDATE', [done.accountId]);
      await blocker.query("UPDATE customer.sessions SET expires_at=clock_timestamp()+interval '150 milliseconds' WHERE id=$1", [done.sessionId]);
      const waiting = action === 'name'
        ? repo.updateName({ ...input, sessionHash: done.sessionHash, encryptedName: 'expired-change', expectedRevision: 0 })
        : repo.revoke({ ...input, sessionHash: done.sessionHash, all: true });
      await blocker.query('SELECT pg_sleep(0.2)');
      await blocker.query('COMMIT');
      await waiting;
      expect((await fixture.admin.query('SELECT encrypted_name,revision::int AS revision,session_version::int AS version FROM customer.accounts WHERE id=$1',
        [done.accountId])).rows[0]).toEqual({ encrypted_name: null, revision: 0, version: 0 });
    } finally { await blocker.query('ROLLBACK'); blocker.release(); }
  });

  it.each(['name', 'revoke-all', 'revoke-one'] as const)('rechecks expiry inside the final %s SQL mutation after the last successful session read', async action => {
    const input = reservation(); await pending(input); const check = claim(input); await repo.claimCheck(check);
    const done = completion(check); await repo.completeCheck(done);
    let intercepted = 0;
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return {
        query: async (sql: string, parameters?: unknown[]) => {
          if (/^UPDATE customer\.(accounts|sessions)\b/.test(sql)) {
            intercepted++;
            // This is after the last session SELECT, immediately before the real
            // UPDATE. It distinguishes the SQL predicate from the earlier lock check.
            await fixture.admin.query(`UPDATE customer.sessions SET
              created_at=statement_timestamp()-interval '1 minute',
              expires_at=statement_timestamp()-interval '1 second' WHERE id=$1`, [done.sessionId]);
          }
          return client.query(sql, parameters);
        },
        release: client.release.bind(client),
      };
    } } as unknown as Pool;
    const guarded = new PostgresCustomerIdentityRepository(interposed);
    if (action === 'name') await guarded.updateName({ ...input, sessionHash: done.sessionHash,
      encryptedName: 'expired-change', expectedRevision: 0 });
    else await guarded.revoke({ ...input, sessionHash: done.sessionHash, all: action === 'revoke-all' });
    expect(intercepted).toBe(1);
    expect((await fixture.admin.query(`SELECT a.encrypted_name,a.revision::int AS revision,a.session_version::int AS version,s.revoked_at
      FROM customer.accounts a JOIN customer.sessions s ON s.account_id=a.id WHERE s.id=$1`, [done.sessionId])).rows[0])
      .toEqual({ encrypted_name: null, revision: 0, version: 0, revoked_at: null });
  });
});
