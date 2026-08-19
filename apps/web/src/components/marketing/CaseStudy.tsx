"use client";

import { useState } from "react";
import { CASE_PHOTOS, CASE_SLIDES } from "./content";
import { Chevron } from "./icons";
import { Photo } from "./Photo";

/**
 * « Ce que ça change, un vrai service » — le texte bascule avant / après, le
 * collage de photos reste fixe (comportement du slider de la maquette).
 *
 * Les visuels sont de vraies photos du restaurant pilote : la carte papier
 * affichée au-dessus du comptoir, celle-là même que la plateforme remplace.
 */
export function CaseStudy() {
  const [index, setIndex] = useState(0);
  const slide = CASE_SLIDES[index];

  const step = (dir: -1 | 1) => setIndex((i) => (i + dir + CASE_SLIDES.length) % CASE_SLIDES.length);

  return (
    <section className="section">
      <div className="section-head rv">
        <span className="badge">Avant / après</span>
        <h2 className="h2">Ce que ça change, un vrai service</h2>
      </div>

      <div className="cs-wrap">
        <div className="cs-textcol rv rv-x-l">
          <div className="cs-textblock" aria-live="polite">
            <h3 className="h4">{slide.title}</h3>
            <p className="body-text">{slide.text}</p>
          </div>
          <div className="cs-arrows">
            <button type="button" className="cs-arrow" aria-label="Précédent" onClick={() => step(-1)}>
              <Chevron dir="left" />
            </button>
            <button type="button" className="cs-arrow" aria-label="Suivant" onClick={() => step(1)}>
              <Chevron />
            </button>
          </div>
        </div>

        <div className="cs-collage rv rv-x-r">
          {CASE_PHOTOS.map((p, i) => (
            <Photo key={p.src} shot={p} sizes={i === 2 ? "(max-width: 810px) 90vw, 640px" : "(max-width: 810px) 45vw, 320px"} />
          ))}
        </div>
      </div>
    </section>
  );
}
