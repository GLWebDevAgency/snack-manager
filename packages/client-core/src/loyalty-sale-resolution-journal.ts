import { LoyaltySaleResolutionIntentSchema, LoyaltySaleSettlementSchema, type LoyaltySaleResolutionIntent } from '@sm/contracts';
import { mutateStoreItem, requireCrossContextStoreLock, type KeyValueStore } from './storage';

export const LOYALTY_SALE_RESOLUTION_STORAGE_KEY = 'sm.loyalty-sale-resolutions.v1';
export interface LoyaltySaleResolutionLocalIntent { ownerId: string; orderId: string; dueUnits: number; request: LoyaltySaleResolutionIntent }
const invalid = () => new Error('Le journal des décisions fidélité doit être vérifié avant de continuer.');
const conflict = () => new Error('Une décision reste à vérifier pour cette vente. Conservez la même demande.');
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function scope(ownerId: string, orderId: string) {
  if (!/^[a-f0-9]{24}:user:[a-f0-9]{24}$/.test(ownerId) || !/^[a-f0-9]{24}$/.test(orderId)) throw invalid();
}
function parse(value: unknown): LoyaltySaleResolutionLocalIntent {
  if (!record(value) || Object.keys(value).sort().join() !== 'dueUnits,orderId,ownerId,request'
    || typeof value.dueUnits !== 'number' || !Number.isSafeInteger(value.dueUnits) || value.dueUnits <= 0
    || typeof value.ownerId !== 'string' || typeof value.orderId !== 'string') throw invalid();
  scope(value.ownerId, value.orderId);
  const request = LoyaltySaleResolutionIntentSchema.safeParse(value.request);
  if (!request.success || !record(value.request) || value.request.reason !== request.data.reason) throw invalid();
  return { ownerId: value.ownerId, orderId: value.orderId, dueUnits: value.dueUnits, request: request.data };
}
function read(raw: string | null): LoyaltySaleResolutionLocalIntent[] {
  if (raw === null) return [];
  try {
    if (raw.length > 131_072) throw invalid();
    const body: unknown = JSON.parse(raw);
    if (!record(body) || Object.keys(body).sort().join() !== 'intents,version' || body.version !== 1 || !Array.isArray(body.intents) || body.intents.length > 128) throw invalid();
    const intents = body.intents.map(parse);
    if (new Set(intents.map(intent => intent.orderId)).size !== intents.length || new Set(intents.map(intent => intent.request.operationId)).size !== intents.length) throw invalid();
    return intents;
  } catch { throw invalid(); }
}
function serialize(intents: LoyaltySaleResolutionLocalIntent[]): string | null {
  if (!intents.length) return null;
  const raw = JSON.stringify({ version: 1, intents }); if (raw.length > 131_072) throw invalid(); return raw;
}
const same = (a: LoyaltySaleResolutionLocalIntent, b: LoyaltySaleResolutionLocalIntent) => JSON.stringify(a) === JSON.stringify(b);
const lock = () => { if (typeof document !== 'undefined') requireCrossContextStoreLock(); };
export async function readLoyaltySaleResolutionIntent(store: KeyValueStore, ownerId: string, orderId: string): Promise<
  { state: 'none' } | { state: 'blocked' } | { state: 'pending'; intent: LoyaltySaleResolutionLocalIntent }
> {
  scope(ownerId, orderId);
  const found = read(await store.getItem(LOYALTY_SALE_RESOLUTION_STORAGE_KEY)).find(intent => intent.orderId === orderId);
  return !found ? { state: 'none' } : found.ownerId === ownerId ? { state: 'pending', intent: found } : { state: 'blocked' };
}
export async function prepareLoyaltySaleResolutionIntent(store: KeyValueStore, intent: LoyaltySaleResolutionLocalIntent): Promise<LoyaltySaleResolutionLocalIntent> {
  const requested = parse(intent); lock();
  return mutateStoreItem(store, LOYALTY_SALE_RESOLUTION_STORAGE_KEY, raw => {
    const intents = read(raw), current = intents.find(entry => entry.orderId === requested.orderId);
    if (current) { if (!same(current, requested)) throw conflict(); return { value: raw, result: current }; }
    if (intents.length >= 128 || intents.some(entry => entry.request.operationId === requested.request.operationId)) throw conflict();
    return { value: serialize([...intents, requested]), result: requested };
  });
}
export async function completeLoyaltySaleResolutionIntent(store: KeyValueStore, intent: LoyaltySaleResolutionLocalIntent, serverView: unknown): Promise<void> {
  const requested = parse(intent), view = LoyaltySaleSettlementSchema.safeParse(serverView);
  if (!view.success || view.data.orderId !== requested.orderId || !view.data.resolutions.some(receipt =>
    JSON.stringify(receipt.request) === JSON.stringify(requested.request))) throw invalid();
  // Receipt text is immutable. Do not acknowledge a different raw request just
  // because transport normalization trims it into the local intent.
  if (!record(serverView) || !Array.isArray(serverView.resolutions) || !serverView.resolutions.some(receipt =>
    record(receipt) && record(receipt.request) && receipt.request.operationId === requested.request.operationId
    && receipt.request.reason === requested.request.reason)) throw invalid();
  lock();
  await mutateStoreItem(store, LOYALTY_SALE_RESOLUTION_STORAGE_KEY, raw => {
    const intents = read(raw), current = intents.find(entry => entry.orderId === requested.orderId);
    if (current && !same(current, requested)) throw conflict();
    return { value: current ? serialize(intents.filter(entry => entry.orderId !== requested.orderId)) : raw, result: undefined };
  });
}

/** A strictly newer immutable SQL version makes an unreceived old CAS decision
 * inapplicable forever. Closing it is explicit and does not waive any points. */
export async function closeSupersededLoyaltySaleResolutionIntent(store: KeyValueStore, intent: LoyaltySaleResolutionLocalIntent, serverView: unknown): Promise<void> {
  const requested = parse(intent), view = LoyaltySaleSettlementSchema.safeParse(serverView);
  if (!view.success || view.data.orderId !== requested.orderId || view.data.caseId !== requested.request.caseId
    || view.data.version === null || view.data.version <= requested.request.expectedVersion
    || view.data.resolutions.some(receipt => receipt.request.operationId === requested.request.operationId)) throw invalid();
  lock();
  await mutateStoreItem(store, LOYALTY_SALE_RESOLUTION_STORAGE_KEY, raw => {
    const intents = read(raw), current = intents.find(entry => entry.orderId === requested.orderId);
    if (current && !same(current, requested)) throw conflict();
    return { value: current ? serialize(intents.filter(entry => entry.orderId !== requested.orderId)) : raw, result: undefined };
  });
}
