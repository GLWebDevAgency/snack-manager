"use client";

import { useId, useState } from "react";
import { FAQ } from "./content";
import { FaqChevron } from "./icons";

/**
 * FAQ en accordéon — une seule réponse ouverte à la fois (comportement du JS
 * de la maquette). La hauteur est animée par `grid-template-rows: 0fr → 1fr`
 * plutôt que par un `max-height` arbitraire : les réponses longues ne sont
 * jamais tronquées.
 */
export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const uid = useId();

  return (
    <section className="faq-section" id="faq">
      <div className="faq-grid">
        <div className="faq-left rv rv-x-l">
          <span className="badge">FAQ</span>
          <h2 className="h2">Questions fréquentes</h2>
          <p className="body-text faq-help">
            Une question précise ?{" "}
            <a href="#contact" className="faq-helplink">
              Contactez-nous
            </a>
          </p>
        </div>

        <div className="rv rv-x-r">
          <div className="faq-list">
            {FAQ.map((item, i) => {
              const isOpen = open === i;
              return (
                <div className={isOpen ? "faq-item open" : "faq-item"} key={item.q}>
                  <button
                    type="button"
                    className="faq-q"
                    id={`${uid}-q${i}`}
                    aria-expanded={isOpen}
                    aria-controls={`${uid}-a${i}`}
                    onClick={() => setOpen(isOpen ? null : i)}
                  >
                    <span className="h5">{item.q}</span>
                    <span className="faq-chevron">
                      <FaqChevron />
                    </span>
                  </button>
                  <div
                    className="faq-answerwrap"
                    id={`${uid}-a${i}`}
                    role="region"
                    aria-labelledby={`${uid}-q${i}`}
                    aria-hidden={!isOpen}
                  >
                    <div className="faq-answerinner">
                      <p className="body-text faq-answer">{item.a}</p>
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
