"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createCustomerAccountClient, customerAccountRequest, EMPTY_ACCOUNT, type CustomerAccountRequest } from "./client";
import { invalidateAccountCheckoutAccess, readCheckoutPrivacyEpoch, type CheckoutAccountAccess } from "../order/checkout-attempt";

const BARRIER_FAILED = "La protection locale de vos commandes n’a pas pu être enregistrée. La déconnexion n’a pas été envoyée. Autorisez le stockage puis réessayez.";
export function checkoutAccountAccessKey(access: CheckoutAccountAccess | null) {
  return access ? JSON.stringify([access.selection.browserRef, access.selection.publication.expectedOperationId,
    access.selection.publication.expectedCheckId, access.expiresAt, access.privacyEpoch]) : "guest";
}

/** One in-memory projection and one set of listeners per tenant in this document.
 * Cross-tab messages contain ONLY an invalidation nonce, never a personal field. */
function runtime(slug: string) {
  let users = 0; let expiry: ReturnType<typeof setTimeout> | undefined;
  let channel: BroadcastChannel | null = null;
  const key = `sm:customer:invalidate:${slug}`;
  let barrierFailed = false;
  let checkoutAccess: CheckoutAccountAccess | null = null;
  const active = () => users > 0 && document.visibilityState !== "hidden" && navigator.onLine !== false;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const transport = customerAccountRequest(slug);
  const request: CustomerAccountRequest = async (action, body, selected) => {
    if (action === "logout") {
      // This boundary is inside the account client's existing mutation lock,
      // after its exact-publication preflight, but BEFORE the HTTP DELETE.
      checkoutAccess = null; barrierFailed = false;
      try { await invalidateAccountCheckoutAccess(slug); }
      catch (error) { barrierFailed = true; throw error; }
    }
    let epoch: number | null = null;
    if (action === "session") {
      checkoutAccess = null;
      // A profile may still be consulted when checkout storage is unavailable;
      // it must not gain access to local account receipts in that case.
      try { epoch = await readCheckoutPrivacyEpoch(slug); } catch { /* Fail closed for checkout access only. */ }
    }
    const raw = await transport(action, body, selected);
    if (action === "session" && selected && epoch !== null) {
      try {
        if (epoch === await readCheckoutPrivacyEpoch(slug) && raw && typeof raw === "object" && "expiresAt" in raw
          && typeof raw.expiresAt === "number") {
          checkoutAccess = { selection: structuredClone(selected), expiresAt: raw.expiresAt, privacyEpoch: epoch };
        }
      } catch { /* Never recapture a newer epoch after this response. */ }
    }
    if (action === "session") barrierFailed = false;
    return raw;
  };
  // The client pins the displayed publication using this port; a wrapper
  // without it would turn every authenticated preflight into a conflict.
  request.selection = transport.selection;
  const client = createCustomerAccountClient({ request, active,
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
  return { client, barrierFailed: () => barrierFailed,
    currentCheckoutAccess: (): CheckoutAccountAccess | null => {
      const access = client.currentAccess();
      return access && checkoutAccess && access.expiresAt === checkoutAccess.expiresAt
        && access.selection.browserRef === checkoutAccess.selection.browserRef
        && access.selection.publication.expectedOperationId === checkoutAccess.selection.publication.expectedOperationId
        && access.selection.publication.expectedCheckId === checkoutAccess.selection.publication.expectedCheckId
        ? structuredClone(checkoutAccess) : null;
    }, retain: () => {
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
  return { state: shared?.barrierFailed() && state.status === "error" ? { ...state, message: BARRIER_FAILED } : state,
    refresh: shared?.client.refresh ?? noRefresh, saveName: shared?.client.saveName ?? noMutation,
    logout: shared?.client.logout ?? noMutation, currentAccess: shared?.client.currentAccess ?? noAccess,
    currentCheckoutAccess: shared?.currentCheckoutAccess ?? noAccess };
}
