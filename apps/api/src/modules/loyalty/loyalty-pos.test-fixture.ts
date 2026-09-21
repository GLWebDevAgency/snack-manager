import { randomUUID } from 'node:crypto';
import { OrderRewardStore, orderRewardHash } from './order-reward.store';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import type { HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import type { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleFinancialFingerprint, type HistoricalPosSaleSettlementInput } from './loyalty-historical-sale.types';
export const posTestCrypto = new LoyaltyCryptoAdapter({ encryptionKeyBase64: Buffer.alloc(32, 1).toString('base64'), phoneLookupKeyBase64: Buffer.alloc(32, 2).toString('base64'),
  operationFingerprintKeyBase64: Buffer.alloc(32, 3).toString('base64'), qrTokenDerivationKeyBase64: Buffer.alloc(32, 4).toString('base64'), encryptionKeyVersion: 1 });
export function posObservation(input: HistoricalPosSaleSettlementInput, refunded: number, pending = 0): HistoricalPosSaleSettlementInput {
  const proof = { original: input.attribution.basis.chargedTotalCents, confirmed: refunded, pending };
  const financial = { attribution: input.attribution, eligibleRefundedCents: refunded, pendingRefundCents: pending, paidAndDelivered: true, proof };
  return { ...input, observation: { eligibleRefundedCents: refunded, pendingRefundCents: pending, paidAndDelivered: true, proof, observationId: randomUUID(), orderVersion: input.observation.orderVersion + 1,
    refundSyncVersion: input.observation.refundSyncVersion + 1, financialFingerprint: historicalSaleFinancialFingerprint(financial) } };
}
async function transaction(f: HistoricalSaleTestFixture, tenant: string, work: (c: import('pg').PoolClient) => Promise<void>) {
  const c = await f.app.connect();
  try { await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]); await work(c); await c.query('COMMIT'); }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
export async function seedPosReceipt(f: HistoricalSaleTestFixture, service: LoyaltyHistoricalSaleService, total = 1000, units = 10, linked = false): Promise<HistoricalPosSaleSettlementInput> {
    const web = await f.seed();
    const tenantRef = web.tenantRef, clientId = randomUUID(), memberId = linked ? web.attribution.memberId : randomUUID(), operationId = randomUUID(), receiptId = randomUUID();
    const ledgerId = units ? randomUUID() : null, externalRef = `pos-order:${clientId}`;
    const fingerprint = posTestCrypto.operationFingerprint({ tenantRef, kind: 'earn', payload: { memberId, operationId, purchaseCents: total, externalRef, source: 'pos' } });
    await transaction(f, tenantRef, async c => {
      // The default is a standalone card without a customer membership.
      // Reservation-specific tests explicitly reuse the protected linked fixture.
      if (!linked) {
        await c.query('INSERT INTO loyalty.members(id,tenant_ref,enrollment_handoff_at) VALUES($1,$2,now())', [memberId, tenantRef]);
        await c.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [tenantRef, memberId, web.attribution.programId]);
      }
      await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'earn',$3,'completed',$4,now())",
        [tenantRef, operationId, fingerprint, { memberId, outcome: units ? 'earned' : 'below_minimum', awardedUnits: units, rulesVersion: 1, ledgerEntryId: ledgerId }]);
      await c.query("INSERT INTO loyalty.earn_receipts(id,tenant_ref,member_id,operation_id,source,external_ref) VALUES($1,$2,$3,$4,'pos',$5)", [receiptId, tenantRef, memberId, operationId, externalRef]);
      if (units) {
        await c.query('UPDATE loyalty.wallets SET balance_units=$3,lifetime_earned_units=$3,version=1 WHERE tenant_ref=$1 AND member_id=$2', [tenantRef, memberId, units]);
        await c.query(`INSERT INTO loyalty.ledger_entries(id,tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,external_ref,rules_version,wallet_version,occurred_at)
          VALUES($1,$2,$3,$4,$5,'earn',$6,$6,'pos',$7,1,1,now())`, [ledgerId, tenantRef, memberId, web.attribution.programId, operationId, units, externalRef]);
      }
    });
    const attribution = await service.readPosSaleAttribution({ tenantRef, clientId, memberId, operationId, purchaseCents: total });
    const base = { tenantRef, clientId, earnOperationId: operationId, attribution, observation: { orderVersion: 0, refundSyncVersion: 0 } } as HistoricalPosSaleSettlementInput;
    return posObservation(base, 0);
  }


/** Real reservation/closure protocol on an explicitly linked test card. */
export async function reservePosFixtureReward(f: HistoricalSaleTestFixture, input: HistoricalPosSaleSettlementInput, units: number) {
  const membership = (await f.admin.query<{ parent_ref: string; account_id: string }>(
    'SELECT parent_ref,account_id FROM customer.loyalty_memberships WHERE tenant_ref=$1 AND member_id=$2',
    [input.tenantRef, input.attribution.memberId])).rows[0];
  if (!membership) throw new Error('Reward fixture needs an already protected linked card');
  const rewardId = randomUUID(), clientId = randomUUID();
  await f.admin.query(`INSERT INTO loyalty.rewards(id,tenant_ref,program_id,name,kind,cost_units,value_cents)
    VALUES($1,$2,$3,'Fixture reward','fixed_discount',$4,100)`, [rewardId, input.tenantRef, input.attribution.programId, units]);
  const store = new OrderRewardStore(f.app);
  await store.reserve({ clientId, owner: { tenantRef: input.tenantRef, parentRef: membership.parent_ref, accountId: membership.account_id },
    selection: { rewardId, expectedCostUnits: units }, pricingHash: orderRewardHash({ clientId }), subtotalCents: 1000,
    lines: [{ productId: '507f1f77bcf86cd799439012', unitPrice: 1000, qty: 1, options: [] }] });
  return { release: () => store.reject(input.tenantRef, clientId, { kind: 'admission_rejected', payloadHash: orderRewardHash({ rejected: clientId }) }) };
}
