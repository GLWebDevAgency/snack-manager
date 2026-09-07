import {
  DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionResultSchema, DeliveryMissionViewSchema,
  type DeliveryMissionAssign, type DeliveryMissionDispatch, type DeliveryMissionView,
} from "@sm/contracts";

export const MISSION_ASSIGNMENT_REASONS = ["Organisation de la tournée", "Changement de livreur", "Retrait de l’affectation"] as const;
type Store = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
export type MissionOperation = {
  v: 1; scope: string; missionId: string; kind: "assignment" | "dispatch";
  body: DeliveryMissionAssign | DeliveryMissionDispatch;
};
const PREFIX = "sm.delivery-mission.v1.";
const storageError = () => new Error("La sauvegarde de l’action est indisponible. Aucun nouveau départ ni changement d’affectation n’est envoyé.");
const scopeValid = (scope: string) => /^(?:bo:[a-f0-9]{24}:(?:user|staff):[a-f0-9]{24}|driver:[a-z0-9][a-z0-9_-]{0,99}:[a-f0-9]{24})$/.test(scope);
function prefix(scope: string) {
  if (!scopeValid(scope)) throw storageError();
  return `${PREFIX}${scope}.`;
}
function parse(value: unknown, scope: string): MissionOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw storageError();
  const record = value as MissionOperation;
  if (Object.keys(record).sort().join() !== "body,kind,missionId,scope,v" || record.v !== 1 || record.scope !== scope || !/^[a-f0-9]{24}$/.test(record.missionId)) throw storageError();
  const body = record.kind === "dispatch" ? DeliveryMissionDispatchSchema.parse(record.body)
    : record.kind === "assignment" ? DeliveryMissionAssignSchema.parse(record.body) : null;
  if (!body || ("reason" in body && !MISSION_ASSIGNMENT_REASONS.some(reason => reason === body.reason))) throw storageError();
  return { v: 1, scope, missionId: record.missionId, kind: record.kind, body };
}

/** Only an operation's IDs/revisions and a fixed reason: never a customer, address or cookie.
 * No TTL: elapsed time cannot prove whether a server mutation was committed.
 */
export function readMissionOperations(storage: Store, scope: string): MissionOperation[] {
  try {
    const namespace = prefix(scope);
    const operations: MissionOperation[] = [];
    if (storage.length > 10_000) throw storageError();
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(namespace)) continue;
      const raw = storage.getItem(key);
      if (!raw || raw.length > 2_048 || operations.length >= 128) throw storageError();
      const found = parse(JSON.parse(raw), scope);
      if (key !== `${namespace}${found.missionId}`) throw storageError();
      operations.push(found);
    }
    return operations;
  } catch { throw storageError(); }
}
export function readMissionOperation(storage: Store, scope: string, missionId?: string): MissionOperation | null {
  return readMissionOperations(storage, scope).find(operation => !missionId || operation.missionId === missionId) ?? null;
}

export function prepareMissionOperation(storage: Store, scope: string, missionId: string, kind: MissionOperation["kind"], body: MissionOperation["body"]): MissionOperation {
  const requested = parse({ v: 1, scope, missionId, kind, body }, scope);
  const existing = readMissionOperations(storage, scope);
  const current = existing.find(operation => operation.missionId === missionId);
  if (current) {
    if (JSON.stringify(current) !== JSON.stringify(requested)) throw new Error("Une action reste à vérifier. Reprenez-la avant d’en lancer une autre.");
    return current;
  }
  if (existing.length >= 128) throw new Error("Trop d’actions restent à vérifier. Reprenez les actions existantes avant d’en ajouter une autre.");
  try {
    storage.setItem(`${prefix(scope)}${missionId}`, JSON.stringify(requested));
    if (JSON.stringify(readMissionOperation(storage, scope, missionId)) !== JSON.stringify(requested)) throw storageError();
    return requested;
  } catch { throw storageError(); }
}

function remove(storage: Store, operation: MissionOperation) {
  const current = readMissionOperation(storage, operation.scope, operation.missionId);
  if (!current || JSON.stringify(current) !== JSON.stringify(operation)) throw storageError();
  try { storage.removeItem(`${prefix(operation.scope)}${operation.missionId}`); }
  catch { throw storageError(); }
}

export function completeMissionOperation(storage: Store, operation: MissionOperation, raw: unknown) {
  const result = DeliveryMissionResultSchema.parse(raw);
  if (result.operationId !== operation.body.operationId || result.mission.id !== operation.missionId
    || result.appliedRevision <= operation.body.expectedRevision || result.mission.revision < result.appliedRevision) throw new Error("La réponse ne permet pas de confirmer cette action. Reprenez la même vérification.");
  remove(storage, operation);
  return result;
}

/** A bare 409/404 or GET does not resolve a lost write. Only this explicit conflict + newer view does. */
export function releaseChangedMissionOperation(storage: Store, operation: MissionOperation, code: string, raw: unknown): DeliveryMissionView {
  const mission = DeliveryMissionViewSchema.parse(raw);
  if (code !== "DELIVERY_MISSION_CHANGED" || mission.id !== operation.missionId || mission.revision <= operation.body.expectedRevision) throw new Error("L’action reste à vérifier. Aucun nouveau geste n’est autorisé pour le moment.");
  remove(storage, operation);
  return mission;
}

export class MissionHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function missionRequest(path: string, body?: DeliveryMissionDispatch): Promise<unknown> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(12_000),
  });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = raw && typeof raw === "object" && "code" in raw && typeof raw.code === "string" ? raw.code : "UNKNOWN";
    throw new MissionHttpError(response.status, code, response.status === 401 ? "Votre accès a été retiré ou a expiré."
      : response.status === 404 ? "Cette mission n’est plus disponible pour votre accès."
        : response.status === 409 ? "Cette mission a changé. Son état doit être vérifié avant de continuer."
          : response.status === 429 ? "Trop de demandes. Patientez avant de réessayer."
            : "La réponse n’est pas confirmée. Vérifiez votre connexion puis reprenez la même action.");
  }
  return raw;
}
