"use client";

import { useEffect, useRef, useState } from "react";
import { PROOF } from "./content";

/**
 * Bandeau « la preuve en chiffres » — compteurs animés une seule fois à
 * l'entrée dans le viewport. La valeur finale est rendue côté serveur : pas de
 * décalage de mise en page, et en `prefers-reduced-motion` rien ne bouge.
 */
export function ProofBand() {
  return (
    <section className="mk-section mk-section--tight" aria-label="La preuve en chiffres">
      <div className="mk-wrap">
        <div className="mk-proof" data-rv>
          {PROOF.map((p) => (
            <div className="mk-proof-cell" key={p.label}>
              <div className="mk-proof-num mk-num">
                <Counter value={p.value} prefix={p.prefix} suffix={p.suffix} />
              </div>
              <div className="mk-proof-label">{p.label}</div>
              <div className="mk-proof-src">{p.source}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const DURATION = 1100;

function Counter({ value, prefix, suffix }: { value: number; prefix: string; suffix: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / DURATION);
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(Math.round(value * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setShown(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <span ref={ref}>
      {prefix}
      {shown}
      {suffix}
    </span>
  );
}
