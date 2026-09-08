import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { confirmCustomerTestBrowser } from './browser-test-fixture';
import { withCustomerScope } from './client';
import { migrateCustomer } from './migration';
import type { CustomerIdentityRepository, VerificationReservation } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
function reservation(patch: Partial<VerificationReservation> = {}): VerificationReservation {
  const now = Date.now();
  return { parentRef: `parent_${hash().slice(0, 16)}`, tenantRef: `tenant_${hash().slice(0, 16)}`,
    browserRef: randomUUID(), operationId: randomUUID(), challengeId: randomUUID(), browserHash: hash(), requestHash: hash(), phoneHash: hash(),
    globalPhoneHash: hash(), ipHash: hash(), encryptedPhone: 'fixture-only', serviceSid: `VA${'1'.repeat(32)}`,
    evidenceReference: 'fixture', now, expiresAt: now + 600_000, planExpiresAt: now + 60_000,
    limits: { trialSendReservations: 50, smsUnitsReservedPerSend: 1,
      freeSmsUnitsRemainingAtObservation: 100, freeVerificationUnitsRemainingAtObservation: 100,
      cooldownMs: 60_000, windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5 }, ...patch };
}
type Completion = Parameters<CustomerIdentityRepository['completeCheck']>[0];

integration('browser continuity — native PostgreSQL, both credentials required', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(fixture.app);
  }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function reserve(input: VerificationReservation) {
    await confirmCustomerTestBrowser(repo, input);
    return repo.reserve(input);
  }
  async function admitted(input: VerificationReservation): Promise<Completion> {
    expect(await reserve(input)).toEqual({ kind: 'reserved', challengeId: input.challengeId });
    expect(await repo.settleSend({ ...input, verificationSid: `VE${randomUUID().replaceAll('-', '')}` })).not.toBeNull();
    const claim = { ...input, checkId: randomUUID() };
    expect(await repo.claimCheck(claim)).not.toBeNull();
    return { ...claim, result: 'approved', sessionId: randomUUID(), sessionHash: hash(), accountId: randomUUID(),
      sessionExpiresAt: Date.now() + 604_800_000, existingSessionHash: null };
  }
  const sameBrowser = (input: VerificationReservation) => reservation({ parentRef: input.parentRef,
    tenantRef: input.tenantRef, browserRef: input.browserRef, browserHash: input.browserHash });

  it('makes token A and its exact recovery inert after publication B, without deleting receipts or budget', async () => {
    const input = reservation(); const a = await admitted(input); expect(await repo.completeCheck(a)).not.toBeNull();
    const b = await admitted(sameBrowser(input)); expect(await repo.completeCheck(b)).not.toBeNull();
    expect(await repo.authenticate(a)).toBeNull();
    expect(await repo.recoverCheck(a)).toBeNull();
    expect(await repo.completeCheck(a)).toBeNull();
    expect(await repo.updateName({ ...a, encryptedName: 'stale', expectedRevision: 0 })).toBeNull();
    for (const all of [false, true]) await repo.revoke({ ...a, all });
    expect((await repo.authenticate(b))?.sessionId).toBe(b.sessionId);
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM customer.sessions WHERE parent_ref=$1', [input.parentRef])).rows[0].n).toBe(2);
    expect((await fixture.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].reserved_sends).toBe('2');
  });

  it.each([false, true])('fences an admitted confirmation behind a completed logout (all=%s)', async all => {
    const input = reservation(); const a = await admitted(input); await repo.completeCheck(a);
    const b = await admitted(sameBrowser(input));
    await repo.revoke({ ...a, all });
    expect(await repo.completeCheck(b)).toBeNull();
    expect(await repo.authenticate(a)).toBeNull(); expect(await repo.authenticate(b)).toBeNull();
    expect(await repo.recoverCheck(a)).toBeNull(); expect(await repo.recoverCheck(b)).toBeNull();
    const row = (await fixture.admin.query('SELECT state FROM customer.check_attempts WHERE id=$1', [b.checkId])).rows[0];
    expect(row.state).toBe('rejected');
    expect((await fixture.admin.query('SELECT count(*)::int AS n FROM customer.accounts WHERE parent_ref=$1', [input.parentRef])).rows[0].n).toBe(1);
  });

  it('publishes only one of two approvals admitted at the same browser generation', async () => {
    const input = reservation(); const a = await admitted(input); const b = await admitted(sameBrowser(input));
    const outcomes = await Promise.all([repo.completeCheck(a), repo.completeCheck(b)]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    expect((await Promise.all([repo.authenticate(a), repo.authenticate(b)])).filter(Boolean)).toHaveLength(1);
    expect((await fixture.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].reserved_sends).toBe('2');
  });

  it('binds authentication, mutations and recovery to the same browser and tenant', async () => {
    const input = reservation(); const a = await admitted(input); await repo.completeCheck(a);
    for (const patch of [{ browserHash: hash() }, { tenantRef: 'foreign' }, { parentRef: 'foreign' }]) {
      expect(await repo.authenticate({ ...a, ...patch })).toBeNull();
      expect(await repo.recoverCheck({ ...a, ...patch })).toBeNull();
      expect(await repo.updateName({ ...a, ...patch, expectedRevision: 0, encryptedName: 'forbidden' })).toBeNull();
      await repo.revoke({ ...a, ...patch, all: true });
    }
    expect((await repo.authenticate(a))?.profile.revision).toBe(0);
    const other = await admitted(reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef }));
    await repo.completeCheck(other); await repo.revoke({ ...a, all: false });
    expect((await repo.authenticate(other))?.sessionId).toBe(other.sessionId);
  });

  it('refuses stale challenge replays and checks before contacting a provider', async () => {
    const input = reservation(); const old = await admitted(input);
    const newer = await admitted(sameBrowser(input)); await repo.completeCheck(newer);
    expect(await reserve(input)).toEqual({ kind: 'denied' });
    expect(await repo.claimCheck({ ...old, checkId: randomUUID() })).toBeNull();
    expect(await repo.settleSend({ ...input, verificationSid: `VE${'2'.repeat(32)}` })).toBeNull();
    expect(await repo.completeCheck(old)).toBeNull();
  });

  it('requires both RLS scopes and creates no browser context for a denied reservation', async () => {
    const denied = reservation({ planExpiresAt: Date.now() - 1000 });
    expect(await reserve(denied)).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT 1 FROM customer.browser_contexts WHERE parent_ref=$1', [denied.parentRef])).rowCount).toBe(0);
    const input = reservation(); await admitted(input);
    expect((await fixture.app.query('SELECT * FROM customer.browser_contexts')).rowCount).toBe(0);
    for (const scope of [{ ...input, tenantRef: 'foreign' }, { ...input, parentRef: 'foreign' }]) {
      expect(await withCustomerScope(fixture.app, scope, async client => (await client.query('SELECT * FROM customer.browser_contexts')).rowCount)).toBe(0);
    }
    const before = (await fixture.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
    expect(before).toHaveLength(4); await migrateCustomer(fixture.admin);
    expect((await fixture.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(before);
  });

  it('keeps the final generation available for logout and rejects resets or cross-browser pointers', async () => {
    const input = reservation(); await reserve(input);
    // The privileged fixture constructs the boundary without billions of writes.
    await fixture.admin.query('ALTER TABLE customer.browser_contexts DISABLE TRIGGER browser_context_monotone');
    try {
      await fixture.admin.query('UPDATE customer.browser_contexts SET generation=$2 WHERE parent_ref=$1',
        [input.parentRef, String(BigInt(Number.MAX_SAFE_INTEGER) - 2n)]);
    } finally { await fixture.admin.query('ALTER TABLE customer.browser_contexts ENABLE TRIGGER browser_context_monotone'); }
    const final = await admitted(sameBrowser(input)); await repo.completeCheck(final);
    expect((await repo.authenticate(final))?.sessionId).toBe(final.sessionId);
    await expect(fixture.admin.query('UPDATE customer.browser_contexts SET generation=0 WHERE parent_ref=$1', [input.parentRef]))
      .rejects.toMatchObject({ code: '23514' });
    await expect(fixture.admin.query('DELETE FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef]))
      .rejects.toMatchObject({ code: '23514' });
    const other = await admitted(reservation({ parentRef: input.parentRef, tenantRef: input.tenantRef })); await repo.completeCheck(other);
    await expect(fixture.admin.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$4
      WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3`, [input.parentRef, input.tenantRef, input.browserHash, other.sessionId]))
      .rejects.toMatchObject({ code: '23503' });
    await repo.revoke({ ...final, all: false });
    expect(await repo.authenticate(final)).toBeNull();
    expect(await reserve(sameBrowser(input))).toEqual({ kind: 'denied' });
    expect((await fixture.admin.query('SELECT generation,current_session_id FROM customer.browser_contexts WHERE parent_ref=$1 AND browser_hash=$2',
      [input.parentRef, input.browserHash])).rows[0]).toEqual({ generation: String(Number.MAX_SAFE_INTEGER), current_session_id: null });
  });

  it('rolls back the temporary context when SQL time expires after budget checks', async () => {
    const input = reservation({ expiresAt: Date.now() + 1000 }); let intercepted = 0;
    await confirmCustomerTestBrowser(repo, input);
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO customer.challenges')) {
          intercepted++;
          expect((await client.query('SELECT 1 FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1);
          await fixture.admin.query('SELECT pg_sleep($1)', [Math.max(0, (input.expiresAt - Date.now()) / 1000) + 0.02]);
        }
        return client.query(sql, params);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    expect(await new PostgresCustomerIdentityRepository(interposed).reserve(input)).toEqual({ kind: 'denied' });
    expect(intercepted).toBe(1);
    expect((await fixture.admin.query('SELECT 1 FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT 1 FROM customer.reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
  });

  it('rolls back account, session and consumption when publication fails, but never refunds the reservation', async () => {
    const input = reservation(); const done = await admitted(input); let intercepted = 0;
    const interposed = { connect: async () => {
      const client = await fixture.app.connect();
      return { query: (sql: string, params?: unknown[]) => {
        if (sql.startsWith('UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$5')) {
          intercepted++; throw new Error('fixture publication failure');
        }
        return client.query(sql, params);
      }, release: client.release.bind(client) };
    } } as unknown as Pool;
    await expect(new PostgresCustomerIdentityRepository(interposed).completeCheck(done)).rejects.toThrow('Identité client indisponible');
    expect(intercepted).toBe(1);
    for (const table of ['accounts', 'sessions']) {
      expect((await fixture.admin.query(`SELECT 1 FROM customer.${table} WHERE parent_ref=$1`, [input.parentRef])).rowCount).toBe(0);
    }
    expect((await fixture.admin.query('SELECT state FROM customer.check_attempts WHERE id=$1', [done.checkId])).rows[0].state).toBe('checking');
    expect((await fixture.admin.query('SELECT generation,current_session_id FROM customer.browser_contexts WHERE parent_ref=$1', [input.parentRef])).rows[0])
      .toEqual({ generation: '0', current_session_id: null });
    expect((await fixture.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0].reserved_sends).toBe('1');
  });
});

integration('browser continuity migration — preexisting identities remain inert', () => {
  it.each([2, 3] as const)('upgrades the first %s actual migrations without inferring a browser preparation or deleting history', async migrationCount => {
    const input = reservation(); const accountId = randomUUID(); const sessionId = randomUUID(); const sessionHash = hash();
    const checkId = randomUUID(); let originalBudget: unknown;
    const fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL, {
      beforeUpgradeMigrations: migrationCount,
      beforeUpgrade: async admin => {
        await admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit,reserved_sends,reserved_sms,reserved_verifications)
          VALUES($1,50,100,100,1,1,1)`, [input.parentRef]);
        await admin.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)', [accountId, input.parentRef, input.tenantRef]);
        await admin.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone)
          VALUES($1,$2,$3,$4,$5)`, [input.parentRef, input.tenantRef, accountId, input.phoneHash, input.encryptedPhone]);
        await admin.query(`INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,expires_at)
          VALUES($1,$2,$3,$4,$5,0,clock_timestamp()+interval '1 day')`, [sessionId, input.parentRef, input.tenantRef, accountId, sessionHash]);
        await admin.query(`INSERT INTO customer.challenges(id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,
          service_sid,verification_sid,state,max_checks,checks_used,check_id,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'consumed',5,1,$11,clock_timestamp()+interval '5 minutes')`,
        [input.challengeId, input.parentRef, input.tenantRef, input.operationId, input.requestHash, input.browserHash, input.phoneHash,
          input.encryptedPhone, input.serviceSid, `VE${'2'.repeat(32)}`, checkId]);
        await admin.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
          VALUES($1,$2,$3,$4,$5,$6,$7,1)`, [input.operationId, input.parentRef, input.tenantRef, input.challengeId,
          input.globalPhoneHash, input.ipHash, input.evidenceReference]);
        await admin.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id,state,session_id,completed_at)
          VALUES($1,$2,$3,$4,'approved',$5,clock_timestamp())`, [checkId, input.parentRef, input.tenantRef, input.challengeId, sessionId]);
        if (migrationCount === 3) {
          await admin.query('INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash) VALUES($1,$2,$3)',
            [input.parentRef, input.tenantRef, input.browserHash]);
          await admin.query('UPDATE customer.sessions SET browser_hash=$2,browser_generation=1 WHERE id=$1', [sessionId, input.browserHash]);
          await admin.query('UPDATE customer.browser_contexts SET generation=1,current_session_id=$2 WHERE parent_ref=$1', [input.parentRef, sessionId]);
          await admin.query('UPDATE customer.challenges SET browser_generation=0 WHERE id=$1', [input.challengeId]);
        }
        originalBudget = (await admin.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0];
      },
    });
    try {
      const repo = new PostgresCustomerIdentityRepository(fixture.app);
      // Even matching a historical hash to a NEW confirmed preparation cannot adopt old rows.
      await confirmCustomerTestBrowser(repo, input);
      expect(await repo.authenticate({ ...input, sessionHash })).toBeNull();
      expect(await repo.recoverCheck({ ...input, checkId, sessionHash })).toBeNull();
      expect(await repo.updateName({ ...input, sessionHash, expectedRevision: 0, encryptedName: 'forbidden' })).toBeNull();
      await repo.revoke({ ...input, sessionHash, all: true });
      expect(await repo.claimCheck({ ...input, checkId: randomUUID() })).toBeNull();
      expect((await fixture.admin.query('SELECT * FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rows[0]).toEqual(originalBudget);
      expect((await fixture.admin.query('SELECT browser_ref,browser_hash,browser_generation,revoked_at FROM customer.sessions WHERE id=$1', [sessionId])).rows[0])
        .toEqual({ browser_ref: null, browser_hash: migrationCount === 3 ? input.browserHash : null,
          browser_generation: migrationCount === 3 ? '1' : null, revoked_at: null });
      expect((await fixture.admin.query('SELECT browser_ref,browser_generation,state FROM customer.challenges WHERE id=$1', [input.challengeId])).rows[0])
        .toEqual({ browser_ref: null, browser_generation: migrationCount === 3 ? '0' : null, state: 'consumed' });
      expect((await fixture.admin.query('SELECT 1 FROM customer.browser_contexts')).rowCount).toBe(migrationCount === 3 ? 1 : 0);
      expect((await fixture.admin.query('SELECT revision,session_version FROM customer.accounts WHERE id=$1', [accountId])).rows[0])
        .toEqual({ revision: '0', session_version: '0' });
      await migrateCustomer(fixture.admin);
      expect((await fixture.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations')).rowCount).toBe(4);
    } finally { await fixture.close(); }
  }, 20_000);
});
