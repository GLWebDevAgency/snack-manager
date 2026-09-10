import { Query, Schema } from 'mongoose';
import { CustomerSaleAttributionSchema as AttributionContract, type CustomerSaleAttribution } from '@sm/contracts';

const options = { _id: false, strict: 'throw' as const };
const text = { type: String, immutable: true, cast: false };
const number = { type: Number, immutable: true, cast: false };
const owner = new Schema({ parentRef: { ...text, required: true }, tenantRef: { ...text, required: true },
  accountId: { ...text, required: true } }, options);
const basis = new Schema({ policyVersion: { ...text, required: true }, eligiblePurchaseCents: { ...number, required: true },
  excludedChargeCents: { ...number, required: true }, chargedTotalCents: { ...number, required: true } }, options);
const rule = new Schema({ mechanism: { ...text, required: true }, minimumPurchaseCents: { ...number, required: true },
  maximumUnitsPerPurchase: number, spendStepCents: number, unitsPerStep: number, unitsPerVisit: number }, options);

/** These nested paths are immutable as well as the parent: a hydrated ticket
 * must not rewrite its historical rule through dotted document setters. */
export const CustomerSaleAttributionMongoSchema = new Schema<CustomerSaleAttribution>({
  version: { ...number, required: true }, tenantRef: { ...text, required: true }, clientId: { ...text, required: true },
  owner: { type: owner, required: true, immutable: true }, capturedAt: { ...number, required: true },
  basis: { type: basis, required: true, immutable: true }, decision: { ...text, required: true }, reason: text,
  memberId: text, membershipOperationId: text, programId: text, rulesVersion: number,
  rule: { type: rule, immutable: true },
}, options);

function plain(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'toObject' in value && typeof value.toObject === 'function'
    ? value.toObject({ transform: false }) : value;
}
function checked(value: unknown): CustomerSaleAttribution | null | undefined {
  if (value === null || value === undefined) return value;
  const parsed = AttributionContract.safeParse(plain(value));
  if (!parsed.success) throw new Error('Attribution de fidélité invalide.');
  return parsed.data;
}
type OrderContext = { tenantId?: unknown; clientId?: unknown; customerOwner?: unknown; totals?: unknown };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
function field(context: OrderContext, key: keyof OrderContext): unknown {
  if (!(context instanceof Query)) return context[key];
  const update = context.getUpdate();
  return (!Array.isArray(update) ? update?.$setOnInsert?.[key] : undefined) ?? context.get(key);
}
function matchesTicket(this: OrderContext, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const parsed = AttributionContract.safeParse(plain(value));
  if (!parsed.success) return false;
  const snapshot = parsed.data;
  const ticketOwner = record(plain(field(this, 'customerOwner')));
  const totals = record(plain(field(this, 'totals')));
  if (!ticketOwner || !totals || String(field(this, 'tenantId')) !== snapshot.tenantRef || field(this, 'clientId') !== snapshot.clientId
    || ticketOwner.parentRef !== snapshot.owner.parentRef || ticketOwner.tenantRef !== snapshot.owner.tenantRef
    || ticketOwner.accountId !== snapshot.owner.accountId) return false;
  const discount = totals.discount == null ? 0 : record(plain(totals.discount))?.amount;
  const amounts = [totals.subtotal, discount, totals.deliveryFee ?? 0, totals.total];
  if (!amounts.every(amount => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)) return false;
  const [subtotal, reduction, delivery, total] = amounts as [number, number, number, number];
  if (reduction > subtotal) return false;
  return BigInt(subtotal) - BigInt(reduction) === BigInt(snapshot.basis.eligiblePurchaseCents)
    && delivery === snapshot.basis.excludedChargeCents && total === snapshot.basis.chargedTotalCents;
}

/** New server-priced tickets only. ODM guards are not cross-store authority:
 * only the protected SQL reader may construct this snapshot. Query validation
 * also checks $setOnInsert siblings; it never infers ownership from a filter. */
export function customerSaleAttributionField() {
  return { type: CustomerSaleAttributionMongoSchema, default: null, select: false, immutable: true, set: checked,
    validate: { validator: matchesTicket, message: 'Attribution de fidélité incohérente avec la commande.' } };
}
