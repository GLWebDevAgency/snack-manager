import { createHash } from 'node:crypto';
import { counterRefundProjection, type CounterRefundSnapshot } from '../ordering/order-counter-refund.policy';
import { refundProjection } from '../ordering/order-refund-flow.policy';
import { refundAllocationProjection } from '../ordering/order-refund-allocation.policy';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { HISTORICAL_SALE_PROOF_MAX_BYTES, historicalSaleFinancialFingerprint, type HistoricalSaleJson, type HistoricalPosSaleSettlementInput } from './loyalty-historical-sale.types';
import { PosSaleProofError } from './loyalty-pos-sale.reader';

type StripeOrder = Parameters<typeof refundAllocationProjection>[0];
export type LoyaltyPosObservedOrder = StripeOrder & CounterRefundSnapshot & { _id: unknown; tenantId: unknown; clientId: string; channel: string;
  status: string; __v?: number; loyaltyMemberId?: string | null; loyaltyEarnOperationId?: string | null; loyaltyEarnState?: string | null;
  customerSaleAttribution?: unknown };
export class LoyaltyPosObservationError extends Error {
  constructor(readonly code: 'historical_proof_conflict' | 'financial_proof_conflict' | 'financial_proof_too_large') { super(code); }
}
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function observationId(tenant: string, client: string, hash: string) {
  const b = createHash('sha256').update(`loyalty-pos-compensation-v1\0${tenant}\0${client}\0${hash}`).digest().subarray(0, 16);
  b[6] = (b[6]! & 15) | 0x50; b[8] = (b[8]! & 63) | 0x80; const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Only a completed, cryptographically bound historical POS receipt can be
 * compensated. Its paid/delivered eligibility was validated before the gain;
 * adoption does not invent a second handoff proof or a customer account. */
export async function loyaltyPosObservation(order: LoyaltyPosObservedOrder, historical: LoyaltyHistoricalSaleService): Promise<HistoricalPosSaleSettlementInput> {
  const tenantRef = String(order.tenantId);
  if (!/^[a-f0-9]{24}$/.test(tenantRef) || order.channel !== 'pos' || !uuid(order.clientId)
    || !uuid(order.loyaltyMemberId) || !uuid(order.loyaltyEarnOperationId) || order.loyaltyEarnState !== 'completed'
    || (order.customerSaleAttribution as { decision?: string } | null)?.decision === 'attributed'
    || !Number.isSafeInteger(order.__v) || order.__v! < 0) throw new LoyaltyPosObservationError('historical_proof_conflict');
  let attribution;
  try { attribution = await historical.readPosSaleAttribution({ tenantRef, clientId: order.clientId, memberId: order.loyaltyMemberId,
    operationId: order.loyaltyEarnOperationId, purchaseCents: order.totals.total }); }
  catch (e) { if (e instanceof PosSaleProofError) throw new LoyaltyPosObservationError('historical_proof_conflict'); throw e; }
  let confirmed: number, pending: number, version: number, proof: HistoricalSaleJson;
  try {
    if (order.payment.method === 'online') {
      const projected = refundAllocationProjection(order);
      // The legacy POS rule awarded on the whole total, including delivery.
      // Use total refund amounts after validating their exact durable journal.
      confirmed = refundProjection(order).summary.refundedCents; pending = projected.pendingRefundCents;
      version = order.payment.refundSyncVersion ?? 0; proof = projected.proof as unknown as HistoricalSaleJson;
    } else {
      const projected = counterRefundProjection(order);
      if (projected.originalPaidCents !== attribution.basis.chargedTotalCents) throw new Error('basis');
      confirmed = projected.confirmedRefundedCents; pending = projected.pendingRefundCents;
      version = projected.refundSyncVersion; proof = projected.proof as unknown as HistoricalSaleJson;
    }
  } catch { throw new LoyaltyPosObservationError('financial_proof_conflict'); }
  const financial = { attribution, eligibleRefundedCents: confirmed, pendingRefundCents: pending, paidAndDelivered: true,
    proof: { version: 1, orderId: String(order._id), basis: 'legacy-pos-total-v1', refund: proof } as HistoricalSaleJson };
  if (Buffer.byteLength(JSON.stringify(financial.proof)) > HISTORICAL_SALE_PROOF_MAX_BYTES) throw new LoyaltyPosObservationError('financial_proof_too_large');
  const financialFingerprint = historicalSaleFinancialFingerprint(financial);
  return { tenantRef, clientId: order.clientId, earnOperationId: order.loyaltyEarnOperationId, attribution,
    observation: { observationId: observationId(tenantRef, order.clientId, financialFingerprint), financialFingerprint,
      orderVersion: order.__v!, refundSyncVersion: version, eligibleRefundedCents: confirmed, pendingRefundCents: pending,
      paidAndDelivered: true, proof: financial.proof } };
}
