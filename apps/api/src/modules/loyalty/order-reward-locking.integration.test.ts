import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loyaltyDb } from '@sm/loyalty';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { OrderRewardStore, orderRewardHash } from './order-reward.store';
import { LoyaltyMemberService } from './loyalty-member.service';
import { posTestCrypto } from './loyalty-pos.test-fixture';
import type { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

const integration = process.env.LOYALTY_WEB_TEST_DATABASE_URL ? describe : describe.skip;
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function instrument(pool: Pool, options: { applicationName?: string; memberLocked?: () => Promise<void> }) {
  return new Proxy(pool, { get(target, property, receiver) {
    if (property !== 'connect') { const value = Reflect.get(target, property, receiver); return typeof value === 'function' ? value.bind(target) : value; }
    return async () => {
      const client = await target.connect();
      if (options.applicationName) await client.query("SELECT set_config('application_name',$1,false)", [options.applicationName]);
      let held = false;
      return new Proxy(client, { get(connection, key, inner) {
        if (key !== 'query') { const value = Reflect.get(connection, key, inner); return typeof value === 'function' ? value.bind(connection) : value; }
        return async (...args: unknown[]) => {
          const text = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
          const result = await Reflect.apply(connection.query, connection, args);
          if (!held && /from "loyalty"\."members"/i.test(text) && /for update/i.test(text) && options.memberLocked) {
            held = true; await options.memberLocked();
          }
          return result;
        };
      } }) as PoolClient;
    };
  } });
}
async function waitForNativeLock(pool: Pool, applicationName: string) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    const row = await pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'", [applicationName]);
    if (row.rows.length) return;
    await pause(10);
  }
  throw new Error('Expected native PostgreSQL lock wait was not observed');
}
integration('reward / legacy member lock ordering — actual PostgreSQL', () => {
  let f: HistoricalSaleTestFixture;
  beforeAll(async () => { f = await historicalSaleTestFixture(process.env.LOYALTY_WEB_TEST_DATABASE_URL); }, 30_000);
  afterAll(async () => f?.close());
  it.each(['reserve', 'consume', 'reverse'] as const)('%s serializes with a real legacy adjustment without deadlock or duplicated movement', async action => {
    const sale = await f.seed({ eligiblePurchaseCents: 10000 }); await f.service.settleHistoricalSale(sale);
    const rewardId = randomUUID(), clientId = randomUUID();
    await f.admin.query("INSERT INTO loyalty.rewards(id,tenant_ref,program_id,name,kind,cost_units,value_cents) VALUES($1,$2,$3,'Fixture','fixed_discount',60,300)", [rewardId, sale.tenantRef, sale.attribution.programId]);
    const input = { owner: sale.attribution.owner, clientId, selection: { rewardId, expectedCostUnits: 60 }, pricingHash: orderRewardHash({ clientId }),
      subtotalCents: 1000, lines: [{ productId: '507f1f77bcf86cd799439011', unitPrice: 1000, qty: 1, options: [] }] };
    const store = new OrderRewardStore(f.app), snapshot = action === 'reserve' ? null : await store.reserve(input);
    const created = { kind: 'order_created' as const, orderId: '507f1f77bcf86cd799439012', pricingHash: input.pricingHash };
    if (action === 'reverse') await store.consume(snapshot!, created);
    const locked = barrier(), release = barrier(), name = `reward_lock_${randomUUID()}`;
    const legacy = new LoyaltyMemberService(loyaltyDb(instrument(f.app, { memberLocked: async () => { locked.release(); await release.promise; } })),
      posTestCrypto, {} as LoyaltyPurchaseVerifier);
    const adjustment = legacy.adjust(sale.tenantRef, sale.attribution.memberId, { operationId: randomUUID(), units: 1, reason: 'Concurrent adjustment fixture' },
      { source: 'admin', actorRef: 'fixture-owner', deviceRef: null });
    // The unmodified legacy service has really acquired its member FOR UPDATE.
    await locked.promise;
    const concurrent = new OrderRewardStore(instrument(f.app, { applicationName: name }));
    const mutation = action === 'reserve' ? concurrent.reserve(input) : action === 'consume' ? concurrent.consume(snapshot!, created)
      : concurrent.reverse(snapshot!, { kind: 'order_reversed', orderId: created.orderId, orderVersion: 3, reason: 'fully_refunded' });
    const results = Promise.allSettled([adjustment, mutation]);
    try { await waitForNativeLock(f.admin, name); }
    finally { release.release(); }
    const settled = await results;
    expect(settled.map(value => value.status)).toEqual(['fulfilled', 'fulfilled']);
    const wallet = (await f.admin.query('SELECT balance_units,reserved_units FROM loyalty.wallets WHERE tenant_ref=$1', [sale.tenantRef])).rows[0];
    expect(wallet).toEqual(action === 'reserve' ? { balance_units: '101', reserved_units: '60' }
      : action === 'consume' ? { balance_units: '41', reserved_units: '0' } : { balance_units: '101', reserved_units: '0' });
    const rows = (await f.admin.query("SELECT kind,delta_units FROM loyalty.ledger_entries WHERE tenant_ref=$1 AND kind != 'earn' ORDER BY wallet_version", [sale.tenantRef])).rows;
    expect(rows.filter(row => row.kind === 'adjust_credit')).toEqual([{ kind: 'adjust_credit', delta_units: '1' }]);
    expect(rows.filter(row => row.kind === 'redeem')).toHaveLength(action === 'reserve' ? 0 : 1);
    expect(rows.filter(row => row.kind === 'reverse')).toHaveLength(action === 'reverse' ? 1 : 0);
  });
});
