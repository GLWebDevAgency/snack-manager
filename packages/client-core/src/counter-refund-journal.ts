import { CounterRefundIntentSchema, CounterRefundJournalSchema, type CounterRefundIntent, type CounterRefundJournal } from '@sm/contracts';
import { mutateStoreItem, requireCrossContextStoreLock, type KeyValueStore } from './storage';

export const COUNTER_REFUND_STORAGE_KEY = 'sm.counter-refunds.v1';
const ownerPattern = /^[a-f0-9]{24}:(?:user|staff):[a-f0-9]{24}$/;
const orderPattern = /^[a-f0-9]{24}$/;
export type CounterRefundLocalPhase = 'prepared' | 'start_requested' | 'confirm_requested' | 'withdraw_requested' | 'no_effect_requested';
export interface CounterRefundLocalIntent {
  ownerId: string;
  orderId: string;
  body: CounterRefundIntent;
  phase: CounterRefundLocalPhase;
  resolutionReason?: string;
}
const storageError = () => new Error('Le journal des remboursements comptoir est indisponible. Conservez le stockage et vérifiez les demandes.');
const conflict = () => new Error('Un remboursement reste à vérifier pour cette commande. Reprenez la même demande.');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function scope(ownerId: string, orderId?: string) {
  if (!ownerPattern.test(ownerId) || (orderId !== undefined && !orderPattern.test(orderId))) throw storageError();
}
function parse(value: unknown): CounterRefundLocalIntent {
  if (!object(value) || !['body,orderId,ownerId,phase', 'body,orderId,ownerId,phase,resolutionReason'].includes(Object.keys(value).sort().join())
    || typeof value.ownerId !== 'string' || typeof value.orderId !== 'string'
    || !['prepared', 'start_requested', 'confirm_requested', 'withdraw_requested', 'no_effect_requested'].includes(String(value.phase))) throw storageError();
  scope(value.ownerId, value.orderId);
  const body = CounterRefundIntentSchema.safeParse(value.body);
  if (!body.success || !object(value.body) || value.body.reason !== body.data.reason) throw storageError();
  const resolution = value.phase === 'no_effect_requested';
  if (resolution ? typeof value.resolutionReason !== 'string' || value.resolutionReason !== value.resolutionReason.trim()
    || value.resolutionReason.length < 3 || value.resolutionReason.length > 200 : value.resolutionReason !== undefined) throw storageError();
  return { ownerId: value.ownerId, orderId: value.orderId, body: body.data, phase: value.phase as CounterRefundLocalPhase,
    ...(resolution ? { resolutionReason: value.resolutionReason as string } : {}) };
}
function parseJournal(raw: string | null): CounterRefundLocalIntent[] {
  if (raw === null) return [];
  try {
    if (raw.length > 131_072) throw storageError();
    const data: unknown = JSON.parse(raw);
    if (!object(data) || Object.keys(data).sort().join() !== 'intents,version' || data.version !== 1
      || !Array.isArray(data.intents) || data.intents.length > 128) throw storageError();
    const intents = data.intents.map(parse);
    const main = intents.filter(intent => intent.phase !== 'no_effect_requested');
    if (new Set(main.map(intent => intent.orderId)).size !== main.length
      || new Set(intents.map(intent => `${intent.ownerId}:${intent.orderId}:${intent.phase === 'no_effect_requested'}`)).size !== intents.length) throw storageError();
    for (const intent of intents) if (intents.some(other => other !== intent && other.body.operationId === intent.body.operationId
      && (other.orderId !== intent.orderId || !sameBody(other.body, intent.body)))) throw storageError();
    return intents;
  } catch { throw storageError(); }
}
function serialize(intents: CounterRefundLocalIntent[]): string | null {
  if (!intents.length) return null;
  const raw = JSON.stringify({ version: 1, intents });
  if (intents.length > 128 || raw.length > 131_072) throw storageError();
  return raw;
}
function lock() { if (typeof document !== 'undefined') requireCrossContextStoreLock(); }
function sameBody(a: CounterRefundIntent, b: CounterRefundIntent) {
  return a.operationId === b.operationId && a.amountCents === b.amountCents && a.reason === b.reason && a.tender === b.tender
    && a.allocation.version === b.allocation.version && a.allocation.merchandiseCents === b.allocation.merchandiseCents
    && a.allocation.deliveryCents === b.allocation.deliveryCents;
}
const same = (a: CounterRefundLocalIntent, b: CounterRefundLocalIntent) => a.ownerId === b.ownerId && a.orderId === b.orderId
  && sameBody(a.body, b.body) && a.phase === b.phase && a.resolutionReason === b.resolutionReason;
async function readAll(store: KeyValueStore) {
  try { return parseJournal(await store.getItem(COUNTER_REFUND_STORAGE_KEY)); } catch { throw storageError(); }
}
/** The tenant-scoped store is shared across staff, never scoped to an author. */
export async function readCounterRefundIntents(store: KeyValueStore, ownerId: string): Promise<CounterRefundLocalIntent[]> {
  scope(ownerId); return (await readAll(store)).filter(intent => intent.ownerId === ownerId);
}
export async function readCounterRefundIntent(store: KeyValueStore, ownerId: string, orderId: string): Promise<
  { state: 'none' } | { state: 'blocked' } | { state: 'pending'; intent: CounterRefundLocalIntent }
> {
  scope(ownerId, orderId); const rows = (await readAll(store)).filter(intent => intent.orderId === orderId);
  const own = rows.find(intent => intent.ownerId === ownerId && intent.phase === 'no_effect_requested')
    ?? rows.find(intent => intent.ownerId === ownerId);
  return own ? { state: 'pending', intent: own } : rows.length ? { state: 'blocked' } : { state: 'none' };
}
/** Commit before prepare POST; credentials and permission to disburse are never journaled. */
export async function prepareCounterRefundIntent(store: KeyValueStore, input: CounterRefundLocalIntent): Promise<CounterRefundLocalIntent> {
  const next = parse(input); lock();
  if (next.phase !== 'prepared') throw conflict();
  return mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw), current = rows.find(row => row.orderId === next.orderId);
    if (current) { if (!same(current, next)) throw conflict(); return { value: raw, result: current }; }
    if (rows.some(row => row.body.operationId === next.body.operationId)) throw conflict();
    return { value: serialize([...rows, next]), result: next };
  });
}
/** Explicit recovery from this author's fresh server journal on another device.
 * Adoption never grants a physical right or rolls back a local uncertainty. */
export async function adoptCounterRefundIntent(store: KeyValueStore, ownerId: string, orderId: string,
  operationId: string, serverJournal: unknown): Promise<CounterRefundLocalIntent> {
  scope(ownerId, orderId);
  const view = CounterRefundJournalSchema.parse(serverJournal);
  const operation = view.operations.find(row => row.operationId === operationId);
  if (view.orderId !== orderId || !operation?.canResume || !['prepared', 'started'].includes(operation.state)) throw conflict();
  const next = parse({ ownerId, orderId, phase: operation.state === 'started' ? 'start_requested' : 'prepared',
    body: { operationId: operation.operationId, amountCents: operation.amountCents, reason: operation.reason,
      tender: operation.tender, allocation: operation.allocation } });
  lock();
  return mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw), current = rows.find(row => row.orderId === orderId);
    if (current) {
      if (current.ownerId !== ownerId || current.phase === 'no_effect_requested' || !sameBody(current.body, next.body)) throw conflict();
      return { value: raw, result: current };
    }
    if (rows.some(row => row.body.operationId === operationId)) throw conflict();
    return { value: serialize([...rows, next]), result: next };
  });
}
/** Persist every uncertainty phase before its POST. Never move backwards. */
export async function markCounterRefundIntent(store: KeyValueStore, input: CounterRefundLocalIntent,
  phase: 'start_requested' | 'confirm_requested' | 'withdraw_requested'): Promise<CounterRefundLocalIntent> {
  const before = parse(input), next = parse({ ...before, phase }); lock();
  const allowed = before.phase === phase || (before.phase === 'prepared' && (phase === 'start_requested' || phase === 'withdraw_requested'))
    || (before.phase === 'start_requested' && phase === 'confirm_requested');
  if (!allowed) throw conflict();
  return mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw), current = rows.find(row => row.orderId === before.orderId && row.ownerId === before.ownerId && row.phase !== 'no_effect_requested');
    if (!current || !same(current, before)) throw conflict();
    return { value: serialize(rows.map(row => row === current ? next : row)), result: next };
  });
}
/** An owner decision is a separate local intention; it never transfers the
 * initial author's refund. The API alone grants that responsible authority. */
export async function prepareCounterRefundNoEffect(store: KeyValueStore, input: CounterRefundLocalIntent, serverJournal: unknown): Promise<CounterRefundLocalIntent> {
  const next = parse(input), view = CounterRefundJournalSchema.parse(serverJournal); lock();
  if (next.phase !== 'no_effect_requested' || view.orderId !== next.orderId || !view.canResolveNoEffect
    || !view.operations.some(op => op.state === 'started' && sameBody(op, next.body))) throw conflict();
  return mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw), current = rows.find(row => row.ownerId === next.ownerId && row.orderId === next.orderId && row.phase === 'no_effect_requested');
    if (current) { if (!same(current, next)) throw conflict(); return { value: raw, result: current }; }
    if (rows.some(row => row.orderId === next.orderId && !sameBody(row.body, next.body))) throw conflict();
    return { value: serialize([...rows, next]), result: next };
  });
}
/** Terminal server proof can settle an old author's journal after an owner
 * resolution, but absence, prepared and started never authorize deletion. */
export async function reconcileCounterRefundJournal(store: KeyValueStore, orderId: string, rawView: unknown): Promise<CounterRefundJournal> {
  if (!orderPattern.test(orderId)) throw storageError();
  const view = CounterRefundJournalSchema.parse(rawView); lock();
  if (view.orderId !== orderId || !object(rawView) || !Array.isArray(rawView.operations)) throw conflict();
  const rawOperations = rawView.operations;
  await mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw);
    const keep = rows.filter(row => {
      if (row.orderId !== orderId) return true;
      const receipt = view.operations.find(op => sameBody(op, row.body));
      const source = rawOperations.find(op => object(op) && op.operationId === row.body.operationId);
      if (!receipt || !['confirmed', 'withdrawn', 'not_executed'].includes(receipt.state) || !object(source) || source.reason !== row.body.reason) return true;
      // A competing owner's different decision can be displayed, but is not
      // silently acknowledged as our own resolution request.
      return row.phase === 'no_effect_requested' && receipt.state === 'not_executed'
        && (receipt.resolutionReason !== row.resolutionReason || source.resolutionReason !== row.resolutionReason);
    });
    return { value: keep.length === rows.length ? raw : serialize(keep), result: undefined };
  });
  return view;
}
export async function assertCounterRefundsSettled(store: KeyValueStore): Promise<void> {
  if ((await readAll(store)).length) throw new Error('Un remboursement comptoir reste à vérifier. Conservez son journal avant de changer d’établissement.');
}
/** Explicit dismissal of a losing owner decision. The original refund UUID is
 * already terminal, so no delayed request can create another physical right. */
export async function closeSupersededCounterRefundResolution(store: KeyValueStore, input: CounterRefundLocalIntent, rawView: unknown): Promise<void> {
  const intent = parse(input), view = CounterRefundJournalSchema.parse(rawView); lock();
  if (intent.phase !== 'no_effect_requested' || view.orderId !== intent.orderId || !object(rawView) || !Array.isArray(rawView.operations)
    || !view.operations.some(op => sameBody(op, intent.body) && ['confirmed', 'withdrawn', 'not_executed'].includes(op.state))
    || !rawView.operations.some(op => object(op) && op.operationId === intent.body.operationId && op.reason === intent.body.reason)) throw conflict();
  await mutateStoreItem(store, COUNTER_REFUND_STORAGE_KEY, raw => {
    const rows = parseJournal(raw), current = rows.find(row => row.ownerId === intent.ownerId && row.orderId === intent.orderId && row.phase === 'no_effect_requested');
    if (current && !same(current, intent)) throw conflict();
    return { value: current ? serialize(rows.filter(row => row !== current)) : raw, result: undefined };
  });
}
