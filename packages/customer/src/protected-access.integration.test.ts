import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { confirmCustomerTestBrowser, prepareCustomerTestIntent } from './browser-test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { withCustomerScope } from './client';

const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
const hash = () => randomBytes(32).toString('hex');
const token = () => randomBytes(32).toString('base64url');
integration('protected access — durable PostgreSQL admission', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>>, repo: PostgresCustomerIdentityRepository;
  beforeAll(async () => { fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); repo = new PostgresCustomerIdentityRepository(fixture.app); }, 20_000);
  afterAll(async () => { await fixture?.close(); });
  async function binding() {
    const scope = { parentRef: `parent_${hash()}`, tenantRef: `tenant_${hash()}`, browserRef: randomUUID(), browserHash: hash(),
      operationId: randomUUID(), proofHash: hash(), attemptId: randomUUID() };
    await confirmCustomerTestBrowser(repo, scope); await prepareCustomerTestIntent(repo, scope); return scope;
  }
  it('prepares one durable challenge without a financial parent, preserving exact replay and RLS', async () => {
    const input = { ...await binding(), sourceHash: hash(), origin: 'https://customer.fixture', rpId: 'customer.fixture', challenge: token() };
    const first = await repo.preparePasskeyLogin(input);
    expect(first).toMatchObject({ operationId: input.operationId, attemptId: input.attemptId, challenge: input.challenge });
    expect(await repo.preparePasskeyLogin({ ...input, challenge: token() })).toEqual(first);
    expect((await fixture.admin.query('SELECT 1 FROM customer.parent_budgets WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(0);
    expect((await fixture.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1);
    expect((await fixture.app.query('SELECT 1 FROM customer.credential_access_attempts')).rowCount).toBe(0);
    expect(await withCustomerScope(fixture.app, { ...input, tenantRef: 'other' }, async c =>
      (await c.query('SELECT 1 FROM customer.credential_access_attempts')).rowCount)).toBe(0);
  });
  it('records incorrect recovery as terminal denied; replay spends no extra attempt and changed code conflicts', async () => {
    const scope = await binding(), input = { ...scope, sourceHash: hash(), requestHash: hash(), codeHash: hash() };
    expect(await repo.beginAccountRecovery(input)).toMatchObject({ state: 'denied' });
    expect(await repo.readAccountRecovery(scope)).toMatchObject({ state: 'denied' });
    expect(await repo.beginAccountRecovery(input)).toMatchObject({ state: 'denied' });
    expect(await repo.beginAccountRecovery({ ...input, requestHash: hash(), codeHash: hash() })).toBeNull();
    expect((await fixture.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(1);
  });
  it('serializes a five-attempt intention limit and closes before late admission without spending', async () => {
    const input = { ...await binding(), sourceHash: hash(), origin: 'https://customer.fixture', rpId: 'customer.fixture', challenge: token() };
    const results = await Promise.all(Array.from({ length: 8 }, () => repo.preparePasskeyLogin({ ...input, attemptId: randomUUID() })));
    expect(results.filter(Boolean)).toHaveLength(5);
    await repo.closeIntent({ parentRef: input.parentRef, tenantRef: input.tenantRef, browserRef: input.browserRef,
      browserHash: input.browserHash, operationId: input.operationId });
    expect(await repo.preparePasskeyLogin({ ...input, attemptId: randomUUID() })).toBeNull();
    expect((await fixture.admin.query('SELECT 1 FROM customer.credential_auth_reservations WHERE parent_ref=$1', [input.parentRef])).rowCount).toBe(5);
  });
});
