"use client";

import { useCallback, useEffect, useState } from "react";
import { CHANGELOG, PROC_TEXTS, type ChangelogTone } from "./content";
import { IcoCalendar, IcoChat, IcoClock, IcoCycle, SmallFillet, UpdArrow } from "./icons";

const TONE_COLOR: Record<ChangelogTone, string> = {
  new: "var(--green)",
  improved: "var(--accent)",
  fixed: "var(--orange)",
};

const FADE = [1, 0.55, 0.4];

/** Étiquette « Étape n. » posée dans l'angle de la carte, avec ses deux congés. */
function StepTag({ label }: { label: string }) {
  return (
    <div className="notch-tag tl">
      {label}
      <span className="fl1">
        <SmallFillet rotate={90} />
      </span>
      <span className="fl2">
        <SmallFillet rotate={90} />
      </span>
    </div>
  );
}

/**
 * « Comment on vous accompagne » — trois panneaux d'interface factices, en
 * dégradé masqué vers le bas, chacun surmonté de son étiquette d'étape.
 *
 * Le troisième panneau fait tourner le changelog toutes les 4 s (comportement
 * du JS de la maquette), avec deux flèches qui reprennent la main. Le minuteur
 * est suspendu si l'utilisateur demande moins d'animation.
 */
export function Process() {
  const [monthIndex, setMonthIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setMonthIndex((i) => (i + 1) % CHANGELOG.length), 4000);
    return () => window.clearInterval(id);
  }, [paused, monthIndex]);

  const step = useCallback((dir: -1 | 1) => {
    setMonthIndex((i) => (i + dir + CHANGELOG.length) % CHANGELOG.length);
  }, []);

  const log = CHANGELOG[monthIndex];

  return (
    <section className="proc-section" id="pourquoi">
      <div className="proc-inner">
        <div className="section-head proc-head rv">
          <span className="badge">Notre méthode</span>
          <h2 className="h2">Comment on vous accompagne vers de vrais résultats</h2>
        </div>

        <div className="proc-grid">
          {/* ── Étape 1 : analyse du service ── */}
          <div className="proc-card rv">
            <StepTag label={PROC_TEXTS[0].step} />
            <div className="proc-viewport" aria-hidden="true">
              <div className="mock-panel">
                <div className="mock-panelinner">
                  <p className="mock-title">Analyse du service</p>
                  <p className="mock-sub">Pour savoir ce qu&apos;on peut simplifier</p>
                  <div className="mock-divider" />
                  <div className="diag-rows">
                    <div className="diag-row">
                      <span className="icon-circle">
                        <IcoClock />
                      </span>
                      <div className="diag-col">
                        <p className="diag-label">Rush du vendredi soir</p>
                        <p className="diag-value">Élevé</p>
                      </div>
                    </div>
                    <div className="diag-row">
                      <span className="icon-circle">
                        <IcoCycle />
                      </span>
                      <div className="diag-col">
                        <p className="diag-value">3 postes mobilisés</p>
                        <div className="diag-bar">
                          <div className="diag-barfill" style={{ width: "72%" }} />
                        </div>
                      </div>
                    </div>
                    <div className="diag-row">
                      <span className="icon-circle">
                        <IcoChat />
                      </span>
                      <div className="diag-col">
                        <p className="diag-label">Commandes au stylo</p>
                        <p className="diag-value">À déchiffrer en cuisine</p>
                      </div>
                    </div>
                    <div className="diag-row dim">
                      <span className="icon-circle">
                        <IcoClock />
                      </span>
                      <div className="diag-col">
                        <p className="diag-value">~12 par semaine</p>
                        <div className="diag-bar">
                          <div className="diag-barfill" style={{ width: "34%" }} />
                        </div>
                      </div>
                    </div>
                    <div className="diag-row dim">
                      <span className="icon-circle">
                        <IcoCalendar />
                      </span>
                      <div className="diag-col">
                        <p className="diag-label">Heures sup</p>
                        <p className="diag-value">Calculées à la main</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="proc-cardtext rv">
              <h4 className="h4">{PROC_TEXTS[0].title}</h4>
              <p className="body-text">{PROC_TEXTS[0].text}</p>
            </div>
          </div>

          {/* ── Étape 2 : configuration ── */}
          <div className="proc-card rv">
            <StepTag label={PROC_TEXTS[1].step} />
            <div className="proc-viewport" aria-hidden="true">
              <div className="mock-panel">
                <div className="mock-panelinner">
                  <p className="mock-title">Configuration</p>
                  <p className="mock-sub">Connecté à votre activité</p>
                  <div className="mock-divider" />
                  <div className="int-row">
                    <p className="int-title">Menu &amp; prix</p>
                    <p className="int-text">Importé depuis votre carte actuelle.</p>
                    <div className="int-tools">
                      <span className="int-tool" />
                      <span className="int-tool" />
                      <span className="int-tool" />
                      <span className="int-more">+ Voir plus</span>
                    </div>
                  </div>
                  <div className="int-row">
                    <p className="int-title">Équipe</p>
                    <p className="int-text">Comptes créés pour chaque poste.</p>
                  </div>
                  <div className="int-row">
                    <p className="int-title">Paiement</p>
                    <p className="int-text">Carte, espèces, click &amp; collect.</p>
                  </div>
                  <div className="int-row">
                    <p className="int-title">Fidélité</p>
                    <p className="int-text">Points et codes promo activés.</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="proc-cardtext rv">
              <h4 className="h4">{PROC_TEXTS[1].title}</h4>
              <p className="body-text">{PROC_TEXTS[1].text}</p>
            </div>
          </div>

          {/* ── Étape 3 : mises à jour (changelog rotatif) ── */}
          <div className="proc-card rv">
            <StepTag label={PROC_TEXTS[2].step} />
            <div className="proc-viewport">
              <div className="mock-panel">
                <div className="mock-panelinner">
                  <p className="mock-title">Mises à jour</p>
                  <p className="mock-sub">Tout continue de s&apos;améliorer</p>
                  <div className="mock-divider" />
                  <div className="upd-filters">
                    <span className="upd-filter">
                      <span className="mock-dot" style={{ background: "var(--green)" }} />
                      New
                    </span>
                    <span className="upd-filter">
                      <span className="mock-dot" style={{ background: "var(--accent)" }} />
                      Improved
                    </span>
                    <span className="upd-filter">
                      <span className="mock-dot" style={{ background: "var(--orange)" }} />
                      Fixed
                    </span>
                    <span className="upd-arrows">
                      <button
                        type="button"
                        className="upd-arrowbtn"
                        aria-label="Mois précédent"
                        onClick={() => {
                          setPaused(true);
                          step(-1);
                        }}
                      >
                        <UpdArrow dir="prev" />
                      </button>
                      <button
                        type="button"
                        className="upd-arrowbtn"
                        aria-label="Mois suivant"
                        onClick={() => {
                          setPaused(true);
                          step(1);
                        }}
                      >
                        <UpdArrow dir="next" />
                      </button>
                    </span>
                  </div>
                  <div className="upd-changelog">
                    <div className="upd-log" key={log.month}>
                      <p className="upd-month">{log.month}</p>
                      <p className="upd-monthsub">{log.sub}</p>
                      <div className="upd-logdivider" />
                      <ul className="upd-logitems">
                        {log.items.map((item) => (
                          <li
                            className="upd-logitem"
                            key={item.text}
                            style={item.faded ? { opacity: FADE[item.faded] } : undefined}
                          >
                            <span className="mock-dot" style={{ background: TONE_COLOR[item.tone] }} />
                            <span className="upd-logtext">{item.text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="proc-cardtext rv">
              <h4 className="h4">{PROC_TEXTS[2].title}</h4>
              <p className="body-text">{PROC_TEXTS[2].text}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
