"use client";

import { useEffect } from "react";

/**
 * Îlot unique qui pilote les deux effets « ambiants » de la maquette :
 *
 *  1. la révélation au scroll — un seul IntersectionObserver ajoute `.in` aux
 *     éléments `.rv`, ce qui laisse toutes les sections en composants serveur ;
 *  2. le projecteur au survol — les cartes `.spot` reçoivent la position du
 *     pointeur dans `--mx` / `--my`, via un écouteur délégué sur le document.
 *
 * `prefers-reduced-motion` court-circuite les deux : le CSS affiche déjà les
 * éléments, on se contente de ne rien observer.
 */
export function RevealObserver() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(".mk .rv"));

    let io: IntersectionObserver | undefined;
    if (reduced || typeof IntersectionObserver === "undefined") {
      nodes.forEach((n) => n.classList.add("in"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("in");
            io?.unobserve(entry.target);
          }
        },
        { threshold: 0.15 },
      );
      for (const n of nodes) {
        // Déjà visible au chargement : on affiche sans attendre un défilement.
        if (n.getBoundingClientRect().top < window.innerHeight * 0.9) {
          n.classList.add("in");
          continue;
        }
        io.observe(n);
      }
    }

    const onPointerMove = (ev: PointerEvent) => {
      const target = (ev.target as Element | null)?.closest<HTMLElement>(".mk .spot");
      if (!target) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${ev.clientX - r.left}px`);
      target.style.setProperty("--my", `${ev.clientY - r.top}px`);
    };
    if (!reduced) document.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      io?.disconnect();
      document.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return null;
}
