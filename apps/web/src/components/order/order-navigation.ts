"use client";

import { useSyncExternalStore } from "react";

export type OrderView = "menu" | "search" | "orders";
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

export function navigateOrderView(slug: string, key: OrderView, embedded: boolean) {
  const url = new URL(window.location.href);
  if (embedded) {
    if (key === "menu") url.searchParams.delete("vue");
    else url.searchParams.set("vue", key);
  } else {
    url.pathname = `/r/${encodeURIComponent(slug)}${key === "search" ? "/recherche" : key === "orders" ? "/commandes" : "/carte"}`;
  }
  window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(eventName));
}
