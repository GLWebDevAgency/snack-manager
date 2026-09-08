"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCustomerAccount } from "../customer-account/useCustomerAccount";
import {
  forgetRememberedCustomer, readRememberedCustomer, rememberCustomer, subscribeCustomerMemory,
  type Customer, type RememberedCustomer,
} from "./customer-memory";

type Details = {
  scope: string;
  customer: Customer;
  edited: { name: boolean; phone: boolean };
  remembered: RememberedCustomer | null;
  message: string | null;
  busy: boolean;
  memoryCycle: object | null;
};
function empty(scope: string): Details {
  return { scope, customer: { name: "", phone: "" }, edited: { name: false, phone: false }, remembered: null, message: null, busy: false, memoryCycle: null };
}
export type CustomerDetailsSource = "input" | "memory" | "account" | null;
export type CustomerDetailsProvenance = { name: CustomerDetailsSource; phone: CustomerDetailsSource };

/** No automatic writes: only an explicit save can remember these unverified details.
 * Revocation/expiry in another tab cannot be reversed by submit, focus or typing.
 */
export function useCustomerDetails(tenant: string, demo: boolean, open: boolean, accountEnabled = true) {
  const scope = `${demo ? "demo" : "restaurant"}:${tenant}`;
  const [state, setState] = useState<Details>(() => empty(scope));
  const current = state.scope === scope ? state : empty(scope);
  const { state: account } = useCustomerAccount(tenant, open && !demo && accountEnabled);
  // A new opening/scope must finish its own memory read, including when another
  // account component already has a live profile. Explicit local consent wins.
  const memoryCycle = useMemo(() => ({ scope, open }), [scope, open]);
  const profile = open && !demo && accountEnabled && current.memoryCycle === memoryCycle && account.status === "authenticated"
    ? account.view?.profile : null;
  // Keep account suggestions derived: no personal field enters draft/storage
  // merely because a private response arrived. Invalidation removes the overlay.
  const fromAccount = {
    name: !current.edited.name && !current.customer.name && !!profile?.name,
    phone: !current.edited.phone && !current.customer.phone && !!profile?.phoneE164,
  };
  const customer = {
    name: fromAccount.name ? profile!.name! : current.customer.name,
    phone: fromAccount.phone ? profile!.phoneE164 : current.customer.phone,
  };
  const provenance: CustomerDetailsProvenance = {
    name: current.edited.name ? "input" : fromAccount.name ? "account" : current.customer.name ? "memory" : null,
    phone: current.edited.phone ? "input" : fromAccount.phone ? "account" : current.customer.phone ? "memory" : null,
  };
  const operation = useRef(0);
  const changed = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open || demo) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let alive = true;
    const initialOperation = operation.current;
    const refresh = () => {
      clearTimeout(timer);
      const expected = ++generation;
      void readRememberedCustomer(tenant).then(remembered => {
        if (!alive || expected !== generation) return;
        setState(previous => {
          const base = previous.scope === scope ? previous : empty(scope);
          return { ...base, memoryCycle, remembered, message: null, busy: base.busy && operation.current !== initialOperation,
            customer: {
              name: base.edited.name ? base.customer.name : remembered?.customer.name ?? "",
              phone: base.edited.phone ? base.customer.phone : remembered?.customer.phone ?? "",
            } };
        });
        if (remembered) timer = setTimeout(refresh, Math.max(1, remembered.expiresAt - Date.now()));
      }).catch(() => {
        if (!alive || expected !== generation) return;
        setState(previous => {
          const base = previous.scope === scope ? previous : empty(scope);
          return { ...base, memoryCycle, remembered: null, busy: base.busy && operation.current !== initialOperation,
            customer: { name: base.edited.name ? base.customer.name : "", phone: base.edited.phone ? base.customer.phone : "" },
            message: "La mémorisation est indisponible. Vous pouvez continuer à commander sans enregistrer vos coordonnées." };
        });
      });
    };
    changed.current = refresh;
    refresh();
    const unsubscribe = subscribeCustomerMemory(tenant, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => { alive = false; generation++;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate whichever operation is current at cleanup, not the one at effect setup.
      operation.current++;
      changed.current = null;
      clearTimeout(timer); unsubscribe(); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", refresh); };
  }, [tenant, scope, demo, open, memoryCycle]);

  function change(next: Customer) {
    // Inputs pass the whole visible form; changing one field must not adopt the
    // other field's account overlay as voluntary input. A deliberate clear does.
    const nameChanged = next.name !== customer.name;
    const phoneChanged = next.phone !== customer.phone;
    setState(previous => {
      const base = previous.scope === scope ? previous : empty(scope);
      return { ...base, customer: {
        name: nameChanged ? next.name : base.customer.name,
        phone: phoneChanged ? next.phone : base.customer.phone,
      }, message: null, edited: {
        name: base.edited.name || nameChanged,
        phone: base.edited.phone || phoneChanged,
      } };
    });
  }
  async function save() {
    if (demo || !open || current.busy) return;
    const expected = ++operation.current;
    const snapshot = { ...customer };
    setState(previous => ({ ...(previous.scope === scope ? previous : empty(scope)), busy: true }));
    try {
      await rememberCustomer(tenant, snapshot);
      setState(previous => {
        if (previous.scope !== scope) return previous;
        // Keystrokes while waiting for the lock remain new, unpersisted input.
        // Even if the form closed, these unchanged fields were saved: keeping
        // them marked as a fresh draft would resurrect a later-forgotten record.
        // This only updates provenance; never insert values from a late result.
        return { ...previous, busy: expected === operation.current ? false : previous.busy, edited: {
          name: previous.customer.name === snapshot.name ? false : previous.edited.name,
          phone: previous.customer.phone === snapshot.phone ? false : previous.edited.phone,
        } };
      });
      if (expected !== operation.current) return;
      // Reread, never restore a snapshot after another tab has forgotten it.
      changed.current?.();
    } catch {
      if (expected !== operation.current) return;
      setState(previous => ({ ...(previous.scope === scope ? previous : empty(scope)), busy: false,
        message: "Vos coordonnées n’ont pas pu être mémorisées. Vous pouvez continuer sans les enregistrer." }));
    }
  }
  async function forget() {
    if (demo || !open || current.busy) return;
    const expected = ++operation.current;
    const snapshot = { ...current.customer };
    setState(previous => ({ ...(previous.scope === scope ? previous : empty(scope)), busy: true }));
    try {
      await forgetRememberedCustomer(tenant);
      setState(previous => {
        if (previous.scope !== scope) return previous;
        // A delayed forget removes only the draft present at the explicit click.
        // New input while the lock was held stays local and is never persisted.
        const nameChanged = previous.customer.name !== snapshot.name;
        const phoneChanged = previous.customer.phone !== snapshot.phone;
        return { ...empty(scope),
          busy: expected === operation.current ? false : previous.busy,
          customer: { name: nameChanged ? previous.customer.name : "", phone: phoneChanged ? previous.customer.phone : "" },
          edited: { name: nameChanged, phone: phoneChanged },
          message: "Coordonnées mémorisées effacées. Vos nouvelles saisies et commandes déjà envoyées sont conservées." };
      });
      if (expected !== operation.current) return;
      changed.current?.();
    } catch {
      if (expected !== operation.current) return;
      setState(previous => ({ ...(previous.scope === scope ? previous : empty(scope)), busy: false,
        message: "L’effacement n’a pas pu être confirmé. Réessayez ou effacez les données de ce site dans votre navigateur." }));
    }
  }
  return { customer, provenance, change, save, forget, remembered: current.remembered, message: current.message, busy: current.busy };
}
