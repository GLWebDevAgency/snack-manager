"use client";

import { useCallback, useRef, useState } from "react";
import { CATALOGUE, DEMO_APPS } from "./content";
import { Chevron } from "./icons";
import { Photo } from "./Photo";

/** Position d'une carte dans la scène 3D : centre, gauche, droite, hors-champ. */
function slot(index: number, current: number, total: number) {
  let off = (((index - current) % total) + total) % total;
  if (off > total / 2) off -= total;
  if (off === 0) return "is-center";
  if (off === -1) return "is-left";
  if (off === 1) return "is-right";
  return "is-hidden";
}

/**
 * Catalogue app par app + scène de démonstration 3D.
 *
 * Les deux sections partagent un état (`current`) : chaque colonne du
 * catalogue porte son lien « Essayer … en démo → » qui fait pivoter la scène
 * sur la bonne application puis y amène le lecteur — c'est le `smDemoGo()`
 * global de la maquette, remplacé ici par un `useState` et une ref.
 *
 * La maquette embarquait des iframes de démonstration ; on montre les VRAIES
 * captures de nos applications. Celle de la commande client est un écran
 * mobile : elle est présentée dans un châssis de téléphone plutôt que rognée.
 */
export function AppsShowcase() {
  const [current, setCurrent] = useState(0);
  const stageRef = useRef<HTMLElement>(null);
  const total = DEMO_APPS.length;

  const go = useCallback((i: number) => setCurrent(((i % total) + total) % total), [total]);

  const goAndScroll = useCallback(
    (i: number) => {
      go(i);
      stageRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    },
    [go],
  );

  const app = DEMO_APPS[current];

  return (
    <>
      <section className="section cat-section" id="catalogue">
        <span className="badge">Dans le détail</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 680 }}>
          Tout ce que la plateforme couvre, app par app
        </h2>
        <p className="body-text cat-sub rv">
          Pas une plaquette : chaque ligne ci-dessous existe déjà dans les applications — descendez d&apos;une section
          pour les voir en vrai.
        </p>

        <div className="cat-grid">
          {CATALOGUE.map((col, i) => (
            <div className="cat-col rv spot" key={col.name} style={{ transitionDelay: `${i * 0.06}s` }}>
              <div className="cat-colhead">
                <p className="cat-appname">{col.name}</p>
                <p className="cat-device">{col.device}</p>
              </div>
              <div className="cat-items">
                {col.items.map((item, k) => (
                  <div className="cat-item" key={k}>
                    <span className="cat-dot" />
                    <span>
                      {item.pre}
                      {item.strong ? <strong>{item.strong}</strong> : null}
                      {item.post}
                    </span>
                  </div>
                ))}
              </div>
              <button type="button" className="cat-demolink" onClick={() => goAndScroll(col.demo)}>
                {col.demoLabel}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="section demo-section" id="demo" ref={stageRef}>
        <span className="badge">La démo</span>
        <h2 className="h2 center-h2" style={{ maxWidth: 640 }}>
          Explorez les applications, en démo
        </h2>
        <p className="body-text demo-sub rv">
          Des <strong>captures réelles</strong> de la plateforme en service, pas des illustrations : changez d&apos;app,
          regardez les écrans — un aperçu fidèle de <span className="kw">votre futur quotidien</span>.
        </p>

        <div className="demo-pills rv">
          {DEMO_APPS.map((a, i) => (
            <button
              type="button"
              aria-pressed={i === current}
              className={i === current ? "demo-pill is-on" : "demo-pill"}
              key={a.id}
              onClick={() => go(i)}
            >
              {a.label}
            </button>
          ))}
        </div>

        <div className="demo-stage rv">
          <div className="demo-track">
            {DEMO_APPS.map((a, i) => {
              const position = slot(i, current, total);
              const isCenter = position === "is-center";
              return (
                <div className={`demo-card ${position}`} key={a.id} aria-hidden={!isCenter}>
                  <div className={a.shot.portrait ? "demo-frame is-portrait" : "demo-frame"}>
                    {a.shot.portrait ? (
                      <div className="demo-phone">
                        <Photo shot={a.shot} sizes="(max-width: 810px) 40vw, 300px" />
                      </div>
                    ) : (
                      <Photo shot={a.shot} sizes="(max-width: 810px) 92vw, min(880px, 78vw)" />
                    )}
                    {isCenter ? null : (
                      <button
                        type="button"
                        className="demo-focusbtn"
                        aria-label={`Voir ${a.label}`}
                        tabIndex={-1}
                        onClick={() => go(i)}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            className="demo-arrow prev"
            aria-label="Application précédente"
            onClick={() => go(current - 1)}
          >
            <Chevron size={18} dir="left" />
          </button>
          <button
            type="button"
            className="demo-arrow next"
            aria-label="Application suivante"
            onClick={() => go(current + 1)}
          >
            <Chevron size={18} />
          </button>
        </div>

        <p className="demo-caption rv" aria-live="polite">
          <strong>{app.lead}</strong>
          {app.body}
          <span className="demo-chips">
            {app.chips.map((c) => (
              <em key={c}>{c}</em>
            ))}
          </span>
        </p>
      </section>
    </>
  );
}
