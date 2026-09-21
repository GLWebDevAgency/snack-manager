import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalSaleTestFixture, inCanonicalSaleTenant } from './canonical-sale.test-fixture';

const target = process.env.LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL;
(target ? describe : describe.skip)('order reward migration — populated historical wallet', () => {
  it('upgrades 0007 without rewriting points, ledger or old migration hashes', async () => {
    const fixture = await canonicalSaleTestFixture(target, 8);
    const tenant = randomBytes(12).toString('hex'), member = randomUUID(), program = randomUUID(), operation = randomUUID();
    try {
      await inCanonicalSaleTenant(fixture.pool, tenant, async client => {
        await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status,current_version) VALUES($1,$2,'active',1)", [program, tenant]);
        await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
          spend_step_cents,units_per_step,unit_label_singular,unit_label_plural) VALUES($1,$2,1,'Existing program','points',0,100,1,'point','points')`, [tenant, program]);
        await client.query('INSERT INTO loyalty.members(id,tenant_ref) VALUES($1,$2)', [member, tenant]);
        await client.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [tenant, member, program]);
        await client.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint) VALUES($1,$2,'earn',$3)", [tenant, operation, 'a'.repeat(64)]);
        await client.query('UPDATE loyalty.wallets SET balance_units=100,lifetime_earned_units=100,version=1 WHERE tenant_ref=$1', [tenant]);
        await client.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at)
          VALUES($1,$2,$3,$4,'earn',100,100,'standalone',1,1,now())`, [tenant, member, program, operation]);
        await client.query("UPDATE loyalty.operations SET status='completed',result='{}',completed_at=now() WHERE tenant_ref=$1", [tenant]);
      });
      const before = await inCanonicalSaleTenant(fixture.pool, tenant, async client => ({
        wallet: (await client.query('SELECT * FROM loyalty.wallets')).rows,
        ledger: (await client.query('SELECT * FROM loyalty.ledger_entries')).rows,
        migrations: (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_loyalty_migrations ORDER BY created_at')).rows,
      }));
      expect(before.migrations).toHaveLength(8);
      await fixture.upgrade();
      const after = await inCanonicalSaleTenant(fixture.pool, tenant, async client => ({
        wallet: (await client.query('SELECT * FROM loyalty.wallets')).rows,
        ledger: (await client.query('SELECT * FROM loyalty.ledger_entries')).rows,
        migrations: (await client.query('SELECT hash,created_at FROM drizzle.__drizzle_loyalty_migrations ORDER BY created_at')).rows,
        holds: (await client.query('SELECT * FROM loyalty.order_reward_reservations')).rows,
        closures: (await client.query('SELECT * FROM loyalty.order_reward_closures')).rows,
      }));
      expect(after.wallet).toEqual(before.wallet.map(row => ({ ...row, reserved_units: '0' })));
      expect(after.ledger).toEqual(before.ledger); expect(after.migrations.slice(0, 8)).toEqual(before.migrations);
      expect(after.migrations).toHaveLength(10); expect(after.holds).toEqual([]); expect(after.closures).toEqual([]);
      await fixture.upgrade();
      expect((await fixture.pool.query('SELECT hash,created_at FROM drizzle.__drizzle_loyalty_migrations ORDER BY created_at')).rows).toEqual(after.migrations);
    } finally { await fixture.close(); }
  }, 30_000);
});
