"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readCheckoutAttempt,
  readLastCheckoutReceipt,
  subscribeCheckoutAttempts,
  type CheckoutAttempt,
  type ReceivedCheckoutAttempt,
} from "./checkout-attempt";

/** One journal shared by the storefront entry point and its checkout sheet. */
export function useCheckoutRecovery(slug: string, demo: boolean) {
  const [state, setState] = useState<{
    tenant: string;
    active: CheckoutAttempt | null;
    last: ReceivedCheckoutAttempt | null;
    error: string | null;
  } | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    if (demo) return;
    const current = ++generation.current;
    try {
      const [active, last] = await Promise.all([
        readCheckoutAttempt(slug), readLastCheckoutReceipt(slug),
      ]);
      if (current === generation.current) setState({ tenant: slug, active, last, error: null });
    } catch {
      if (current === generation.current) setState(previous => ({
        tenant: slug,
        active: previous?.tenant === slug ? previous.active : null,
        last: previous?.tenant === slug ? previous.last : null,
        error: "La sauvegarde sécurisée de votre demande est indisponible sur ce navigateur. Aucun nouvel envoi n’est autorisé tant qu’elle ne fonctionne pas.",
      }));
    }
  }, [slug, demo]);
  const invalidate = useCallback(() => { generation.current++; }, []);

  useEffect(() => {
    if (demo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- IndexedDB is asynchronous external state, unavailable to SSR; updates happen only after its transaction completes.
    void refresh();
    const changed = () => { void refresh(); };
    const unsubscribe = subscribeCheckoutAttempts(changed);
    window.addEventListener("focus", changed);
    window.addEventListener("pageshow", changed);
    return () => {
      invalidate();
      unsubscribe();
      window.removeEventListener("focus", changed);
      window.removeEventListener("pageshow", changed);
    };
  }, [demo, refresh, invalidate]);

  return {
    ready: demo || state?.tenant === slug,
    active: !demo && state?.tenant === slug ? state.active : null,
    last: !demo && state?.tenant === slug ? state.last : null,
    error: !demo && state?.tenant === slug ? state.error : null,
    refresh,
  };
}

export type CheckoutRecovery = ReturnType<typeof useCheckoutRecovery>;
