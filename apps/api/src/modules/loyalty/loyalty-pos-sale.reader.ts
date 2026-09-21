import { isDeepStrictEqual } from 'node:util';
import { and, eq, sql, earnReceipts, ledgerEntries, operations, programs, programVersions, type LoyaltyCryptoAdapter, type LoyaltyTx } from '@sm/loyalty';
import { z } from 'zod';
import type { HistoricalPosSaleAttribution } from './loyalty-historical-sale.types';

export const PosSaleIdentitySchema = z.strictObject({ tenantRef: z.string().regex(/^[a-f0-9]{24}$/), clientId: z.uuid(),
  memberId: z.uuid(), operationId: z.uuid(), purchaseCents: z.number().int().nonnegative().max(10_000_000) });
export type PosSaleIdentity = z.infer<typeof PosSaleIdentitySchema>;
export class PosSaleProofError extends Error {
  constructor() { super('historical_pos_receipt_conflict'); }
}
const storedSchema = z.object({ memberId: z.uuid(), outcome: z.enum(['earned', 'below_minimum']),
  awardedUnits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), rulesVersion: z.number().int().positive(), ledgerEntryId: z.uuid().nullable() });

/** Exact historical evidence only. No membership/account or current-rule lookup.
 * The HMAC proves that the unchanged charged POS total is the amount of the
 * original earn request, including any delivery charge in the legacy basis. */
export async function readPosSaleAttribution(tx: LoyaltyTx, crypto: LoyaltyCryptoAdapter, raw: PosSaleIdentity): Promise<HistoricalPosSaleAttribution> {
  const q = PosSaleIdentitySchema.parse(raw);
  const fail = (): never => { throw new PosSaleProofError(); };
  const receipts = await tx.select().from(earnReceipts).where(and(eq(earnReceipts.tenantRef, q.tenantRef),
    sql`(${earnReceipts.operationId}=${q.operationId}::uuid OR (${earnReceipts.source} IN ('pos','online')
      AND ${earnReceipts.externalRef} ~* '^(pos-order|online-order|order):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND lower(split_part(${earnReceipts.externalRef},':',2))=${q.clientId}))`)).limit(2);
  const receipt = receipts[0];
  if (receipts.length !== 1 || !receipt || receipt.source !== 'pos' || receipt.operationId !== q.operationId || receipt.memberId !== q.memberId
    || !/^(pos-order|online-order|order):/i.test(receipt.externalRef) || receipt.externalRef.split(':')[1]?.toLowerCase() !== q.clientId) return fail();
  const [operation] = await tx.select().from(operations).where(and(eq(operations.tenantRef, q.tenantRef), eq(operations.operationId, q.operationId))).limit(1);
  const parsed = storedSchema.safeParse(operation?.result);
  const fingerprint = crypto.operationFingerprint({ tenantRef: q.tenantRef, kind: 'earn', payload: {
    memberId: q.memberId, operationId: q.operationId, purchaseCents: q.purchaseCents, externalRef: receipt.externalRef, source: 'pos',
  } });
  if (!operation || operation.kind !== 'earn' || operation.status !== 'completed' || !operation.completedAt
    || operation.requestFingerprint !== fingerprint || !parsed.success || parsed.data.memberId !== q.memberId) return fail();
  const result = parsed.data;
  const entries = await tx.select().from(ledgerEntries).where(and(eq(ledgerEntries.tenantRef, q.tenantRef), eq(ledgerEntries.operationId, q.operationId))).limit(2);
  const entry = entries[0];
  if (result.awardedUnits === 0) {
    if (result.outcome !== 'below_minimum' || result.ledgerEntryId !== null || entries.length) return fail();
  } else if (entries.length !== 1 || !entry || result.outcome !== 'earned' || entry.id !== result.ledgerEntryId
    || entry.kind !== 'earn' || entry.source !== 'pos' || entry.externalRef !== receipt.externalRef || entry.memberId !== q.memberId
    || entry.rulesVersion !== result.rulesVersion || entry.deltaUnits !== result.awardedUnits) return fail();
  const [program] = await tx.select({ id: programs.id }).from(programs).where(eq(programs.tenantRef, q.tenantRef)).limit(1);
  if (!program || (entry && entry.programId !== program.id)) return fail();
  const [version] = await tx.select().from(programVersions).where(and(eq(programVersions.tenantRef, q.tenantRef),
    eq(programVersions.programId, program.id), eq(programVersions.version, result.rulesVersion))).limit(1);
  if (!version) return fail();
  const rule: HistoricalPosSaleAttribution['rule'] = version.mechanism === 'points'
    ? { mechanism: 'points', minimumPurchaseCents: version.minimumPurchaseCents, maximumUnitsPerPurchase: version.maximumUnitsPerPurchase,
      spendStepCents: version.spendStepCents!, unitsPerStep: version.unitsPerStep! }
    : { mechanism: 'stamps', minimumPurchaseCents: version.minimumPurchaseCents, maximumUnitsPerPurchase: version.maximumUnitsPerPurchase, unitsPerVisit: version.unitsPerVisit! };
  // A prior full manual reversal is not a cumulative debit receipt. Fail closed;
  // its business decision must never be silently converted into another debit.
  if (entry && (await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(and(eq(ledgerEntries.tenantRef, q.tenantRef), eq(ledgerEntries.reversedEntryId, entry.id))).limit(1)).length) return fail();
  return { version: 1, decision: 'pos_receipt', tenantRef: q.tenantRef, clientId: q.clientId, memberId: q.memberId,
    programId: program.id, rulesVersion: result.rulesVersion, rule,
    basis: { policyVersion: 'legacy-pos-total-v1', eligiblePurchaseCents: q.purchaseCents, chargedTotalCents: q.purchaseCents, excludedChargeCents: 0 },
    receipt: { id: receipt.id, operationId: q.operationId, ledgerEntryId: result.ledgerEntryId, awardedUnits: result.awardedUnits,
      externalRef: receipt.externalRef, requestFingerprint: operation.requestFingerprint } };
}
export function samePosSaleProof(left: HistoricalPosSaleAttribution, right: HistoricalPosSaleAttribution): boolean {
  return isDeepStrictEqual(left, right);
}
