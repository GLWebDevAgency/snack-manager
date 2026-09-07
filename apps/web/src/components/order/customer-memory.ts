import { phoneOk } from "./helpers";

/** Convenience only: never a verified identity, loyalty session or order owner. */
export type Customer = { name: string; phone: string };
export type RememberedCustomer = Readonly<{ v: 1; tenant: string; savedAt: number; expiresAt: number; customer: Customer }>;
export const CUSTOMER_MEMORY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const PREFIX = "sm.customer.v1.";
const LEGACY_KEY = "sm.customer";
const EVENT = "sm:customer-memory-change";
const TENANT = /^[a-z0-9][a-z0-9_-]{0,127}$/;

function key(tenant: string): string {
  if (!TENANT.test(tenant)) throw new Error("Restaurant invalide");
  return PREFIX + tenant;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validRememberedCustomer(value: unknown): value is Customer {
  return record(value) && Object.keys(value).sort().join() === "name,phone"
    && typeof value.name === "string" && value.name.trim().length >= 2 && value.name.length <= 120
    && typeof value.phone === "string" && value.phone.length <= 32 && phoneOk(value.phone);
}
export function parseRememberedCustomer(raw: string | null, tenant: string, now: number): RememberedCustomer | null {
  if (!raw || raw.length > 2_048 || !TENANT.test(tenant) || !Number.isSafeInteger(now)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || Object.keys(value).sort().join() !== "customer,expiresAt,savedAt,tenant,v"
      || value.v !== 1 || value.tenant !== tenant || !Number.isSafeInteger(value.savedAt) || (value.savedAt as number) < 0
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt !== (value.savedAt as number) + CUSTOMER_MEMORY_TTL_MS
      || (value.savedAt as number) > now || (value.expiresAt as number) <= now || !validRememberedCustomer(value.customer)) return null;
    return value as RememberedCustomer;
  } catch { return null; }
}
async function locked<T>(tenant: string, action: () => T): Promise<T> {
  const storageKey = key(tenant);
  if (!navigator.locks?.request) throw new Error("Mémorisation indisponible");
  return navigator.locks.request(storageKey, { signal: AbortSignal.timeout(5_000) }, action);
}
export function readRememberedCustomer(tenant: string): Promise<RememberedCustomer | null> {
  // The old key had no tenant, consent or expiry. Never infer its restaurant.
  // Retire this convenience cache only, never cart, C01 or delivery credentials.
  return locked(tenant, () => {
    localStorage.removeItem(LEGACY_KEY);
    const storageKey = key(tenant);
    const raw = localStorage.getItem(storageKey);
    const value = parseRememberedCustomer(raw, tenant, Date.now());
    // Purge and save share one lock, so an expired read never deletes a newer save.
    if (raw !== null && !value) localStorage.removeItem(storageKey);
    return value;
  });
}
export async function rememberCustomer(tenant: string, customer: Customer): Promise<RememberedCustomer> {
  if (!validRememberedCustomer(customer)) throw new Error("Vérifiez vos coordonnées avant de les mémoriser.");
  const snapshot = { name: customer.name.trim(), phone: customer.phone.trim() };
  const value = await locked(tenant, () => {
    const savedAt = Date.now();
    const value: RememberedCustomer = { v: 1, tenant, savedAt, expiresAt: savedAt + CUSTOMER_MEMORY_TTL_MS, customer: snapshot };
    localStorage.setItem(key(tenant), JSON.stringify(value));
    return value;
  });
  notify(tenant);
  return value;
}
export async function forgetRememberedCustomer(tenant: string): Promise<void> {
  await locked(tenant, () => { localStorage.removeItem(key(tenant)); localStorage.removeItem(LEGACY_KEY); });
  notify(tenant);
}
function notify(tenant: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tenant }));
}
export function subscribeCustomerMemory(tenant: string, changed: () => void): () => void {
  const storageKey = key(tenant);
  const storage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === null || event.key === storageKey)) changed();
  };
  const local = (event: Event) => { if ((event as CustomEvent).detail === tenant) changed(); };
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, local);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(EVENT, local); };
}
