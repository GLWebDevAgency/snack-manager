import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loyaltyDb } from '@sm/loyalty';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleAttributionFingerprint, type HistoricalPosSaleSettlementInput } from './loyalty-historical-sale.types';

import { posTestCrypto, seedPosReceipt, posObservation, reservePosFixtureReward } from './loyalty-pos.test-fixture';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
integration('POS gain adoption and cumulative refunds — PostgreSQL runtime RLS', () => {
  let f: HistoricalSaleTestFixture, service: LoyaltyHistoricalSaleService;
  beforeAll(async () => { f = await historicalSaleTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); service = new LoyaltyHistoricalSaleService(loyaltyDb(f.app), posTestCrypto); }, 30_000);
  afterAll(async () => f?.close());
  async function transaction(tenant: string, work: (c: import('pg').PoolClient) => Promise<void>) {
    const c = await f.app.connect();
    try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]); await work(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  const seed = (total = 1000, units = 10, linked = false) => seedPosReceipt(f, service, total, units, linked);
  async function state(input: HistoricalPosSaleSettlementInput) {
    const q = [input.tenantRef, input.attribution.memberId];
    return { wallet: (await f.admin.query('SELECT balance_units,reserved_units,lifetime_earned_units,version FROM loyalty.wallets WHERE tenant_ref=$1 AND member_id=$2', q)).rows[0],
      ledger: (await f.admin.query('SELECT kind,delta_units FROM loyalty.ledger_entries WHERE tenant_ref=$1 AND member_id=$2 ORDER BY wallet_version', q)).rows,
      receipts: (await f.admin.query('SELECT count(*)::int n FROM loyalty.earn_receipts WHERE tenant_ref=$1 AND member_id=$2', q)).rows[0].n,
      memberships: (await f.admin.query('SELECT count(*)::int n FROM customer.loyalty_memberships WHERE tenant_ref=$1 AND member_id=$2', q)).rows[0].n };
  }
  it('adopts one real POS receipt without a second credit or a customer account, including concurrent replay', async () => {
    const input = await seed(); const before = await state(input);
    expect((await Promise.all([service.settlePosSale(input), service.settlePosSale(input)])).every(v => v.kind === 'recorded')).toBe(true);
    expect(await state(input)).toEqual(before); expect(before.memberships).toBe(0);
    const partial = posObservation(input, 350);
    expect(await service.settlePosSale(partial)).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 10, reversedUnits: 4 } });
    expect(await service.settlePosSale(partial)).toMatchObject({ kind: 'recorded', replayed: true });
    const full = posObservation(partial, 1000);
    expect(await service.settlePosSale(full)).toMatchObject({ kind: 'recorded', receipt: { reversedUnits: 10, retainedUnits: 0 } });
    expect(await state(input)).toMatchObject({ receipts: 1, memberships: 0, wallet: { balance_units: '0', lifetime_earned_units: '0' },
      ledger: [{ kind: 'earn', delta_units: '10' }, { kind: 'adjust_debit', delta_units: '-4' }, { kind: 'adjust_debit', delta_units: '-6' }] });
  });
  it('uses original total, historical rule and gain even while the current program is paused', async () => {
    const input = await seed(1500, 15);
    await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE tenant_ref=$1", [input.tenantRef]);
    expect(await service.settlePosSale(posObservation(input, 500))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 15, reversedUnits: 5 } });
    expect(input.attribution.basis).toMatchObject({ policyVersion: 'legacy-pos-total-v1', eligiblePurchaseCents: 1500, excludedChargeCents: 0 });
  });
  it('does not infer a different original total, member or tenant from mutable data', async () => {
    const input = await seed(); const identity = { tenantRef: input.tenantRef, clientId: input.clientId, memberId: input.attribution.memberId, operationId: input.earnOperationId, purchaseCents: 1000 };
    await expect(service.readPosSaleAttribution({ ...identity, purchaseCents: 900 })).rejects.toThrow('historical_pos_receipt_conflict');
    await expect(service.readPosSaleAttribution({ ...identity, tenantRef: 'a'.repeat(24) })).rejects.toThrow('historical_pos_receipt_conflict');
    await expect(service.readPosSaleAttribution({ ...identity, memberId: randomUUID() })).rejects.toThrow('historical_pos_receipt_conflict');
    expect((await state(input)).wallet.balance_units).toBe('10');
  });
  it('initial zero receipt stays zero with no synthetic ledger or activity', async () => {
    const input = await seed(50, 0);
    expect(await service.settlePosSale(posObservation(input, 50))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 0, reversedUnits: 0, earnLedgerEntryId: null } });
    expect(await state(input)).toMatchObject({ receipts: 1, ledger: [], wallet: { version: '0' } });
  });
  it('preserves an unresolved refund without debiting it', async () => {
    const input = await seed();
    expect(await service.settlePosSale(posObservation(input, 0, 1000))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 10, reversedUnits: 0 } });
    expect((await state(input)).wallet.balance_units).toBe('10');
  });
  it('blocks debit against reward reservations and requires explicit retry after release', async () => {
    const input = await seed(1000, 10, true);
    const hold = await reservePosFixtureReward(f, input, 8);
    const refund = posObservation(input, 300), blocked = await service.settlePosSale(refund);
    expect(blocked).toMatchObject({ kind: 'reconciliation', reason: 'insufficient_balance', receipt: { dueUnits: 3, reversedUnits: 0 } });
    if (blocked.kind !== 'reconciliation') throw new Error('fixture');
    const request = { tenantRef: input.tenantRef, clientId: input.clientId, caseId: blocked.caseId, expectedVersion: blocked.receipt.version,
      operationId: randomUUID(), actorRef: 'owner-fixture', decision: 'retry' as const, reason: 'Contrôle de solde disponible' };
    expect(await service.resolveHistoricalSale(request)).toMatchObject({ kind: 'reconciliation' });
    await hold.release();
    expect(await service.settlePosSale(refund)).toMatchObject({ kind: 'reconciliation' });
    expect(await service.resolveHistoricalSale({ ...request, operationId: randomUUID() })).toMatchObject({ kind: 'recorded', receipt: { reversedUnits: 3 } });
  });
  it('waiver affects only current cumulative due and exact old receipt survives later refund', async () => {
    const input = await seed(1000, 10, true);
    const hold = await reservePosFixtureReward(f, input, 10);
    const partial = posObservation(input, 300), blocked = await service.settlePosSale(partial);
    if (blocked.kind !== 'reconciliation') throw new Error('fixture');
    const request = { tenantRef: input.tenantRef, clientId: input.clientId, caseId: blocked.caseId, expectedVersion: blocked.receipt.version,
      operationId: randomUUID(), actorRef: 'owner-fixture', decision: 'waive_current' as const, reason: 'Conservation des points déjà attribués' };
    expect(await service.resolveHistoricalSale(request)).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3 } });
    await hold.release();
    expect(await service.settlePosSale(posObservation(partial, 1000))).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3, reversedUnits: 7 } });
    expect(await service.resolveHistoricalSale(request)).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3, reversedUnits: 0 } });
  });
  it('the exact SQL receipt repairs lost acknowledgement, reads do not update wallet or history', async () => {
    const input = posObservation(await seed(), 1000); await service.settlePosSale(input); const before = await state(input);
    expect(await service.readHistoricalSale({ tenantRef: input.tenantRef, clientId: input.clientId, earnOperationId: input.earnOperationId,
      attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution), observationId: input.observation.observationId,
      financialFingerprint: input.observation.financialFingerprint })).toMatchObject({ kind: 'recorded', receipt: { reversedUnits: 10 } });
    expect(await state(input)).toEqual(before);
  });
  it('SQL refuses manual reversal after adoption and immutable origin replacement', async () => {
    const input = await seed(); await service.settlePosSale(input);
    await expect(transaction(input.tenantRef, c => c.query("UPDATE loyalty.sale_settlements SET origin='web_attribution',version=version+1 WHERE tenant_ref=$1", [input.tenantRef]).then(() => {}))).rejects.toMatchObject({ code: '23514' });
    await expect(transaction(input.tenantRef, async c => {
      const op = randomUUID(); await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint) VALUES($1,$2,'reverse',$3)", [input.tenantRef, op, 'a'.repeat(64)]);
      await c.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at,reversed_entry_id)
        VALUES($1,$2,$3,$4,'reverse',-10,0,'admin',1,2,now(),$5)`, [input.tenantRef, input.attribution.memberId, input.attribution.programId, op, input.attribution.receipt.ledgerEntryId]);
    })).rejects.toMatchObject({ code: '23514' });
  });
  it('never adopts or debits a gain already fully reversed by the legacy owner path', async () => {
    const input = await seed();
    await transaction(input.tenantRef, async c => {
      const op = randomUUID();
      await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'reverse',$3,'completed','{}',now())", [input.tenantRef, op, 'c'.repeat(64)]);
      await c.query('UPDATE loyalty.wallets SET balance_units=0,lifetime_earned_units=0,version=2 WHERE tenant_ref=$1 AND member_id=$2', [input.tenantRef, input.attribution.memberId]);
      await c.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at,reversed_entry_id)
        VALUES($1,$2,$3,$4,'reverse',-10,0,'admin',1,2,now(),$5)`, [input.tenantRef, input.attribution.memberId, input.attribution.programId, op, input.attribution.receipt.ledgerEntryId]);
    });
    await expect(service.settlePosSale(posObservation(input, 1000))).rejects.toThrow('historical_pos_receipt_conflict');
    expect((await state(input)).wallet.balance_units).toBe('0');
    expect((await f.admin.query('SELECT count(*)::int n FROM loyalty.sale_settlements WHERE tenant_ref=$1', [input.tenantRef])).rows[0].n).toBe(0);
  });

});
