import { CustomerOrderCreatedSchema, CustomerOrderDetailSchema, CustomerOrderSummarySchema, CustomerOrderReorderResponseSchema } from '@sm/contracts';
import type { Order } from '@sm/db';
import { Types } from 'mongoose';

type Row = Order & { _id: unknown; createdAt: Date };
const iso = (value: Date | null | undefined) => value ? new Date(value).toISOString() : null;
function totals(row: Row) {
  return { subtotal: row.totals.subtotal, deliveryFee: row.totals.deliveryFee ?? 0,
    discount: row.totals.discount ? { amount: row.totals.discount.amount, reason: row.totals.discount.reason } : null,
    total: row.totals.total };
}
export function customerOrderSummary(row: Row) {
  return CustomerOrderSummarySchema.parse({ _id: String(row._id), number: row.number, createdAt: iso(row.createdAt),
    status: row.status, type: row.type, pickupSlot: iso(row.pickup?.slot), totalCents: row.totals.total,
    payment: { method: row.payment.method, status: row.payment.status,
      refundedCents: row.payment.refundedCents ?? 0, pendingRefundCents: row.payment.pendingRefundCents ?? 0 } });
}
export function customerOrderDetail(row: Row) {
  return CustomerOrderDetailSchema.parse({ ...customerOrderSummary(row), totals: totals(row),
    lines: row.lines.map(line => ({ name: line.name, variantName: line.variantName ?? null, qty: line.qty,
      unitPrice: line.unitPrice, lineTotal: line.lineTotal,
      options: line.options.map(option => ({ name: option.name, priceDelta: option.priceDelta })),
      removed: [...line.removed], note: line.note ?? null })), note: row.note ?? null,
    statusHistory: row.statusHistory.map(step => ({ status: step.status, at: iso(step.at) })),
    delivery: row.delivery ? { dispatchedAt: iso(row.delivery.dispatchedAt), deliveredAt: iso(row.delivery.deliveredAt),
      estimatedMinutes: row.delivery.estimatedMinutes } : null });
}
const reorderSource = CustomerOrderReorderResponseSchema.omit({ expiresAt: true });
const historicalKey = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 300 ? value : null;
function historicalProductId(value: unknown): string | null {
  if (value instanceof Types.ObjectId) return value.toHexString();
  return typeof value === 'string' && /^[a-f0-9]{24}$/.test(value) ? value : null;
}
/** A source for a new review, not a priced cart or authority to create an order.
 * Never infer missing legacy identifiers from names, or copy private capabilities. */
export function customerOrderReorder(row: Pick<Row, '_id' | 'number' | 'lines'>) {
  return reorderSource.parse({ orderId: String(row._id), number: row.number,
    lines: row.lines.map(line => {
      const variantKey = historicalKey(line.variantKey);
      // Null is also the legitimate base-product selection. Do not erase a
      // malformed historical key into that meaning, or lose a named variant.
      const ambiguousVariant = variantKey === null && (line.variantKey != null || line.variantName != null);
      return { productId: ambiguousVariant ? null : historicalProductId(line.productId), name: line.name,
        variantKey, variantName: line.variantName ?? null, qty: line.qty, unitPrice: line.unitPrice,
        options: (line.options ?? []).map(option => ({ groupKey: historicalKey(option.groupKey), choiceKey: historicalKey(option.choiceKey) })),
        removed: [...(line.removed ?? [])] };
    }) });
}
/** Creation retains the existing one-order tracking capability; history never emits it. */
export function customerOrderCreated(row: Row) {
  const delivery = row.delivery;
  return CustomerOrderCreatedSchema.parse({ _id: String(row._id), number: row.number, status: row.status, type: row.type,
    payment: { method: row.payment.method, status: row.payment.status }, totals: totals(row),
    pickup: row.pickup ? { slot: iso(row.pickup.slot), customerName: row.pickup.customerName } : null,
    trackingToken: row.trackingToken,
    delivery: delivery ? { address: { line1: delivery.address.line1, line2: delivery.address.line2,
      postalCode: delivery.address.postalCode, city: delivery.address.city, country: delivery.address.country },
      instructions: delivery.instructions, zoneId: delivery.zoneId, zoneName: delivery.zoneName,
      feeCents: delivery.feeCents, estimatedMinutes: delivery.estimatedMinutes,
      dispatchedAt: iso(delivery.dispatchedAt), deliveredAt: iso(delivery.deliveredAt), driverName: delivery.driverName ?? null } : null });
}
