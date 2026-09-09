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
  CustomerAccountBrowserRefSchema,
  CustomerAccountPublicationSchema,
  type CustomerAccountPublication,
  type CreatePublicOrder,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
  type PaymentStatus,
} from "@sm/contracts";
import { DELIVERY_PROOF_ACCESS_RETENTION_MS } from "./delivery-proof-access";

export type CheckoutBusinessPayload = Omit<CreatePublicOrder, "clientId" | "turnstileToken" | "recoveryProof">;
/** Public correlation, never an account credential or proof of ownership. */
export type CheckoutAccountAccess = Readonly<{
  selection: Readonly<{ browserRef: string; publication: CustomerAccountPublication }>;
  expiresAt: number;
  privacyEpoch: number;
}>;
export type CheckoutProvenance = Readonly<{ kind: "guest" }> | (CheckoutAccountAccess & Readonly<{ kind: "account" }>);
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
  v: 1 | 2;
  /** Absent only on legacy v1, which always remains a guest attempt. */
  provenance?: CheckoutProvenance;
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
  /** Non-capability digest retained when account access is removed. */
  receiptFingerprint?: string;
}>;
export type CheckoutRejection = Readonly<{
  reason: "unavailable" | "slot_unavailable" | "invalid_order" | "abandoned";
  message: string;
}>;
export type RejectedCheckoutAttempt = AttemptIdentity & Readonly<{
  state: "rejected";
  rejection: CheckoutRejection;
}>;
export type PrivateSettledCheckoutAttempt = AttemptIdentity & Readonly<{
  state: "private-settled";
  outcome: "received";
  receiptFingerprint: string;
}>;
export type CheckoutAttempt = PendingCheckoutAttempt | ReceivedCheckoutAttempt | RejectedCheckoutAttempt | PrivateSettledCheckoutAttempt;
export type VisibleCheckoutAttempt = Exclude<CheckoutAttempt, PrivateSettledCheckoutAttempt>;
/** A capability verified on this origin, not a synthetic checkout attempt. */
export type ImportedDeliveryReceipt = Readonly<{
  v: 1; state: "imported"; tenant: string; origin: string; clientId: string; updatedAt: number;
  receipt: Readonly<{ orderId: string; recoveryProof: string }>;
}>;
export type DeliveryCheckoutReceipt = ReceivedCheckoutAttempt | ImportedDeliveryReceipt;

const DATABASE = "sm.checkout-attempts";
const VERSION = 2;
const DATABASE_VERSION = 4;
const ACTIVE = "active";
const RECEIPTS = "last-receipt";
const DELIVERY_RECEIPTS = "delivery-receipts";
const DELIVERY_RECEIPT_LIMIT = 128;
const DEVICE_RECEIPTS = "device-receipts";
const PRIVACY = "privacy";
const STORES = [ACTIVE, RECEIPTS, DELIVERY_RECEIPTS, DEVICE_RECEIPTS, PRIVACY];
type Privacy = Readonly<{ epoch: number; present: boolean }>;
const DEVICE_RECEIPT_LIMIT = 128;
const DEVICE_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
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

function accountAccess(value: unknown): CheckoutAccountAccess {
  if (!object(value) || !onlyKeys(value, ["selection", "expiresAt", "privacyEpoch"])
    || !object(value.selection) || !onlyKeys(value.selection, ["browserRef", "publication"])
    || !CustomerAccountBrowserRefSchema.safeParse(value.selection.browserRef).success
    || !CustomerAccountPublicationSchema.safeParse(value.selection.publication).success
    || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= 0
    || !Number.isSafeInteger(value.privacyEpoch) || (value.privacyEpoch as number) < 0) invalid();
  return structuredClone(value) as CheckoutAccountAccess;
}
function provenanceValue(value: unknown): CheckoutProvenance {
  if (!object(value)) invalid();
  if (value.kind === "guest" && onlyKeys(value, ["kind"])) return { kind: "guest" };
  if (value.kind !== "account" || !onlyKeys(value, ["kind", "selection", "expiresAt", "privacyEpoch"])) invalid();
  return { kind: "account", ...accountAccess({ selection: value.selection, expiresAt: value.expiresAt, privacyEpoch: value.privacyEpoch }) };
}
function provenance(attempt: AttemptIdentity): CheckoutProvenance {
  return attempt.v === 1 ? { kind: "guest" } : attempt.provenance!;
}
function identity(attempt: AttemptIdentity): AttemptIdentity {
  return { v: attempt.v, tenant: attempt.tenant, origin: attempt.origin, clientId: attempt.clientId,
    cartFingerprint: attempt.cartFingerprint, createdAt: attempt.createdAt, updatedAt: attempt.updatedAt,
    ...(attempt.v === 2 ? { provenance: attempt.provenance } : {}) };
}
function sameProvenance(a: CheckoutProvenance, b: CheckoutProvenance): boolean { return canonical(a) === canonical(b); }
function accountLive(attempt: AttemptIdentity, privacy: Privacy): boolean {
  const owner = provenance(attempt);
  if (owner.kind === "guest") return true;
  if (!privacy.present) corrupt();
  return owner.privacyEpoch === privacy.epoch && owner.expiresAt > Date.now();
}
function visible(attempt: CheckoutAttempt, privacy: Privacy, access?: CheckoutAccountAccess | null): boolean {
  if (attempt.state === "private-settled") return false;
  const owner = provenance(attempt);
  return owner.kind === "guest" || (!!access && accountLive(attempt, privacy)
    && sameProvenance(owner, { kind: "account", ...access }));
}
function conflict(): never {
  throw new CheckoutAttemptStorageError("conflict", "Une autre tentative de commande est active ou cet accès a changé. Vérifiez la demande précédente avant de continuer.");
}
function validateAdmission(owner: CheckoutProvenance, privacy: Privacy) {
  if (owner.kind === "account" && (owner.privacyEpoch !== privacy.epoch || owner.expiresAt <= Date.now()
    || owner.expiresAt > Date.now() + DEVICE_RECEIPT_RETENTION_MS)) conflict();
}
function privateSettled(attempt: ReceivedCheckoutAttempt): PrivateSettledCheckoutAttempt {
  if (provenance(attempt).kind !== "account" || !attempt.receiptFingerprint) corrupt();
  return { ...identity(attempt), state: "private-settled", outcome: "received", receiptFingerprint: attempt.receiptFingerprint };
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
  if (!object(raw) || (raw.v !== 1 && raw.v !== 2) || raw.tenant !== tenant || raw.origin !== origin || typeof raw.clientId !== "string" || !UUID_V4.test(raw.clientId) || typeof raw.cartFingerprint !== "string" || !HEX_256.test(raw.cartFingerprint) || !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.updatedAt) || (raw.createdAt as number) < 0 || (raw.updatedAt as number) < (raw.createdAt as number)) corrupt();
  try {
    const keys = raw.v === 2 ? [...IDENTITY_KEYS, "provenance"] : IDENTITY_KEYS;
    const owner = raw.v === 2 ? provenanceValue(raw.provenance) : { kind: "guest" };
    if (raw.state === "received") {
      if (!onlyKeys(raw, [...keys, "receipt", ...(owner.kind === "account" ? ["receiptFingerprint"] : [])])) corrupt();
      if (owner.kind === "account" && (typeof raw.receiptFingerprint !== "string" || !HEX_256.test(raw.receiptFingerprint))) corrupt();
      receiptValue(raw.receipt, true);
    } else if (raw.state === "private-settled") {
      if (owner.kind !== "account" || !onlyKeys(raw, [...keys, "outcome", "receiptFingerprint"])
        || raw.outcome !== "received" || typeof raw.receiptFingerprint !== "string" || !HEX_256.test(raw.receiptFingerprint)) corrupt();
    } else if (raw.state === "rejected") {
      if (!onlyKeys(raw, [...keys, "rejection"])) corrupt();
      rejectionValue(raw.rejection);
    } else if (raw.state === "prepared" || raw.state === "uncertain") {
      if (!onlyKeys(raw, [...keys, "payload", "recoveryProof"]) || typeof raw.recoveryProof !== "string" || !HEX_256.test(raw.recoveryProof)) corrupt();
      if (canonical(businessPayload(raw.payload)) !== canonical(raw.payload)) corrupt();
    } else corrupt();
  } catch { corrupt(); }
  return freeze(raw as CheckoutAttempt);
}

/** Tracking is a separate capability from delivery handoff. Never copy the
 * recovery proof or a pending checkout's customer/address/note into this store.
 */
function deviceReceipt(attempt: ReceivedCheckoutAttempt): ReceivedCheckoutAttempt {
  const receipt = { ...attempt.receipt };
  delete receipt.recoveryProof;
  return { ...attempt, receipt };
}
function parseDeviceReceipt(raw: unknown, tenant: string, origin: string): ReceivedCheckoutAttempt | null {
  const attempt = parseAttempt(raw, tenant, origin);
  if (!attempt) return null;
  if (attempt.state !== "received" || Object.hasOwn(attempt.receipt, "recoveryProof")) corrupt();
  return attempt;
}
function deviceReceiptExpired(receipt: ReceivedCheckoutAttempt, now: number): boolean {
  // A future clock must not silently increase the retention or remove a link.
  if (receipt.updatedAt > now) corrupt();
  return receipt.updatedAt + DEVICE_RECEIPT_RETENTION_MS <= now;
}
/** Run once in the versionchange transaction. Do not rebuild from aliases on
 * later reads: that would resurrect a deliberately forgotten shortcut.
 */
function migrateDeviceReceipts(tx: IDBTransaction) {
  const origin = window.location.origin;
  const now = Date.now();
  const target = tx.objectStore(DEVICE_RECEIPTS);
  const migrate = (names: string[]) => {
    const name = names.shift();
    if (!name) return;
    const cursor = tx.objectStore(name).openCursor();
    cursor.onsuccess = () => {
      try {
        const row = cursor.result;
        if (!row) { migrate(names); return; }
        if (!object(row.value) || typeof row.value.tenant !== "string" || !TENANT.test(row.value.tenant)) corrupt();
        const attempt = parseAttempt(row.value, row.value.tenant, origin);
        if (!attempt || (name === RECEIPTS && attempt.state !== "received")) corrupt();
        if (attempt.state !== "received" || deviceReceiptExpired(attempt, now)) { row.continue(); return; }
        const next = deviceReceipt(attempt);
        const get = target.get([attempt.tenant, attempt.receipt.orderId]);
        get.onsuccess = () => {
          try {
            const existing = parseDeviceReceipt(get.result, attempt.tenant, origin);
            if (existing && (existing.clientId !== next.clientId || existing.receipt.trackingToken !== next.receipt.trackingToken)) corrupt();
            // Duplicate aliases retain the earliest receipt time, never sliding TTL.
            if (!existing || next.updatedAt < existing.updatedAt) target.put(next);
            row.continue();
          } catch { tx.abort(); }
        };
      } catch { tx.abort(); }
    };
  };
  migrate([RECEIPTS, ACTIVE]);
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
        // Add stores without rewriting an active attempt or its private capability.
        if (settled || ![0, 1, 2, 3].includes(event.oldVersion)) { request.transaction?.abort(); fail(); return; }
        if (event.oldVersion === 0) {
          request.result.createObjectStore(ACTIVE, { keyPath: "tenant" });
          request.result.createObjectStore(RECEIPTS, { keyPath: "tenant" });
        }
        if (event.oldVersion < 2) request.result.createObjectStore(DELIVERY_RECEIPTS, { keyPath: ["tenant", "receipt.orderId"] });
        if (event.oldVersion < 3) {
          request.result.createObjectStore(DEVICE_RECEIPTS, { keyPath: ["tenant", "receipt.orderId"] });
          if (event.oldVersion > 0 && request.transaction) migrateDeviceReceipts(request.transaction);
        }
        request.result.createObjectStore(PRIVACY, { keyPath: "tenant" });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => db.close();
        if (db.objectStoreNames.length !== STORES.length || !STORES.every(name => db.objectStoreNames.contains(name))) { db.close(); reject(new CheckoutAttemptStorageError("corrupt", "Le journal de commande est endommagé ou incompatible.")); return; }
        resolve(db);
      };
    } catch { fail(); }
  });
}

/** Every mutation resolves only after strict transaction completion, never request success. */
async function transaction<T, C = CheckoutAttempt>(
  tenant: string,
  storeName: typeof ACTIVE | typeof RECEIPTS | typeof DELIVERY_RECEIPTS | typeof DEVICE_RECEIPTS,
  write: boolean,
  action: (current: C | null, tx: IDBTransaction, fail: (error: unknown) => void, privacy: Privacy) => T,
  key?: IDBValidKey,
  parser?: (raw: unknown, tenant: string, origin: string) => C | null,
  notifyWrite = true,
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
      tx = db.transaction(STORES, write ? "readwrite" : "readonly", { durability: "strict" });
      tx.oncomplete = () => { finish(); if (write && notifyWrite) notify(tenant); };
      tx.onabort = () => finish(failure ?? unavailable());
      tx.onerror = () => { failure ??= unavailable(); };
      if (write && tx.durability !== "strict") throw unavailable();
      for (const name of Array.from(tx.objectStoreNames)) {
        const candidate = tx.objectStore(name);
        const expectedKeyPath = name === DELIVERY_RECEIPTS || name === DEVICE_RECEIPTS ? JSON.stringify(["tenant", "receipt.orderId"]) : JSON.stringify("tenant");
        if (JSON.stringify(candidate.keyPath) !== expectedKeyPath || candidate.autoIncrement || candidate.indexNames.length !== 0) corrupt();
      }
      const privateGet = tx.objectStore(PRIVACY).get(tenant);
      privateGet.onsuccess = () => {
        try {
          const raw: unknown = privateGet.result;
          if (raw !== undefined && (!object(raw) || !onlyKeys(raw, ["tenant", "origin", "epoch"])
            || raw.tenant !== tenant || raw.origin !== origin || !Number.isSafeInteger(raw.epoch) || (raw.epoch as number) < 0)) corrupt();
          const privacy: Privacy = { epoch: raw === undefined ? 0 : (raw as { epoch: number }).epoch, present: raw !== undefined };
          const request = tx!.objectStore(storeName).get(key ?? tenant);
          request.onsuccess = () => {
            try {
              const current = parser ? parser(request.result, tenant, origin) : parseAttempt(request.result, tenant, origin) as C | null;
              const persisted: unknown = current;
              if (storeName === RECEIPTS && persisted && (!object(persisted) || persisted.state !== "received")) corrupt();
              result = action(current, tx!, error => { failure = storageError(error); tx!.abort(); }, privacy);
            } catch (error) { failure = storageError(error); tx!.abort(); }
          };
        } catch (error) { failure = storageError(error); tx!.abort(); }
      };
    } catch (error) {
      failure = storageError(error);
      try { tx?.abort(); } catch { /* Already failed. */ }
      finish(failure);
    }
  });
}

export function readCheckoutPrivacyEpoch(tenant: string): Promise<number> {
  return transaction(tenant, ACTIVE, false, (_current, _tx, _fail, privacy) => privacy.epoch);
}
/** Commit before logout/network work. Notifications are only hints: the epoch
 * and all alias removals share the same durable IndexedDB transaction. */
export function invalidateAccountCheckoutAccess(tenant: string): Promise<void> {
  const { origin } = scope(tenant);
  return transaction(tenant, ACTIVE, true, (current, tx, fail, privacy) => {
    if (privacy.epoch === Number.MAX_SAFE_INTEGER) throw unavailable();
    if (current && provenance(current).kind === "account") {
      if (!privacy.present) corrupt();
      if (current.state === "received") tx.objectStore(ACTIVE).put(privateSettled(current));
    }
    tx.objectStore(PRIVACY).put({ tenant, origin, epoch: privacy.epoch + 1 });
    for (const name of [RECEIPTS, DEVICE_RECEIPTS, DELIVERY_RECEIPTS]) {
      const cursor = tx.objectStore(name).openCursor(name === RECEIPTS ? IDBKeyRange.only(tenant)
        : IDBKeyRange.bound([tenant, ""], [tenant, "\uffff"]));
      cursor.onsuccess = () => {
        try {
          const row = cursor.result; if (!row) return;
          const value = name === DELIVERY_RECEIPTS ? parseDeliveryReceipt(row.value, tenant, origin)
            : parseAttempt(row.value, tenant, origin);
          if (!value || (value.state !== "received" && value.state !== "imported")) corrupt();
          if (value.state !== "imported" && provenance(value).kind === "account") {
            if (!privacy.present) corrupt();
            row.delete();
          }
          row.continue();
        } catch (error) { fail(error); }
      };
    }
  });
}
export function readCheckoutAttempt(tenant: string, access?: CheckoutAccountAccess | null): Promise<VisibleCheckoutAttempt | null> {
  const selected = access ? accountAccess(access) : null;
  return transaction(tenant, ACTIVE, false, (current, _tx, _fail, privacy) => current && current.state !== "private-settled" && visible(current, privacy, selected) ? current : null);
}
/** Internal reconciliation only. Never feed this result to a component or
 * retry hidden POSTs: the controller uses the original C01 proof to resolve. */
export function readCheckoutAttemptForReconciliation(tenant: string, clientId: string): Promise<CheckoutAttempt | null> {
  if (!UUID_V4.test(clientId)) invalid();
  return transaction(tenant, ACTIVE, false, current => current?.clientId === clientId ? current : null);
}
export function readLastCheckoutReceipt(tenant: string, access?: CheckoutAccountAccess | null): Promise<ReceivedCheckoutAttempt | null> {
  const selected = access ? accountAccess(access) : null;
  return transaction(tenant, RECEIPTS, false, (current, _tx, _fail, privacy) => current && visible(current, privacy, selected) ? current as ReceivedCheckoutAttempt : null);
}
export type CheckoutRecoveryProjection = {
  active: VisibleCheckoutAttempt | null;
  last: ReceivedCheckoutAttempt | null;
  hidden: { clientId: string; pending: boolean } | null;
};
export function readCheckoutRecovery(tenant: string, access?: CheckoutAccountAccess | null): Promise<CheckoutRecoveryProjection> {
  const selected = access ? accountAccess(access) : null;
  const { origin } = scope(tenant);
  return transaction(tenant, ACTIVE, false, (current, tx, fail, privacy) => {
    const result: CheckoutRecoveryProjection = { active: null, last: null, hidden: null };
    const get = tx.objectStore(RECEIPTS).get(tenant);
    get.onsuccess = () => {
      try {
        if (current) {
          if (current.state !== "private-settled" && visible(current, privacy, selected)) result.active = current;
          else result.hidden = { clientId: current.clientId, pending: current.state === "prepared" || current.state === "uncertain" };
        }
        const last = parseAttempt(get.result, tenant, origin);
        if (last && last.state !== "received") corrupt();
        if (last && visible(last, privacy, selected)) result.last = last;
      } catch (error) { fail(error); }
    };
    return result;
  });
}

/** Local tracking links only, not a verified customer account or server history.
 * Expired shortcuts are removed opportunistically, without notification loops.
 * This never expires active/last reconciliation receipts or private handoff access.
 */
export function readDeviceCheckoutReceipts(tenant: string, access?: CheckoutAccountAccess | null): Promise<ReceivedCheckoutAttempt[]> {
  const { origin } = scope(tenant);
  const selected = access ? accountAccess(access) : null;
  return transaction<ReceivedCheckoutAttempt[]>(tenant, DEVICE_RECEIPTS, true, (_current, tx, fail, privacy) => {
    const now = Date.now();
    const rows: ReceivedCheckoutAttempt[] = [];
    const cursor = tx.objectStore(DEVICE_RECEIPTS).openCursor(IDBKeyRange.bound([tenant, ""], [tenant, "\uffff"]));
    cursor.onsuccess = () => {
      try {
        const row = cursor.result;
        if (!row) { rows.sort((a, b) => b.updatedAt - a.updatedAt || a.receipt.orderId.localeCompare(b.receipt.orderId)); return; }
        const value = parseDeviceReceipt(row.value, tenant, origin);
        if (!value) corrupt();
        if (deviceReceiptExpired(value, now)) row.delete();
        else if (visible(value, privacy, selected)) rows.push(value);
        if (rows.length > DEVICE_RECEIPT_LIMIT) corrupt();
        row.continue();
      } catch (error) { fail(error); }
    };
    return rows;
  }, [tenant, ""], parseDeviceReceipt, false);
}

/** Forget only a shortcut. Reconciliation and private handoff access are
 * deliberately independent; the active receipt must be archived explicitly.
 */
export function forgetDeviceCheckoutReceipt(tenant: string, orderId: string): Promise<void> {
  const { origin } = scope(tenant);
  if (!nonempty(orderId, 128)) invalid();
  return transaction(tenant, ACTIVE, true, (active, tx, fail) => {
    if (active?.state === "received" && active.receipt.orderId === orderId) {
      throw new CheckoutAttemptStorageError("conflict", "Commencez une nouvelle commande avant d’oublier ce suivi encore actif.");
    }
    tx.objectStore(DEVICE_RECEIPTS).delete([tenant, orderId]);
    const aliases = tx.objectStore(RECEIPTS);
    const get = aliases.get(tenant);
    get.onsuccess = () => {
      try {
        const last = parseAttempt(get.result, tenant, origin);
        if (last && last.state !== "received") corrupt();
        if (last?.receipt.orderId === orderId) aliases.delete(tenant);
      } catch (error) { fail(error); }
    };
  });
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
export function readDeliveryCheckoutReceipt(tenant: string, orderId: string, preserveExpired = false, access?: CheckoutAccountAccess | null): Promise<DeliveryCheckoutReceipt | null> {
  if (!nonempty(orderId, 128)) invalid();
  const selected = access ? accountAccess(access) : null;
  return transaction<DeliveryCheckoutReceipt | null, DeliveryCheckoutReceipt>(tenant, DELIVERY_RECEIPTS, true, (current, tx, fail, privacy) => {
    if (!current) return null;
    if (current.receipt.orderId !== orderId || !current.receipt.recoveryProof) corrupt();
    if (current.updatedAt + DELIVERY_PROOF_ACCESS_RETENTION_MS <= Date.now()) {
      if (!preserveExpired) {
        tx.objectStore(DELIVERY_RECEIPTS).delete([tenant, orderId]);
        expireReceiptAliases(tx, tenant, current.origin, fail);
      }
      return null;
    }
    return current.state === "imported" || visible(current, privacy, selected) ? current : null;
  }, [tenant, orderId], parseDeliveryReceipt, false);
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
 * attempt can be acquired per tenant, and all stores share this lock.
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
function reserveDeviceReceipt(tx: IDBTransaction, attempt: PendingCheckoutAttempt, fail: (error: unknown) => void) {
  const now = Date.now();
  const cursor = tx.objectStore(DEVICE_RECEIPTS).openCursor(IDBKeyRange.bound([attempt.tenant, ""], [attempt.tenant, "\uffff"]));
  let count = 0;
  cursor.onsuccess = () => {
    try {
      const row = cursor.result;
      if (!row) {
        if (attempt.payload.fulfillment === "delivery") reserveDeliveryReceipt(tx, attempt, fail);
        else tx.objectStore(ACTIVE).add(attempt);
        return;
      }
      const value = parseDeviceReceipt(row.value, attempt.tenant, attempt.origin);
      if (!value) corrupt();
      if (deviceReceiptExpired(value, now)) row.delete();
      else if (++count >= DEVICE_RECEIPT_LIMIT) throw new CheckoutAttemptStorageError("unavailable", "Ce navigateur conserve déjà 128 suivis de commandes récents. Oubliez un ancien suivi dans « Mes commandes sur cet appareil » avant de commander.");
      row.continue();
    } catch (error) { fail(error); }
  };
}
export async function acquireCheckoutAttempt(
  tenant: string,
  input: Readonly<{ payload: CheckoutBusinessPayload; cartFingerprint: string; provenance?: CheckoutProvenance }>,
): Promise<{ attempt: CheckoutAttempt; acquired: boolean }> {
  const { origin } = scope(tenant);
  const cartFingerprint = input.cartFingerprint;
  if (!HEX_256.test(cartFingerprint)) invalid();
  const payload = businessPayload(input.payload);
  const owner = provenanceValue(input.provenance ?? { kind: "guest" });
  return transaction(tenant, ACTIVE, true, (current, tx, fail, privacy) => {
    validateAdmission(owner, privacy);
    if (current) {
      if (!sameProvenance(provenance(current), owner) || current.state === "private-settled") conflict();
      if (owner.kind === "account" && !privacy.present) corrupt();
      return { attempt: current, acquired: false };
    }
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    const now = Date.now();
    const attempt: PendingCheckoutAttempt = {
      v: VERSION, provenance: owner, tenant, origin, clientId: window.crypto.randomUUID(),
      recoveryProof: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      cartFingerprint, createdAt: now, updatedAt: now, state: "prepared", payload,
    };
    if (owner.kind === "account" && !privacy.present) tx.objectStore(PRIVACY).add({ tenant, origin, epoch: privacy.epoch });
    reserveDeviceReceipt(tx, attempt, fail);
    return { attempt, acquired: true };
  });
}
function matching(current: CheckoutAttempt | null, clientId: string): CheckoutAttempt {
  if (!current || current.clientId !== clientId) throw new CheckoutAttemptStorageError("conflict", "Une autre tentative de commande est active. Vérifiez son état avant de continuer.");
  return current;
}
export function markCheckoutAttemptUncertain(tenant: string, clientId: string, expectedProvenance?: CheckoutProvenance): Promise<CheckoutAttempt> {
  const expected = provenanceValue(expectedProvenance ?? { kind: "guest" });
  return transaction(tenant, ACTIVE, true, (current, tx, _fail, privacy) => {
    const attempt = matching(current, clientId);
    if (!sameProvenance(provenance(attempt), expected)) conflict();
    validateAdmission(expected, privacy);
    if (expected.kind === "account" && !privacy.present) corrupt();
    if (attempt.state === "private-settled") conflict();
    if (attempt.state !== "prepared") return attempt;
    const next: PendingCheckoutAttempt = { ...attempt, state: "uncertain", updatedAt: Math.max(attempt.updatedAt, Date.now()) };
    tx.objectStore(ACTIVE).put(next);
    return next;
  });
}
/** Call only with an authoritative POST/recovery response, before clearing the matching cart. */
export async function recordCheckoutReceipt(tenant: string, clientId: string, input: Omit<CheckoutReceipt, "recoveryProof">): Promise<ReceivedCheckoutAttempt | PrivateSettledCheckoutAttempt> {
  const receipt = receiptValue(input);
  const receiptFingerprint = await checkoutCartFingerprint(["checkout-receipt-v1", receipt.orderId, receipt.trackingToken]);
  return transaction(tenant, ACTIVE, true, (current, tx, _fail, privacy) => {
    const attempt = matching(current, clientId);
    if (attempt.state === "rejected") throw new CheckoutAttemptStorageError("conflict", "Cette tentative a déjà un rejet confirmé. Vérifiez la commande auprès du restaurant.");
    if (attempt.state === "private-settled") {
      if (attempt.receiptFingerprint !== receiptFingerprint) conflict();
      return attempt;
    }
    if (attempt.state === "received") {
      if (attempt.receipt.orderId !== receipt.orderId || attempt.receipt.trackingToken !== receipt.trackingToken) throw new CheckoutAttemptStorageError("conflict", "Le reçu correspond à une autre commande. Vérifiez la commande auprès du restaurant.");
      if (!accountLive(attempt, privacy)) {
        const hidden = privateSettled(attempt); tx.objectStore(ACTIVE).put(hidden); return hidden;
      }
      return attempt;
    }
    const next: ReceivedCheckoutAttempt = {
      ...identity(attempt),
      updatedAt: Math.max(attempt.updatedAt, Date.now()), state: "received",
      receipt: attempt.payload.fulfillment === "delivery" ? { ...receipt, recoveryProof: attempt.recoveryProof } : receipt,
      ...(provenance(attempt).kind === "account" ? { receiptFingerprint } : {}),
    };
    // Remove the customer, address and note. Only a delivery keeps its original
    // capability in the receipt so a same-origin payment return can restore it.
    // Historical receipts without this optional field remain readable, not upgraded.
    if (!accountLive(attempt, privacy)) {
      const hidden = privateSettled(next); tx.objectStore(ACTIVE).put(hidden); return hidden;
    }
    tx.objectStore(ACTIVE).put(next);
    tx.objectStore(DEVICE_RECEIPTS).add(deviceReceipt(next));
    if (next.receipt.recoveryProof) tx.objectStore(DELIVERY_RECEIPTS).add(next);
    return next;
  });
}
/** Only a verified server fence is authoritative; a local HTTP/network error is not a rejection. */
export function recordCheckoutRejection(tenant: string, clientId: string, input: CheckoutRejection): Promise<RejectedCheckoutAttempt> {
  const rejection = rejectionValue(input);
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    const attempt = matching(current, clientId);
    if (attempt.state === "received" || attempt.state === "private-settled") throw new CheckoutAttemptStorageError("conflict", "Cette tentative possède déjà un reçu. Vérifiez la commande auprès du restaurant.");
    if (attempt.state === "rejected") return attempt;
    const next: RejectedCheckoutAttempt = {
      ...identity(attempt),
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
  return transaction(tenant, ACTIVE, true, (current, tx, _fail, privacy) => {
    const attempt = matching(current, clientId);
    if (attempt.state !== "received" && attempt.state !== "private-settled") throw new CheckoutAttemptStorageError("conflict", "La tentative doit être réconciliée avant de commencer une autre commande.");
    if (attempt.state === "received" && accountLive(attempt, privacy)) tx.objectStore(RECEIPTS).put(attempt);
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
