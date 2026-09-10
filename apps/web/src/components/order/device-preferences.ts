import type { MenuCategory } from './api';
import { groupRules, type Draft } from './cart';

/** Convenience selections only. Never identity, an allergy guarantee or an
 * authorization to substitute a product, change a variant or submit an order. */
export type DevicePreferences = Readonly<{ removed: readonly string[]; sauces: readonly string[] }>;
export const EMPTY_DEVICE_PREFERENCES: DevicePreferences = Object.freeze({ removed: Object.freeze([]), sauces: Object.freeze([]) });
export const DEVICE_PREFERENCES_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const PREFIX = 'sm.order-preferences.v1.';
const EVENT = 'sm:order-preferences-change';
const TENANT = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100
  && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 300)
  && new Set(value).size === value.length;
export function validDevicePreferences(value: unknown): value is DevicePreferences {
  return record(value) && Object.keys(value).sort().join() === 'removed,sauces' && keys(value.removed) && keys(value.sauces);
}
export function parseDevicePreferences(raw: string | null, tenant: string, now = Date.now()): DevicePreferences | null {
  if (!raw || raw.length > 65_536 || !TENANT.test(tenant)) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!record(data) || Object.keys(data).sort().join() !== 'expiresAt,preferences,savedAt,tenant,v'
      || data.v !== 1 || data.tenant !== tenant || !Number.isSafeInteger(data.savedAt) || (data.savedAt as number) < 0
      || (data.savedAt as number) > now || data.expiresAt !== (data.savedAt as number) + DEVICE_PREFERENCES_TTL_MS
      || (data.expiresAt as number) <= now || !validDevicePreferences(data.preferences)) return null;
    return data.preferences;
  } catch { return null; }
}
function storageKey(tenant: string) {
  if (!TENANT.test(tenant)) throw new Error('Restaurant invalide');
  return PREFIX + tenant;
}
async function locked<T>(tenant: string, action: (key: string) => T): Promise<T> {
  const key = storageKey(tenant);
  if (!navigator.locks?.request) throw new Error('Mémorisation indisponible');
  return navigator.locks.request(key, { signal: AbortSignal.timeout(5_000) }, () => action(key));
}
export function readDevicePreferences(tenant: string): Promise<DevicePreferences> {
  return locked(tenant, key => {
    const raw = localStorage.getItem(key), value = parseDevicePreferences(raw, tenant);
    if (raw !== null && value === null) localStorage.removeItem(key);
    return value ?? EMPTY_DEVICE_PREFERENCES;
  });
}
export async function saveDevicePreferences(tenant: string, preferences: DevicePreferences): Promise<void> {
  if (!validDevicePreferences(preferences)) throw new Error('Préférences invalides');
  const snapshot = structuredClone(preferences);
  await locked(tenant, key => {
    const savedAt = Date.now();
    localStorage.setItem(key, JSON.stringify({ v: 1, tenant, savedAt, expiresAt: savedAt + DEVICE_PREFERENCES_TTL_MS, preferences: snapshot }));
  });
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tenant }));
}
export async function forgetDevicePreferences(tenant: string): Promise<void> {
  await locked(tenant, key => localStorage.removeItem(key));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: tenant }));
}
export function subscribeDevicePreferences(tenant: string, changed: () => void): () => void {
  const key = storageKey(tenant);
  const storage = (event: StorageEvent) => { if (event.storageArea === localStorage && (event.key === key || event.key === null)) changed(); };
  const local = (event: Event) => { if ((event as CustomEvent).detail === tenant) changed(); };
  window.addEventListener('storage', storage); window.addEventListener(EVENT, local);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(EVENT, local); };
}

/** The menu owns the exact keys. In particular, a sauce name never selects a
 * similarly named paid supplement, and a missing key never selects a neighbor. */
export function applyDevicePreferences(draft: Draft, preferences: DevicePreferences): Draft {
  if (draft.lineId !== null || !validDevicePreferences(preferences)) return draft;
  const removed = [...new Set([...draft.removed, ...preferences.removed.filter(key => draft.product.removables.some(item => item.key === key))])];
  const sauces = draft.product.groups.find(group => group.key === 'sauces');
  if (!sauces) return { ...draft, removed };
  const { max } = groupRules(sauces, draft.variantKey);
  const choices = preferences.sauces.filter(key => sauces.choices.some(choice => choice.key === key)).slice(0, max);
  return { ...draft, removed, picked: choices.length ? { ...draft.picked, sauces: choices } : draft.picked };
}
export function devicePreferenceOptions(categories: readonly MenuCategory[]) {
  const removed = new Map<string, string>(), sauces = new Map<string, string>();
  for (const product of categories.flatMap(category => category.products)) {
    for (const item of product.removables) removed.set(item.key, item.label);
    for (const choice of product.groups.find(group => group.key === 'sauces')?.choices ?? []) sauces.set(choice.key, choice.name);
  }
  const sorted = (entries: Map<string, string>) => [...entries].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  return { removed: sorted(removed), sauces: sorted(sauces) };
}
export function reconcileDevicePreferences(preferences: DevicePreferences, categories: readonly MenuCategory[]): DevicePreferences {
  const options = devicePreferenceOptions(categories);
  return { removed: preferences.removed.filter(key => options.removed.some(item => item.key === key)),
    sauces: preferences.sauces.filter(key => options.sauces.some(item => item.key === key)) };
}
