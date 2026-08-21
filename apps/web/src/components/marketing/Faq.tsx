"use client";

import { useId, useState } from "react";
import { CTA_CALLBACK, FAQ, ancre, section } from "./content";
import { FaqChevron } from "./icons";

/**
 * FAQ en accordéon — une seule réponse ouverte à la fois (comportement du JS
 * de la maquette). La hauteur est animée par `grid-template-rows: 0fr → 1fr`
 * plutôt que par un `max-height` arbitraire : les réponses longues ne sont
 * jamais tronquées.
 *
 * HUIT ENTRÉES RAMENÉES À CINQ, ET L'ACCORDÉON CESSE D'ÊTRE UN PLACARD. Trois
 * questions sont montées dans la section où elles se posent (matériel et
 * hors-ligne en section 5, délai de mise en route en section 8), une est
 * absorbée par les canaux, une part avec les marques blanches. Le tri est fait
 * dans `FAQ` : ce composant ne filtre rien et ne doit rien filtrer.
 *
 * L'ENTRÉE SUR L'ENGAGEMENT NE S'ÉCRIT PAS ICI. Elle vaut `ENGAGEMENT`, la
 * même constante que le bandeau sous la grille tarifaire — la page se
 * contredisait à voix haute (« Sans engagement » au hero contre « on vous
 * détaille au moment du devis » ici), et c'est la référence partagée, pas la
 * bonne volonté, qui empêche la contradiction de revenir.
 */
export function Faq() {
  const { badge, title } = section("faq");
  const [open, setOpen] = useState<number | null>(0);
  const uid = useId();

  return (
    <section className="faq-section" id="faq">
      <div className="faq-grid">
        <div className="faq-left rv rv-x-l">
          {badge ? <span className="badge">{badge}</span> : null}
          <h2 className="h2">{title}</h2>
          {/* Un seul lien, et il dit ce que disent les quatre autres appels de la page. */}
          <p className="body-text faq-help">
            Une question précise ?{" "}
            {/* `ancre()` et pas `#contact` : voir le hero — une ancre nue est
                juste au moment où on l'écrit, et muette le jour où le composant
                change de page. */}
            <a href={ancre("contact").href} className="faq-helplink">
              {CTA_CALLBACK}
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
