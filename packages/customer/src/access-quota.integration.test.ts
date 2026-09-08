import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { accessTestHash as hash, accessTestToken as token, prepareAccessTestIntent } from './access-test-fixture';
import { withCustomerScope } from './client';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('credential quotas — SQL clock, parent scope and immutable reservations', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>, repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(f.app); }, 20_000);
  afterAll(async () => { await f?.close(); });
  async function target() {
    return { ...await prepareAccessTestIntent(repo, { parentRef: `parent_${hash()}`, tenantRef: `tenant_${hash()}` }),
      sourceHash: hash(), origin: 'https://customer.fixture', rpId: 'customer.fixture', challenge: token() };
  }
  /** Historical failed receipts only; never an account/session/credential seed.
   * Bulk ledger fixtures isolate each limit, independently of setup admission. */
  async function history(input: Awaited<ReturnType<typeof target>>, count: number, patch: { tenantRef?: string; browserHash?: string; sourceHash?: string; ageMinutes?: number } = {}) {
    const seed = await prepareAccessTestIntent(repo, { parentRef: input.parentRef, tenantRef: patch.tenantRef ?? input.tenantRef });
    await f.admin.query(`WITH ids AS MATERIALIZED(SELECT gen_random_uuid() id FROM generate_series(1,$7)), stamp AS MATERIALIZED(SELECT clock_timestamp()-$8*interval '1 minute' now),
      written AS(INSERT INTO customer.credential_access_attempts(parent_ref,tenant_ref,operation_id,id,browser_ref,browser_hash,browser_generation,method,created_at,expires_at,
        origin,rp_id,challenge,request_hash,state,completed_at)
      SELECT $1,$2,$3,ids.id,$4,$5,0,'passkey',stamp.now,stamp.now+interval '10 minutes','https://customer.fixture','customer.fixture',$6,repeat('a',64),'failed',stamp.now
      FROM ids CROSS JOIN stamp RETURNING id,created_at)
      INSERT INTO customer.credential_auth_reservations(parent_ref,tenant_ref,operation_id,attempt_id,browser_hash,source_hash,method,reserved_at)
      SELECT $1,$2,$3,id,$9,$10,'passkey',created_at FROM written`,
    [seed.parentRef, seed.tenantRef, seed.operationId, seed.browserRef, seed.browserHash, token(), count, patch.ageMinutes ?? 0,
      patch.browserHash ?? hash(), patch.sourceHash ?? hash()]);
  }
  it.each([{ kind: 'browser', limit: 20 }, { kind: 'source', limit: 30 }, { kind: 'tenant', limit: 300 }, { kind: 'parent', limit: 1000 }] as const)
    ('refuses the $kind boundary including simultaneous final admissions', async ({ kind, limit }) => {
      const input = await target();
      await history(input, limit - 1, { ...(kind === 'browser' ? { browserHash: input.browserHash } : {}),
        ...(kind === 'source' ? { sourceHash: input.sourceHash } : {}), ...(kind === 'parent' ? { tenantRef: 'sibling' } : {}) });
      const results = await Promise.all([repo.preparePasskeyLogin(input), repo.preparePasskeyLogin({ ...input, attemptId: randomUUID() })]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect((await f.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(limit);
    });
  it('uses SQL windows rather than caller dates, never deletes or resets reservations', async () => {
    const input = await target(); await history(input, 1000, { tenantRef: 'sibling', sourceHash: input.sourceHash, browserHash: input.browserHash, ageMinutes: 61 });
    expect(await repo.preparePasskeyLogin(input)).not.toBeNull();
    await expect(withCustomerScope(f.app, input, c => c.query('DELETE FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef]))).rejects.toThrow();
    await expect(withCustomerScope(f.app, input, c => c.query("UPDATE customer.credential_auth_reservations SET reserved_at=clock_timestamp()-interval '1 day' WHERE parent_ref=$1", [input.parentRef]))).rejects.toThrow();
    expect((await f.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1001);
    expect(() => repo.preparePasskeyLogin({ ...input, now: Date.now() } as typeof input)).toThrow();
  });
  it('denies quota write spoofing by another tenant while counting its parent-shared metadata', async () => {
    const input = await target(); await repo.preparePasskeyLogin(input);
    expect(await withCustomerScope(f.app, { ...input, tenantRef: 'sibling' }, async c =>
      (await c.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount)).toBe(1);
    expect(await withCustomerScope(f.app, { ...input, parentRef: 'foreign' }, async c =>
      (await c.query('SELECT 1 FROM customer.credential_auth_reservations')).rowCount)).toBe(0);
    await expect(withCustomerScope(f.app, { ...input, tenantRef: 'sibling' }, c => c.query(`INSERT INTO customer.credential_auth_reservations
      SELECT parent_ref,tenant_ref,operation_id,attempt_id,browser_hash,source_hash,method,reserved_at FROM customer.credential_auth_reservations`))).rejects.toThrow();
  });
});
