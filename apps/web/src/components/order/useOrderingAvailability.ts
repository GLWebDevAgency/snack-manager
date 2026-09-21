"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicOrderingAvailability } from "@sm/contracts";
import type { OrderingApi } from "./api";

type LiveState = { status: "checking" | "fresh" | "offline" | "unavailable";
  data: PublicOrderingAvailability | null; serverNow: number };
const unknown: LiveState = { status: "checking", data: null, serverNow: 0 };
const POLL_MS = 45_000;
const FRESH_MS = 60_000;
const MIN_POLL_MS = 5_000;

/** Availability has a short lifetime; catalogue, cart and payment do not.
 * No cached availability is authoritative after a visibility/network change.
 * Server observation + elapsed request time conservatively filters old slots;
 * the browser wall clock is never used to promise a pickup time. */
export function useOrderingAvailability(slug: string, api: OrderingApi, demo: boolean) {
  const [state, setState] = useState<LiveState>(unknown);
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (demo) return;
    let alive = true;
    let active: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let fresh = false;
    const visible = () => document.visibilityState !== "hidden";
    function invalidate(status: LiveState["status"]) {
      clearTimeout(timer); clearTimeout(expiry); fresh = false;
      active?.abort(); active = null;
      if (alive) setState({ ...unknown, status });
    }
    function read(soft = false) {
      if (!alive) return;
      if (!navigator.onLine) { invalidate("offline"); return; }
      if (!visible()) { invalidate("checking"); return; }
      if (!soft) { clearTimeout(expiry); fresh = false; setState(unknown); }
      if (active) return;
      clearTimeout(timer);
      const controller = new AbortController(); active = controller;
      const started = performance.now();
      void api.loadAvailability(slug, controller.signal).then(data => {
        if (!alive || active !== controller || controller.signal.aborted) return;
        const elapsed = Math.max(0, performance.now() - started);
        const serverNow = Date.parse(data.observedAt) + elapsed;
        // Refresh before the displayed first slot becomes past, never in a
        // rapid retry loop when the API returns an expired/full slot list.
        const upcoming = data.slots.slots.find(slot => !slot.full && Date.parse(slot.iso) > serverNow + MIN_POLL_MS);
        const lifetime = Math.max(0, Math.min(FRESH_MS - elapsed, upcoming ? Date.parse(upcoming.iso) - serverNow : FRESH_MS));
        clearTimeout(expiry); fresh = true;
        expiry = setTimeout(() => {
          fresh = false;
          setState({ ...unknown, status: active ? "checking" : "unavailable" });
          if (!active) read();
        }, lifetime);
        setState({ status: "fresh", data: { ...data, slots: { ...data.slots,
          slots: data.slots.slots.filter(slot => Date.parse(slot.iso) > serverNow + MIN_POLL_MS),
        } }, serverNow });
      }).catch(() => {
        if (alive && active === controller && !controller.signal.aborted && !fresh) setState({ ...unknown, status: "unavailable" });
      }).finally(() => {
        if (!alive || active !== controller) return;
        active = null;
        if (visible() && navigator.onLine) timer = setTimeout(() => read(true), POLL_MS);
      });
    }
    const resumed = () => read();
    // Iframe fields also emit window.focus: keep a still-fresh observation
    // during that read so the pending confirmation click remains actionable.
    const focused = () => read(fresh);
    const suspended = () => invalidate(navigator.onLine ? "checking" : "offline");
    const visibility = () => { if (visible()) read(); else suspended(); };
    refreshRef.current = resumed;
    window.addEventListener("focus", focused);
    window.addEventListener("pageshow", resumed);
    window.addEventListener("pagehide", suspended);
    window.addEventListener("online", resumed);
    window.addEventListener("offline", suspended);
    document.addEventListener("visibilitychange", visibility);
    read();
    return () => {
      alive = false; clearTimeout(timer); clearTimeout(expiry); active?.abort();
      refreshRef.current = () => {};
      window.removeEventListener("focus", focused);
      window.removeEventListener("pageshow", resumed);
      window.removeEventListener("pagehide", suspended);
      window.removeEventListener("online", resumed);
      window.removeEventListener("offline", suspended);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [slug, api, demo]);
  return { ...state, refresh };
}
