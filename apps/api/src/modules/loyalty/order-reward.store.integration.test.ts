import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { OrderRewardStore, orderRewardHash } from './order-reward.store';

const target = process.env.LOYALTY_WEB_TEST_DATABASE_URL;
const integration = target ? describe : describe.skip;
integration('order rewards — actual PostgreSQL reservations and ledger', () => {
  let fixture: HistoricalSaleTestFixture, store: OrderRewardStore;
  beforeAll(async () => { fixture = await historicalSaleTestFixture(target); store = new OrderRewardStore(fixture.app); }, 30_000);
  afterAll(async () => { await fixture?.close(); });
  async function seed() {
    const sale = await fixture.seed({ eligiblePurchaseCents: 10000 }), rewardId = randomUUID();
    await fixture.service.settleHistoricalSale(sale);
    await fixture.admin.query(`INSERT INTO loyalty.rewards(id,tenant_ref,program_id,name,kind,cost_units,value_cents)
      VALUES($1,$2,$3,'Trois euros','fixed_discount',60,300)`, [rewardId, sale.tenantRef, sale.attribution.programId]);
    const input = { owner: sale.attribution.owner, clientId: randomUUID(), selection: { rewardId, expectedCostUnits: 60 },
      pricingHash: orderRewardHash({ lines: 'server-prices' }), subtotalCents: 1000,
      lines: [{ productId: '507f1f77bcf86cd799439011', unitPrice: 1000, qty: 1, options: [] }] };
    const wallet = async () => (await fixture.admin.query('SELECT balance_units,reserved_units,lifetime_redeemed_units,version FROM loyalty.wallets WHERE tenant_ref=$1', [sale.tenantRef])).rows[0];
    const ledger = async () => (await fixture.admin.query("SELECT kind,delta_units FROM loyalty.ledger_entries WHERE tenant_ref=$1 AND kind != 'earn' ORDER BY wallet_version", [sale.tenantRef])).rows;
    return { input, wallet, ledger };
  }
  const created = (pricingHash: string) => ({ kind: 'order_created' as const, orderId: '507f1f77bcf86cd799439012', pricingHash });
  it('reserves once, makes points unavailable, consumes once and restores exactly once', async () => {
    const f = await seed(); const reservation = await store.reserve(f.input);
    expect(await store.reserve(f.input)).toEqual(reservation);
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '60', version: '1' });
    expect(await f.ledger()).toEqual([]);
    await Promise.all([store.consume(reservation, created(f.input.pricingHash)), store.consume(reservation, created(f.input.pricingHash))]);
    expect(await f.wallet()).toMatchObject({ balance_units: '40', reserved_units: '0', lifetime_redeemed_units: '60', version: '2' });
    const proof = { kind: 'order_reversed' as const, orderId: '507f1f77bcf86cd799439012', orderVersion: 3, reason: 'fully_refunded' as const };
    await Promise.all([store.reverse(reservation, proof), store.reverse(reservation, proof)]);
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '0', lifetime_redeemed_units: '0', version: '3' });
    expect(await f.ledger()).toEqual([{ kind: 'redeem', delta_units: '-60' }, { kind: 'reverse', delta_units: '60' }]);
  });
  it('arbitrates two different checkouts against the same spendable balance', async () => {
    const f = await seed();
    const results = await Promise.allSettled([store.reserve(f.input), store.reserve({ ...f.input, clientId: randomUUID() })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '60' });
  });
  it('closes before a delayed reservation without ever locking points', async () => {
    const f = await seed();
    await store.reject(f.input.owner.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) });
    await expect(store.reserve(f.input)).rejects.toThrow('même commande');
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '0' });
  });
  it('releases a rejected attempt once and prevents its late consumption or reservation', async () => {
    const f = await seed(); const reservation = await store.reserve(f.input);
    const reject = () => store.reject(f.input.owner.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) });
    await Promise.all([reject(), reject()]);
    await expect(store.consume(reservation, created(f.input.pricingHash))).rejects.toThrow();
    await expect(store.reserve(f.input)).rejects.toThrow();
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '0' });
  });
  it('does not reuse a reservation for another owner, price or reward cost', async () => {
    const f = await seed(); await store.reserve(f.input);
    for (const changed of [{ ...f.input, pricingHash: 'b'.repeat(64) },
      { ...f.input, owner: { ...f.input.owner, accountId: randomUUID() } },
      { ...f.input, selection: { ...f.input.selection, expectedCostUnits: 1 } }]) {
      await expect(store.reserve(changed)).rejects.toThrow();
    }
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '60' });
  });
  it('database rejects any legacy debit that would spend reserved points', async () => {
    const f = await seed(); await store.reserve(f.input);
    await expect(fixture.admin.query('UPDATE loyalty.wallets SET balance_units=39 WHERE tenant_ref=$1', [f.input.owner.tenantRef])).rejects.toMatchObject({ constraint: 'wallets_reserved_bounds' });
    expect(await f.wallet()).toMatchObject({ balance_units: '100', reserved_units: '60' });
  });
  it('never releases a consumed reward on an admission rejection', async () => {
    const f = await seed(), snapshot = await store.reserve(f.input);
    await store.consume(snapshot, created(f.input.pricingHash));
    await expect(store.reject(f.input.owner.tenantRef, f.input.clientId, { kind: 'admission_rejected', payloadHash: 'a'.repeat(64) })).rejects.toThrow();
    expect(await f.wallet()).toMatchObject({ balance_units: '40', reserved_units: '0' });
  });
  it('keeps tenant rows and closures private to the active RLS context', async () => {
    const f = await seed(); await store.reserve(f.input);
    expect(await store.read('507f1f77bcf86cd799439099', f.input.clientId)).toBeNull();
    const client = await fixture.app.connect();
    try { expect((await client.query('SELECT * FROM loyalty.order_reward_reservations')).rows).toEqual([]); }
    finally { client.release(); }
  });
});
