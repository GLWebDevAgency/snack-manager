import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { PostgresCustomerProductionOperator } from './production-operator';
import { migrateCustomer } from './migration';
import { assertCustomerMigrationsCurrent } from './migration-state';
import { withCustomerScope } from './client';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomUUID().replaceAll('-', '').repeat(2);
const scope = () => ({ parentRef: `parent_${randomUUID().replaceAll('-', '')}`, tenantRef: `tenant_${randomUUID().replaceAll('-', '')}` });
const policy = (s: ReturnType<typeof scope>) => ({ ...s, policyRef: 'production-target', windowMs: 60000,
  browserSourceLimit: 1, browserTenantLimit: 200, browserParentLimit: 200,
  intentBrowserLimit: 20, intentSourceLimit: 20, intentTenantLimit: 200, intentParentLimit: 200 });
async function seedChallenge(admin: Pool, s: ReturnType<typeof scope>, challengeId = randomUUID()) {
  await admin.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
    VALUES($1,5,20,10) ON CONFLICT DO NOTHING`, [s.parentRef]);
  await admin.query(`WITH stamp AS (SELECT clock_timestamp() AS now) INSERT INTO customer.challenges
    (id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,service_sid,max_checks,created_at,expires_at)
    SELECT $1,$2,$3,$4,$5,$5,$5,'fixture','VA11111111111111111111111111111111',5,now,now+interval '10 minutes' FROM stamp`,
  [challengeId, s.parentRef, s.tenantRef, randomUUID(), hash()]);
  return challengeId;
}

integration('production additive upgrade and legacy writer fences — native PostgreSQL', () => {
  it('preserves original migration hashes, pilot receipts/caps, 128 admissions and tombstones', async () => {
    const s = scope(); const browserRef = randomUUID(); const browserHash = hash(); const operationId = randomUUID();
    let history: unknown[] = []; let receipt: unknown;
    const f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL, { beforeUpgradeMigrations: 9, beforeUpgrade: async admin => {
      const challengeId = await seedChallenge(admin, s);
      await admin.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
        VALUES($1,$2,$3,$4,$5,$5,'historical',2)`, [randomUUID(), s.parentRef, s.tenantRef, challengeId, hash()]);
      receipt = (await admin.query('SELECT * FROM customer.reservations WHERE parent_ref=$1', [s.parentRef])).rows[0];
      await admin.query(`WITH stamp AS (SELECT clock_timestamp() AS now) INSERT INTO customer.browser_preparations
        (parent_ref,tenant_ref,browser_ref,browser_hash,created_at,admission_expires_at,expires_at,issued_at,confirmed_at)
        SELECT $1,$2,$3,$4,now,now+interval '10 minutes',now+interval '168 hours',now,now FROM stamp`, [s.parentRef, s.tenantRef, browserRef, browserHash]);
      await admin.query(`WITH stamp AS (SELECT clock_timestamp() AS now) INSERT INTO customer.browser_preparations
        (parent_ref,tenant_ref,browser_ref,created_at,admission_expires_at,expires_at)
        SELECT $1,$2,gen_random_uuid(),now,now+interval '10 minutes',now+interval '168 hours' FROM stamp,generate_series(1,127)`, [s.parentRef, s.tenantRef]);
      await admin.query(`WITH stamp AS (SELECT clock_timestamp() AS now) INSERT INTO customer.verification_intents
        (parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,browser_generation,state,created_at,expires_at,closed_at)
        SELECT $1,$2,CASE WHEN n=1 THEN $5::uuid ELSE gen_random_uuid() END,$3,$4,0,'closed',now,now+interval '10 minutes',now
        FROM stamp,generate_series(1,128) AS n`, [s.parentRef, s.tenantRef, browserRef, browserHash, operationId]);
      history = (await admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
    } });
    try {
      const repo = new PostgresCustomerIdentityRepository(f.app); const op = new PostgresCustomerProductionOperator(f.operator);
      expect(await repo.prepareBrowser({ ...s, browserRef: randomUUID() })).toBeNull();
      expect(await repo.prepareIntent({ ...s, browserRef, browserHash, operationId: randomUUID(), proofHash: hash() })).toBeNull();
      expect(await repo.closeIntent({ ...s, browserRef, browserHash, operationId })).toMatchObject({ state: 'closed' });
      await op.authorizeAdmissions(policy(s));
      const admission = { mode: 'production_paid' as const, sourceHash: hash() };
      expect(await repo.prepareBrowser({ ...s, browserRef: randomUUID(), admission })).toMatchObject({ state: 'prepared' });
      expect(await repo.prepareIntent({ ...s, browserRef, browserHash, operationId: randomUUID(), proofHash: hash(), admission })).toMatchObject({ intent: { state: 'open' } });
      expect(await repo.prepareIntent({ ...s, browserRef, browserHash, operationId, proofHash: hash(), admission })).toMatchObject({ intent: { state: 'closed' }, emitCookie: false });
      expect((await f.admin.query('SELECT * FROM customer.reservations WHERE parent_ref=$1', [s.parentRef])).rows[0])
        .toEqual({ ...(receipt as object), production_authorization_ref: null });
      expect((await f.admin.query('SELECT send_limit,sms_limit,verification_limit,reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [s.parentRef])).rows[0])
        .toEqual({ send_limit: '5', sms_limit: '20', verification_limit: '10', reserved_sends: '0' });
      const current = (await f.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
      expect(current).toHaveLength(11); expect(current.slice(0,9)).toEqual(history);
      await migrateCustomer(f.admin); await assertCustomerMigrationsCurrent(f.app);
      expect((await f.admin.query('SELECT hash,created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(current);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM customer.browser_preparations WHERE parent_ref=$1', [s.parentRef])).rows[0].n).toBe(129);
      expect((await f.admin.query('SELECT count(*)::int AS n FROM customer.verification_intents WHERE parent_ref=$1', [s.parentRef])).rows[0].n).toBe(129);
    } finally { await f.close(); }
  }, 20000);

  it('rejects the old SQL writer already waiting when the operator commits production cutover', async () => {
    const f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); const s = scope();
    const blocker = await f.admin.connect(); let waiting: Promise<unknown> | undefined;
    try {
      const challengeId = await seedChallenge(f.admin, s);
      await blocker.query('BEGIN'); await blocker.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [s.parentRef]);
      waiting = withCustomerScope(f.app, s, async c => {
        const result = await c.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
          VALUES($1,$2,$3,$4,$5,$5,'old-writer',2) RETURNING id`, [randomUUID(), s.parentRef, s.tenantRef, challengeId, hash()]);
        return result.rowCount;
      }).then(() => 'unexpected-success', () => 'closed');
      await expect.poll(async () => (await f.admin.query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=$1 AND usename=$2 AND wait_event_type='Lock'`, [f.database, f.role])).rows[0].n).toBe(1);
      await blocker.query(`INSERT INTO customer.production_admission_policies(parent_ref,tenant_ref,policy_ref,window_ms,
        browser_source_limit,browser_tenant_limit,browser_parent_limit,intent_browser_limit,intent_source_limit,intent_tenant_limit,intent_parent_limit)
        VALUES($1,$2,'target',60000,1,200,200,20,20,200,200)`, [s.parentRef, s.tenantRef]);
      await blocker.query('COMMIT'); expect(await waiting).toBe('closed');
      expect((await f.admin.query('SELECT count(*)::int AS n FROM customer.reservations WHERE parent_ref=$1', [s.parentRef])).rows[0].n).toBe(0);
      const oldBrowser = await withCustomerScope(f.app, s, c => c.query(`WITH stamp AS (SELECT clock_timestamp() AS now)
        INSERT INTO customer.browser_preparations(parent_ref,tenant_ref,browser_ref,created_at,admission_expires_at,expires_at)
        SELECT $1,$2,$3,now,now+interval '10 minutes',now+interval '168 hours' FROM stamp RETURNING browser_ref`,
      [s.parentRef, s.tenantRef, randomUUID()]));
      expect(oldBrowser.rowCount).toBe(0);
    } finally { await blocker.query('ROLLBACK').catch(() => undefined); blocker.release(); await waiting; await f.close(); }
  }, 20000);

  it('uses SQL time windows without deleting or rewriting expired admissions', async () => {
    const f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); const s = scope();
    try {
      const op = new PostgresCustomerProductionOperator(f.operator); const repo = new PostgresCustomerIdentityRepository(f.app);
      await op.authorizeAdmissions(policy(s)); const sourceHash = hash(); const oldId = randomUUID();
      await f.admin.query(`INSERT INTO customer.production_admissions(parent_ref,tenant_ref,kind,admission_ref,browser_ref,policy_ref,source_hash,admitted_at)
        VALUES($1,$2,'browser',$3,$3,'production-target',$4,clock_timestamp()-interval '2 minutes')`, [s.parentRef, s.tenantRef, oldId, sourceHash]);
      const first = await repo.prepareBrowser({ ...s, browserRef: randomUUID(), admission: { mode: 'production_paid', sourceHash } });
      expect(first).not.toBeNull();
      expect(await repo.prepareBrowser({ ...s, browserRef: randomUUID(), admission: { mode: 'production_paid', sourceHash } })).toBeNull();
      expect((await f.admin.query('SELECT count(*)::int AS n FROM customer.production_admissions WHERE parent_ref=$1', [s.parentRef])).rows[0].n).toBe(2);
      await expect(f.admin.query('DELETE FROM customer.production_admissions WHERE admission_ref=$1', [oldId])).rejects.toMatchObject({ code: '23514' });
      await expect(f.admin.query('UPDATE customer.production_admissions SET admitted_at=clock_timestamp() WHERE admission_ref=$1', [oldId])).rejects.toMatchObject({ code: '23514' });
    } finally { await f.close(); }
  }, 20000);
});
