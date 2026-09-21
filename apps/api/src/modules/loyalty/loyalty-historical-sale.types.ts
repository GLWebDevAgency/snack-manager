import { createHash } from 'node:crypto';
import type { CustomerSaleAttribution } from '@sm/contracts';
export const HISTORICAL_SALE_PROOF_MAX_BYTES = 65_536;
export type HistoricalSaleAttribution = Extract<CustomerSaleAttribution, {
    decision: 'attributed';
}>;
export type HistoricalSaleJson = null | boolean | number | string | readonly HistoricalSaleJson[] | {
    readonly [key: string]: HistoricalSaleJson;
};
export interface HistoricalSaleFinancialInput {
    attribution: HistoricalSaleAttribution;
    eligibleRefundedCents: number | null;
    pendingRefundCents: number;
    paidAndDelivered: boolean;
    proof: HistoricalSaleJson;
}
export interface HistoricalSaleObservation {
    observationId: string;
    orderVersion: number;
    refundSyncVersion: number;
    financialFingerprint: string;
    eligibleRefundedCents: number | null;
    pendingRefundCents: number;
    paidAndDelivered: boolean;
    proof: HistoricalSaleJson;
}
export interface HistoricalSaleSettlementInput {
    tenantRef: string;
    clientId: string;
    earnOperationId: string;
    attribution: HistoricalSaleAttribution;
    observation: HistoricalSaleObservation;
}
export interface HistoricalSaleReceiptQuery {
    tenantRef: string;
    clientId: string;
    earnOperationId: string;
    attributionFingerprint: string;
    observationId: string;
    financialFingerprint: string;
}
export type HistoricalSaleReconciliationReason = 'allocation_unknown' | 'insufficient_balance' | 'historical_proof_conflict' | 'canonical_sale_conflict' | 'financial_regression';
export type HistoricalSalePendingReason = 'not_observed' | 'observation_superseded' | 'payment_or_handoff_pending' | 'refund_pending' | 'program_inactive' | 'member_inactive';
export interface HistoricalSaleReceipt {
    saleId: string;
    earnOperationId: string;
    observationId: string | null;
    financialFingerprint: string | null;
    attributionFingerprint: string;
    version: number;
    initialUnits: number | null;
    reversedUnits: number;
    waivedUnits: number;
    retainedUnits: number;
    dueUnits: number;
    earnReceiptId: string | null;
    earnLedgerEntryId: string | null;
}
export type HistoricalSaleSettlementResult = {
    kind: 'recorded';
    receipt: HistoricalSaleReceipt;
    replayed: boolean;
} | {
    kind: 'reconciliation';
    reason: HistoricalSaleReconciliationReason;
    receipt: HistoricalSaleReceipt;
    caseId: string;
} | {
    kind: 'pending';
    reason: HistoricalSalePendingReason;
    receipt: HistoricalSaleReceipt | null;
};
export interface HistoricalSaleResolutionInput {
    tenantRef: string;
    clientId: string;
    operationId: string;
    caseId: string;
    expectedVersion: number;
    actorRef: string;
    decision: 'retry' | 'waive_current';
    reason: string;
}
function canonical(value: unknown): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string')
        return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new Error('Invalid historical loyalty proof');
}
export function historicalSaleAttributionFingerprint(attribution: HistoricalSaleAttribution): string {
    return createHash('sha256').update(canonical(attribution)).digest('hex');
}
export function historicalSaleFinancialFingerprint(input: HistoricalSaleFinancialInput): string {
    return createHash('sha256').update(canonical(input)).digest('hex');
}
