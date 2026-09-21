import { OrderRefundAllocationSchema, OrderRefundJournalSchema, OrderRefundOperationViewSchema, type OrderRefundAllocation } from '@sm/contracts';
import { mutateStoreItem, requireCrossContextStoreLock, type KeyValueStore } from './storage';

export const ORDER_REFUND_STORAGE_KEY = 'sm.order-refunds.v1';
const MAX_INTENTS = 128;
const MAX_JOURNAL_LENGTH = 131_072;
const objectId = /^[a-f0-9]{24}$/;
const ownerIdPattern = /^[a-f0-9]{24}:user:[a-f0-9]{24}$/;
const operationIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Local ownership only. The API remains responsible for authentication and authorization. */
export interface OrderRefundIntent {
  ownerId: string;
  orderId: string;
  operationId: string;
  amountCents: number;
  reason: string;
  allocation?: OrderRefundAllocation | null;
}

export interface OrderRefundAllocationIntent extends OrderRefundIntent {
  kind: 'allocation';
  refundId: string;
  allocation: OrderRefundAllocation;
}
type StoredIntent = OrderRefundIntent | OrderRefundAllocationIntent;
const isAllocation = (intent: StoredIntent): intent is OrderRefundAllocationIntent => 'kind' in intent && intent.kind === 'allocation';

export type OrderRefundIntentRead =
  | { state: 'none' }
  | { state: 'pending'; intent: OrderRefundIntent }
  | { state: 'blocked' };

const storageError = () => new Error('Le journal des remboursements est illisible ou indisponible. Conservez le stockage et vérifiez les demandes avant de continuer.');
const pendingError = () => new Error('Un remboursement reste à vérifier pour cette commande. Reprenez la même demande avant d’en créer une autre.');
const confirmationError = () => new Error('Cette réponse ne confirme pas la demande de remboursement. Conservez la même demande et vérifiez son état.');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertScope(ownerId: unknown, orderId: unknown): void {
  if (typeof ownerId !== 'string' || !ownerIdPattern.test(ownerId)
    || typeof orderId !== 'string' || !objectId.test(orderId)) throw storageError();
}

function parseIntent(value: unknown): StoredIntent {
  if (!isRecord(value)) throw storageError();
  const historical = value.kind === 'allocation';
  const keys = Object.keys(value).sort().join();
  if (historical ? keys !== 'allocation,amountCents,kind,operationId,orderId,ownerId,reason,refundId'
    : !['amountCents,operationId,orderId,ownerId,reason', 'allocation,amountCents,operationId,orderId,ownerId,reason'].includes(keys)) throw storageError();
  assertScope(value.ownerId, value.orderId);
  if (typeof value.operationId !== 'string' || !operationIdPattern.test(value.operationId)
    || typeof value.amountCents !== 'number' || !Number.isSafeInteger(value.amountCents)
    || value.amountCents <= 0 || value.amountCents > 100_000_000
    || typeof value.reason !== 'string' || value.reason !== value.reason.trim()
    || value.reason.length < 3 || value.reason.length > 200) throw storageError();
  const parsed = value.allocation == null ? null : OrderRefundAllocationSchema.safeParse(value.allocation);
  if ((parsed && !parsed.success) || (parsed?.success && parsed.data.merchandiseCents + parsed.data.deliveryCents !== value.amountCents)
    || (historical && (!parsed?.success || typeof value.refundId !== 'string' || !value.refundId.length || value.refundId.length > 255))) throw storageError();
  return { ...(historical ? { kind: 'allocation' as const, refundId: value.refundId as string } : {}),
    ...('allocation' in value ? { allocation: parsed?.success ? parsed.data : null } : {}), ownerId: value.ownerId as string, orderId: value.orderId as string,
    operationId: value.operationId, amountCents: value.amountCents, reason: value.reason };
}

function parseJournal(raw: string | null): StoredIntent[] {
  if (raw === null) return [];
  try {
    if (raw.length > MAX_JOURNAL_LENGTH) throw storageError();
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || Object.keys(value).sort().join() !== 'intents,version'
      || value.version !== 1 || !Array.isArray(value.intents) || value.intents.length > MAX_INTENTS) throw storageError();
    const intents = value.intents.map(parseIntent);
    if (new Set(intents.map(intent => intent.orderId)).size !== intents.length
      || new Set(intents.map(intent => intent.operationId)).size !== intents.length) throw storageError();
    return intents;
  } catch { throw storageError(); }
}

function serialize(intents: StoredIntent[]): string | null {
  if (!intents.length) return null;
  const raw = JSON.stringify({ version: 1, intents });
  if (raw.length > MAX_JOURNAL_LENGTH) throw storageError();
  return raw;
}

function sameIntent(a: StoredIntent, b: StoredIntent): boolean {
  return a.ownerId === b.ownerId && a.orderId === b.orderId && a.operationId === b.operationId
    && a.amountCents === b.amountCents && a.reason === b.reason && sameAllocation(a.allocation, b.allocation)
    && isAllocation(a) === isAllocation(b) && (!isAllocation(a) || (isAllocation(b) && a.refundId === b.refundId));
}

function sameAllocation(a: OrderRefundAllocation | null | undefined, b: OrderRefundAllocation | null | undefined): boolean {
  return a == null ? b == null : b != null && a.version === b.version && a.merchandiseCents === b.merchandiseCents && a.deliveryCents === b.deliveryCents;
}

function requireMutationLock(): void {
  // Native adapters can supply mutateItem (e.g. SQLite). Browser mutations
  // must never fall back to the in-process lock, even with a custom store.
  if (typeof document !== 'undefined') {
    try { requireCrossContextStoreLock(); }
    catch { throw new Error('Ce navigateur ne peut pas sécuriser un remboursement. Utilisez un navigateur compatible sur une connexion sécurisée.'); }
  }
}

/** Use a durable store shared by all authors of the origin/tenant, never an author-specific store. */
export async function readOrderRefundIntent(store: KeyValueStore, ownerId: string, orderId: string): Promise<OrderRefundIntentRead> {
  assertScope(ownerId, orderId);
  let raw: string | null;
  try { raw = await store.getItem(ORDER_REFUND_STORAGE_KEY); }
  catch { throw storageError(); }
  const current = parseJournal(raw).find(intent => intent.orderId === orderId);
  if (!current) return { state: 'none' };
  return current.ownerId === ownerId && !isAllocation(current) ? { state: 'pending', intent: current } : { state: 'blocked' };
}

/** Await this before POST. A missing response never authorizes a new UUID, amount or reason. */
export async function prepareOrderRefundIntent(store: KeyValueStore, intent: OrderRefundIntent): Promise<OrderRefundIntent> {
  requireMutationLock();
  const requested = parseIntent(intent);
  if (isAllocation(requested)) throw storageError();
  return prepareStoredIntent(store, requested) as Promise<OrderRefundIntent>;
}

async function prepareStoredIntent(store: KeyValueStore, requested: StoredIntent): Promise<StoredIntent> {
  return mutateStoreItem(store, ORDER_REFUND_STORAGE_KEY, raw => {
    const intents = parseJournal(raw);
    const current = intents.find(entry => entry.orderId === requested.orderId);
    if (current) {
      if (!sameIntent(current, requested)) throw pendingError();
      return { value: raw, result: current };
    }
    if (intents.length >= MAX_INTENTS || intents.some(entry => entry.operationId === requested.operationId)) throw pendingError();
    return { value: serialize([...intents, requested]), result: requested };
  });
}

/** Only an exact server journal receipt closes local uncertainty. A summary,
 * missing operation or transport error cannot acknowledge this intent.
 * `known` means the provider operation exists, not that its payment succeeded;
 * `withdrawn` is the server tombstone that permanently forbids sending it. */
export async function completeOrderRefundIntent(store: KeyValueStore, intent: OrderRefundIntent, confirmedOperation: unknown): Promise<void> {
  const requested = parseIntent(intent);
  if (isAllocation(requested)) throw confirmationError();
  const parsed = OrderRefundOperationViewSchema.safeParse(confirmedOperation);
  if (!parsed.success
    || !((parsed.data.state === 'known' && parsed.data.providerStatus !== null)
      || (parsed.data.state === 'withdrawn' && parsed.data.providerStatus === null))
    || parsed.data.orderId !== requested.orderId || parsed.data.operationId !== requested.operationId
    || !sameAllocation(parsed.data.allocation, requested.allocation)
    || parsed.data.amountCents !== requested.amountCents || parsed.data.reason !== requested.reason
    || !isRecord(confirmedOperation) || confirmedOperation.reason !== requested.reason) throw confirmationError();
  requireMutationLock();
  await mutateStoreItem(store, ORDER_REFUND_STORAGE_KEY, raw => {
    const intents = parseJournal(raw);
    const current = intents.find(entry => entry.orderId === requested.orderId);
    // Another tab may already have acknowledged this exact receipt. A newer
    // intent (including one belonging to another author) must stay untouched.
    if (current && !sameIntent(current, requested)) throw pendingError();
    return { value: current ? serialize(intents.filter(entry => entry.orderId !== requested.orderId)) : raw,
      result: undefined };
  });
}

/** Historical allocation shares the per-order lock with financial requests. */
export async function readOrderRefundAllocationIntent(store: KeyValueStore, ownerId: string, orderId: string): Promise<
  { state: 'none' } | { state: 'blocked' } | { state: 'pending'; intent: OrderRefundAllocationIntent }
> {
  assertScope(ownerId, orderId);
  let raw: string | null;
  try { raw = await store.getItem(ORDER_REFUND_STORAGE_KEY); } catch { throw storageError(); }
  const current = parseJournal(raw).find(intent => intent.orderId === orderId);
  if (!current) return { state: 'none' };
  return current.ownerId === ownerId && isAllocation(current) ? { state: 'pending', intent: current } : { state: 'blocked' };
}

export async function prepareOrderRefundAllocationIntent(store: KeyValueStore, intent: OrderRefundAllocationIntent): Promise<OrderRefundAllocationIntent> {
  requireMutationLock();
  const requested = parseIntent(intent);
  if (!isAllocation(requested)) throw storageError();
  return prepareStoredIntent(store, requested) as Promise<OrderRefundAllocationIntent>;
}

/** The enclosing journal proves the order scope; a standalone allocation receipt
 * contains no order id and is deliberately insufficient for acknowledgement. */
export async function completeOrderRefundAllocationIntent(store: KeyValueStore, intent: OrderRefundAllocationIntent, confirmedJournal: unknown): Promise<void> {
  const requested = parseIntent(intent);
  const parsed = OrderRefundJournalSchema.safeParse(confirmedJournal);
  if (!isAllocation(requested) || !parsed.success || parsed.data.orderId !== requested.orderId) throw confirmationError();
  const receipt = parsed.data.allocations.find(entry => entry.operationId === requested.operationId);
  const rawReceipt = isRecord(confirmedJournal) && Array.isArray(confirmedJournal.allocations)
    ? confirmedJournal.allocations.find((entry: unknown) => isRecord(entry) && entry.operationId === requested.operationId) : null;
  if (!receipt || receipt.refundId !== requested.refundId || receipt.reason !== requested.reason
    || !isRecord(rawReceipt) || rawReceipt.reason !== requested.reason
    || !sameAllocation(receipt.allocation, requested.allocation)) throw confirmationError();
  requireMutationLock();
  await mutateStoreItem(store, ORDER_REFUND_STORAGE_KEY, raw => {
    const intents = parseJournal(raw);
    const current = intents.find(entry => entry.orderId === requested.orderId);
    if (current && !sameIntent(current, requested)) throw pendingError();
    return { value: current ? serialize(intents.filter(entry => entry.orderId !== requested.orderId)) : raw, result: undefined };
  });
}

/** Explicitly close a losing allocation only after another immutable allocation
 * for the same refund is observed. The server permanently rejects this losing
 * UUID; absence, another refund or an unscoped receipt is never sufficient. */
export async function closeSupersededOrderRefundAllocationIntent(store: KeyValueStore, intent: OrderRefundAllocationIntent, confirmedJournal: unknown): Promise<void> {
  const requested = parseIntent(intent);
  const parsed = OrderRefundJournalSchema.safeParse(confirmedJournal);
  if (!isAllocation(requested) || !parsed.success || parsed.data.orderId !== requested.orderId
    || parsed.data.allocations.some(entry => entry.operationId === requested.operationId)
    || !(parsed.data.allocations.length >= 128 || parsed.data.allocations.some(entry => entry.state === 'recorded' && entry.refundId === requested.refundId && entry.operationId !== requested.operationId))) throw confirmationError();
  requireMutationLock();
  await mutateStoreItem(store, ORDER_REFUND_STORAGE_KEY, raw => {
    const intents = parseJournal(raw);
    const current = intents.find(entry => entry.orderId === requested.orderId);
    if (current && !sameIntent(current, requested)) throw pendingError();
    return { value: current ? serialize(intents.filter(entry => entry.orderId !== requested.orderId)) : raw, result: undefined };
  });
}
