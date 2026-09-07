import { DeliveryHandoffResolveSchema, DeliveryHandoffResultSchema, type DeliveryHandoffResolve } from "@sm/contracts";

export type HandoffStore = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type HandoffOperation = Readonly<{ v: 1; scope: string; missionId: string; operation: DeliveryHandoffResolve }>;
const PREFIX = "sm.delivery-handoff.v1.";
const SCOPE = /^(?:bo:[a-f0-9]{24}:(?:user|staff):[a-f0-9]{24}|driver:[a-z0-9][a-z0-9_-]{0,99}:[a-f0-9]{24})$/;
const ID = /^[a-f0-9]{24}$/;
export const HANDOFF_JOURNAL_EVENT = "sm:delivery-handoff-change";
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event(HANDOFF_JOURNAL_EVENT)); }
const storageError = () => new Error("La sauvegarde de l’action est indisponible. Aucun nouvel envoi n’est autorisé.");
function namespace(scope: string) {
  if (!SCOPE.test(scope)) throw storageError();
  return `${PREFIX}${scope}.`;
}
function parse(raw: unknown, scope: string): HandoffOperation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw storageError();
  const value = raw as HandoffOperation;
  if (Object.keys(value).sort().join() !== "missionId,operation,scope,v" || value.v !== 1 || value.scope !== scope || !ID.test(value.missionId)) throw storageError();
  const operation = DeliveryHandoffResolveSchema.parse(value.operation);
  return Object.freeze({ v: 1, scope, missionId: value.missionId, operation: Object.freeze(operation) });
}

/** Only IDs, revisions and action survive reload. No PIN/hash/QR/reason/customer.
 * No timer or GET absence can discard a request that may already have committed.
 */
export function readHandoffOperations(storage: HandoffStore, scope: string): HandoffOperation[] {
  try {
    const prefix = namespace(scope);
    if (storage.length > 10_000) throw storageError();
    const result: HandoffOperation[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (!raw || raw.length > 1_024 || result.length >= 128) throw storageError();
      const entry = parse(JSON.parse(raw), scope);
      if (key !== `${prefix}${entry.missionId}`) throw storageError();
      result.push(entry);
    }
    return result;
  } catch { throw storageError(); }
}

export function prepareHandoffOperation(storage: HandoffStore, scope: string, missionId: string, operation: DeliveryHandoffResolve): HandoffOperation {
  const wanted = parse({ v: 1, scope, missionId, operation }, scope);
  const all = readHandoffOperations(storage, scope);
  const existing = all.find(entry => entry.missionId === missionId);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(wanted)) throw new Error("Une action reste à vérifier pour cette commande. Vérifiez-la avant un nouveau geste.");
    return existing;
  }
  if (all.length >= 128) throw new Error("Trop d’actions restent à vérifier. Reprenez les actions précédentes avant de continuer.");
  try {
    storage.setItem(`${namespace(scope)}${missionId}`, JSON.stringify(wanted));
    if (JSON.stringify(readHandoffOperations(storage, scope).find(entry => entry.missionId === missionId)) !== JSON.stringify(wanted)) throw storageError();
    changed();
    return wanted;
  } catch { throw storageError(); }
}

export function completeHandoffOperation(storage: HandoffStore, operation: HandoffOperation, raw: unknown) {
  const result = DeliveryHandoffResultSchema.parse(raw);
  if (result.missionId !== operation.missionId || result.state.missionId !== operation.missionId
    || result.operationId !== operation.operation.operationId || result.action !== operation.operation.action
    || result.appliedRevision <= operation.operation.expectedRevision || result.state.revision < result.appliedRevision) {
    throw new Error("La réponse ne confirme pas cette action. Vérifiez la même référence sans recommencer la remise.");
  }
  const current = readHandoffOperations(storage, operation.scope).find(entry => entry.missionId === operation.missionId);
  if (JSON.stringify(current) !== JSON.stringify(operation)) throw storageError();
  try { storage.removeItem(`${namespace(operation.scope)}${operation.missionId}`); }
  catch { throw storageError(); }
  changed();
  return result;
}
