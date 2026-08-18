"use client";

import { useId, useState } from "react";
import { CONTACT_EMAIL, FAQ } from "./content";
import { MkIcon } from "./icons";

/**
 * FAQ en accordéon : un seul panneau ouvert, tous fermables. Vrais `<button>`
 * avec `aria-expanded`/`aria-controls` — le clavier fonctionne sans code
 * supplémentaire, et la hauteur s'anime en grid-template-rows (0fr → 1fr) donc
 * aucune réponse n'est tronquée quelle que soit sa longueur.
 */
export function Faq() {
  const [open, setOpen] = useState(0);
  const base = useId().replace(/[:]/g, "");

  return (
    <section className="mk-section" id="faq">
      <div className="mk-wrap">
        <div className="mk-faq">
          <div data-rv>
            <span className="mk-eyebrow">FAQ</span>
            <h2 className="mk-h2" style={{ marginTop: 16 }}>
              Questions fréquentes
            </h2>
            <p className="mk-lead" style={{ marginTop: 14 }}>
              Une question précise ?{" "}
              <a className="mk-link" href="#contact">
                Contactez-nous
              </a>{" "}
              ou écrivez à{" "}
              <a className="mk-link" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </div>

          <div className="mk-faq-list" data-rv style={{ transitionDelay: "60ms" }}>
            {FAQ.map((item, i) => {
              const isOpen = open === i;
              return (
                <div className="mk-faq-item" key={item.q} data-open={isOpen ? "true" : undefined}>
                  <h3 style={{ margin: 0 }}>
                    <button
                      type="button"
                      className="mk-faq-q"
                      aria-expanded={isOpen}
                      aria-controls={`${base}-a-${i}`}
                      id={`${base}-q-${i}`}
                      onClick={() => setOpen(isOpen ? -1 : i)}
                    >
                      {item.q}
                      <MkIcon name="chevron" size={16} />
                    </button>
                  </h3>
                  <div className="mk-faq-a" id={`${base}-a-${i}`} role="region" aria-labelledby={`${base}-q-${i}`}>
                    <div>
                      <p>{item.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
