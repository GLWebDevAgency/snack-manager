import { afterAll, describe, expect, it } from 'vitest';
import { customerTestFixture } from './test-fixture';
import { PostgresCustomerIdentityRepository } from './repository';
import { migrateCustomer } from './migration';
import { assertCustomerMigrationsCurrent } from './migration-state';
import { accessTestHash as hash, accessTestToken as token, prepareAccessTestIntent, protectedAccessTestAccount } from './access-test-fixture';
import { randomUUID } from 'node:crypto';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('protected access migration 0006 → 0007', () => {
  let fixture: Awaited<ReturnType<typeof customerTestFixture>> | undefined;
  afterAll(async () => { await fixture?.close(); });
  it('preserves a real protected account and all old journals before enabling new login', async () => {
    let account!: Awaited<ReturnType<typeof protectedAccessTestAccount>>;
    let oldHistory: unknown[] = [], oldData: unknown[] = [];
    const tables = ['accounts', 'verified_contacts', 'passkey_credentials', 'recovery_codes', 'sessions', 'session_publications'];
    fixture = await customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL, { beforeUpgradeMigrations: 7, beforeUpgrade: async admin => {
      account = await protectedAccessTestAccount(new PostgresCustomerIdentityRepository(admin), admin);
      oldHistory = (await admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
      oldData = await Promise.all(tables.map(async t => (await admin.query(`SELECT * FROM customer.${t} ORDER BY 1`)).rows));
      expect((await admin.query("SELECT 1 FROM information_schema.tables WHERE table_schema='customer' AND table_name='account_recovery_grants'")).rowCount).toBe(0);
    } });
    const repo = new PostgresCustomerIdentityRepository(fixture.app);
    await assertCustomerMigrationsCurrent(fixture.app);
    const history = (await fixture.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows;
    expect(history).toHaveLength(8); expect(history.slice(0, 7)).toEqual(oldHistory);
    expect(await Promise.all(tables.map(async t => (await fixture!.admin.query(`SELECT * FROM customer.${t} ORDER BY 1`)).rows))).toEqual(oldData);
    expect(await repo.authenticate(account.selection)).toEqual(account.session);
    const binding = await prepareAccessTestIntent(repo, account.input);
    expect(await repo.preparePasskeyLogin({ ...binding, sourceHash: hash(), origin: account.origin, rpId: account.rpId, challenge: token() })).not.toBeNull();
    const claim = { ...binding, requestHash: hash(), credentialId: account.credential.credentialId, userHandle: account.userHandle };
    expect(await repo.claimPasskeyLogin(claim)).not.toBeNull();
    expect(await repo.completePasskeyLogin({ ...binding, requestHash: claim.requestHash,
      assertion: { credentialId: claim.credentialId, counter: 1, deviceType: 'multiDevice', backedUp: true },
      sessionId: randomUUID(), sessionHash: hash(), sessionExpiresAt: Date.now() + 604_800_000 })).not.toBeNull();
    await migrateCustomer(fixture.admin);
    expect((await fixture.admin.query('SELECT * FROM drizzle.__drizzle_customer_migrations ORDER BY created_at')).rows).toEqual(history);
  }, 20_000);
});
