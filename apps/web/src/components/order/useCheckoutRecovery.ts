"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutAccountAccessKey as accessKey, useCustomerAccount } from "../customer-account/useCustomerAccount";
import {
  readCheckoutRecovery,
  subscribeCheckoutAttempts,
  type CheckoutAttempt,
  type ReceivedCheckoutAttempt,
} from "./checkout-attempt";

function guest<T extends CheckoutAttempt | ReceivedCheckoutAttempt>(attempt: T | null): T | null {
  return attempt?.provenance?.kind === "account" ? null : attempt;
}

/** One journal shared by the storefront entry point and its checkout sheet. */
export function useCheckoutRecovery(slug: string, demo: boolean, accountEnabled = true) {
  const account = useCustomerAccount(slug, !demo && accountEnabled);
  const currentAccess = account.currentCheckoutAccess;
  const checkoutAccess = currentAccess();
  const selectedKey = accessKey(checkoutAccess);
  const [state, setState] = useState<{
    tenant: string;
    active: Awaited<ReturnType<typeof readCheckoutRecovery>>["active"];
    last: ReceivedCheckoutAttempt | null;
    hidden: { clientId: string; pending: boolean } | null;
    accessKey: string;
    error: string | null;
  } | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (demo) return;
    const current = ++generation.current;
    const access = currentAccess(), expectedKey = accessKey(access);
    // Clear private aliases before any asynchronous storage read, including
    // failed reads. Guest reconciliation remains independent of the account.
    setState(previous => previous?.tenant === slug ? { ...previous, active: guest(previous.active), last: guest(previous.last) } : null);
    if (expectedKey !== selectedKey) return;
    try {
      const { active, last, hidden } = await readCheckoutRecovery(slug, access);
      if (current === generation.current && expectedKey === accessKey(currentAccess())) {
        setState({ tenant: slug, active, last, hidden, accessKey: expectedKey, error: null });
      }
    } catch {
      if (current === generation.current) setState(previous => ({
        tenant: slug,
        active: previous?.tenant === slug ? guest(previous.active) : null,
        last: previous?.tenant === slug ? guest(previous.last) : null,
        hidden: previous?.tenant === slug ? previous.hidden : null,
        accessKey: "guest",
        error: "La sauvegarde sécurisée de votre demande est indisponible sur ce navigateur. Aucun nouvel envoi n’est autorisé tant qu’elle ne fonctionne pas.",
      }));
    }
  // selectedKey intentionally resubscribes when the validated publication,
  // absolute expiry or privacy fence changes, not when a profile field does.
  }, [slug, demo, currentAccess, selectedKey]);
  const invalidate = useCallback(() => { generation.current++; }, []);

  useEffect(() => {
    if (demo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB is asynchronous external state, unavailable to SSR; updates happen only after its transaction completes.
    void refresh();
    const changed = () => { invalidate(); void refresh(); };
    const unsubscribe = subscribeCheckoutAttempts(tenant => { if (tenant === slug) changed(); });
    window.addEventListener("focus", changed);
    window.addEventListener("pageshow", changed);
    window.addEventListener("offline", changed);
    window.addEventListener("online", changed);
    window.addEventListener("pagehide", changed);
    document.addEventListener("visibilitychange", changed);
    return () => {
      invalidate();
      unsubscribe();
      window.removeEventListener("focus", changed);
      window.removeEventListener("pageshow", changed);
      window.removeEventListener("offline", changed);
      window.removeEventListener("online", changed);
      window.removeEventListener("pagehide", changed);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [slug, demo, refresh, invalidate]);

  const visible = !demo && state?.tenant === slug ? state : null;
  const sameAccess = visible?.accessKey === selectedKey;

  return {
    ready: demo || state?.tenant === slug,
    active: visible ? sameAccess ? visible.active : guest(visible.active) : null,
    last: visible ? sameAccess ? visible.last : guest(visible.last) : null,
    hidden: visible?.hidden ?? null,
    checkoutAccess,
    currentCheckoutAccess: currentAccess,
    accountStatus: account.state.status,
    error: !demo && state?.tenant === slug ? state.error : null,
    refresh,
  };
}

export type CheckoutRecovery = ReturnType<typeof useCheckoutRecovery>;
