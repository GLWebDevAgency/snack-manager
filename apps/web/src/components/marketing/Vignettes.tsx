"use client";

import { useState } from "react";
import { VIGNETTES } from "./content";
import { Chevron } from "./icons";
import { Photo } from "./Photo";

/**
 * « Des situations qu'on connaît par cœur » — carrousel de vignettes.
 *
 * Le déplacement de la piste est calculé en CSS à partir de `--vg-slide`
 * (375 px, ou la largeur de l'écran moins les marges en mobile) : aucune mesure
 * DOM n'est nécessaire, la valeur suit toute seule le point de rupture.
 */
export function Vignettes() {
  const [index, setIndex] = useState(0);
  const last = VIGNETTES.length - 1;

  return (
    <section className="vg-section" id="temoignages">
      <div className="vg-inner">
        <div className="vg-headrow">
          <div className="section-head rv" style={{ alignItems: "flex-start", textAlign: "left" }}>
            <span className="badge">Le quotidien</span>
            <h2 className="h2">Des situations qu&apos;on connaît par cœur</h2>
          </div>
          <div className="vg-arrows rv" style={{ transitionDelay: "0.2s" }}>
            <button
              type="button"
              className="vg-arrow"
              aria-label="Précédent"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              <Chevron dir="left" />
            </button>
            <button
              type="button"
              className="vg-arrow"
              aria-label="Suivant"
              disabled={index === last}
              onClick={() => setIndex((i) => Math.min(last, i + 1))}
            >
              <Chevron />
            </button>
          </div>
        </div>

        <div className="vg-viewport rv">
          <div
            className="vg-track"
            style={{ transform: `translateX(calc(${-index} * (var(--vg-slide) + 10px)))` }}
          >
            {VIGNETTES.map((v) => (
              <div className="vg-slide" key={v.tag}>
                <article className="vg-card">
                  <header className="vg-cardhead">
                    <span className="vg-tagtext">{v.tag}</span>
                  </header>
                  <figure className="vg-media">
                    <Photo shot={v.photo} sizes="375px" />
                    <blockquote className="vg-quote">{v.quote}</blockquote>
                  </figure>
                </article>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
