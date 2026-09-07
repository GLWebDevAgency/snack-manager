import {
  DeliveryAccessSecretSchema,
  DeliveryOperatorCreateSchema,
  DeliveryOperatorInvitationSchema,
  type DeliveryOperatorCreate,
  type DeliveryOperatorView,
  type DeliveryOperatorsView,
} from "@sm/contracts";

export const DELIVERY_OPERATOR_ATTEMPT_TTL_MS = 30 * 60 * 1000;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type DeliveryOperatorAttempt = {
  v: 1;
  tenantId: string;
  createdAt: number;
  request: DeliveryOperatorCreate;
};
const storageError = () => new Error("Le stockage sécurisé de cette demande est indisponible. Aucun nouvel ajout n’est envoyé. Vérifiez l’annuaire avant de réessayer.");
function key(tenantId: string) {
  if (!/^[a-f0-9]{24}$/.test(tenantId)) throw storageError();
  return `sm.delivery-operator-create.v1.${tenantId}`;
}

/** Session storage only: one tenant-scoped, bounded request; never an invitation secret. */
export function readDeliveryOperatorAttempt(storage: StoragePort, tenantId: string): DeliveryOperatorAttempt | null {
  try {
    const raw = storage.getItem(key(tenantId));
    if (raw === null) return null;
    if (raw.length > 2048) throw storageError();
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== "createdAt,request,tenantId,v" || value.v !== 1 || value.tenantId !== tenantId || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw storageError();
    return { v: 1, tenantId, createdAt: value.createdAt, request: DeliveryOperatorCreateSchema.parse(value.request) };
  } catch { throw storageError(); }
}

export function saveDeliveryOperatorAttempt(storage: StoragePort, tenantId: string, input: DeliveryOperatorCreate, now = Date.now()): DeliveryOperatorAttempt {
  const request = DeliveryOperatorCreateSchema.parse(input);
  const current = readDeliveryOperatorAttempt(storage, tenantId);
  if (current) {
    if (JSON.stringify(current.request) !== JSON.stringify(request)) throw new Error("Une demande doit encore être vérifiée. Reprenez-la avant d’ajouter un autre livreur.");
    return current;
  }
  try {
    if (!Number.isSafeInteger(now) || now < 0) throw storageError();
    const attempt: DeliveryOperatorAttempt = { v: 1, tenantId, createdAt: now, request };
    storage.setItem(key(tenantId), JSON.stringify(attempt));
    return attempt;
  } catch { throw storageError(); }
}

/** A response lost in flight never authorizes clearing by itself. */
export function removeDeliveryOperatorAttempt(storage: StoragePort, tenantId: string, requestId: string): void {
  const current = readDeliveryOperatorAttempt(storage, tenantId);
  if (!current) return;
  if (current.request.requestId !== requestId) throw new Error("Une autre demande est enregistrée. Actualisez l’annuaire.");
  try { storage.removeItem(key(tenantId)); } catch { throw storageError(); }
}

/** Expiry asks for a fresh review; it never silently creates a replacement UUID. */
export function isDeliveryOperatorAttemptExpired(attempt: DeliveryOperatorAttempt, now = Date.now()): boolean {
  return now - attempt.createdAt >= DELIVERY_OPERATOR_ATTEMPT_TTL_MS || attempt.createdAt > now + 5000;
}

export function deliveryApplicationUrl(platformUrl: string): URL {
  const base = new URL(platformUrl);
  if (base.username || base.password || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))) throw new Error("L’adresse de l’application livreur n’est pas configurée correctement.");
  return new URL("/livreur", base.origin);
}

export function deliveryInvitationLink(platformUrl: string, token: string): string {
  DeliveryAccessSecretSchema.parse(token);
  const url = deliveryApplicationUrl(platformUrl);
  url.hash = `invitation=${token}`;
  return url.toString();
}

export function parseDeliveryInvitation(input: unknown, operatorId: string, now = Date.now()) {
  const result = DeliveryOperatorInvitationSchema.parse(input);
  if (result.operator.id !== operatorId || !result.operator.effectiveActive || result.operator.inviteExpiresAt !== result.expiresAt || Date.parse(result.expiresAt) <= now) throw new Error("Ce lien d’association n’est plus utilisable. Actualisez l’annuaire puis générez un nouveau lien.");
  return result;
}

export function deliveryOperatorStatus(operator: DeliveryOperatorView): { label: string; tone: "ok" | "waiting" | "muted"; detail: string } {
  if (!operator.active) return { label: "Accès révoqué", tone: "muted", detail: "Aucun téléphone ne peut utiliser cet accès." };
  if (operator.blockedReason === "staff_inactive") return { label: "Équipier inactif", tone: "waiting", detail: "L’accès reste bloqué tant que cet équipier est inactif." };
  if (operator.blockedReason === "staff_changed") return { label: "Habilitation à renouveler", tone: "waiting", detail: "La fiche équipier a changé. Confirmez de nouveau son habilitation avant d’associer un téléphone." };
  if (operator.sessionState === "connected") return { label: "Téléphone associé", tone: "ok", detail: "Cette association ne signale ni présence en ligne ni position GPS." };
  if (operator.sessionState === "expired") return { label: "Association expirée", tone: "waiting", detail: "Générez un nouveau lien pour associer son téléphone." };
  return { label: "Téléphone à associer", tone: "muted", detail: "L’accès est autorisé. Associez maintenant le téléphone du livreur." };
}

/** Pagination never drops an already displayed entry, even at an overlapping boundary. */
export function mergeDeliveryOperatorPages(first: DeliveryOperatorsView, next: DeliveryOperatorsView): DeliveryOperatorsView {
  const operators = new Map(first.operators.map(operator => [operator.id, operator]));
  for (const operator of next.operators) operators.set(operator.id, operator);
  return { ...first, operators: [...operators.values()], nextCursor: next.nextCursor ?? null };
}
