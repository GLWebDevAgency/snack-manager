import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { accessTestHash, protectedAccessTestAccount } from './access-test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { withProtectedCustomerSession } from './protected-session';
import type { CustomerIdentityRepository } from './port';

type Input = Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;

integration('protected customer SQL unit of work — native PostgreSQL, no provider', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(f.app);
  }, 20_000);
  afterAll(async () => { await f?.close(); });

  async function account() {
    const value = await protectedAccessTestAccount(repo, f.admin);
    const { parentRef, tenantRef, browserRef, browserHash } = value.input;
    const input: Input = { parentRef, tenantRef, browserRef, browserHash,
      sessionHash: value.selection.sessionHash, expectedOperationId: value.selection.expectedOperationId,
      expectedCheckId: value.selection.expectedCheckId, now: Date.now() };
    return { ...value, principalInput: input };
  }
  async function writeName(client: PoolClient, input: Input, accountId: string) {
    expect((await client.query(`UPDATE customer.accounts SET encrypted_name='transaction-fixture',revision=revision+1
      WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, accountId])).rowCount).toBe(1);
  }
  async function storedName(accountId: string) {
    return (await f.admin.query('SELECT encrypted_name,revision FROM customer.accounts WHERE id=$1', [accountId])).rows[0];
  }

  it.each(['parent', 'tenant', 'browserHash', 'browserRef', 'operation', 'check', 'token'] as const)
    ('refuses wrong %s before invoking the writer', async field => {
      const a = await account();
      const patch = field === 'parent' ? { parentRef: 'foreign' } : field === 'tenant' ? { tenantRef: 'foreign' }
        : field === 'browserHash' ? { browserHash: accessTestHash() } : field === 'browserRef' ? { browserRef: randomUUID() }
          : field === 'operation' ? { expectedOperationId: randomUUID() } : field === 'check' ? { expectedCheckId: randomUUID() }
            : { sessionHash: accessTestHash() };
      const work = vi.fn(async () => 'forbidden');
      expect(await withProtectedCustomerSession(f.app, { ...a.principalInput, ...patch }, work)).toBeNull();
      expect(work).not.toHaveBeenCalled();
      expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
    });

  it('rejects malformed and extra authority fields before connecting', async () => {
    const a = await account();
    const pool = { connect: vi.fn(async () => { throw new Error('No connection expected'); }) };
    const work = vi.fn(async () => 'forbidden');
    for (const patch of [{ sessionHash: 'raw-token' }, { now: Number.NaN }, { expectedCheckId: null },
      { accountId: a.completion.accountId }, { phone: '+33000000000' }, { qrToken: 'not-authority' }]) {
      await expect(withProtectedCustomerSession(pool, { ...a.principalInput, ...patch } as Input, work))
        .rejects.toMatchObject({ reason: 'invalid_input' });
    }
    expect(pool.connect).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it.each(['key', 'code', 'revoked'] as const)('requires current %s protection before invoking the writer', async kind => {
    const a = await account();
    if (kind === 'revoked') await repo.revoke({ ...a.principalInput, all: false });
    else await f.admin.query(kind === 'key'
      ? 'UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp() WHERE account_id=$1'
      : 'UPDATE customer.recovery_codes SET revoked_at=clock_timestamp() WHERE account_id=$1', [a.completion.accountId]);
    const work = vi.fn(async () => 'forbidden');
    expect(await withProtectedCustomerSession(f.app, a.principalInput, work)).toBeNull();
    expect(work).not.toHaveBeenCalled();
  });

  it('uses one scoped client, keeps changes private until commit and freezes the encrypted session view', async () => {
    const a = await account();
    const connect = vi.spyOn(f.app, 'connect');
    try {
      const result = await withProtectedCustomerSession(f.app, a.principalInput, async ({ client, session }) => {
        expect(Object.isFrozen(session)).toBe(true);
        expect(Object.isFrozen(session.profile)).toBe(true);
        expect(session.profile).toEqual(a.session.profile);
        expect(session).not.toHaveProperty('sessionHash');
        expect(session.profile).not.toHaveProperty('phone');
        const before = (await client.query(`SELECT pg_backend_pid() AS pid,txid_current()::text AS tx,
          current_setting('app.tenant_ref') AS tenant,current_setting('app.customer_parent_ref') AS parent,
          current_user AS role`)).rows[0];
        expect(before).toMatchObject({ tenant: a.principalInput.tenantRef, parent: a.principalInput.parentRef, role: f.role });
        await writeName(client, a.principalInput, session.profile.accountId);
        expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
        const after = (await client.query('SELECT pg_backend_pid() AS pid,txid_current()::text AS tx')).rows[0];
        expect(after).toEqual({ pid: before.pid, tx: before.tx });
        return { committedAccount: session.profile.accountId };
      });
      expect(connect).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ committedAccount: a.completion.accountId });
      expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: 'transaction-fixture', revision: '1' });
    } finally { connect.mockRestore(); }
  });

  it('rolls back callback writes and never returns its result when the callback throws', async () => {
    const a = await account();
    await expect(withProtectedCustomerSession(f.app, a.principalInput, async ({ client, session }) => {
      await writeName(client, a.principalInput, session.profile.accountId);
      throw new Error('private callback failure');
    })).rejects.toMatchObject({ reason: 'unavailable', message: 'Identité client indisponible.' });
    expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
    expect(await repo.authenticateProtected(a.principalInput)).not.toBeNull();
  });

  it.each(['key', 'code', 'account', 'session', 'browser'] as const)
    ('rolls back the whole unit when %s protection disappears after admission', async kind => {
      const a = await account();
      let called = 0;
      await expect(withProtectedCustomerSession(f.app, a.principalInput, async ({ client, session }) => {
        called++;
        await writeName(client, a.principalInput, session.profile.accountId);
        if (kind === 'key') await client.query('UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp() WHERE account_id=$1', [a.completion.accountId]);
        else if (kind === 'code') await client.query('UPDATE customer.recovery_codes SET consumed_at=clock_timestamp() WHERE account_id=$1', [a.completion.accountId]);
        else if (kind === 'account') await client.query('UPDATE customer.accounts SET active=false WHERE id=$1', [a.completion.accountId]);
        else if (kind === 'session') await client.query('UPDATE customer.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [a.session.sessionId]);
        else await client.query('UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=NULL WHERE parent_ref=$1 AND tenant_ref=$2',
          [a.principalInput.parentRef, a.principalInput.tenantRef]);
        return 'must-never-publish';
      })).rejects.toMatchObject({ reason: 'unavailable' });
      expect(called).toBe(1);
      expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
      expect(await repo.authenticateProtected(a.principalInput)).not.toBeNull();
    });

  it('uses SQL wall time after the callback and rolls back when the admitted session expires', async () => {
    const a = await account();
    // A stale caller-supplied clock must neither admit nor prolong a session.
    const input = { ...a.principalInput, now: 0 };
    let expiredInsideTransaction = false;
    await expect(withProtectedCustomerSession(f.app, input, async ({ client, session }) => {
      await writeName(client, input, session.profile.accountId);
      await client.query("UPDATE customer.sessions SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1", [a.session.sessionId]);
      await client.query(`SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp()))+0.025)
        FROM customer.sessions WHERE id=$1`, [a.session.sessionId]);
      expiredInsideTransaction = (await client.query('SELECT expires_at<=clock_timestamp() AS expired FROM customer.sessions WHERE id=$1',
        [a.session.sessionId])).rows[0].expired === true;
      return 'expired-result';
    })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(expiredInsideTransaction).toBe(true);
    expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
    expect(await repo.authenticateProtected(a.principalInput)).not.toBeNull();
  });

  it('linearizes a concurrent revoke after the admitted transaction using the same advisory lock', async () => {
    const a = await account();
    let entered!: (pid: number) => void;
    const admitted = new Promise<number>(resolve => { entered = resolve; });
    let release!: () => void;
    const finish = new Promise<void>(resolve => { release = resolve; });
    const transaction = withProtectedCustomerSession(f.app, a.principalInput, async ({ client, session }) => {
      await writeName(client, a.principalInput, session.profile.accountId);
      entered((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      await finish;
      return 'committed-before-revoke';
    });
    let revoke: Promise<void> | undefined;
    try {
      const ownerPid = await admitted;
      revoke = repo.revoke({ ...a.principalInput, all: false });
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE usename=$1 AND wait_event_type='Lock' AND wait_event='advisory' AND $2=ANY(pg_blocking_pids(pid))`,
      [f.role, ownerPid])).rows[0].n, { timeout: 2000 }).toBe(1);
      expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: null, revision: '0' });
      release();
      expect(await transaction).toBe('committed-before-revoke');
      await revoke;
      expect(await storedName(a.completion.accountId)).toEqual({ encrypted_name: 'transaction-fixture', revision: '1' });
      expect(await repo.authenticateProtected(a.principalInput)).toBeNull();
      const denied = vi.fn(async () => 'forbidden');
      expect(await withProtectedCustomerSession(f.app, a.principalInput, denied)).toBeNull();
      expect(denied).not.toHaveBeenCalled();
    } finally { release(); await Promise.allSettled([transaction, ...(revoke ? [revoke] : [])]); }
  });

  it('refuses a valid historical phone-only session without invoking the writer', async () => {
    let input!: Input;
    const legacy = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL, {
      beforeUpgradeMigrations: 6,
      beforeUpgrade: async admin => { input = await seedLegacySession(admin); },
    });
    try {
      expect(await new PostgresCustomerIdentityRepository(legacy.app).authenticate(input)).not.toBeNull();
      const work = vi.fn(async () => 'forbidden');
      expect(await withProtectedCustomerSession(legacy.app, input, work)).toBeNull();
      expect(work).not.toHaveBeenCalled();
    } finally { await legacy.close(); }
  }, 20_000);
});

/** Legitimate pre-protection data is inserted BEFORE migration0006, never by
 * disabling modern triggers. The ordinary session must still authenticate. */
async function seedLegacySession(admin: Pool): Promise<Input> {
  const i = { parentRef: `p_${accessTestHash()}`, tenantRef: `t_${accessTestHash()}`, browserRef: randomUUID(), browserHash: accessTestHash(),
    operationId: randomUUID(), proofHash: accessTestHash(), checkId: randomUUID(), challengeId: randomUUID(),
    accountId: randomUUID(), sessionId: randomUUID(), sessionHash: accessTestHash(), phoneHash: accessTestHash() };
  await admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit,reserved_sends,reserved_sms,reserved_verifications)
    VALUES($1,50,100,100,1,1,1)`, [i.parentRef]);
  await admin.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)', [i.accountId, i.parentRef, i.tenantRef]);
  await admin.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone)
    VALUES($1,$2,$3,$4,'fixture')`, [i.parentRef, i.tenantRef, i.accountId, i.phoneHash]);
  await admin.query(`WITH t AS (SELECT clock_timestamp()-interval '1 hour' AS at)
    INSERT INTO customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash,created_at,admission_expires_at,expires_at,issued_at,confirmed_at)
    SELECT $1,$2,$3,$4,at,at+interval '10 minutes',at+interval '168 hours',at,at FROM t`, [i.parentRef, i.tenantRef, i.browserRef, i.browserHash]);
  await admin.query('INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash) VALUES($1,$2,$3)', [i.parentRef, i.tenantRef, i.browserHash]);
  await admin.query(`WITH t AS (SELECT clock_timestamp()-interval '12 minutes' AS at)
    INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,browser_generation,state,created_at,expires_at,consumed_at)
    SELECT $1,$2,$3,$4,$5,$6,0,'consumed',at,at+interval '10 minutes',at+interval '1 minute' FROM t`,
  [i.parentRef, i.tenantRef, i.operationId, i.browserRef, i.browserHash, i.proofHash]);
  await admin.query(`INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,created_at,expires_at,browser_ref,browser_hash,browser_generation)
    VALUES($1,$2,$3,$4,$5,0,clock_timestamp()-interval '11 minutes',clock_timestamp()+interval '1 day',$6,$7,1)`,
  [i.sessionId, i.parentRef, i.tenantRef, i.accountId, i.sessionHash, i.browserRef, i.browserHash]);
  await admin.query('UPDATE customer.browser_contexts SET generation=1,current_session_id=$4 WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3',
    [i.parentRef, i.tenantRef, i.browserHash, i.sessionId]);
  await admin.query(`INSERT INTO customer.challenges(id,parent_ref,tenant_ref,operation_id,intent_operation_id,request_hash,browser_ref,browser_hash,browser_generation,
    phone_hash,encrypted_phone,service_sid,state,max_checks,checks_used,check_id,verification_sid,created_at,expires_at)
    VALUES($1,$2,$3,$4,$4,$5,$6,$7,0,$8,'fixture',$9,'consumed',5,1,$10,$11,clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '3 minutes')`,
  [i.challengeId, i.parentRef, i.tenantRef, i.operationId, accessTestHash(), i.browserRef, i.browserHash, i.phoneHash,
    `VA${accessTestHash().slice(0, 32)}`, i.checkId, `VE${accessTestHash().slice(0, 32)}`]);
  await admin.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
    VALUES($1,$2,$3,$4,$5,$6,'fixture',1)`, [i.operationId, i.parentRef, i.tenantRef, i.challengeId, accessTestHash(), accessTestHash()]);
  await admin.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id,state,session_id,completed_at,request_hash)
    VALUES($1,$2,$3,$4,'approved',$5,clock_timestamp(),$6)`, [i.checkId, i.parentRef, i.tenantRef, i.challengeId, i.sessionId, accessTestHash()]);
  await admin.query(`INSERT INTO customer.session_publications(parent_ref,tenant_ref,session_id,operation_id,check_id,browser_ref,browser_hash,browser_generation,method)
    VALUES($1,$2,$3,$4,$5,$6,$7,1,'phone')`, [i.parentRef, i.tenantRef, i.sessionId, i.operationId, i.checkId, i.browserRef, i.browserHash]);
  return { parentRef: i.parentRef, tenantRef: i.tenantRef, browserRef: i.browserRef, browserHash: i.browserHash,
    sessionHash: i.sessionHash, expectedOperationId: i.operationId, expectedCheckId: i.checkId, now: Date.now() };
}
