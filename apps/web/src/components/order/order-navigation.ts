"use client";

import { useEffect, useSyncExternalStore } from "react";
import { customerAppPath, type CustomerAppView } from "@sm/client-core";

export type OrderView = CustomerAppView;
const eventName = "sm:order-navigation";
const view = (value: string | null): OrderView => value === "search" || value === "orders" ? value : "menu";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("popstate", callback); window.removeEventListener(eventName, callback); };
};
const queryView = () => view(new URLSearchParams(window.location.search).get("vue"));
const serverView = (): OrderView => "menu";
const installRequested = () => new URLSearchParams(window.location.search).get("installer") === "1";
export function useOrderInstallationRequest() { return useSyncExternalStore(subscribe, installRequested, () => false); }

/** Demo and embed keep their transport and host URL. Real restaurant tabs
 * have reloadable routes; native history preserves the live cart controller. */
export function useEmbeddedOrderView() {
  return useSyncExternalStore(subscribe, queryView, serverView);
}

/** Keep an acknowledged private mutation on its current screen. App buttons
 * are disabled separately; Back and full-page departure need the same guard. */
export function useOrderNavigationLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const currentUrl = window.location.href;
    const back = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      window.history.pushState(null, "", currentUrl);
      window.dispatchEvent(new Event(eventName));
    };
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("popstate", back, true);
    window.addEventListener("beforeunload", leave);
    return () => { window.removeEventListener("popstate", back, true); window.removeEventListener("beforeunload", leave); };
  }, [locked]);
}

export function navigateOrderView(slug: string, key: OrderView, embedded: boolean) {
  const url = new URL(window.location.href);
  if (embedded) {
    // Embedded and demo visitors retain their guest-only destination set.
    if (key === "account" || key === "loyalty") return;
    if (key === "menu") url.searchParams.delete("vue");
    else url.searchParams.set("vue", key);
  } else {
    url.pathname = customerAppPath(slug, key);
    url.hash = "";
    url.searchParams.delete("vue");
    url.searchParams.delete("installer");
  }
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(eventName));
}
