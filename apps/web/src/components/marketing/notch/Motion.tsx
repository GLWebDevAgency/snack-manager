"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribeMotion(notify: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
const motionSnapshot = () => window.matchMedia(QUERY).matches;
const motionServerSnapshot = () => true;
function subscribeVisibility(notify: () => void) {
  document.addEventListener("visibilitychange", notify);
  return () => document.removeEventListener("visibilitychange", notify);
}
const visibilitySnapshot = () => !document.hidden;
const visibilityServerSnapshot = () => false;

const MotionContext = createContext({ paused: false, reduced: true, toggle: () => {} });

/** A single pause applies to every decorative scene, independently of the navigation. */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, motionSnapshot, motionServerSnapshot);
  const value = useMemo(() => ({ paused, reduced, toggle: () => setPaused((previous) => !previous) }), [paused, reduced]);
  return <MotionContext.Provider value={value}>
    <div className="nl-root" data-motion={paused ? "paused" : "playing"} data-reduced={reduced}>{children}</div>
  </MotionContext.Provider>;
}

export function MotionControl({ className }: { className?: string }) {
  const { paused, reduced, toggle } = useContext(MotionContext);
  return <button className={className} type="button" aria-pressed={paused || reduced} disabled={reduced} onClick={toggle}>
    <span aria-hidden="true">{paused || reduced ? "▷" : "Ⅱ"}</span>{" "}
    {reduced ? "Animations réduites" : paused ? "Reprendre les animations" : "Mettre les animations en pause"}
  </button>;
}

/** Timers stop outside the viewport, in background tabs, and while exploring by keyboard. */
export function useSceneMotion({ count, intervalMs = 6000 }: { count: number; intervalMs?: number }) {
  const { paused, reduced, toggle } = useContext(MotionContext);
  const visibleTab = useSyncExternalStore(subscribeVisibility, visibilitySnapshot, visibilityServerSnapshot);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .12 });
    observer.observe(element);
    // Pointer clicks keep the button focused too: only keyboard focus should
    // suspend playback, otherwise clicking "Reprendre" cannot resume a scene.
    const focusIn = (event: FocusEvent) => setFocused(event.target instanceof Element && event.target.matches(":focus-visible"));
    const focusOut = (event: FocusEvent) => { if (!element.contains(event.relatedTarget as Node | null)) setFocused(false); };
    const keyDown = () => setFocused(true);
    const pointerDown = () => setFocused(false);
    element.addEventListener("focusin", focusIn);
    element.addEventListener("focusout", focusOut);
    element.addEventListener("keydown", keyDown);
    element.addEventListener("pointerdown", pointerDown);
    return () => {
      observer.disconnect();
      element.removeEventListener("focusin", focusIn);
      element.removeEventListener("focusout", focusOut);
      element.removeEventListener("keydown", keyDown);
      element.removeEventListener("pointerdown", pointerDown);
    };
  }, []);

  const playing = visible && visibleTab && !paused && !reduced && !focused;
  useEffect(() => {
    if (!playing || count < 2) return;
    // A manual selection receives a full reading interval as well.
    const timer = window.setTimeout(() => setStep((previous) => (previous + 1) % count), intervalMs);
    return () => window.clearTimeout(timer);
  }, [playing, count, intervalMs, step]);

  return { ref, step, select: (index: number) => setStep(Math.min(Math.max(0, index), count - 1)), playing, reduced, paused, toggle };
}
