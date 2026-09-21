import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { loyaltyDb } from '@sm/loyalty';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleFinancialFingerprint, type HistoricalSaleSettlementInput, type HistoricalSaleAttribution } from './loyalty-historical-sale.types';
export interface HistoricalSaleTestFixture {
    app: Pool;
    admin: Pool;
    role: string;
    service: LoyaltyHistoricalSaleService;
    close(): Promise<void>;
    seed(options?: {
        eligiblePurchaseCents?: number;
        excludedChargeCents?: number;
        rule?: HistoricalSaleAttribution['rule'];
    }): Promise<HistoricalSaleSettlementInput>;
}
/** Disposable real migrations + ordinary runtime role. Identity principals are
 * synthetic historical accounts created before the protected-enrollment upgrade;
 * this fixture does not claim an SMS/passkey journey (separate suites cover it). */
export async function historicalSaleTestFixture(raw: unknown): Promise<HistoricalSaleTestFixture> {
    const prepared = Array.from({ length: 40 }, () => ({ tenantRef: randomBytes(12).toString('hex'), parentRef: `AC${randomBytes(16).toString('hex')}`, accountId: randomUUID() }));
    const fixturePath = resolve(__dirname, '../../../../../packages/customer/src/test-fixture.ts');
    type Fixture = {
        app: Pool;
        admin: Pool;
        role: string;
        close(): Promise<void>;
    };
    const { customerTestFixture } = await import(/* @vite-ignore */ fixturePath) as {
        customerTestFixture(raw: unknown, options: {
            beforeUpgradeMigrations: 5;
            beforeUpgrade(admin: Pool): Promise<void>;
        }): Promise<Fixture>;
    };
    const f = await customerTestFixture(raw, { beforeUpgradeMigrations: 5, beforeUpgrade: async (admin) => {
            for (const a of prepared) {
                await admin.query('INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit) VALUES($1,1,1,1)', [a.parentRef]);
                await admin.query('INSERT INTO customer.accounts(id,tenant_ref,parent_ref) VALUES($1,$2,$3)', [a.accountId, a.tenantRef, a.parentRef]);
            }
        } });
    await f.admin.query(`GRANT USAGE ON SCHEMA loyalty TO "${f.role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA loyalty TO "${f.role}"`);
    const service = new LoyaltyHistoricalSaleService(loyaltyDb(f.app));
    return { ...f, service, seed: async (options = {}) => {
            const a = prepared.shift();
            if (!a)
                throw new Error('Historical sale fixture capacity exceeded');
            const memberId = randomUUID(), programId = randomUUID(), membershipOperationId = randomUUID();
            const rule = options.rule ?? { mechanism: 'points' as const, minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 };
            const client = await f.app.connect();
            try {
                await client.query('BEGIN');
                await client.query("SELECT set_config('app.tenant_ref',$1,true),set_config('app.customer_parent_ref',$2,true)", [a.tenantRef, a.parentRef]);
                await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status) VALUES($1,$2,'active')", [programId, a.tenantRef]);
                await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,maximum_units_per_purchase,spend_step_cents,units_per_step,units_per_visit,unit_label_singular,unit_label_plural)
        VALUES($1,$2,1,'Fixture', $3,$4,$5,$6,$7,$8,'point','points')`, [a.tenantRef, programId, rule.mechanism, rule.minimumPurchaseCents, rule.maximumUnitsPerPurchase,
                    rule.mechanism === 'points' ? rule.spendStepCents : null, rule.mechanism === 'points' ? rule.unitsPerStep : null, rule.mechanism === 'stamps' ? rule.unitsPerVisit : null]);
                await client.query('INSERT INTO loyalty.members(id,tenant_ref,enrollment_handoff_at) VALUES($1,$2,now())', [memberId, a.tenantRef]);
                await client.query('INSERT INTO loyalty.wallets(tenant_ref,member_id,program_id) VALUES($1,$2,$3)', [a.tenantRef, memberId, programId]);
                await client.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'member_create',$3,'completed','{}',now())", [a.tenantRef, membershipOperationId, 'a'.repeat(64)]);
                await client.query('INSERT INTO customer.loyalty_memberships(parent_ref,tenant_ref,account_id,member_id,operation_id,request_hash) VALUES($1,$2,$3,$4,$5,$6)', [a.parentRef, a.tenantRef, a.accountId, memberId, membershipOperationId, 'b'.repeat(64)]);
                await client.query('COMMIT');
            }
            catch (error) {
                await client.query('ROLLBACK');
                throw error;
            }
            finally {
                client.release();
            }
            const eligiblePurchaseCents = options.eligiblePurchaseCents ?? 1000, excludedChargeCents = options.excludedChargeCents ?? 0, clientId = randomUUID();
            const attribution: HistoricalSaleAttribution = { version: 1, tenantRef: a.tenantRef, clientId, owner: a, decision: 'attributed', capturedAt: Date.now(),
                basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents, excludedChargeCents, chargedTotalCents: eligiblePurchaseCents + excludedChargeCents },
                memberId, membershipOperationId, programId, rulesVersion: 1, rule };
            const financial = { attribution, eligibleRefundedCents: 0, pendingRefundCents: 0, paidAndDelivered: true, proof: { payment: 'fixture-paid', handoff: 'fixture-delivered', allocation: 'fixture-no-refund' } };
            return { tenantRef: a.tenantRef, clientId, earnOperationId: randomUUID(), attribution, observation: { eligibleRefundedCents: financial.eligibleRefundedCents, pendingRefundCents: financial.pendingRefundCents, paidAndDelivered: financial.paidAndDelivered, proof: financial.proof, observationId: randomUUID(), orderVersion: 1, refundSyncVersion: 0, financialFingerprint: historicalSaleFinancialFingerprint(financial) } };
        } };
}
