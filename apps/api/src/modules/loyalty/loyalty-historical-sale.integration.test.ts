import { LoyaltyCryptoAdapter, loyaltyDb } from '@sm/loyalty';
import { LoyaltyMemberService } from './loyalty-member.service';
import type { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { historicalSaleAttributionFingerprint, historicalSaleFinancialFingerprint, type HistoricalSaleSettlementInput } from './loyalty-historical-sale.types';
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
function observe(input: HistoricalSaleSettlementInput, eligibleRefundedCents: number | null, pendingRefundCents = 0): HistoricalSaleSettlementInput {
    const proof = { payment: 'fixture-paid', handoff: 'fixture-delivered', allocation: eligibleRefundedCents === null ? 'unallocated' : String(eligibleRefundedCents) };
    const financial = { attribution: input.attribution, eligibleRefundedCents, pendingRefundCents, paidAndDelivered: true, proof };
    return { ...input, observation: { ...input.observation, eligibleRefundedCents, pendingRefundCents, paidAndDelivered: true, proof, observationId: randomUUID(), orderVersion: input.observation.orderVersion + 1,
            refundSyncVersion: input.observation.refundSyncVersion + 1, financialFingerprint: historicalSaleFinancialFingerprint(financial) } };
}
integration('historical web loyalty — real PostgreSQL and runtime RLS', () => {
    let f: HistoricalSaleTestFixture;
    beforeAll(async () => { f = await historicalSaleTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL); }, 30000);
    afterAll(async () => { await f?.close(); });
    async function state(input: HistoricalSaleSettlementInput) {
        return {
            wallet: (await f.admin.query('SELECT balance_units,lifetime_earned_units,version FROM loyalty.wallets WHERE tenant_ref=$1', [input.tenantRef])).rows[0],
            ledger: (await f.admin.query('SELECT kind,delta_units,rules_version FROM loyalty.ledger_entries WHERE tenant_ref=$1 ORDER BY wallet_version', [input.tenantRef])).rows,
            receipts: (await f.admin.query('SELECT * FROM loyalty.earn_receipts WHERE tenant_ref=$1', [input.tenantRef])).rowCount,
            corrections: (await f.admin.query('SELECT kind,units FROM loyalty.sale_corrections WHERE tenant_ref=$1 ORDER BY created_at', [input.tenantRef])).rows,
        };
    }
    async function transaction(input: HistoricalSaleSettlementInput, work: (c: PoolClient) => Promise<void>) { const c = await f.app.connect(); try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.tenant_ref',$1,true)", [input.tenantRef]);
        await work(c);
        await c.query('COMMIT');
    }
    catch (e) {
        await c.query('ROLLBACK');
        throw e;
    }
    finally {
        c.release();
    } }
    async function walletMovement(input: HistoricalSaleSettlementInput, delta: number) {
        await transaction(input, async (c) => {
            const operation = randomUUID();
            await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'adjust',$3,'completed','{}',now())", [input.tenantRef, operation, 'a'.repeat(64)]);
            const w = await c.query('UPDATE loyalty.wallets SET balance_units=balance_units+$2,version=version+1,lifetime_redeemed_units=lifetime_redeemed_units+$3 WHERE tenant_ref=$1 RETURNING balance_units,version', [input.tenantRef, delta, Math.max(0, -delta)]);
            await c.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'admin',1,$8,now())`, [input.tenantRef, input.attribution.memberId, input.attribution.programId, operation, delta > 0 ? 'adjust_credit' : 'redeem', delta, w.rows[0].balance_units, w.rows[0].version]);
        });
    }
    it('one historical credit, concurrent workers, exact receipt after ACK loss, no current-rule recomputation', async () => {
        const input = await f.seed();
        const [a, b] = await Promise.all([f.service.settleHistoricalSale(input), f.service.settleHistoricalSale(input)]);
        expect(a.kind).toBe('recorded');
        expect(b.kind).toBe('recorded');
        expect(await state(input)).toMatchObject({ wallet: { balance_units: '10', lifetime_earned_units: '10', version: '1' }, receipts: 1, ledger: [{ kind: 'earn', delta_units: '10' }] });
        await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE tenant_ref=$1", [input.tenantRef]);
        expect(await f.service.readHistoricalSale({ tenantRef: input.tenantRef, clientId: input.clientId, earnOperationId: input.earnOperationId,
            attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution), observationId: input.observation.observationId, financialFingerprint: input.observation.financialFingerprint })).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 10 } });
    });
    it('gain and already confirmed correction publish atomically with historical thresholds', async () => {
        const input = observe(await f.seed({ rule: { mechanism: 'points', minimumPurchaseCents: 500, maximumUnitsPerPurchase: 8, spendStepCents: 100, unitsPerStep: 1 } }), 550);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 8, reversedUnits: 8, retainedUnits: 0 } });
        expect(await state(input)).toMatchObject({ wallet: { balance_units: '0', lifetime_earned_units: '0', version: '2' }, ledger: [{ kind: 'earn', delta_units: '8' }, { kind: 'adjust_debit', delta_units: '-8' }] });
    });
    it('unknown allocation and pending refund reserve identity without a provisional gain', async () => {
        const input = observe(await f.seed(), null);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'reconciliation', reason: 'allocation_unknown' });
        expect(await state(input)).toMatchObject({ receipts: 0, ledger: [], wallet: { balance_units: '0' } });
        expect((await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [input.tenantRef])).rows[0].last_activity_at).toBeNull();
        const pending = observe(input, 0, 200);
        expect(await f.service.settleHistoricalSale(pending)).toMatchObject({ kind: 'pending', reason: 'refund_pending' });
        expect(await state(input)).toMatchObject({ receipts: 0, ledger: [] });
        expect(await f.service.settleHistoricalSale(observe(pending, 200))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 10, reversedUnits: 2, retainedUnits: 8 } });
    });
    it('cumulative partials, concurrent observations and repeated totals never debit twice', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        const p = observe(input, 300);
        expect(await f.service.settleHistoricalSale(p)).toMatchObject({ kind: 'recorded', receipt: { reversedUnits: 3 } });
        const full = observe(p, 1000);
        const outcomes = await Promise.all([f.service.settleHistoricalSale(full), f.service.settleHistoricalSale(full)]);
        expect(outcomes.every(x => x.kind === 'recorded')).toBe(true);
        expect(await state(input)).toMatchObject({ wallet: { balance_units: '0', lifetime_earned_units: '0' }, corrections: [{ units: '3' }, { units: '7' }] });
    });
    it('zero receipt consumes the sale and no ledger delta is invented', async () => {
        const input = await f.seed({ eligiblePurchaseCents: 0, rule: { mechanism: 'stamps', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, unitsPerVisit: 1 } });
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 0, earnLedgerEntryId: null } });
        expect(await state(input)).toMatchObject({ receipts: 1, ledger: [], wallet: { balance_units: '0', version: '0' } });
        expect((await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [input.tenantRef])).rows[0].last_activity_at).toBeInstanceOf(Date);
    });
    it('insufficient balance never partially debits or retries silently; owner waiver only affects current due', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        await walletMovement(input, -10);
        const partial = observe(input, 300);
        const blocked = await f.service.settleHistoricalSale(partial);
        expect(blocked).toMatchObject({ kind: 'reconciliation', reason: 'insufficient_balance', receipt: { dueUnits: 3, reversedUnits: 0 } });
        const before = await state(input);
        expect(before.corrections).toEqual([]);
        expect(before.wallet).toMatchObject({ balance_units: '0', lifetime_earned_units: '10' });
        await walletMovement(input, 4);
        expect(await f.service.settleHistoricalSale(partial)).toMatchObject({ kind: 'reconciliation', receipt: { dueUnits: 3 } });
        if (blocked.kind !== 'reconciliation')
            throw new Error('fixture');
        const resolution = { tenantRef: input.tenantRef, clientId: input.clientId, operationId: randomUUID(), caseId: blocked.caseId, expectedVersion: blocked.receipt.version, actorRef: 'fixture-owner', decision: 'waive_current' as const, reason: 'Geste commercial documenté' };
        const activityBeforeWaiver = (await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [input.tenantRef])).rows[0].last_activity_at;
        expect(await f.service.resolveHistoricalSale(resolution)).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3, reversedUnits: 0, dueUnits: 0 } });
        expect(await f.service.resolveHistoricalSale(resolution)).toMatchObject({ kind: 'recorded' });
        expect((await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [input.tenantRef])).rows[0].last_activity_at).toEqual(activityBeforeWaiver);
        const next = observe(partial, 500);
        expect(await f.service.settleHistoricalSale(next)).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3, reversedUnits: 2, dueUnits: 0 } });
        expect(await state(input)).toMatchObject({ wallet: { balance_units: '2', lifetime_earned_units: '8' }, corrections: [{ kind: 'waive', units: '3' }, { kind: 'debit', units: '2' }] });
        expect(await f.service.resolveHistoricalSale(resolution)).toMatchObject({ kind: 'recorded', receipt: { waivedUnits: 3, reversedUnits: 0 } });
        expect((await state(input)).wallet.balance_units).toBe('2');
    });
    it('owner retry is all-or-nothing, audited on failure and scoped to current case version', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        await walletMovement(input, -10);
        const partial = observe(input, 400);
        const blocked = await f.service.settleHistoricalSale(partial);
        if (blocked.kind !== 'reconciliation')
            throw new Error('fixture');
        const resolution = { tenantRef: input.tenantRef, clientId: input.clientId, operationId: randomUUID(), caseId: blocked.caseId, expectedVersion: blocked.receipt.version, actorRef: 'fixture-owner', decision: 'retry' as const, reason: 'Reprise explicite après contrôle' };
        expect(await f.service.resolveHistoricalSale(resolution)).toMatchObject({ kind: 'reconciliation', receipt: { dueUnits: 4, reversedUnits: 0 } });
        const durable = await f.admin.query('SELECT result FROM loyalty.operations WHERE tenant_ref=$1 AND operation_id=$2', [input.tenantRef, resolution.operationId]);
        expect(durable.rows[0].result).toMatchObject({ request: { reason: resolution.reason, operationId: resolution.operationId }, result: { kind: 'reconciliation', reason: 'insufficient_balance' } });
        await transaction(input, async (c) => {
            // The small fixture would naturally use a sequential scan. Disable
            // that choice only here to prove the exact BO predicate is indexable.
            await c.query('SET LOCAL enable_seqscan=off');
            const plan = await c.query(`EXPLAIN (FORMAT JSON) SELECT result,completed_at FROM loyalty.operations
                WHERE tenant_ref=$1 AND kind='adjust' AND status='completed' AND result ? 'resolutionActorRef'
                AND result->>'clientId'=$2 AND result->>'resolutionActorRef'=$3 ORDER BY completed_at DESC LIMIT 128`,
            [input.tenantRef, input.clientId, resolution.actorRef]);
            expect(JSON.stringify(plan.rows)).toContain('operations_sale_resolution_receipts_idx');
        });
        await expect(transaction(input, async (c) => {
            await c.query("UPDATE loyalty.operations SET result='{}' WHERE tenant_ref=$1 AND operation_id=$2", [input.tenantRef, resolution.operationId]);
        })).rejects.toMatchObject({ code: '23514' });
        await walletMovement(input, 4);
        expect(await f.service.resolveHistoricalSale(resolution)).toMatchObject({ kind: 'reconciliation' });
        const next = { ...resolution, operationId: randomUUID() };
        expect(await f.service.resolveHistoricalSale(next)).toMatchObject({ kind: 'recorded', receipt: { reversedUnits: 4 } });
        await expect(f.service.resolveHistoricalSale({ ...resolution, operationId: randomUUID(), decision: 'waive_current' })).rejects.toThrow(/Relisez/);
    });
    it('new observation does not remove explicit-resolution requirement when balance recovers', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        await walletMovement(input, -10);
        const partial = observe(input, 200);
        await f.service.settleHistoricalSale(partial);
        await walletMovement(input, 8);
        const unknown = observe(partial, null);
        expect(await f.service.settleHistoricalSale(unknown)).toMatchObject({ kind: 'reconciliation', reason: 'allocation_unknown' });
        expect(await f.service.settleHistoricalSale(observe(unknown, 400))).toMatchObject({ kind: 'reconciliation', reason: 'insufficient_balance', receipt: { dueUnits: 4, reversedUnits: 0 } });
        expect((await state(input)).wallet.balance_units).toBe('8');
    });
    it('stale and financially regressive observations cannot re-credit or lose previous corrections', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        const partial = observe(input, 500);
        await f.service.settleHistoricalSale(partial);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'pending', reason: 'observation_superseded' });
        expect(await f.service.settleHistoricalSale(observe(partial, 400))).toMatchObject({ kind: 'reconciliation', reason: 'financial_regression' });
        expect((await state(input)).wallet.balance_units).toBe('5');
    });
    it('pause after initial gain does not replace the rule or erase the correction obligation', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE tenant_ref=$1", [input.tenantRef]);
        expect(await f.service.settleHistoricalSale(observe(input, 400))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 10, reversedUnits: 4 } });
    });
    it('new gain waits for active member/program with durable canonical identity', async () => {
        const input = await f.seed();
        await f.admin.query("UPDATE loyalty.programs SET status='paused' WHERE tenant_ref=$1", [input.tenantRef]);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'pending', reason: 'program_inactive' });
        expect((await state(input)).ledger).toEqual([]);
        await f.admin.query("UPDATE loyalty.programs SET status='active' WHERE tenant_ref=$1", [input.tenantRef]);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({ kind: 'recorded' });
    });
    it('the historical SQL writer cannot claim a waiting canonical web sale under a POS alias', async () => {
        const input = observe(await f.seed(), null);
        await f.service.settleHistoricalSale(input);
        await expect(transaction(input, async (c) => {
            const operation = randomUUID();
            await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint) VALUES($1,$2,'earn',$3)", [input.tenantRef, operation, 'a'.repeat(64)]);
            await c.query("INSERT INTO loyalty.earn_receipts(tenant_ref,source,external_ref,operation_id,member_id) VALUES($1,'pos',$2,$3,$4)", [input.tenantRef, `POS-ORDER:${input.clientId.toUpperCase()}`, operation, input.attribution.memberId]);
        })).rejects.toMatchObject({ code: '23505' });
        expect(await state(input)).toMatchObject({ receipts: 0, ledger: [] });
    });
    it('manual reverse of a managed gain is refused by SQL even for a pre-upgrade writer', async () => {
        const input = await f.seed();
        const r = await f.service.settleHistoricalSale(input);
        if (r.kind !== 'recorded')
            throw new Error('fixture');
        const before = await state(input);
        await expect(transaction(input, async (c) => {
            const operation = randomUUID();
            await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint) VALUES($1,$2,'reverse',$3)", [input.tenantRef, operation, 'a'.repeat(64)]);
            const w = await c.query('UPDATE loyalty.wallets SET balance_units=balance_units-10,lifetime_earned_units=lifetime_earned_units-10,version=version+1 WHERE tenant_ref=$1 RETURNING balance_units,version', [input.tenantRef]);
            await c.query(`INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at,reversed_entry_id)
    VALUES($1,$2,$3,$4,'reverse',-10,$5,'admin',1,$6,now(),$7)`, [input.tenantRef, input.attribution.memberId, input.attribution.programId, operation, w.rows[0].balance_units, w.rows[0].version, r.receipt.earnLedgerEntryId]);
        })).rejects.toMatchObject({ code: '23514' });
        expect(await state(input)).toEqual(before);
    });
    it('runtime RLS hides rows without tenant; immutable source and cumulative projection cannot be rewritten', async () => {
        const input = await f.seed();
        await f.service.settleHistoricalSale(input);
        expect((await f.app.query('SELECT * FROM loyalty.sale_settlements')).rowCount).toBe(0);
        await expect(transaction(input, async (c) => { await c.query('UPDATE loyalty.sale_settlements SET initial_units=99,version=version+1 WHERE tenant_ref=$1', [input.tenantRef]); })).rejects.toMatchObject({ code: '23514' });
        await expect(transaction(input, async (c) => { await c.query('UPDATE loyalty.sale_settlements SET reversed_units=1,version=version+1 WHERE tenant_ref=$1', [input.tenantRef]); })).rejects.toMatchObject({ code: '23514' });
        await expect(transaction(input, async (c) => { await c.query('UPDATE loyalty.sale_settlements SET latest_order_version=latest_order_version-1,version=version+1 WHERE tenant_ref=$1', [input.tenantRef]); })).rejects.toMatchObject({ code: '23514' });
        await expect(transaction(input, async (c) => { await c.query('UPDATE loyalty.sale_settlements SET latest_refund_sync_version=latest_refund_sync_version-1,version=version+1 WHERE tenant_ref=$1', [input.tenantRef]); })).rejects.toMatchObject({ code: '23514' });
        await expect(transaction(input, async (c) => { await c.query('DELETE FROM loyalty.sale_observations WHERE tenant_ref=$1', [input.tenantRef]); })).rejects.toThrow();
        await expect(transaction(input, async (c) => { await c.query("INSERT INTO loyalty.sale_observations(tenant_ref,observation_id,sale_id,financial_fingerprint,order_version,refund_sync_version,pending_refund_cents,paid_and_delivered,proof) SELECT 'other', $2,id,$3,1,1,0,true,'{}' FROM loyalty.sale_settlements WHERE tenant_ref=$1", [input.tenantRef, randomUUID(), 'a'.repeat(64)]); })).rejects.toMatchObject({ code: '42501' });
    });
    it('public dashboard reports net historical gains and manual reversal returns a clear conflict', async () => {
        const input = await f.seed();
        const activity = async (): Promise<Date | null> => (await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [input.tenantRef])).rows[0].last_activity_at;
        expect(await activity()).toBeNull();
        const startedAt = Date.now();
        const initial = await f.service.settleHistoricalSale(input);
        if (initial.kind !== 'recorded') throw new Error('fixture');
        const creditedAt = await activity();
        expect(creditedAt).toBeInstanceOf(Date);
        expect(creditedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(creditedAt!.getTime()).toBeLessThanOrEqual(Date.now());
        await f.service.settleHistoricalSale(input);
        expect(await activity()).toEqual(creditedAt);
        const oldActivity = new Date('2025-01-01T00:00:00.000Z');
        await f.admin.query('UPDATE loyalty.members SET last_activity_at=$2 WHERE tenant_ref=$1', [input.tenantRef, oldActivity]);
        await f.service.settleHistoricalSale(input);
        await f.service.readHistoricalSale({ tenantRef: input.tenantRef, clientId: input.clientId, earnOperationId: input.earnOperationId,
            attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution), observationId: input.observation.observationId,
            financialFingerprint: input.observation.financialFingerprint });
        expect(await activity()).toEqual(oldActivity);
        const refund = observe(input, 400);
        await f.service.settleHistoricalSale(refund);
        const correctedAt = await activity();
        expect(correctedAt).toBeInstanceOf(Date);
        expect(correctedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
        await f.service.settleHistoricalSale(refund);
        expect(await activity()).toEqual(correctedAt);
        const crypto = new LoyaltyCryptoAdapter({ encryptionKeyBase64: Buffer.alloc(32, 17).toString('base64'), phoneLookupKeyBase64: Buffer.alloc(32, 43).toString('base64'), operationFingerprintKeyBase64: Buffer.alloc(32, 91).toString('base64'), qrTokenDerivationKeyBase64: Buffer.alloc(32, 127).toString('base64') });
        const legacy = new LoyaltyMemberService(loyaltyDb(f.app), crypto, { confirmedPurchaseCents: async () => { throw new Error('No Mongo/provider read expected'); } } as unknown as LoyaltyPurchaseVerifier);
        expect(await legacy.dashboard(input.tenantRef)).toMatchObject({ outstandingUnits: 6, earnedUnits30d: 6, activeMembers30d: 1 });
        await expect(legacy.reverseLedgerEntry(input.tenantRef, input.attribution.memberId, initial.receipt.earnLedgerEntryId!, { operationId: randomUUID(), reason: 'Refus protocole historique' }, { source: 'admin', actorRef: 'fixture-owner', deviceRef: null })).rejects.toThrow(/dossier de rapprochement/);
        expect((await state(input)).wallet.balance_units).toBe('6');
        await expect(transaction(input,async c=>{await c.query("UPDATE loyalty.operations SET result='{}' WHERE tenant_ref=$1 AND operation_id=$2",[input.tenantRef,input.earnOperationId]);})).rejects.toMatchObject({code:'23514'});
    });

    it('two concurrent sales of the same member serialize activity and wallet without lock promotion', async () => {
        const first = await f.seed();
        const clientId = randomUUID();
        const second = observe({ ...first, clientId, earnOperationId: randomUUID(), attribution: { ...first.attribution, clientId } }, 0);
        const results = await Promise.all([f.service.settleHistoricalSale(first), f.service.settleHistoricalSale(second)]);
        expect(results.every(value => value.kind === 'recorded')).toBe(true);
        expect(await state(first)).toMatchObject({ receipts: 2, wallet: { balance_units: '20', lifetime_earned_units: '20', version: '2' } });
        expect((await f.admin.query('SELECT last_activity_at FROM loyalty.members WHERE tenant_ref=$1', [first.tenantRef])).rows[0].last_activity_at).toBeInstanceOf(Date);
    });

    it('a newly published current rule cannot alter a captured historical gain or its partial correction', async () => {
        const input = await f.seed();
        await f.admin.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,spend_step_cents,units_per_step,unit_label_singular,unit_label_plural)
          VALUES($1,$2,2,'New rule','points',0,100,100,'point','points')`, [input.tenantRef,input.attribution.programId]);
        await f.admin.query('UPDATE loyalty.programs SET current_version=2 WHERE tenant_ref=$1',[input.tenantRef]);
        expect(await f.service.settleHistoricalSale(input)).toMatchObject({kind:'recorded',receipt:{initialUnits:10}});
        expect(await f.service.settleHistoricalSale(observe(input,300))).toMatchObject({kind:'recorded',receipt:{initialUnits:10,reversedUnits:3}});
        expect((await state(input)).ledger.every(row=>row.rules_version==='1')).toBe(true);
    });
    it('a blocked member pauses correction without losing its historical obligation', async () => {
        const input=await f.seed();await f.service.settleHistoricalSale(input);const refunded=observe(input,1000);
        await f.admin.query("UPDATE loyalty.members SET status='blocked',blocked_at=now() WHERE tenant_ref=$1",[input.tenantRef]);
        expect(await f.service.settleHistoricalSale(refunded)).toMatchObject({kind:'pending',reason:'member_inactive'});
        expect((await state(input)).wallet.balance_units).toBe('10');
        await f.admin.query("UPDATE loyalty.members SET status='active',blocked_at=NULL WHERE tenant_ref=$1",[input.tenantRef]);
        expect(await f.service.settleHistoricalSale(refunded)).toMatchObject({kind:'recorded',receipt:{reversedUnits:10}});
    });
    it('another protected owner cannot claim this membership by substituting its attribution', async () => {
        const input=await f.seed();input.attribution.owner.accountId=randomUUID();
        const invalid=observe(input,0);
        expect(await f.service.settleHistoricalSale(invalid)).toMatchObject({kind:'reconciliation',reason:'historical_proof_conflict'});
        expect(await state(input)).toMatchObject({receipts:0,ledger:[],wallet:{balance_units:'0'}});
    });

});
