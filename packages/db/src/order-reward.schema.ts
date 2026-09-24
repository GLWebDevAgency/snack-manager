import { Query, Schema } from 'mongoose';
import { OrderRewardSnapshotSchema, type OrderRewardSnapshot } from '@sm/contracts';

const options = { _id: false, strict: 'throw' as const };
const text = { type: String, immutable: true, cast: false };
const number = { type: Number, immutable: true, cast: false };
const owner = new Schema({ tenantRef: { ...text, required: true }, parentRef: { ...text, required: true },
  accountId: { ...text, required: true } }, options);
const benefit = new Schema({ rewardId: { ...text, required: true }, name: { ...text, required: true },
  costUnits: { ...number, required: true }, kind: { ...text, required: true }, amountCents: { ...number, required: true },
  productRef: text, policy: { ...text, required: true } }, options);

/** Every persisted leaf is immutable, including dotted document setters.
 * The mutable SQL reconciliation marker is deliberately a separate field. */
export const OrderRewardMongoSchema = new Schema<OrderRewardSnapshot>({
  version: { ...number, required: true }, reservationId: { ...text, required: true }, clientId: { ...text, required: true },
  owner: { type: owner, required: true, immutable: true }, memberId: { ...text, required: true }, programId: { ...text, required: true },
  rulesVersion: { ...number, required: true }, pricingHash: { ...text, required: true },
  benefit: { type: benefit, required: true, immutable: true },
}, options);

function plain(value: unknown): unknown {
  return value !== null && typeof value === 'object' && 'toObject' in value && typeof value.toObject === 'function'
    ? value.toObject({ transform: false }) : value;
}
function checked(value: unknown): OrderRewardSnapshot | null | undefined {
  if (value === null || value === undefined) return value;
  const parsed = OrderRewardSnapshotSchema.safeParse(plain(value));
  if (!parsed.success) throw new Error('Récompense de commande invalide.');
  return parsed.data;
}
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
type OrderContext = { tenantId?: unknown; clientId?: unknown; customerOwner?: unknown; totals?: unknown; channel?: unknown; type?: unknown };
function field(context: OrderContext, key: keyof OrderContext): unknown {
  if (!(context instanceof Query)) return context[key];
  const update = context.getUpdate();
  return (!Array.isArray(update) ? update?.$setOnInsert?.[key] : undefined) ?? context.get(key);
}
function matchesTicket(this: OrderContext, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const parsed = OrderRewardSnapshotSchema.safeParse(plain(value));
  if (!parsed.success) return false;
  const reward = parsed.data;
  const ticketOwner = record(plain(field(this, 'customerOwner')));
  const totals = record(plain(field(this, 'totals')));
  if (!ticketOwner || !totals || field(this, 'channel') !== 'online' || !['pickup', 'delivery'].includes(String(field(this, 'type')))
    || String(field(this, 'tenantId')) !== reward.owner.tenantRef || field(this, 'clientId') !== reward.clientId
    || ticketOwner.tenantRef !== reward.owner.tenantRef || ticketOwner.parentRef !== reward.owner.parentRef
    || ticketOwner.accountId !== reward.owner.accountId) return false;
  const discount = record(plain(totals.discount));
  if (!discount || discount.amount !== reward.benefit.amountCents || discount.promotionId != null) return false;
  if ((reward.benefit.kind === 'product') !== (reward.benefit.productRef !== null)) return false;
  const amounts = [totals.subtotal, discount.amount, totals.deliveryFee ?? 0, totals.total];
  if (!amounts.every(amount => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0)) return false;
  const [subtotal, reduction, delivery, total] = amounts as [number, number, number, number];
  return reduction <= subtotal && BigInt(subtotal) - BigInt(reduction) + BigInt(delivery) === BigInt(total);
}

/** Insert validation checks sibling fields from the actual snapshot, never
 * reconstructs owner/price from a query filter, and grants no SQL authority. */
export function orderRewardField() {
  return { type: OrderRewardMongoSchema, default: null, select: false, immutable: true, set: checked,
    validate: { validator: matchesTicket, message: 'Récompense incohérente avec la commande.' } };
}
