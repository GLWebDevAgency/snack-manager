"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createCustomerAccountClient, customerAccountRequest, EMPTY_ACCOUNT } from "./client";

/** One in-memory projection and one set of listeners per tenant in this document.
 * Cross-tab messages contain ONLY an invalidation nonce, never a personal field. */
function runtime(slug: string) {
  let users = 0; let expiry: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | null = null;
  const key = `sm:customer:invalidate:${slug}`;
  const active = () => users > 0 && document.visibilityState !== "hidden" && navigator.onLine !== false;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const client = createCustomerAccountClient({ request: customerAccountRequest(slug), active,
    lock: locks ? async job => { await locks.request(`sm:customer:${slug}`, { mode: "exclusive", signal: AbortSignal.timeout(15_000) }, job); } : undefined,
    announce: () => {
      const nonce = crypto.randomUUID();
      let sent = false;
      try { if (channel) { channel.postMessage(nonce); sent = true; } } catch { /* Try storage. */ }
      try { localStorage.setItem(key, nonce); sent = true; } catch { /* BroadcastChannel may suffice. */ }
      if (!sent) throw new Error("Cross-tab invalidation unavailable");
    },
  });
  const refresh = () => { if (active()) void client.refresh(); };
  const pause = () => { client.invalidate(navigator.onLine === false ? "offline" : "idle"); };
  const resume = () => { pause(); refresh(); };
  const visibility = () => { if (document.visibilityState === "hidden") pause(); else resume(); };
  const incoming = () => { pause(); refresh(); /* Reads wait for the same mutation lock. */ };
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) incoming(); };
  const scheduleExpiry = () => {
    clearTimeout(expiry); const view = client.getSnapshot().view;
    if (view) expiry = setTimeout(() => client.invalidate("guest"), Math.max(0, view.expiresAt - Date.now()));
  };
  let unsubscribeExpiry: (() => void) | undefined;
  return { client, retain: () => {
    users++;
    if (users === 1) {
      try { channel = new BroadcastChannel(key); channel.addEventListener("message", incoming); } catch { channel = null; }
      window.addEventListener("storage", storage); window.addEventListener("focus", resume);
      window.addEventListener(key, incoming);
      window.addEventListener("pageshow", resume); window.addEventListener("pagehide", pause);
      window.addEventListener("online", resume); window.addEventListener("offline", pause);
      document.addEventListener("visibilitychange", visibility);
      unsubscribeExpiry = client.subscribe(scheduleExpiry); resume();
    }
    return () => {
      users--;
      if (users === 0) {
        client.invalidate(); clearTimeout(expiry); unsubscribeExpiry?.(); channel?.close(); channel = null;
        window.removeEventListener("storage", storage); window.removeEventListener("focus", resume);
        window.removeEventListener(key, incoming);
        window.removeEventListener("pageshow", resume); window.removeEventListener("pagehide", pause);
        window.removeEventListener("online", resume); window.removeEventListener("offline", pause);
        document.removeEventListener("visibilitychange", visibility);
      }
    };
  } };
}
const instances = new Map<string, ReturnType<typeof runtime>>();
function getRuntime(slug: string) {
  const previous = instances.get(slug); if (previous) return previous;
  const next = runtime(slug); instances.set(slug, next); return next;
}
const noopSubscribe = () => () => undefined;
const emptySnapshot = () => EMPTY_ACCOUNT;
const noRefresh = async () => undefined;
const noMutation = async () => false;
const noAccess = () => null;

export function useCustomerAccount(slug: string, enabled: boolean) {
  const shared = useMemo(() => enabled && typeof window !== "undefined" ? getRuntime(slug) : null, [enabled, slug]);
  const state = useSyncExternalStore(shared?.client.subscribe ?? noopSubscribe, shared?.client.getSnapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => shared?.retain(), [shared]);
  return { state, refresh: shared?.client.refresh ?? noRefresh, saveName: shared?.client.saveName ?? noMutation,
    logout: shared?.client.logout ?? noMutation, currentAccess: shared?.client.currentAccess ?? noAccess };
}
