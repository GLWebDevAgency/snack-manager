import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { OrderRewardStore, orderRewardHash } from './order-reward.store';

const target = process.env.LOYALTY_WEB_TEST_DATABASE_URL;
const integration = target ? describe : describe.skip;
integration('reward SQL integrity — limited runtime, exact ledger and deferred holds', () => {
  let fixture: HistoricalSaleTestFixture, store: OrderRewardStore;
  beforeAll(async () => { fixture = await historicalSaleTestFixture(target); store = new OrderRewardStore(fixture.app); }, 30_000);
  afterAll(async () => { await fixture?.close(); });
  async function seed() {
    const sale = await fixture.seed({ eligiblePurchaseCents: 10000 }), rewardId = randomUUID();
    await fixture.service.settleHistoricalSale(sale);
    await fixture.admin.query(`INSERT INTO loyalty.rewards(id,tenant_ref,program_id,name,kind,cost_units,value_cents)
      VALUES($1,$2,$3,'Trois euros','fixed_discount',60,300)`, [rewardId, sale.tenantRef, sale.attribution.programId]);
    const input = { owner: sale.attribution.owner, clientId: randomUUID(), selection: { rewardId, expectedCostUnits: 60 },
      pricingHash: orderRewardHash({ source: 'server' }), subtotalCents: 1000,
      lines: [{ productId: '507f1f77bcf86cd799439011', unitPrice: 1000, qty: 1, options: [] }] };
    const snapshot = await store.reserve(input);
    const row = () => fixture.admin.query('SELECT * FROM loyalty.order_reward_reservations WHERE tenant_ref=$1 AND client_id=$2', [sale.tenantRef, input.clientId]);
    return { sale, input, snapshot, row };
  }
  async function tx<T>(tenant: string, run: (client: PoolClient) => Promise<T>) {
    const client = await fixture.app.connect();
    try { await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]);
      const result = await run(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const created = (pricingHash: string) => ({ kind: 'order_created' as const, orderId: '507f1f77bcf86cd799439012', pricingHash });
  it('makes a disconnected wallet release fail at COMMIT and roll back, not midway through valid consumption', async () => {
    const f = await seed(); let statementSucceeded = false;
    await expect(tx(f.sale.tenantRef, async client => {
      await client.query('UPDATE loyalty.wallets SET reserved_units=0 WHERE tenant_ref=$1', [f.sale.tenantRef]); statementSucceeded = true;
    })).rejects.toMatchObject({ code: '23514' });
    expect(statementSucceeded).toBe(true);
    expect((await fixture.admin.query('SELECT reserved_units FROM loyalty.wallets WHERE tenant_ref=$1', [f.sale.tenantRef])).rows[0]).toEqual({ reserved_units: '60' });
    await store.consume(f.snapshot, created(f.input.pricingHash));
    expect((await f.row()).rows[0].state).toBe('consumed');
  });
  it('rejects a closure that leaves its still-reserved points stranded', async () => {
    const f = await seed();
    await expect(tx(f.sale.tenantRef, client => client.query('INSERT INTO loyalty.order_reward_closures(tenant_ref,client_id,proof) VALUES($1,$2,$3)',
      [f.sale.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) }]))).rejects.toMatchObject({ code: '23514' });
    expect((await fixture.admin.query('SELECT * FROM loyalty.order_reward_closures WHERE tenant_ref=$1', [f.sale.tenantRef])).rows).toEqual([]);
  });
  it('requires the canonical closure before releasing a hold even when the wallet was made consistent', async () => {
    const f = await seed();
    await expect(tx(f.sale.tenantRef, async client => {
      await client.query('UPDATE loyalty.wallets SET reserved_units=0 WHERE tenant_ref=$1', [f.sale.tenantRef]);
      await client.query("UPDATE loyalty.order_reward_reservations SET state='released',decision_proof=$3 WHERE tenant_ref=$1 AND client_id=$2",
        [f.sale.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) }]);
    })).rejects.toMatchObject({ code: '23514' });
    expect((await f.row()).rows[0].state).toBe('reserved');
  });
  it.each(['cost_units=1', "snapshot=jsonb_set(snapshot,'{owner,accountId}',to_jsonb('00000000-0000-4000-8000-000000000001'::text))", "request_hash=repeat('b',64)"])
  ('makes the captured decision immutable: %s', assignment => {
    return seed().then(async f => {
      await expect(tx(f.sale.tenantRef, client => client.query(`UPDATE loyalty.order_reward_reservations SET ${assignment} WHERE tenant_ref=$1`, [f.sale.tenantRef]))).rejects.toThrow();
      expect((await f.row()).rows[0].snapshot).toEqual(f.snapshot);
    });
  });
  it('rejects a new hold whose snapshot does not bind its row, even with enough available points', async () => {
    const f = await seed(), row = (await f.row()).rows[0];
    const id = randomUUID(), clientId = randomUUID();
    const forged = { ...f.snapshot, reservationId: id, clientId, memberId: randomUUID(), benefit: { ...f.snapshot.benefit, costUnits: 1 } };
    await expect(tx(f.sale.tenantRef, async client => {
      await client.query(`INSERT INTO loyalty.order_reward_reservations(tenant_ref,client_id,id,member_id,program_id,reward_id,rules_version,cost_units,request_hash,snapshot)
        VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$8)`, [f.sale.tenantRef, clientId, id, row.member_id, row.program_id, row.reward_id, row.request_hash, forged]);
      await client.query('UPDATE loyalty.wallets SET reserved_units=reserved_units+1 WHERE tenant_ref=$1', [f.sale.tenantRef]);
    })).rejects.toMatchObject({ code: '23514' });
  });
  it('refuses to call an existing earn ledger entry a reward consumption', async () => {
    const f = await seed();
    const earnId = (await fixture.admin.query("SELECT id FROM loyalty.ledger_entries WHERE tenant_ref=$1 AND kind='earn'", [f.sale.tenantRef])).rows[0].id;
    await expect(tx(f.sale.tenantRef, async client => {
      await client.query('UPDATE loyalty.wallets SET reserved_units=0 WHERE tenant_ref=$1', [f.sale.tenantRef]);
      await client.query("UPDATE loyalty.order_reward_reservations SET state='consumed',ledger_entry_id=$3,decision_proof=$4 WHERE tenant_ref=$1 AND client_id=$2",
        [f.sale.tenantRef, f.input.clientId, earnId, created(f.input.pricingHash)]);
    })).rejects.toMatchObject({ code: '23514' });
    expect((await f.row()).rows[0].state).toBe('reserved');
  });
  it('protects completed operation receipts and canonical redemption from later mutation', async () => {
    const f = await seed(); await store.consume(f.snapshot, created(f.input.pricingHash));
    await expect(tx(f.sale.tenantRef, client => client.query("UPDATE loyalty.operations SET result='{}' WHERE tenant_ref=$1 AND operation_id=$2",
      [f.sale.tenantRef, f.snapshot.reservationId]))).rejects.toMatchObject({ code: '23514' });
    await expect(tx(f.sale.tenantRef, client => client.query("UPDATE loyalty.redemptions SET external_ref='forged' WHERE tenant_ref=$1 AND operation_id=$2",
      [f.sale.tenantRef, f.snapshot.reservationId]))).rejects.toMatchObject({ code: '23514' });
    await expect(tx(f.sale.tenantRef, client => client.query('DELETE FROM loyalty.redemptions WHERE tenant_ref=$1 AND operation_id=$2',
      [f.sale.tenantRef, f.snapshot.reservationId]))).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects a forged cost even when the SQL row and snapshot agree with one another', async () => {
    const f = await seed(), row = (await f.row()).rows[0], id = randomUUID(), clientId = randomUUID();
    const forged = { ...f.snapshot, reservationId: id, clientId, benefit: { ...f.snapshot.benefit, costUnits: 1 } };
    await expect(tx(f.sale.tenantRef, client => client.query(`INSERT INTO loyalty.order_reward_reservations(tenant_ref,client_id,id,member_id,program_id,reward_id,rules_version,cost_units,request_hash,snapshot)
      VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$8)`, [f.sale.tenantRef, clientId, id, row.member_id, row.program_id, row.reward_id, row.request_hash, forged])))
      .rejects.toMatchObject({ code: '23514', message: 'Reward value does not match the captured offer' });
  });
  it('does not leave an operation receipt attached to an unconsumed hold after an interrupted writer', async () => {
    const f = await seed();
    await expect(tx(f.sale.tenantRef, client => client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint)
      VALUES($1,$2,'redeem',$3)`, [f.sale.tenantRef, f.snapshot.reservationId, 'a'.repeat(64)])))
      .rejects.toMatchObject({ code: '23514', message: 'An unconsumed hold cannot have a debit receipt' });
  });
  it('keeps both tables forced-RLS scoped with no runtime bypass and rejects foreign inserts', async () => {
    const f = await seed();
    expect((await fixture.admin.query(`SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
      WHERE oid IN ('loyalty.order_reward_reservations'::regclass,'loyalty.order_reward_closures'::regclass) ORDER BY relname`)).rows)
      .toEqual([{ relname: 'order_reward_closures', relrowsecurity: true, relforcerowsecurity: true },
        { relname: 'order_reward_reservations', relrowsecurity: true, relforcerowsecurity: true }]);
    expect((await fixture.app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    expect((await fixture.app.query('SELECT * FROM loyalty.order_reward_reservations')).rows).toEqual([]);
    await expect(tx('other-tenant', client => client.query('INSERT INTO loyalty.order_reward_closures(tenant_ref,client_id,proof) VALUES($1,$2,$3)',
      [f.sale.tenantRef, randomUUID(), { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) }]))).rejects.toMatchObject({ code: '42501' });
  });
  it('rejects deleting or truncating durable holds and rejection tombstones, even for the schema owner', async () => {
    const f = await seed(); await store.reject(f.sale.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) });
    for (const table of ['order_reward_reservations', 'order_reward_closures']) {
      await expect(fixture.admin.query(`DELETE FROM loyalty.${table} WHERE tenant_ref=$1`, [f.sale.tenantRef])).rejects.toThrow();
      await expect(fixture.admin.query(`TRUNCATE loyalty.${table}`)).rejects.toMatchObject({ code: '55000' });
    }
    expect((await f.row()).rows[0].state).toBe('released');
  });
});
