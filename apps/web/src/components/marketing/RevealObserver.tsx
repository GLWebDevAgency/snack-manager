"use client";

import { useEffect } from "react";

/**
 * Îlot unique qui anime toutes les révélations au scroll de la page.
 *
 * Les sections restent des server components : elles posent juste `data-rv`
 * (+ `style={{ transitionDelay }}` pour les cascades). Un seul
 * IntersectionObserver suffit, et `prefers-reduced-motion` court-circuite tout
 * (le CSS neutralise déjà opacité/transform, on se contente de ne pas observer).
 */
export function RevealObserver() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-rv]"));
    if (nodes.length === 0) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("mk-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("mk-in");
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -6% 0px" },
    );

    nodes.forEach((n) => {
      // Déjà dans le viewport au chargement : on affiche sans attendre un scroll.
      if (n.getBoundingClientRect().top < window.innerHeight * 0.9) {
        n.classList.add("mk-in");
        return;
      }
      io.observe(n);
    });

    return () => io.disconnect();
  }, []);

  return null;
}
