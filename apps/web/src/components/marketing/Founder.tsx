import { FOUNDER_FACTS, FOUNDER_PHOTO, FOUNDER_QUOTE } from "./content";
import { Photo } from "./Photo";

/**
 * « Né au comptoir » — la carte fondateur, halo laiton en dérive lente,
 * illustrée par une photo réelle du restaurant pilote.
 */
export function Founder() {
  return (
    <section className="section fd-section" id="pilote">
      <span className="badge">Né au comptoir</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 620 }}>
        Construit dans un vrai restaurant, pas dans un bureau
      </h2>

      <div className="fd-card rv spot">
        <div className="fd-portrait">
          <Photo shot={FOUNDER_PHOTO} sizes="(max-width: 810px) 90vw, 280px" />
        </div>
        <div className="fd-body">
          <blockquote className="fd-quote">{FOUNDER_QUOTE}</blockquote>
          <p className="fd-name">
            Les fondateurs · <strong>Class&apos;Food</strong>, restaurant pilote — Perriers-sur-Andelle
          </p>
          <div className="fd-facts">
            {FOUNDER_FACTS.map((f) => (
              <span className="fd-fact" key={f}>
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
