"use client";
import { useEffect } from "react";
import { knownNeed, LEAD_INTENT_EVENT } from "./lead-intent";

/** Keep project CTAs on the page, with normal URLs as the progressive fallback. */
export function ProjectNavigation() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href*="besoin="]');
      if (!link || link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== "/" || window.location.pathname !== "/" || url.hash !== "#contact" || !knownNeed(url.searchParams.get("besoin"))) return;
      const target = document.getElementById("contact");
      if (!target) return;
      event.preventDefault();
      window.history.pushState(null, "", url.pathname + url.search + url.hash);
      window.dispatchEvent(new Event(LEAD_INTENT_EVENT));
      target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    };
    // Run before Next Link's handler so all project links update the form in place.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
