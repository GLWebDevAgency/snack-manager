import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessTestHash, protectedAccessTestAccount } from './access-test-fixture';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { withCustomerScope } from './client';
import { withProtectedCustomerSession } from './protected-session';
import type { CustomerIdentityRepository, CustomerScope } from './port';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
type Selection = Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
type Association = CustomerScope & { accountId: string; memberId: string; operationId: string; requestHash: string };

/** Schema-level proof only. The business enrollment writer must additionally
 * verify current program/terms, build the encrypted profile, wallet and joined
 * event, and handle phone collisions. No route or loyalty grant is opened here. */
integration('durable account–loyalty association — native SQL constraints', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>;
  let repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => {
    f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    repo = new PostgresCustomerIdentityRepository(f.app);
    // This disposable fixture exercises the combined SQL adapter. The normal
    // customer-only fixture does not gain unrestricted loyalty grants.
    if (!/^customer_test_[a-f0-9]{32}$/.test(f.role)) throw new Error('Disposable role required');
    await f.admin.query(`GRANT USAGE ON SCHEMA loyalty TO "${f.role}";
      GRANT SELECT,INSERT,UPDATE,DELETE ON loyalty.members,loyalty.operations TO "${f.role}"`);
  }, 20_000);
  afterAll(async () => { await f?.close(); });

  async function account(scope: Partial<CustomerScope> = {}) {
    const a = await protectedAccessTestAccount(repo, f.admin, scope);
    const { parentRef, tenantRef, browserRef, browserHash } = a.input;
    const selection: Selection = { parentRef, tenantRef, browserRef, browserHash,
      sessionHash: a.selection.sessionHash, expectedOperationId: a.selection.expectedOperationId,
      expectedCheckId: a.selection.expectedCheckId, now: Date.now() };
    return { ...a, selection, association: { parentRef, tenantRef, accountId: a.completion.accountId,
      memberId: randomUUID(), operationId: randomUUID(), requestHash: accessTestHash() } };
  }
  async function evidence(client: Pick<PoolClient, 'query'>, i: Association) {
    await client.query(`WITH t AS (SELECT clock_timestamp() AS at)
      INSERT INTO loyalty.members(id,tenant_ref,joined_at,enrollment_handoff_at)
      SELECT $1,$2,at,at FROM t`, [i.memberId, i.tenantRef]);
    await client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
      VALUES($1,$2,'member_create',$3)`, [i.tenantRef, i.operationId, i.requestHash]);
  }
  const insert = (client: Pick<PoolClient, 'query'>, i: Association) => client.query(`
    INSERT INTO customer.loyalty_memberships(parent_ref,tenant_ref,account_id,member_id,operation_id,request_hash)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING member_id`,
  [i.parentRef, i.tenantRef, i.accountId, i.memberId, i.operationId, i.requestHash]);
  async function link() {
    const a = await account();
    await evidence(f.admin, a.association);
    await withCustomerScope(f.app, a.association, client => insert(client, a.association));
    return a;
  }
  const find = (scope: CustomerScope) => withCustomerScope(f.app, scope, client =>
    client.query('SELECT account_id,member_id FROM customer.loyalty_memberships'));

  it('stores only durable references and isolates both parent and tenant, including an unscoped runtime', async () => {
    const a = await link();
    expect((await find(a.association)).rows).toEqual([{ account_id: a.association.accountId, member_id: a.association.memberId }]);
    expect((await find({ ...a.association, parentRef: 'another_parent' })).rows).toEqual([]);
    expect((await find({ ...a.association, tenantRef: 'another_tenant' })).rows).toEqual([]);
    expect((await f.app.query('SELECT 1 FROM customer.loyalty_memberships')).rows).toEqual([]);
    const protection = (await f.admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid='customer.loyalty_memberships'::regclass`)).rows[0];
    expect(protection).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const columns = (await f.admin.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='customer' AND table_name='loyalty_memberships' ORDER BY ordinal_position`)).rows;
    expect(columns.map(row => row.column_name)).toEqual(['parent_ref', 'tenant_ref', 'account_id', 'member_id', 'operation_id', 'request_hash', 'created_at']);
  });

  it.each(['parentRef', 'tenantRef'] as const)('refuses a write outside the selected %s scope', async field => {
    const a = await account(); await evidence(f.admin, a.association);
    let sqlError: unknown;
    await expect(withCustomerScope(f.app, { ...a.association, [field]: 'outside_scope' }, async client => {
      try { return await insert(client, a.association); }
      catch (error) { sqlError = error; throw error; }
    })).rejects.toMatchObject({ reason: 'unavailable' });
    // Assert outside the wrapper: it intentionally masks callback errors, so an
    // assertion thrown inside it must not masquerade as the expected refusal.
    expect(sqlError).toMatchObject({ code: '42501' });
    expect((await find(a.association)).rows).toEqual([]);
  });

  it.each(['accountId', 'memberId', 'operationId'] as const)('rejects a %s reference from another restaurant', async field => {
    const a = await account(); const other = await account();
    await evidence(f.admin, a.association); await evidence(f.admin, other.association);
    await expect(insert(f.admin, { ...a.association, [field]: other.association[field] }))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('rejects an account from another parent even within the same restaurant', async () => {
    const a = await account(); const other = await account({ tenantRef: a.association.tenantRef });
    await evidence(f.admin, a.association);
    await expect(insert(f.admin, { ...a.association, accountId: other.association.accountId }))
      .rejects.toMatchObject({ code: '23503', constraint: 'loyalty_memberships_account_fk' });
  });

  it('allows only one card per account, one owner per card and one association per operation', async () => {
    const a = await link();
    const second = await account({ parentRef: a.association.parentRef, tenantRef: a.association.tenantRef });
    await evidence(f.admin, second.association);
    await expect(insert(f.admin, { ...second.association, accountId: a.association.accountId }))
      .rejects.toMatchObject({ code: '23505', constraint: 'loyalty_memberships_pkey' });
    await expect(insert(f.admin, { ...second.association, memberId: a.association.memberId }))
      .rejects.toMatchObject({ code: '23505', constraint: 'loyalty_memberships_tenant_member_uq' });
    await expect(insert(f.admin, { ...second.association, operationId: a.association.operationId }))
      .rejects.toMatchObject({ code: '23505', constraint: 'loyalty_memberships_tenant_operation_uq' });
  });

  it.each(['', 'not-a-hash', 'A'.repeat(64), 'a'.repeat(63)])('rejects an invalid request hash %j', async requestHash => {
    const a = await account(); await evidence(f.admin, a.association);
    await expect(insert(f.admin, { ...a.association, requestHash })).rejects.toMatchObject({ code: '23514' });
  });

  it.each(['account_id', 'member_id', 'operation_id', 'request_hash', 'created_at', 'delete'] as const)
    ('keeps ownership evidence immutable against %s', async field => {
      const a = await link();
      const sql = field === 'delete' ? 'DELETE FROM customer.loyalty_memberships WHERE account_id=$1'
        : `UPDATE customer.loyalty_memberships SET ${field}=${field} WHERE account_id=$1`;
      await expect(f.admin.query(sql, [a.association.accountId])).rejects.toMatchObject({ code: '23514' });
      expect((await find(a.association)).rowCount).toBe(1);
    });

  it('preserves the association when the card is blocked or anonymized; does not free it for adoption', async () => {
    const a = await link();
    await f.admin.query("UPDATE loyalty.members SET status='blocked',blocked_at=clock_timestamp() WHERE id=$1", [a.association.memberId]);
    await f.admin.query("UPDATE loyalty.members SET status='anonymized',anonymized_at=clock_timestamp() WHERE id=$1", [a.association.memberId]);
    await f.admin.query('UPDATE customer.accounts SET active=false WHERE id=$1', [a.association.accountId]);
    expect((await find(a.association)).rows).toEqual([{ account_id: a.association.accountId, member_id: a.association.memberId }]);
    expect(await repo.authenticateProtected(a.selection)).toBeNull();
    await expect(f.admin.query('DELETE FROM loyalty.members WHERE id=$1', [a.association.memberId])).rejects.toMatchObject({ code: '23503' });
    await expect(f.admin.query('DELETE FROM loyalty.operations WHERE tenant_ref=$1 AND operation_id=$2',
      [a.association.tenantRef, a.association.operationId])).rejects.toMatchObject({ code: '23503' });
  });

  it('rolls back the new member, operation and association together after protected authority is lost', async () => {
    const a = await account();
    let visibleBeforeCommit: number | null | undefined;
    let revokedInsideTransaction: number | null | undefined;
    await expect(withProtectedCustomerSession(f.app, a.selection, async ({ client }) => {
      await evidence(client, a.association);
      await insert(client, a.association);
      visibleBeforeCommit = (await f.admin.query('SELECT 1 FROM loyalty.members WHERE id=$1', [a.association.memberId])).rowCount;
      revokedInsideTransaction = (await client.query('UPDATE customer.sessions SET revoked_at=clock_timestamp() WHERE id=$1', [a.session.sessionId])).rowCount;
      return 'must-not-publish';
    })).rejects.toMatchObject({ reason: 'unavailable' });
    expect(visibleBeforeCommit).toBe(0);
    expect(revokedInsideTransaction).toBe(1);
    expect((await f.admin.query('SELECT 1 FROM loyalty.members WHERE id=$1', [a.association.memberId])).rowCount).toBe(0);
    expect((await f.admin.query('SELECT 1 FROM loyalty.operations WHERE tenant_ref=$1 AND operation_id=$2',
      [a.association.tenantRef, a.association.operationId])).rowCount).toBe(0);
    expect((await find(a.association)).rowCount).toBe(0);
    expect(await repo.authenticateProtected(a.selection)).not.toBeNull();
  });

  it('serializes concurrent owners through native uniqueness; only one complete association wins', async () => {
    const a = await account();
    const b = await account({ parentRef: a.association.parentRef, tenantRef: a.association.tenantRef });
    await evidence(f.admin, a.association); await evidence(f.admin, b.association);
    const inputs = [a.association, { ...b.association, memberId: a.association.memberId }];
    const errors: unknown[] = [];
    const outcomes = await Promise.allSettled(inputs.map(input => withCustomerScope(f.app, input, async client => {
      try { return await insert(client, input); }
      catch (error) { errors.push(error); throw error; }
    })));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: '23505', constraint: 'loyalty_memberships_tenant_member_uq' });
    expect((await find(a.association)).rowCount).toBe(1);
  });

  it('commits the association independently of the browser session and without a POS expiry timer', async () => {
    const a = await account();
    expect(await withProtectedCustomerSession(f.app, a.selection, async ({ client, session }) => {
      expect(session.profile.accountId).toBe(a.association.accountId);
      await evidence(client, a.association); await insert(client, a.association);
      return a.association.memberId;
    })).toBe(a.association.memberId);
    await repo.revoke({ ...a.selection, all: false });
    expect(await repo.authenticateProtected(a.selection)).toBeNull();
    expect((await find(a.association)).rowCount).toBe(1);
    expect((await f.admin.query('SELECT enrollment_handoff_at=joined_at AS handed FROM loyalty.members WHERE id=$1',
      [a.association.memberId])).rows[0]).toEqual({ handed: true });
  });
});
