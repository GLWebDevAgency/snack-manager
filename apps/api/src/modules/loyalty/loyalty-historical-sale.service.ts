import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { CustomerSaleAttributionSchema } from '@sm/contracts';
import { loyalty as domain, Money } from '@sm/domain';
import { and, eq, sql, withLoyaltyTenant, saleSettlements, saleObservations, saleCorrections, operations, earnReceipts, ledgerEntries, wallets, programs, programVersions, members, type LoyaltyCryptoAdapter, type LoyaltyDb, type LoyaltyTx } from '@sm/loyalty';
import { z } from 'zod';
import { LOYALTY_CRYPTO, LOYALTY_DB } from '../../loyalty-db.module';
import { HISTORICAL_SALE_PROOF_MAX_BYTES, historicalSaleAttributionFingerprint, historicalSaleFinancialFingerprint, type HistoricalSaleSettlementInput, type HistoricalSaleReceiptQuery, type HistoricalSaleResolutionInput, type HistoricalSaleSettlementResult, type HistoricalSaleReceipt, type HistoricalSalePendingReason, type HistoricalSaleReconciliationReason, type HistoricalSaleSource, type HistoricalPosSaleSettlementInput } from './loyalty-historical-sale.types';
import { readPosSaleAttribution, samePosSaleProof, type PosSaleIdentity } from './loyalty-pos-sale.reader';
type AnyInput = HistoricalSaleSettlementInput<HistoricalSaleSource>;
type Sale = typeof saleSettlements.$inferSelect;
type Wallet = typeof wallets.$inferSelect;
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identity = { tenantRef: z.string().regex(/^[a-f0-9]{24}$/), clientId: z.uuid(), earnOperationId: z.uuid() };
const querySchema = z.strictObject({ ...identity, attributionFingerprint: digest, observationId: z.uuid(), financialFingerprint: digest });
const observationSchema = z.strictObject({ observationId: z.uuid(), orderVersion: units, refundSyncVersion: units, financialFingerprint: digest,
    eligibleRefundedCents: units.nullable(), pendingRefundCents: units, paidAndDelivered: z.boolean(), proof: z.unknown() });
const inputSchema = z.strictObject({ ...identity, attribution: CustomerSaleAttributionSchema, observation: observationSchema });
const resolutionSchema = z.strictObject({ tenantRef: identity.tenantRef, clientId: z.uuid(), operationId: z.uuid(), caseId: z.uuid(), expectedVersion: units,
    actorRef: z.string().min(1).max(160), decision: z.enum(['retry', 'waive_current']), reason: z.string().trim().min(3).max(500) });
const storedReceiptSchema = z.strictObject({ saleId: z.uuid(), earnOperationId: z.uuid(), observationId: z.uuid().nullable(), financialFingerprint: digest.nullable(), attributionFingerprint: digest,
    version: units, initialUnits: units.nullable(), reversedUnits: units, waivedUnits: units, retainedUnits: units, dueUnits: units, earnReceiptId: z.uuid().nullable(), earnLedgerEntryId: z.uuid().nullable() });
const storedResultSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('recorded'), receipt: storedReceiptSchema, replayed: z.boolean() }),
    z.strictObject({ kind: z.literal('reconciliation'), reason: z.enum(['allocation_unknown', 'insufficient_balance', 'historical_proof_conflict', 'canonical_sale_conflict', 'financial_regression']), receipt: storedReceiptSchema, caseId: z.uuid() }),
    z.strictObject({ kind: z.literal('pending'), reason: z.enum(['not_observed', 'observation_superseded', 'payment_or_handoff_pending', 'refund_pending', 'program_inactive', 'member_inactive']), receipt: storedReceiptSchema.nullable() })
]);
const resolutionReceiptSchema = z.strictObject({ clientId: z.uuid(), resolutionActorRef: z.string(), request: z.strictObject({ operationId: z.uuid(), caseId: z.uuid(), expectedVersion: units, decision: z.enum(['retry', 'waive_current']), reason: z.string() }), result: storedResultSchema });
function checkedAdd(a: number, b: number) {
    const value = a + b;
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new ConflictException('Plafond technique fidélité atteint');
    }
    return value;
}
function receipt(s: Sale): HistoricalSaleReceipt {
    return { saleId: s.id, earnOperationId: s.earnOperationId, observationId: s.latestObservationId,
        financialFingerprint: s.latestFinancialFingerprint, attributionFingerprint: s.attributionFingerprint, version: s.version, initialUnits: s.initialUnits,
        reversedUnits: s.reversedUnits, waivedUnits: s.waivedUnits, retainedUnits: (s.initialUnits ?? 0) - s.reversedUnits, dueUnits: s.dueUnits,
        earnReceiptId: s.earnReceiptId, earnLedgerEntryId: s.earnLedgerEntryId };
}
function result(s: Sale, replayed = false): HistoricalSaleSettlementResult {
    if (s.status === 'recorded')
        return storedResultSchema.parse({ kind: 'recorded', receipt: receipt(s), replayed });
    if (s.status === 'reconciliation')
        return storedResultSchema.parse({ kind: 'reconciliation', reason: s.reason, caseId: s.id, receipt: receipt(s) });
    return storedResultSchema.parse({ kind: 'pending', reason: s.reason, receipt: receipt(s) });
}
function inputFingerprint(input: AnyInput) {
    return historicalSaleFinancialFingerprint({ attribution: input.attribution,
        eligibleRefundedCents: input.observation.eligibleRefundedCents, pendingRefundCents: input.observation.pendingRefundCents,
        paidAndDelivered: input.observation.paidAndDelivered, proof: input.observation.proof });
}
/** Server-only writer. Mongo observations are supplied by the protected worker,
 * never a customer request. Wallet, canonical receipt and cumulative corrections
 * commit together; a lost acknowledgement is read before another attempt. */
@Injectable()
export class LoyaltyHistoricalSaleService {
    constructor(
    @Inject(LOYALTY_DB)
    private readonly db: LoyaltyDb,
    @Inject(LOYALTY_CRYPTO) private readonly crypto?: LoyaltyCryptoAdapter) { }
    private async load(tx: LoyaltyTx, tenantRef: string, clientId: string, lock = false): Promise<Sale | undefined> {
        const query = tx.select().from(saleSettlements).where(and(eq(saleSettlements.tenantRef, tenantRef), eq(saleSettlements.clientId, clientId))).limit(1);
        return (await (lock ? query.for('update') : query))[0];
    }
    private async change(tx: LoyaltyTx, s: Sale, patch: Partial<typeof saleSettlements.$inferInsert>): Promise<Sale> {
        const [row] = await tx.update(saleSettlements).set({ ...patch, version: checkedAdd(s.version, 1), updatedAt: new Date() })
            .where(and(eq(saleSettlements.tenantRef, s.tenantRef), eq(saleSettlements.id, s.id), eq(saleSettlements.version, s.version))).returning();
        if (!row)
            throw new ConflictException('Traitement fidélité modifié');
        return row;
    }
    async readHistoricalSale(raw: HistoricalSaleReceiptQuery): Promise<HistoricalSaleSettlementResult> {
        const q = querySchema.parse(raw);
        return withLoyaltyTenant(this.db, q.tenantRef, async (tx) => {
            const s = await this.load(tx, q.tenantRef, q.clientId);
            if (!s)
                return { kind: 'pending', reason: 'not_observed', receipt: null };
            if (s.earnOperationId !== q.earnOperationId || s.attributionFingerprint !== q.attributionFingerprint)
                return { kind: 'reconciliation', reason: 'historical_proof_conflict', caseId: s.id, receipt: receipt(s) };
            if (s.latestObservationId !== q.observationId || s.latestFinancialFingerprint !== q.financialFingerprint)
                return { kind: 'pending', reason: 'observation_superseded', receipt: receipt(s) };
            return result(s, true);
        });
    }
    async settleHistoricalSale(raw: HistoricalSaleSettlementInput): Promise<HistoricalSaleSettlementResult> {
        const parsed = inputSchema.parse(raw);
        if (parsed.attribution.decision !== 'attributed' || parsed.tenantRef !== parsed.attribution.tenantRef || parsed.clientId !== parsed.attribution.clientId)
            throw new BadRequestException('Photographie fidélité incohérente');
        return this.settle(raw);
    }
    async readPosSaleAttribution(input: PosSaleIdentity) {
        if (!this.crypto) throw new ConflictException('Preuve POS indisponible');
        return withLoyaltyTenant(this.db, input.tenantRef, tx => readPosSaleAttribution(tx, this.crypto!, input));
    }
    async settlePosSale(input: HistoricalPosSaleSettlementInput): Promise<HistoricalSaleSettlementResult> {
        z.object(identity).parse(input);
        observationSchema.parse(input.observation);
        if (input.attribution.decision !== 'pos_receipt' || input.attribution.tenantRef !== input.tenantRef
            || input.attribution.clientId !== input.clientId || input.attribution.receipt.operationId !== input.earnOperationId)
            throw new BadRequestException('Photographie POS incohérente');
        return this.settle(input);
    }
    private async settle(input: AnyInput): Promise<HistoricalSaleSettlementResult> {
        const a = input.attribution;
        const o = input.observation;
        if (Buffer.byteLength(JSON.stringify(o.proof)) > HISTORICAL_SALE_PROOF_MAX_BYTES || inputFingerprint(input) !== o.financialFingerprint
            || (o.eligibleRefundedCents !== null && o.eligibleRefundedCents > a.basis.eligiblePurchaseCents)
            || o.pendingRefundCents > a.basis.chargedTotalCents
            || BigInt(o.pendingRefundCents) + BigInt(o.eligibleRefundedCents ?? 0) > BigInt(a.basis.chargedTotalCents)
            || input.earnOperationId === o.observationId)
            throw new BadRequestException('Preuve financière fidélité incohérente');
        const attributionFingerprint = historicalSaleAttributionFingerprint(a);
        return withLoyaltyTenant(this.db, input.tenantRef, async (tx) => {
            // Adoption is serialized with both legacy earn and manual reversal.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.tenantRef} || ':' || ${input.clientId},0))`);
            if (a.decision === 'pos_receipt') {
                if (!this.crypto) throw new ConflictException('Preuve POS indisponible');
                const proof = await readPosSaleAttribution(tx, this.crypto, { tenantRef: input.tenantRef, clientId: input.clientId,
                    memberId: a.memberId, operationId: input.earnOperationId, purchaseCents: a.basis.chargedTotalCents });
                if (!samePosSaleProof(a, proof)) throw new ConflictException('Le reçu POS ne correspond pas à cette vente');
            }
            // The insert trigger takes the canonical sale lock before member,
            // program and wallet locks, also excluding a legacy POS/online earn.
            await tx.insert(saleSettlements).values({ tenantRef: input.tenantRef, clientId: input.clientId, earnOperationId: input.earnOperationId,
                memberId: a.memberId, programId: a.programId, rulesVersion: a.rulesVersion, attribution: a, attributionFingerprint,
                eligiblePurchaseCents: a.basis.eligiblePurchaseCents,
                ...(a.decision === 'pos_receipt' ? { origin: 'pos_receipt', initialUnits: a.receipt.awardedUnits,
                    earnReceiptId: a.receipt.id, earnLedgerEntryId: a.receipt.ledgerEntryId } : {}) }).onConflictDoNothing();
            let s = await this.load(tx, input.tenantRef, input.clientId, true);
            if (!s)
                throw new ConflictException('Vente fidélité concurrente');
            if (s.earnOperationId !== input.earnOperationId || s.attributionFingerprint !== attributionFingerprint)
                return { kind: 'reconciliation', reason: 'historical_proof_conflict', caseId: s.id, receipt: receipt(s) };
            if (s.latestObservationId === o.observationId && s.latestFinancialFingerprint === o.financialFingerprint && s.status !== 'pending')
                return result(s, true);
            if (s.latestObservationId && s.latestObservationId !== o.observationId
                && (o.refundSyncVersion < s.latestRefundSyncVersion || (o.refundSyncVersion === s.latestRefundSyncVersion && o.orderVersion < s.latestOrderVersion)))
                return { kind: 'pending', reason: 'observation_superseded', receipt: receipt(s) };
            await tx.insert(saleObservations).values({ tenantRef: s.tenantRef, saleId: s.id, ...o }).onConflictDoNothing();
            const [observed] = await tx.select().from(saleObservations).where(and(eq(saleObservations.tenantRef, s.tenantRef), eq(saleObservations.observationId, o.observationId))).limit(1);
            if (!observed || observed.saleId !== s.id || observed.financialFingerprint !== o.financialFingerprint)
                throw new ConflictException('Observation fidélité déjà utilisée');
            const patch = { latestObservationId: o.observationId, latestFinancialFingerprint: o.financialFingerprint,
                latestOrderVersion: Math.max(s.latestOrderVersion, o.orderVersion), latestRefundSyncVersion: Math.max(s.latestRefundSyncVersion, o.refundSyncVersion) };
            const stop = async (status: 'pending' | 'reconciliation', reason: HistoricalSalePendingReason | HistoricalSaleReconciliationReason) => result(await this.change(tx, s!, { ...patch, status, reason }));
            if (o.eligibleRefundedCents !== null && o.eligibleRefundedCents < s.confirmedEligibleCents)
                return stop('reconciliation', 'financial_regression');
            if (!o.paidAndDelivered)
                return stop('pending', 'payment_or_handoff_pending');
            if (o.eligibleRefundedCents === null)
                return stop('reconciliation', 'allocation_unknown');
            // An unresolved refund must not expose spendable provisional points.
            if (s.initialUnits === null && o.pendingRefundCents > 0)
                return stop('pending', 'refund_pending');
            // Historical version and immutable ownership, not current contact/QR.
            if (a.decision === 'attributed') {
                await tx.execute(sql`SELECT set_config('app.customer_parent_ref',${a.owner.parentRef},true)`);
                const ownership = await tx.execute(sql`SELECT 1 FROM customer.loyalty_memberships WHERE parent_ref=${a.owner.parentRef}
                    AND tenant_ref=${s.tenantRef} AND account_id=${a.owner.accountId}::uuid AND member_id=${s.memberId}::uuid
                    AND operation_id=${a.membershipOperationId}::uuid`);
                if (!ownership.rows.length) return stop('reconciliation', 'historical_proof_conflict');
            }
            const [storedRule] = await tx.select().from(programVersions).where(and(eq(programVersions.tenantRef, s.tenantRef), eq(programVersions.programId, s.programId), eq(programVersions.version, s.rulesVersion))).limit(1);
            if (!storedRule)
                return stop('reconciliation', 'historical_proof_conflict');
            const rule: domain.LoyaltyEarnRule = storedRule.mechanism === 'points'
                ? { mechanism: 'points', minimumPurchaseCents: storedRule.minimumPurchaseCents, maximumUnitsPerPurchase: storedRule.maximumUnitsPerPurchase, spendStepCents: storedRule.spendStepCents!, unitsPerStep: storedRule.unitsPerStep! }
                : { mechanism: 'stamps', minimumPurchaseCents: storedRule.minimumPurchaseCents, maximumUnitsPerPurchase: storedRule.maximumUnitsPerPurchase, unitsPerVisit: storedRule.unitsPerVisit! };
            if (!isDeepStrictEqual(rule, a.rule))
                return stop('reconciliation', 'historical_proof_conflict');
            // Serialize member activity before the wallet. NO KEY UPDATE stays
            // compatible with the KEY SHARE locks taken by each sale's member
            // FK, so two sales never deadlock while upgrading those FK locks.
            const [member] = await tx.select().from(members).where(and(eq(members.tenantRef, s.tenantRef), eq(members.id, s.memberId))).limit(1).for('no key update');
            if (member?.status !== 'active')
                return stop('pending', 'member_inactive');
            const [program] = await tx.select().from(programs).where(and(eq(programs.tenantRef, s.tenantRef), eq(programs.id, s.programId))).limit(1).for('share');
            if (s.initialUnits === null && program?.status !== 'active')
                return stop('pending', 'program_inactive');
            const calculated = domain.calculateLoyaltyEarn({ status: 'active', earn: rule }, Money.fromCents(s.eligiblePurchaseCents));
            if (!calculated.ok)
                return stop('reconciliation', 'historical_proof_conflict');
            const initialUnits = a.decision === 'attributed' && s.eligiblePurchaseCents === 0 ? 0 : calculated.value.units;
            if (s.initialUnits !== null && s.initialUnits !== initialUnits)
                return stop('reconciliation', 'historical_proof_conflict');
            let wallet = await this.wallet(tx, s);
            if (s.initialUnits === null) {
                if (a.decision !== 'attributed') return stop('reconciliation', 'historical_proof_conflict');
                const previous = await tx.execute(sql `SELECT 1 FROM loyalty.earn_receipts WHERE tenant_ref=${s.tenantRef} AND source IN ('pos','online')
          AND external_ref ~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND lower(split_part(external_ref,':',2))=${s.clientId}
          UNION ALL SELECT 1 FROM loyalty.ledger_entries WHERE tenant_ref=${s.tenantRef} AND kind='earn' AND source IN ('pos','online')
          AND external_ref ~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND lower(split_part(external_ref,':',2))=${s.clientId} LIMIT 1`);
                if (previous.rows.length)
                    return stop('reconciliation', 'canonical_sale_conflict');
                const earnReceiptId = randomUUID();
                const earnLedgerEntryId = initialUnits ? randomUUID() : null;
                await this.beginOperation(tx, s.tenantRef, s.earnOperationId, 'earn', attributionFingerprint);
                s = await this.change(tx, s, { ...patch, initialUnits, earnReceiptId, earnLedgerEntryId, reason: 'not_observed' });
                await tx.insert(earnReceipts).values({ id: earnReceiptId, tenantRef: s.tenantRef, source: 'online', externalRef: `order:${s.clientId}`,
                    operationId: s.earnOperationId, memberId: s.memberId });
                if (initialUnits) {
                    wallet = await this.moveWallet(tx, s, wallet, initialUnits);
                    await this.ledger(tx, s, wallet, s.earnOperationId, earnLedgerEntryId!, 'earn', initialUnits);
                }
                await this.completeOperation(tx, s.tenantRef, s.earnOperationId, { memberId: s.memberId, outcome: initialUnits ? 'earned' : 'below_minimum',
                    awardedUnits: initialUnits, rulesVersion: s.rulesVersion, ledgerEntryId: earnLedgerEntryId, saleId: s.id });
                // Like the existing earn path, a zero-point purchase receipt
                // is still an activity. Replays never reach this branch.
                await this.touchMember(tx, s);
            }
            const plan = domain.planLoyaltyEarnReversal({ historicalRule: rule, eligiblePurchaseCents: s.eligiblePurchaseCents,
                confirmedRefundedEligibleCents: o.eligibleRefundedCents, earnedUnits: initialUnits, alreadyReversedUnits: s.reversedUnits + s.waivedUnits });
            if (!plan.ok)
                return stop('reconciliation', 'historical_proof_conflict');
            const due = plan.value.additionalUnitsToReverse;
            // Once insufficient, only an explicit owner decision can clear this
            // latch; later wallet funding or another observation cannot retry it.
            const blocked = s.requiresResolution;
            s = await this.change(tx, s, { ...patch, confirmedEligibleCents: o.eligibleRefundedCents, dueUnits: due,
                status: due ? 'reconciliation' : 'recorded', reason: due ? 'insufficient_balance' : null, requiresResolution: due > 0 && (blocked || wallet.balanceUnits - wallet.reservedUnits < due) });
            if (due && (blocked || wallet.balanceUnits - wallet.reservedUnits < due))
                return result(s);
            if (due)
                s = await this.correct(tx, s, wallet, o.observationId, 'debit', null, 'Correction de gain après remboursement');
            return result(s);
        });
    }
    private async wallet(tx: LoyaltyTx, s: Sale): Promise<Wallet> {
        const [wallet] = await tx.select().from(wallets).where(and(eq(wallets.tenantRef, s.tenantRef), eq(wallets.memberId, s.memberId), eq(wallets.programId, s.programId))).limit(1).for('update');
        if (!wallet)
            throw new ConflictException('Portefeuille fidélité introuvable');
        return wallet;
    }
    private async moveWallet(tx: LoyaltyTx, s: Sale, w: Wallet, delta: number): Promise<Wallet> {
        const [next] = await tx.update(wallets).set({ balanceUnits: checkedAdd(w.balanceUnits, delta), lifetimeEarnedUnits: checkedAdd(w.lifetimeEarnedUnits, delta), version: checkedAdd(w.version, 1), updatedAt: new Date() })
            .where(and(eq(wallets.tenantRef, s.tenantRef), eq(wallets.memberId, s.memberId), eq(wallets.programId, s.programId), eq(wallets.version, w.version))).returning();
        if (!next)
            throw new ConflictException('Portefeuille fidélité modifié');
        return next;
    }
    private async touchMember(tx: LoyaltyTx, s: Sale): Promise<void> {
        await tx.update(members).set({ lastActivityAt: new Date() })
            .where(and(eq(members.tenantRef, s.tenantRef), eq(members.id, s.memberId)));
    }
    private async ledger(tx: LoyaltyTx, s: Sale, w: Wallet, operationId: string, id: string, kind: 'earn' | 'adjust_debit', delta: number) {
        await tx.insert(ledgerEntries).values({ id, tenantRef: s.tenantRef, memberId: s.memberId, programId: s.programId, operationId, kind, deltaUnits: delta,
            balanceAfter: w.balanceUnits, source: kind === 'earn' ? 'online' : 'system', externalRef: `order:${s.clientId}`, rulesVersion: s.rulesVersion, walletVersion: w.version,
            reason: kind === 'earn' ? 'Gain sur vente web attribuée' : 'Correction de gain après remboursement', occurredAt: new Date() });
    }
    private async beginOperation(tx: LoyaltyTx, tenantRef: string, operationId: string, kind: 'earn' | 'adjust', fingerprint: string) {
        await tx.insert(operations).values({ tenantRef, operationId, kind, requestFingerprint: fingerprint });
    }
    private async completeOperation(tx: LoyaltyTx, tenantRef: string, operationId: string, value: object) {
        await tx.update(operations).set({ status: 'completed', result: value, completedAt: new Date() }).where(and(eq(operations.tenantRef, tenantRef), eq(operations.operationId, operationId)));
    }
    private async correct(tx: LoyaltyTx, s: Sale, w: Wallet, operationId: string, kind: 'debit' | 'waive', actorRef: string | null, reason: string, claimed = false, resolution?: HistoricalSaleResolutionInput): Promise<Sale> {
        if (!claimed)
            await this.beginOperation(tx, s.tenantRef, operationId, 'adjust', s.latestFinancialFingerprint!);
        if (!s.latestObservationId)
            throw new ConflictException('Observation fidélité absente');
        const units = s.dueUnits;
        const ledgerEntryId = kind === 'debit' ? randomUUID() : null;
        const reversedUnits = checkedAdd(s.reversedUnits, kind === 'debit' ? units : 0);
        const waivedUnits = checkedAdd(s.waivedUnits, kind === 'waive' ? units : 0);
        await tx.insert(saleCorrections).values({ tenantRef: s.tenantRef, operationId, saleId: s.id, observationId: s.latestObservationId, kind, units,
            beforeReversedUnits: s.reversedUnits, afterReversedUnits: reversedUnits, beforeWaivedUnits: s.waivedUnits, afterWaivedUnits: waivedUnits, ledgerEntryId, actorRef, reason });
        if (kind === 'debit') {
            w = await this.moveWallet(tx, s, w, -units);
            await this.ledger(tx, s, w, operationId, ledgerEntryId!, 'adjust_debit', -units);
            await this.touchMember(tx, s);
        }
        const next = await this.change(tx, s, { reversedUnits, waivedUnits, dueUnits: 0, status: 'recorded', reason: null, requiresResolution: false });
        await this.completeOperation(tx, s.tenantRef, operationId, resolution ? this.resolutionReceipt(resolution, result(next)) : { saleId: s.id, kind, units, receipt: receipt(next) });
        return next;
    }
    private resolutionReceipt(input: HistoricalSaleResolutionInput, value: HistoricalSaleSettlementResult) {
        return { clientId: input.clientId, resolutionActorRef: input.actorRef, request: { operationId: input.operationId, caseId: input.caseId, expectedVersion: input.expectedVersion, decision: input.decision, reason: input.reason }, result: value };
    }
    /** Called only behind owner + reauthentication in the HTTP adapter. No debt,
     * partial debit or silent retry when later earnings refill this wallet. */
    async resolveHistoricalSale(raw: HistoricalSaleResolutionInput): Promise<HistoricalSaleSettlementResult> {
        const input = resolutionSchema.parse(raw);
        return withLoyaltyTenant(this.db, input.tenantRef, async (tx) => {
            const s = await this.load(tx, input.tenantRef, input.clientId, true);
            if (!s || s.id !== input.caseId)
                throw new ConflictException('Dossier fidélité introuvable');
            const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
            const [existing] = await tx.select().from(operations).where(and(eq(operations.tenantRef, s.tenantRef), eq(operations.operationId, input.operationId))).limit(1);
            if (existing) {
                if (existing.kind !== 'adjust' || existing.requestFingerprint !== fingerprint || existing.status !== 'completed')
                    throw new ConflictException('Résolution déjà utilisée');
                const stored = resolutionReceiptSchema.safeParse(existing.result);
                if (!stored.success || stored.data.clientId !== input.clientId || stored.data.resolutionActorRef !== input.actorRef)
                    throw new ConflictException('Reçu de résolution incohérent');
                return stored.data.result;
            }
            if (s.version !== input.expectedVersion || s.status !== 'reconciliation' || s.reason !== 'insufficient_balance' || s.dueUnits <= 0 || s.initialUnits === null)
                throw new ConflictException('Relisez le dossier fidélité avant de décider');
            const [member] = await tx.select().from(members).where(and(eq(members.tenantRef, s.tenantRef), eq(members.id, s.memberId))).limit(1).for('no key update');
            if (member?.status !== 'active')
                throw new ConflictException('Le membre fidélité doit être actif pour résoudre ce dossier');
            const wallet = await this.wallet(tx, s);
            if (input.decision === 'retry' && wallet.balanceUnits - wallet.reservedUnits < s.dueUnits) {
                await this.beginOperation(tx, s.tenantRef, input.operationId, 'adjust', fingerprint);
                await this.completeOperation(tx, s.tenantRef, input.operationId, this.resolutionReceipt(input, result(s)));
                return result(s);
            }
            await this.beginOperation(tx, s.tenantRef, input.operationId, 'adjust', fingerprint);
            return result(await this.correct(tx, s, wallet, input.operationId, input.decision === 'retry' ? 'debit' : 'waive', input.actorRef, input.reason, true, input));
        });
    }
}
