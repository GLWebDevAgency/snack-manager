import {
  CreatePublicOrderSchema,
  OrderStatusSchema,
  OrderTypeSchema,
  PaymentMethodSchema,
  PaymentStatusSchema,
  type CreatePublicOrder,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
  type PaymentStatus,
} from "@sm/contracts";

export type CheckoutBusinessPayload = Omit<CreatePublicOrder, "clientId" | "turnstileToken" | "recoveryProof">;
export type CheckoutReceipt = Readonly<{
  orderId: string;
  trackingToken: string;
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

const DATABASE = "sm.checkout-attempts";
const VERSION = 1;
const ACTIVE = "active";
const RECEIPTS = "last-receipt";
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
function receiptValue(value: unknown): CheckoutReceipt {
  if (!object(value) || !onlyKeys(value, ["orderId", "trackingToken", "number", "status", "type", "payment"]) || !nonempty(value.orderId, 128) || !nonempty(value.trackingToken, 2_048)) invalid();
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
      receiptValue(raw.receipt);
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
      const request = window.indexedDB.open(DATABASE, VERSION);
      request.onblocked = fail;
      request.onerror = fail;
      request.onupgradeneeded = (event) => {
        // Never recreate missing stores or delete an unknown/future journal.
        if (settled || event.oldVersion !== 0) { request.transaction?.abort(); fail(); return; }
        request.result.createObjectStore(ACTIVE, { keyPath: "tenant" });
        request.result.createObjectStore(RECEIPTS, { keyPath: "tenant" });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true;
        clearTimeout(timer);
        db.onversionchange = () => db.close();
        if (db.objectStoreNames.length !== 2 || !db.objectStoreNames.contains(ACTIVE) || !db.objectStoreNames.contains(RECEIPTS)) { db.close(); reject(new CheckoutAttemptStorageError("corrupt", "Le journal de commande est endommagé ou incompatible.")); return; }
        resolve(db);
      };
    } catch { fail(); }
  });
}

/** Every mutation resolves only after strict transaction completion, never request success. */
async function transaction<T>(
  tenant: string,
  storeName: typeof ACTIVE | typeof RECEIPTS,
  write: boolean,
  action: (current: CheckoutAttempt | null, tx: IDBTransaction) => T,
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
      tx = db.transaction(write ? [ACTIVE, RECEIPTS] : [storeName], write ? "readwrite" : "readonly", { durability: "strict" });
      tx.oncomplete = () => { finish(); if (write) notify(tenant); };
      tx.onabort = () => finish(failure ?? unavailable());
      tx.onerror = () => { failure ??= unavailable(); };
      if (write && tx.durability !== "strict") throw unavailable();
      for (const name of Array.from(tx.objectStoreNames)) {
        const candidate = tx.objectStore(name);
        if (candidate.keyPath !== "tenant" || candidate.autoIncrement || candidate.indexNames.length !== 0) corrupt();
      }
      const store = tx.objectStore(storeName);
      const request = store.get(tenant);
      request.onsuccess = () => {
        try {
          const current = parseAttempt(request.result, tenant, origin);
          if (storeName === RECEIPTS && current && current.state !== "received") corrupt();
          result = action(current, tx!);
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
export async function acquireCheckoutAttempt(
  tenant: string,
  input: Readonly<{ payload: CheckoutBusinessPayload; cartFingerprint: string }>,
): Promise<{ attempt: CheckoutAttempt; acquired: boolean }> {
  const { origin } = scope(tenant);
  const cartFingerprint = input.cartFingerprint;
  if (!HEX_256.test(cartFingerprint)) invalid();
  const payload = businessPayload(input.payload);
  return transaction(tenant, ACTIVE, true, (current, tx) => {
    if (current) return { attempt: current, acquired: false };
    const bytes = window.crypto.getRandomValues(new Uint8Array(32));
    const now = Date.now();
    const attempt: PendingCheckoutAttempt = {
      v: VERSION, tenant, origin, clientId: window.crypto.randomUUID(),
      recoveryProof: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      cartFingerprint, createdAt: now, updatedAt: now, state: "prepared", payload,
    };
    tx.objectStore(ACTIVE).add(attempt);
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
export function recordCheckoutReceipt(tenant: string, clientId: string, input: CheckoutReceipt): Promise<ReceivedCheckoutAttempt> {
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
      updatedAt: Math.max(attempt.updatedAt, Date.now()), state: "received", receipt,
    };
    // Replacing the whole row removes the customer, address, note and recovery proof.
    tx.objectStore(ACTIVE).put(next);
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
