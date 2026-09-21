import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalSaleTestFixture, inCanonicalSaleTenant } from './canonical-sale.test-fixture';
const target = process.env.LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL;
const integration = target ? describe : describe.skip;
integration('0009 additive POS compensation migration', () => {
  it('preserves a populated web case, existing POS receipt and wallet across upgrade with runtime RLS', async () => {
    const f = await canonicalSaleTestFixture(target, 9);
    try {
      const tenant = randomUUID(), member = randomUUID(), program = randomUUID(), client = randomUUID(), operation = randomUUID(), sale = randomUUID();
      await inCanonicalSaleTenant(f.pool, tenant, async c => {
        await c.query("INSERT INTO loyalty.programs(id,tenant_ref,status,current_version) VALUES($1,$2,'active',1)", [program, tenant]);
        await c.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,spend_step_cents,units_per_step,unit_label_singular,unit_label_plural)
          VALUES($1,$2,1,'Fixture','points',0,100,1,'point','points')`, [tenant, program]);
        await c.query('INSERT INTO loyalty.members(id,tenant_ref) VALUES($1,$2)', [member, tenant]);
        await c.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [tenant, member, program]);
        await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'earn',$3,'completed','{}',now())", [tenant, operation, 'a'.repeat(64)]);
        await c.query("INSERT INTO loyalty.earn_receipts(tenant_ref,member_id,operation_id,source,external_ref) VALUES($1,$2,$3,'pos',$4)", [tenant, member, operation, `pos-order:${client}`]);
        await c.query(`INSERT INTO loyalty.sale_settlements(id,tenant_ref,client_id,earn_operation_id,member_id,program_id,rules_version,attribution,attribution_fingerprint,eligible_purchase_cents)
          VALUES($1,$2,$3,$4,$5,$6,1,'{}',$7,1000)`, [sale, tenant, randomUUID(), randomUUID(), member, program, 'b'.repeat(64)]);
      });
      const contents = () => inCanonicalSaleTenant(f.pool, tenant, async c => ({ receipts: (await c.query('SELECT * FROM loyalty.earn_receipts')).rows,
        operations: (await c.query('SELECT * FROM loyalty.operations')).rows, wallets: (await c.query('SELECT * FROM loyalty.wallets')).rows,
        sales: (await c.query("SELECT row_to_json(s)::jsonb - 'origin' value FROM loyalty.sale_settlements s")).rows }));
      const before = await contents(); await f.upgrade(); expect(await contents()).toEqual(before);
      await inCanonicalSaleTenant(f.pool, tenant, async c => {
        expect((await c.query('SELECT origin FROM loyalty.sale_settlements WHERE id=$1', [sale])).rows).toEqual([{ origin: 'web_attribution' }]);
        await c.query('SAVEPOINT origin_guard');
        await expect(c.query("UPDATE loyalty.sale_settlements SET origin='pos_receipt',version=version+1 WHERE id=$1", [sale])).rejects.toMatchObject({ code: '23514' });
        await c.query('ROLLBACK TO SAVEPOINT origin_guard');
      });
      expect((await f.pool.query('SELECT count(*)::int n FROM loyalty.sale_settlements')).rows[0].n).toBe(0);
    } finally { await f.close(); }
  });
});
