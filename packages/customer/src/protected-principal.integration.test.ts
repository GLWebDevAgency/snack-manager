import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { accessTestHash, protectedAccessTestAccount } from './access-test-fixture';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('protected commerce principal — real PG session, no profile projection', () => {
  let f: Awaited<ReturnType<typeof customerTestFixture>>, repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { f = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(f.app); }, 20_000);
  afterAll(async () => { await f?.close(); });
  async function account() {
    const value = await protectedAccessTestAccount(repo, f.admin);
    const { parentRef, tenantRef, browserRef, browserHash } = value.input;
    const input = { parentRef, tenantRef, browserRef, browserHash, sessionHash: value.selection.sessionHash,
      expectedOperationId: value.selection.expectedOperationId, expectedCheckId: value.selection.expectedCheckId, now: Date.now() };
    return { ...value, principalInput: input };
  }
  it('projects only the protected account identity, exact session and its deadline', async () => {
    const a = await account();
    expect(await repo.authenticateProtected(a.principalInput)).toEqual({ accountId: a.completion.accountId,
      sessionId: a.session.sessionId, expiresAt: a.session.expiresAt });
    const budget = await f.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [a.input.parentRef]);
    expect(budget.rows[0].reserved_sends).toBe('1');
  });
  it.each(['parent', 'tenant', 'browser', 'publication', 'token'] as const)('rejects the wrong %s without resolving a principal', async field => {
    const a = await account();
    const patch = field === 'parent' ? { parentRef: 'foreign' } : field === 'tenant' ? { tenantRef: 'foreign' }
      : field === 'browser' ? { browserHash: accessTestHash() } : field === 'publication' ? { expectedCheckId: randomUUID() }
        : { sessionHash: accessTestHash() };
    expect(await repo.authenticateProtected({ ...a.principalInput, ...patch })).toBeNull();
  });
  it('refuses revoked sessions, even when the protected account still exists', async () => {
    const a = await account(); await repo.revoke({ ...a.principalInput, all: true });
    expect(await repo.authenticateProtected(a.principalInput)).toBeNull();
  });
  it.each(['key', 'code'] as const)('requires an active %s, not just a formerly completed enrollment', async kind => {
    const a = await account();
    await f.admin.query(kind === 'key'
      ? 'UPDATE customer.passkey_credentials SET revoked_at=clock_timestamp() WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3'
      : 'UPDATE customer.recovery_codes SET revoked_at=clock_timestamp() WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3',
    [a.input.parentRef, a.input.tenantRef, a.completion.accountId]);
    expect(await repo.authenticate(a.principalInput)).not.toBeNull();
    expect(await repo.authenticateProtected(a.principalInput)).toBeNull();
  });
});
