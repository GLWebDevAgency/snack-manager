import {
  CreatePublicOrderSchema,
  OrderStatusSchema,
  OrderTypeSchema,
  PaymentMethodSchema,
  PaymentStatusSchema,
  DeliveryCustomerProofSchema,
  DeliveryProofRequestSchema,
  parseDeliveryHandoffQr,
  PublicOrderRecoveryResultSchema,
  type CreatePublicOrder,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
  type PaymentStatus,
} from "@sm/contracts";
import { DELIVERY_PROOF_ACCESS_RETENTION_MS } from "./delivery-proof-access";

export type CheckoutBusinessPayload = Omit<CreatePublicOrder, "clientId" | "turnstileToken" | "recoveryProof">;
export type CheckoutReceipt = Readonly<{
  orderId: string;
  trackingToken: string;
  /** Delivery access retained from the private local attempt, never a server response.
   * Unlike the tracking token, this must never enter staff views, receipts or sockets.
   */
  recoveryProof?: string;
  number?: number;
  status?: OrderStatus;
  type?: OrderType;
  payment?: Readonly<{ method: PaymentMethod; status: PaymentStatus }>;
}>;
type AttemptIdentity = Readonly<{
  v: 1;
  tenant: string;
  origin: string;
  clientId: string;
  /** SHA-256 only: never a duplicate copy of a cart/note/customer. */
  cartFingerprint: string;
  createdAt: number;
  updatedAt: number;
}>;
export type PendingCheckoutAttempt = AttemptIdentity & Readonly<{
  state: "prepared" | "uncertain";
  recoveryProof: string;
  payload: CheckoutBusinessPayload;
}>;
export type ReceivedCheckoutAttempt = AttemptIdentity & Readonly<{
  state: "received";
  receipt: CheckoutReceipt;
}>;
export type CheckoutRejection = Readonly<{
  reason: "unavailable" | "slot_unavailable" | "invalid_order" | "abandoned";
  message: string;
}>;
export type RejectedCheckoutAttempt = AttemptIdentity & Readonly<{
  state: "rejected";
  rejection: CheckoutRejection;
}>;
export type CheckoutAttempt = PendingCheckoutAttempt | ReceivedCheckoutAttempt | RejectedCheckoutAttempt;
/** A capability verified on this origin, not a synthetic checkout attempt. */
export type ImportedDeliveryReceipt = Readonly<{
  v: 1; state: "imported"; tenant: string; origin: string; clientId: string; updatedAt: number;
  receipt: Readonly<{ orderId: string; recoveryProof: string }>;
}>;
export type DeliveryCheckoutReceipt = ReceivedCheckoutAttempt | ImportedDeliveryReceipt;

const DATABASE = "sm.checkout-attempts";
const VERSION = 1;
const DATABASE_VERSION = 2;
const ACTIVE = "active";
const RECEIPTS = "last-receipt";
const DELIVERY_RECEIPTS = "delivery-receipts";
const DELIVERY_RECEIPT_LIMIT = 128;
const DEADLINE_MS = 5_000;
const HEX_256 = /^[a-f\d]{64}$/;
const UUID_V4 = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/;
const TENANT = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const EVENT = "sm:checkout-attempt-change";
const CHANNEL = "sm.checkout-attempt-change.v1";
const IDENTITY_KEYS = ["v", "tenant", "origin", "clientId", "cartFingerprint", "createdAt", "updatedAt", "state"];

export class CheckoutAttemptStorageError extends Error {
  constructor(
    public readonly code: "unavailable" | "corrupt" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "CheckoutAttemptStorageError";
  }
}

function unavailable(): CheckoutAttemptStorageError {
  return new CheckoutAttemptStorageError("unavailable", "Le stockage sécurisé de la commande est indisponible. Aucun nouvel envoi n’est autorisé ; conservez cette page et réessayez.");
}
function corrupt(): never {
  throw new CheckoutAttemptStorageError("corrupt", "Le journal de commande est endommagé ou incompatible. Ne passez pas une nouvelle commande ; contactez le restaurant pour vérifier la précédente.");
}
function invalid(): never {
  throw new CheckoutAttemptStorageError("invalid", "La tentative de commande est invalide. Aucun nouvel envoi n’est autorisé.");
}
function storageError(error: unknown): CheckoutAttemptStorageError {
  return error instanceof CheckoutAttemptStorageError ? error : unavailable();
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
function nonempty(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}
function scope(tenant: string): { tenant: string; origin: string } {
  if (!TENANT.test(tenant)) invalid();
  try {
    if (typeof window === "undefined" || !window.isSecureContext || !window.indexedDB || !window.crypto?.subtle || !window.crypto?.getRandomValues) throw unavailable();
    const origin = window.location.origin;
    if (origin === "null") throw unavailable();
    return { tenant, origin };
  } catch (error) { throw storageError(error); }
}

/** Sorting object keys makes the digest stable across independently restored tabs. */
function canonical(value: unknown, depth = 0): string {
  if (depth > 30) invalid();
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
  return invalid();
}
export async function checkoutCartFingerprint(snapshot: unknown): Promise<string> {
  try {
    const input = canonical(snapshot);
    if (input.length > 250_000) invalid();
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch (error) { throw storageError(error); }
}

function businessPayload(value: unknown): CheckoutBusinessPayload {
  if (!object(value) || !onlyKeys(value, ["fulfillment", "delivery", "lines", "payment", "pickup", "note", "promoCode"])) invalid();
  // Same schema as POST, but transient challenge/proof are never persisted here.
  const parsed = CreatePublicOrderSchema.safeParse({
    ...value, clientId: "00000000-0000-4000-8000-000000000000", turnstileToken: "journal-validation",
  });
  if (!parsed.success) invalid();
  const result = { ...parsed.data } as Record<string, unknown>;
  delete result.clientId;
  delete result.turnstileToken;
  delete result.recoveryProof;
  return result as CheckoutBusinessPayload;
}
function receiptValue(value: unknown, allowPrivateProof = false): CheckoutReceipt {
  if (!object(value) || !onlyKeys(value, ["orderId", "trackingToken", "number", "status", "type", "payment", ...(allowPrivateProof ? ["recoveryProof"] : [])]) || !nonempty(value.orderId, 128) || !nonempty(value.trackingToken, 2_048)) invalid();
  if (Object.hasOwn(value, "recoveryProof") && (typeof value.recoveryProof !== "string" || !HEX_256.test(value.recoveryProof))) invalid();
  if (value.number !== undefined && (!Number.isSafeInteger(value.number) || (value.number as number) < 0)) invalid();
  if (value.status !== undefined && !OrderStatusSchema.safeParse(value.status).success) invalid();
  if (value.type !== undefined && !OrderTypeSchema.safeParse(value.type).success) invalid();
  if (value.payment !== undefined && (!object(value.payment) || !onlyKeys(value.payment, ["method", "status"]) || !PaymentMethodSchema.safeParse(value.payment.method).success || !PaymentStatusSchema.safeParse(value.payment.status).success)) invalid();
  return structuredClone(value) as CheckoutReceipt;
}
function rejectionValue(value: unknown): CheckoutRejection {
  if (!object(value) || !onlyKeys(value, ["reason", "message"]) || !["unavailable", "slot_unavailable", "invalid_order", "abandoned"].includes(value.reason as string) || !nonempty(value.message, 1_000)) invalid();
  return structuredClone(value) as CheckoutRejection;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => freeze(child));
    Object.freeze(value);
  }
  return value;
}
function parseAttempt(raw: unknown, tenant: string, origin: string): CheckoutAttempt | null {
  if (raw === undefined) return null;
  if (!object(raw) || raw.v !== VERSION || raw.tenant !== tenant || raw.origin !== origin || typeof raw.clientId !== "string" || !UUID_V4.test(raw.clientId) || typeof raw.cartFingerprint !== "string" || !HEX_256.test(raw.cartFingerprint) || !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.updatedAt) || (raw.createdAt as number) < 0 || (raw.updatedAt as number) < (raw.createdAt as number)) corrupt();
  try {
    if (raw.state === "received") {
      if (!onlyKeys(raw, [...IDENTITY_KEYS, "receipt"])) corrupt();
      receiptValue(raw.receipt, true);
    } else if (raw.state === "rejected") {
      if (!onlyKeys(raw, [...IDENTITY_KEYS, "rejection"])) corrupt();
      rejectionValue(raw.rejection);
    } else if (raw.state === "prepared" || raw.state === "uncertain") {
      if (!onlyKeys(raw, [...IDENTITY_KEYS, "payload", "recoveryProof"]) || typeof raw.recoveryProof !== "string" || !HEX_256.test(raw.recoveryProof)) corrupt();
      if (canonical(businessPayload(raw.payload)) !== canonical(raw.payload)) corrupt();
    } else corrupt();
  } catch { corrupt(); }
  return freeze(raw as CheckoutAttempt);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(unavailable()); } };
    const timer = setTimeout(fail, DEADLINE_MS);
    try {
      const request = window.indexedDB.open(DATABASE, DATABASE_VERSION);
      request.onblocked = fail;
      request.onerror = fail;
      request.onupgradeneeded = (event) => {
        // The only upgrade adds a private per-order receipt store. Never rewrite,
        // recreate or discard an existing active attempt or its immutable identity.
        if (settled || ![0, 1].includes(event.oldVersion)) { request.transaction?.abort(); fail(); return; }
        if (event.oldVersion === 0) {
          request.result.createObjectStore(ACTIVE, { keyPath: "tenant" });
          request.result.createObjectStore(RECEIPTS, { keyPath: "tenant" });
        }
        request.result.createObjectStore(DELIVERY_RECEIPTS, { keyPath: ["tenant", "receipt.orderId"] });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => db.close();
        if (db.objectStoreNames.length !== 3 || !db.objectStoreNames.contains(ACTIVE) || !db.objectStoreNames.contains(RECEIPTS) || !db.objectStoreNames.contains(DELIVERY_RECEIPTS)) { db.close(); reject(new CheckoutAttemptStorageError("corrupt", "Le journal de commande est endommagé ou incompatible.")); return; }
        resolve(db);
      };
    } catch { fail(); }
  });
}

/** Every mutation resolves only after strict transaction completion, never request success. */
async function transaction<T, C = CheckoutAttempt>(
  tenant: string,
  storeName: typeof ACTIVE | typeof RECEIPTS | typeof DELIVERY_RECEIPTS,
  write: boolean,
  action: (current: C | null, tx: IDBTransaction, fail: (error: unknown) => void) => T,
  key?: IDBValidKey,
  parser?: (raw: unknown, tenant: string, origin: string) => C | null,
): Promise<T> {
  const { origin } = scope(tenant);
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    let result: T;
    let failure: CheckoutAttemptStorageError | undefined;
    let completed = false;
    const timer = setTimeout(() => {
      failure = unavailable();
      try { tx?.abort(); } catch { /* May already be committing: next read remains authoritative. */ }
      finish(failure);
    }, DEADLINE_MS);
    function finish(error?: CheckoutAttemptStorageError) {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      db.close();
      if (error) reject(error); else resolve(freeze(result));
    }
    try {
      tx = db.transaction(write ? [ACTIVE, RECEIPTS, DELIVERY_RECEIPTS] : [storeName], write ? "readwrite" : "readonly", { durability: "strict" });
      tx.oncomplete = () => { finish(); if (write) notify(tenant); };
      tx.onabort = () => finish(failure ?? unavailable());
      tx.onerror = () => { failure ??= unavailable(); };
      if (write && tx.durability !== "strict") throw unavailable();
      for (const name of Array.from(tx.objectStoreNames)) {
        const candidate = tx.objectStore(name);
        const expectedKeyPath = name === DELIVERY_RECEIPTS ? JSON.stringify(["tenant", "receipt.orderId"]) : JSON.stringify("tenant");
        if (JSON.stringify(candidate.keyPath) !== expectedKeyPath || candidate.autoIncrement || candidate.indexNames.length !== 0) corrupt();
      }
      const store = tx.objectStore(storeName);
      const request = store.get(key ?? tenant);
      request.onsuccess = () => {
        try {
          const current = parser ? parser(request.result, tenant, origin) : parseAttempt(request.result, tenant, origin) as C | null;
          const persisted: unknown = current;
          if (storeName === RECEIPTS && persisted && (!object(persisted) || persisted.state !== "received")) corrupt();
          result = action(current, tx!, error => { failure = storageError(error); tx!.abort(); });
        } catch (error) { failure = storageError(error); tx!.abort(); }
      };
    } catch (error) {
      failure = storageError(error);
      try { tx?.abort(); } catch { /* Already failed. */ }
      finish(failure);
    }
  });
}

export function readCheckoutAttempt(tenant: string): Promise<CheckoutAttempt | null> {
  return transaction(tenant, ACTIVE, false, (current) => current);
}
export function readLastCheckoutReceipt(tenant: string): Promise<ReceivedCheckoutAttempt | null> {
  return transaction(tenant, RECEIPTS, false, (current) => current as ReceivedCheckoutAttempt | null);
}
function expireReceiptAliases(tx: IDBTransaction, tenant: string, origin: string, fail: (error: unknown) => void) {
  for (const name of [ACTIVE, RECEIPTS]) {
    const store = tx.objectStore(name);
    const request = store.get(tenant);
    request.onsuccess = () => {
      try {
        const current = parseAttempt(request.result, tenant, origin);
        if (!current || current.state !== "received" || !current.receipt.recoveryProof
          || current.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS > Date.now()) return;
        const receipt = { ...current.receipt };
        delete receipt.recoveryProof;
        store.put({ ...current, receipt });
      } catch (error) { fail(error); }
    };
  }
}
/** Exact private lookup only, not a customer history. A tracking token alone
 * cannot recreate a missing capability. Retention is seven days from receipt;
 * expired entries are removed opportunistically, never pending attempts.
 */
function parseDeliveryReceipt(raw: unknown, tenant: string, origin: string): DeliveryCheckoutReceipt | null {
  if (raw == null) return null;
  if (object(raw) && raw.state === "imported") {
    if (!onlyKeys(raw, ["v", "state", "tenant", "origin", "clientId", "updatedAt", "receipt"])
      || raw.v !== 1 || raw.tenant !== tenant || raw.origin !== origin || typeof raw.clientId !== "string" || !UUID_V4.test(raw.clientId)
      || !Number.isSafeInteger(raw.updatedAt) || (raw.updatedAt as number) < 0 || !object(raw.receipt)
      || !onlyKeys(raw.receipt, ["orderId", "recoveryProof"]) || typeof raw.receipt.orderId !== "string" || !/^[a-f\d]{24}$/.test(raw.receipt.orderId)
      || typeof raw.receipt.recoveryProof !== "string" || !HEX_256.test(raw.receipt.recoveryProof)) corrupt();
    return raw as ImportedDeliveryReceipt;
  }
  const attempt = parseAttempt(raw, tenant, origin);
  if (!attempt || attempt.state !== "received" || !attempt.receipt.recoveryProof) corrupt();
  return attempt;
}
export function readDeliveryCheckoutReceipt(tenant: string, orderId: string, preserveExpired = false): Promise<DeliveryCheckoutReceipt | null> {
  if (!nonempty(orderId, 128)) invalid();
  return transaction<DeliveryCheckoutReceipt | null, DeliveryCheckoutReceipt>(tenant, DELIVERY_RECEIPTS, true, (current, tx, fail) => {
    if (!current) return null;
    if (current.receipt.orderId !== orderId || !current.receipt.recoveryProof) corrupt();
    if (current.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS <= Date.now()) {
      if (!preserveExpired) {
        tx.objectStore(DELIVERY_RECEIPTS).delete([tenant, orderId]);
        expireReceiptAliases(tx, tenant, current.origin, fail);
      }
      return null;
    }
    return current;
  }, [tenant, orderId], parseDeliveryReceipt);
}

/** Call only after this exact order's proof endpoint accepted the private
 * fragment, and its authenticated tracking ticket established the tenant.
 * Never creates/archives an attempt or stores the returned PIN/QR.
 */
export function importVerifiedDeliveryReceipt(tenant: string, orderId: string, access: unknown, confirmation: unknown): Promise<void> {
  const request = DeliveryProofRequestSchema.parse(access);
  const proof = DeliveryCustomerProofSchema.parse(confirmation);
  const qr = parseDeliveryHandoffQr(proof.qr);
  if (proof.missionId !== orderId || qr?.orderId !== orderId || qr.proofId !== proof.proofId) invalid();
  return importDeliveryReceipt(tenant, orderId, request);
}
/** Explicit payment recovery only. C01 may finish an already committed
 * snapshot; this is not a read-only visit and never starts a new attempt.
 * No synthetic PIN/QR is manufactured to authorize this distinct receipt.
 */
export function importRecoveredDeliveryReceipt(tenant: string, orderId: string, trackingToken: string, access: unknown, confirmation: unknown): Promise<void> {
  const request = DeliveryProofRequestSchema.parse(access);
  const result = PublicOrderRecoveryResultSchema.parse(confirmation);
  if (result.state !== "created" || result.order._id !== orderId || result.order.type !== "delivery" || result.order.trackingToken !== trackingToken) invalid();
  return importDeliveryReceipt(tenant, orderId, request);
}
function importDeliveryReceipt(tenant: string, orderId: string, request: { clientId: string; recoveryProof: string }): Promise<void> {
  const { origin } = scope(tenant);
  if (!/^[a-f\d]{24}$/.test(orderId) || !UUID_V4.test(request.clientId)) invalid();
  const next: ImportedDeliveryReceipt = { v: 1, state: "imported", tenant, origin, clientId: request.clientId,
    updatedAt: Date.now(), receipt: { orderId, recoveryProof: request.recoveryProof } };
  return transaction(tenant, ACTIVE, true, (active, tx, fail) => {
    const store = tx.objectStore(DELIVERY_RECEIPTS);
    const cursor = store.openCursor(IDBKeyRange.bound([tenant, ""], [tenant, "\uffff"]));
    // Do not consume the slot already reserved for an unresolved delivery.
    let count = active && (active.state === "prepared" || active.state === "uncertain") && active.payload.fulfillment === "delivery" ? 1 : 0;
    let exists = false;
    cursor.onsuccess = () => {
      try {
        const row = cursor.result;
        if (!row) {
          if (!exists) {
            if (count >= DELIVERY_RECEIPT_LIMIT) throw unavailable();
            store.add(next);
          }
          return;
        }
        const value = parseDeliveryReceipt(row.value, tenant, origin)!;
        if (value.receipt.orderId === orderId) {
          if (value.clientId !== request.clientId || value.receipt.recoveryProof !== request.recoveryProof) corrupt();
          if (value.updatedAt > Date.now() || value.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS <= Date.now()) throw unavailable();
          exists = true; // Reading/importing never extends the original retention.
        } else if (value.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS <= Date.now()) row.delete();
        else count++;
        row.continue();
      } catch (error) { fail(error); }
    };
  });
}

/** The pending active row reserves the remaining receipt slot: only one
 * attempt can be acquired per tenant, and all three stores share this lock.
 */
function reserveDeliveryReceipt(tx: IDBTransaction, attempt: PendingCheckoutAttempt, fail: (error: unknown) => void) {
  expireReceiptAliases(tx, attempt.tenant, attempt.origin, fail);
  const store = tx.objectStore(DELIVERY_RECEIPTS);
  const cursor = store.openCursor(IDBKeyRange.bound([attempt.tenant, ""], [attempt.tenant, "\uffff"]));
  let count = 0;
  cursor.onsuccess = () => {
    try {
      const row = cursor.result;
      if (!row) { tx.objectStore(ACTIVE).add(attempt); return; }
      const value = parseDeliveryReceipt(row.value, attempt.tenant, attempt.origin);
      if (!value) corrupt();
      if (value.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS <= Date.now()) row.delete();
      else if (++count >= DELIVERY_RECEIPT_LIMIT) throw new CheckoutAttemptStorageError("unavailable", "Ce navigateur conserve déjà 128 accès de livraison récents. Aucun nouvel envoi n’est autorisé ; contactez le restaurant avant de poursuivre.");
      row.continue();
    } catch (error) { fail(error); }
  };
}
export async function acquireCheckoutAttempt(
  tenant: string,
  input: Readonly<{ payload: CheckoutBusinessPayload; cartFingerprint: string }>,
): Promise<{ attempt: CheckoutAttempt; acquired: boolean }> {
  const { origin } = scope(tenant);
  const cartFingerprint = input.cartFingerprint;
  if (!HEX_256.test(cartFingerprint)) invalid();
  const payload = businessPayload(input.payload);
  return transaction(tenant, ACTIVE, true, (current, tx, fail) => {
    if (current) return { attempt: current, acquired: false };
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    const now = Date.now();
    const attempt: PendingCheckoutAttempt = {
      v: VERSION, tenant, origin, clientId: window.crypto.randomUUID(),
      recoveryProof: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      cartFingerprint, createdAt: now, updatedAt: now, state: "prepared", payload,
    };
    if (payload.fulfillment === "delivery") reserveDeliveryReceipt(tx, attempt, fail);
    else tx.objectStore(ACTIVE).add(attempt);
    return { attempt, acquired: true };
  });
}
function matching(current: CheckoutAttempt | null, clientId: string): CheckoutAttempt {
  if (!current || current.clientId !== clientId) throw new CheckoutAttemptStorageError("conflict", "Une autre tentative de commande est active. Vérifiez son état avant de continuer.");
  return current;
}
export function markCheckoutAttemptUncertain(tenant: string, clientId: string): Promise<CheckoutAttempt> {
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state !== "prepared") return attempt;
    const next: PendingCheckoutAttempt = { ...attempt, state: "uncertain", updatedAt: Math.max(attempt.updatedAt, Date.now()) };
    tx.objectStore(ACTIVE).put(next);
    return next;
  });
}
/** Call only with an authoritative POST/recovery response, before clearing the matching cart. */
export function recordCheckoutReceipt(tenant: string, clientId: string, input: Omit<CheckoutReceipt, "recoveryProof">): Promise<ReceivedCheckoutAttempt> {
  const receipt = receiptValue(input);
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state === "rejected") throw new CheckoutAttemptStorageError("conflict", "Cette tentative a déjà un rejet confirmé. Vérifiez la commande auprès du restaurant.");
    if (attempt.state === "received") {
      if (attempt.receipt.orderId !== receipt.orderId || attempt.receipt.trackingToken !== receipt.trackingToken) throw new CheckoutAttemptStorageError("conflict", "Le reçu correspond à une autre commande. Vérifiez la commande auprès du restaurant.");
      return attempt;
    }
    const next: ReceivedCheckoutAttempt = {
      v: VERSION, tenant: attempt.tenant, origin: attempt.origin, clientId: attempt.clientId,
      cartFingerprint: attempt.cartFingerprint, createdAt: attempt.createdAt,
      updatedAt: Math.max(attempt.updatedAt, Date.now()), state: "received",
      receipt: attempt.payload.fulfillment === "delivery" ? { ...receipt, recoveryProof: attempt.recoveryProof } : receipt,
    };
    // Remove the customer, address and note. Only a delivery keeps its original
    // capability in the receipt so a same-origin payment return can restore it.
    // Historical receipts without this optional field remain readable, not upgraded.
    tx.objectStore(ACTIVE).put(next);
    if (next.receipt.recoveryProof) tx.objectStore(DELIVERY_RECEIPTS).add(next);
    return next;
  });
}
/** Only a verified server fence is authoritative; a local HTTP/network error is not a rejection. */
export function recordCheckoutRejection(tenant: string, clientId: string, input: CheckoutRejection): Promise<RejectedCheckoutAttempt> {
  const rejection = rejectionValue(input);
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state === "received") throw new CheckoutAttemptStorageError("conflict", "Cette tentative possède déjà un reçu. Vérifiez la commande auprès du restaurant.");
    if (attempt.state === "rejected") return attempt;
    const next: RejectedCheckoutAttempt = {
      v: VERSION, tenant: attempt.tenant, origin: attempt.origin, clientId: attempt.clientId,
      cartFingerprint: attempt.cartFingerprint, createdAt: attempt.createdAt,
      updatedAt: Math.max(attempt.updatedAt, Date.now()), state: "rejected", rejection,
    };
    tx.objectStore(ACTIVE).put(next);
    return next;
  });
}
export function releaseRejectedCheckoutAttempt(tenant: string, clientId: string): Promise<void> {
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state !== "rejected") throw new CheckoutAttemptStorageError("conflict", "Un rejet confirmé doit être enregistré avant de commencer une autre commande.");
    tx.objectStore(ACTIVE).delete(tenant);
  });
}
/** Explicit "new order" only. A timeout, 404 or closing a dialog is never reconciliation. */
export function archiveCheckoutAttempt(tenant: string, clientId: string): Promise<void> {
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state !== "received") throw new CheckoutAttemptStorageError("conflict", "La tentative doit être réconciliée avant de commencer une autre commande.");
    tx.objectStore(RECEIPTS).put(attempt);
    tx.objectStore(ACTIVE).delete(tenant);
  });
}

let broadcast: BroadcastChannel | null = null;
let subscriptions = 0;
function notify(tenant: string): void {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: tenant }));
    const sender = broadcast ?? new BroadcastChannel(CHANNEL);
    sender.postMessage({ tenant });
    if (!broadcast) sender.close();
  } catch { /* Notifications are hints only; a successful commit stays successful. */ }
}
export function subscribeCheckoutAttempts(listener: (tenant: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = (event: Event) => {
    const tenant: unknown = (event as CustomEvent).detail;
    if (typeof tenant === "string" && TENANT.test(tenant)) listener(tenant);
  };
  window.addEventListener(EVENT, local);
  subscriptions += 1;
  try {
    broadcast ??= new BroadcastChannel(CHANNEL);
    broadcast.onmessage = (event: MessageEvent<unknown>) => {
      if (object(event.data) && onlyKeys(event.data, ["tenant"]) && typeof event.data.tenant === "string" && TENANT.test(event.data.tenant)) {
        window.dispatchEvent(new CustomEvent(EVENT, { detail: event.data.tenant }));
      }
    };
  } catch { /* focus/pageshow can refresh when BroadcastChannel is unavailable. */ }
  let subscribed = true;
  return () => {
    if (!subscribed) return;
    subscribed = false;
    window.removeEventListener(EVENT, local);
    subscriptions -= 1;
    if (!subscriptions) { broadcast?.close(); broadcast = null; }
  };
}
