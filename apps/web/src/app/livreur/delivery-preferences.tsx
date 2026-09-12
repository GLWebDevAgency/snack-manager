"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeliveryAddress } from "@sm/contracts";

export type DeliveryPreferences = { theme: "dark" | "light" | "auto"; navigation: "google" | "apple" | "waze"; alerts: boolean; wake: boolean; reduceMotion: boolean; reduceTransparency: boolean };
const DEFAULTS: DeliveryPreferences = { theme: "dark", navigation: "google", alerts: false, wake: false, reduceMotion: false, reduceTransparency: false };
const KEY = "sm.delivery.preferences.v2";

export function useDeliveryPreferences() {
  const [preferences, setPreferences] = useState(DEFAULTS);
  const [systemDark, setSystemDark] = useState(true);
  const audio = useRef<AudioContext | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<DeliveryPreferences> | null;
      // Hydrate browser-only settings after the identical server/client initial render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw && typeof raw === "object") setPreferences({
        theme: ["dark", "light", "auto"].includes(raw.theme ?? "") ? raw.theme! : DEFAULTS.theme,
        navigation: ["google", "apple", "waze"].includes(raw.navigation ?? "") ? raw.navigation! : DEFAULTS.navigation,
        alerts: raw.alerts === true, wake: raw.wake === true,
        reduceMotion: raw.reduceMotion === true, reduceTransparency: raw.reduceTransparency === true,
      });
    } catch { /* Private browsing / malformed appearance preferences do not block access. */ }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(media.matches); sync();
    media.addEventListener("change", sync);
    return () => { media.removeEventListener("change", sync); void audio.current?.close().catch(() => {}); audio.current = null; };
  }, []);
  function update(patch: Partial<DeliveryPreferences>) {
    setPreferences(current => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Applies for this visit. */ }
      return next;
    });
  }
  const alert = useCallback(async (explicit = false) => {
    if (!explicit && document.visibilityState !== "visible") return;
    try {
      const Context = window.AudioContext;
      if (!Context) throw new Error("Audio unavailable");
      if (!audio.current || audio.current.state === "closed") audio.current = new Context();
      const context = audio.current;
      if (explicit) await context.resume();
      if (context.state !== "running") { setAlertMessage("Touchez « Tester l’alerte » pour autoriser le son sur ce navigateur."); return; }
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = "sine"; oscillator.frequency.setValueAtTime(740, context.currentTime);
      gain.gain.setValueAtTime(0, context.currentTime); gain.gain.linearRampToValueAtTime(.12, context.currentTime + .02);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .32);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .34);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      navigator.vibrate?.([100, 70, 100]);
      if (explicit) setAlertMessage("Alerte testée. Les nouvelles missions seront signalées lorsque l’application est ouverte.");
    } catch { setAlertMessage("Le navigateur n’a pas autorisé le son. Les missions restent visibles et actualisées."); }
  }, []);
  return { preferences, update, theme: preferences.theme === "auto" ? systemDark ? "dark" as const : "light" as const : preferences.theme, alert, alertMessage };
}

export function useDeliveryWakeLock(enabled: boolean) {
  const [status, setStatus] = useState("Désactivé");
  useEffect(() => {
    if (!enabled) return;
    let stopped = false; let sentinel: WakeLockSentinel | null = null; let requesting = false;
    async function acquire() {
      if (stopped || requesting || sentinel || document.visibilityState !== "visible") return;
      if (!("wakeLock" in navigator)) { setStatus("Non pris en charge par ce navigateur"); return; }
      requesting = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped || document.visibilityState !== "visible") { await next.release(); return; }
        sentinel = next; setStatus("Actif pendant votre tournée");
        next.addEventListener("release", () => { if (sentinel === next) sentinel = null; if (!stopped) setStatus("Suspendu par le navigateur"); });
      } catch { if (!stopped) setStatus("Non autorisé par le navigateur"); }
      finally { requesting = false; }
    }
    const visibility = () => {
      if (document.visibilityState === "visible") void acquire();
      else { const previous = sentinel; sentinel = null; void previous?.release().catch(() => {}); }
    };
    void acquire(); document.addEventListener("visibilitychange", visibility);
    return () => { stopped = true; document.removeEventListener("visibilitychange", visibility); void sentinel?.release().catch(() => {}); };
  }, [enabled]);
  return enabled ? status : "Désactivé · activé seulement avec une mission en route";
}

export function deliveryNavigationUrl(address: DeliveryAddress | string, navigation: DeliveryPreferences["navigation"]) {
  const destination = typeof address === "string" ? address : [address.line1, address.line2, address.postalCode, address.city, address.country].filter(Boolean).join(", ");
  const encoded = encodeURIComponent(destination);
  return navigation === "apple" ? `https://maps.apple.com/?daddr=${encoded}`
    : navigation === "waze" ? `https://waze.com/ul?q=${encoded}&navigate=yes`
      : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

export function deliverySmsUrl(phone: string, body: string) {
  // Opens the native composer; sending always remains the driver's explicit action.
  const separator = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
  return `sms:${phone.replace(/[^+\d]/g, "")}${separator}body=${encodeURIComponent(body)}`;
}
