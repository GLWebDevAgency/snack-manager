"use client";

import { useEffect, useRef, useState } from "react";
import { PROOF } from "./content";

/**
 * Les quatre chiffres de preuve, comptés à l'entrée dans le viewport
 * (`data-count` de la maquette, porté en état React).
 *
 * `prefers-reduced-motion` court-circuite l'animation : la valeur finale est
 * affichée d'emblée. Le rendu serveur affiche déjà la valeur cible, donc la
 * page reste lisible sans JavaScript et l'hydratation ne bouge pas.
 */
export function ProofBand() {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let start: number | null = null;
    const run = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / 1100);
      setProgress(1 - Math.pow(1 - p, 3));
      if (p < 1) raf = requestAnimationFrame(run);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          io.disconnect();
          setProgress(0);
          raf = requestAnimationFrame(run);
        }
      },
      { threshold: 0.5 },
    );
    io.observe(node);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section className="proof-band" aria-label="La preuve en chiffres">
      <div className="proof-grid rv" ref={ref}>
        {PROOF.map((p) => (
          <div className="proof-item" key={p.label}>
            <p className="proof-num">
              {p.prefix}
              {Math.round(p.value * progress)}
              {p.suffix}
            </p>
            <p className="proof-label">
              {p.label}
              <span className="proof-src">{p.source}</span>
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
