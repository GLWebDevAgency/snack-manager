import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { assertCustomerTestTarget, customerTestFixture, trackCustomerTestPool } from './test-fixture';
import { migrateCustomer } from './migration';
import { PostgresCustomerIdentityRepository } from './repository';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const sources = ['accounts', 'verified_contacts', 'sessions', 'browser_contexts', 'browser_preparations',
  'verification_intents', 'challenges', 'check_attempts'];

async function seed0004(admin: Pool, kind: 'valid' | 'no_intent' | 'no_request' | 'pending' | 'revoked') {
  const i = { parentRef: `p_${hash()}`, tenantRef: `t_${hash()}`, browserRef: randomUUID(), browserHash: hash(),
    operationId: randomUUID(), proofHash: hash(), checkId: randomUUID(), challengeId: randomUUID(),
    accountId: randomUUID(), sessionId: randomUUID(), sessionHash: hash(), phoneHash: hash(), now: Date.now() };
  await admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit,reserved_sends,reserved_sms,reserved_verifications)
    VALUES($1,50,100,100,1,1,1)`, [i.parentRef]);
  await admin.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)', [i.accountId, i.parentRef, i.tenantRef]);
  await admin.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone)
    VALUES($1,$2,$3,$4,'fixture')`, [i.parentRef, i.tenantRef, i.accountId, i.phoneHash]);
  await admin.query(`WITH t AS (SELECT clock_timestamp()-interval '1 hour' AS at)
    INSERT INTO customer.browser_preparations(parent_ref,tenant_ref,browser_ref,browser_hash,created_at,admission_expires_at,expires_at,issued_at,confirmed_at)
    SELECT $1,$2,$3,$4,at,at+interval '10 minutes',at+interval '168 hours',at,at FROM t`,
  [i.parentRef, i.tenantRef, i.browserRef, i.browserHash]);
  await admin.query('INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash) VALUES($1,$2,$3)', [i.parentRef, i.tenantRef, i.browserHash]);
  if (kind !== 'no_intent') await admin.query(`WITH t AS (SELECT clock_timestamp()-interval '12 minutes' AS at)
    INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,
      browser_generation,state,created_at,expires_at,consumed_at)
    SELECT $1,$2,$3,$4,$5,$6,0,'consumed',at,at+interval '10 minutes',at+interval '1 minute' FROM t`,
  [i.parentRef, i.tenantRef, i.operationId, i.browserRef, i.browserHash, i.proofHash]);
  await admin.query(`INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,
    created_at,expires_at,revoked_at,browser_ref,browser_hash,browser_generation)
    VALUES($1,$2,$3,$4,$5,0,clock_timestamp()-interval '11 minutes',clock_timestamp()+interval '1 day',
      CASE WHEN $8 THEN clock_timestamp() ELSE NULL END,$6,$7,1)`,
  [i.sessionId, i.parentRef, i.tenantRef, i.accountId, i.sessionHash, i.browserRef, i.browserHash, kind === 'revoked']);
  await admin.query('UPDATE customer.browser_contexts SET generation=1,current_session_id=$4 WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3',
    [i.parentRef, i.tenantRef, i.browserHash, i.sessionId]);
  await admin.query(`INSERT INTO customer.challenges(id,parent_ref,tenant_ref,operation_id,intent_operation_id,request_hash,
    browser_ref,browser_hash,browser_generation,phone_hash,encrypted_phone,service_sid,state,max_checks,checks_used,check_id,verification_sid,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'fixture',$10,'consumed',5,1,$11,
      $12,clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '3 minutes')`,
  [i.challengeId, i.parentRef, i.tenantRef, i.operationId, kind === 'no_intent' ? null : i.operationId, hash(), i.browserRef,
    i.browserHash, i.phoneHash, `VA${hash().slice(0, 32)}`, i.checkId, `VE${hash().slice(0, 32)}`]);
  await admin.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
    VALUES($1,$2,$3,$4,$5,$6,'fixture',1)`, [i.operationId, i.parentRef, i.tenantRef, i.challengeId, hash(), hash()]);
  await admin.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id,state,session_id,completed_at,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)`, [i.checkId, i.parentRef, i.tenantRef, i.challengeId,
    kind === 'pending' ? 'pending' : 'approved', i.sessionId, kind === 'no_request' ? null : hash()]);
  return { ...i, expectedOperationId: i.operationId, expectedCheckId: i.checkId };
}

integration('0004→0005 publication migration — limited owner, native SQL', () => {
  it('backfills only exact live approvals after intent expiry; restores FORCE on success and failed migration', async () => {
    const raw = assertCustomerTestTarget(process.env.CUSTOMER_TEST_DATABASE_URL);
    const owner = `customer_migrator_test_${randomUUID().replaceAll('-', '')}`;
    const password = randomUUID();
    let ownerCreated = false;
    let f: Awaited<ReturnType<typeof customerTestFixture>> | undefined;
    let cases: Awaited<ReturnType<typeof seed0004>>[] = [];
    let originalRows: unknown;
    let oldJournal: unknown[] = [];
    try {
      f = await customerTestFixture(raw, { beforeUpgradeMigrations: 5, beforeUpgrade: async admin => {
        for (const kind of ['valid', 'no_intent', 'no_request', 'pending', 'revoked'] as const) cases.push(await seed0004(admin, kind));
        originalRows = (await admin.query('SELECT * FROM customer.sessions ORDER BY id')).rows;
        // Exact private selection used before 0005: this is the baseline authority,
        // not an expectation inferred from the new migration's SELECT.
        expect((await admin.query(`SELECT s.id FROM customer.sessions s
          JOIN customer.accounts a ON (a.parent_ref,a.tenant_ref,a.id)=(s.parent_ref,s.tenant_ref,s.account_id)
          JOIN customer.verified_contacts v ON (v.parent_ref,v.tenant_ref,v.account_id)=(a.parent_ref,a.tenant_ref,a.id)
          JOIN customer.browser_contexts b ON (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
            =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)
          JOIN customer.browser_preparations p ON (p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)
            =(s.parent_ref,s.tenant_ref,s.browser_ref,s.browser_hash)
          WHERE s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND a.active AND a.session_version=s.account_version
            AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp()
            AND EXISTS (SELECT 1 FROM customer.check_attempts k JOIN customer.challenges c
              ON (c.parent_ref,c.tenant_ref,c.id)=(k.parent_ref,k.tenant_ref,k.challenge_id)
              WHERE (k.parent_ref,k.tenant_ref,k.session_id)=(s.parent_ref,s.tenant_ref,s.id)
                AND k.state='approved' AND k.request_hash IS NOT NULL AND c.intent_operation_id IS NOT NULL)`)).rows)
          .toEqual([{ id: cases[0]!.sessionId }]);
        oldJournal = (await admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
        expect(oldJournal).toHaveLength(5);
        const database = (await admin.query<{ name: string }>('SELECT current_database() AS name')).rows[0]!.name;
        if (!/^snackmanager_customer_test_[a-f0-9]{32}$/.test(database)) throw new Error('Disposable target required');
        const runtime = database.replace('snackmanager_customer_test_', 'customer_test_');
        await admin.query(`CREATE ROLE "${owner}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
        ownerCreated = true;
        await admin.query(`GRANT CONNECT,CREATE ON DATABASE "${database}" TO "${owner}";
          GRANT USAGE ON SCHEMA customer,drizzle TO "${runtime}";
          GRANT SELECT ON ALL TABLES IN SCHEMA customer,drizzle TO "${runtime}";
          GRANT "${runtime}" TO "${owner}"`);
        // Only objects in this freshly generated UUID database and these schemas.
        const tables = (await admin.query<{ name: string }>(`SELECT format('%I.%I',n.nspname,c.relname) AS name
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('customer','drizzle') AND c.relkind='r'`)).rows;
        const functions = (await admin.query<{ name: string }>(`SELECT format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS name
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='customer'`)).rows;
        await admin.query(`ALTER SCHEMA customer OWNER TO "${owner}"; ALTER SCHEMA drizzle OWNER TO "${owner}"`);
        for (const table of tables) await admin.query(`ALTER TABLE ${table.name} OWNER TO "${owner}"`);
        for (const fn of functions) await admin.query(`ALTER FUNCTION ${fn.name} OWNER TO "${owner}"`);
        const url = new URL(raw); url.pathname = `/${database}`; url.username = owner; url.password = password;
        const pool = new Pool({ connectionString: url.toString(), max: 1, connectionTimeoutMillis: 3000 });
        const drain = trackCustomerTestPool(pool);
        let injected = 0;
        let ownerFlags: unknown;
        let sourcesWithoutForce = -1;
        let runtimeVisible = -1;
        const injectedFailure = new Error('synthetic failure after NO FORCE');
        const connect = pool.connect.bind(pool);
        const spy = vi.spyOn(pool, 'connect').mockImplementation(((callback?: Parameters<Pool['connect']>[0]) => {
          if (callback) return connect(callback);
          return (async () => {
            const client = await connect(); const query = client.query.bind(client);
            return { query: async (sql: string | { text: string }, params?: unknown[]) => {
            const text = typeof sql === 'string' ? sql : sql.text;
            if (text.includes('INSERT INTO customer.session_publications')) {
              injected++;
              ownerFlags = (await query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
              sourcesWithoutForce = (await query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='customer' AND c.relname=ANY($1) AND c.relrowsecurity AND NOT c.relforcerowsecurity`, [sources])).rows[0].n;
              await query(`SET LOCAL ROLE "${runtime}"`);
              runtimeVisible = (await query('SELECT 1 FROM customer.sessions')).rowCount ?? -1;
              await query(`SET LOCAL ROLE "${owner}"`);
              throw injectedFailure;
            }
            return query(sql, params);
            }, release: client.release.bind(client) } as PoolClient;
          })();
        }) as typeof pool.connect);
        try {
          const failure = await migrateCustomer(pool).then(() => null, error => error);
          expect(failure === injectedFailure || failure?.cause === injectedFailure).toBe(true);
          expect(injected).toBe(1);
          expect(ownerFlags).toEqual({ rolsuper: false, rolbypassrls: false });
          expect(sourcesWithoutForce).toBe(8); expect(runtimeVisible).toBe(0);
          spy.mockRestore();
          expect((await admin.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='customer' AND c.relname=ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity`, [sources])).rows[0].n).toBe(8);
          expect((await admin.query("SELECT to_regclass('customer.session_publications') AS name")).rows[0].name).toBeNull();
          expect((await admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(oldJournal);
          await migrateCustomer(pool);
          expect((await admin.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='customer' AND c.relname=ANY($1) AND c.relrowsecurity AND c.relforcerowsecurity`, [[...sources, 'session_publications']])).rows[0].n).toBe(9);
        } finally { spy.mockRestore(); await drain(); }
      } });
      const repo = new PostgresCustomerIdentityRepository(f.app);
      expect(await repo.authenticate(cases[0]!)).not.toBeNull();
      for (const invalid of cases.slice(1)) expect(await repo.authenticate(invalid)).toBeNull();
      expect((await f.admin.query('SELECT session_id,method FROM customer.session_publications')).rows)
        .toEqual([{ session_id: cases[0]!.sessionId, method: 'phone' }]);
      expect((await f.admin.query('SELECT * FROM customer.sessions ORDER BY id')).rows).toEqual(originalRows);
      expect((await f.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows.slice(0, 5)).toEqual(oldJournal);
      const before = (await f.admin.query('SELECT * FROM customer.session_publications')).rows;
      await migrateCustomer(f.admin);
      expect((await f.admin.query('SELECT * FROM customer.session_publications')).rows).toEqual(before);
      expect((await f.app.query('SELECT 1 FROM customer.session_publications')).rowCount).toBe(0);
      const current = cases[0]!;
      expect((await repo.updateName({ ...current, encryptedName: 'upgraded', expectedRevision: 0 }))?.profile.revision).toBe(1);
      await repo.revoke({ ...current, all: false }); expect(await repo.authenticate(current)).toBeNull();
    } finally {
      await f?.close();
      if (ownerCreated) {
        const root = new Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 3000 }); const drain = trackCustomerTestPool(root);
        try { await root.query(`DROP ROLE "${owner}"`); } finally { await drain(); }
      }
    }
  }, 20_000);
});
