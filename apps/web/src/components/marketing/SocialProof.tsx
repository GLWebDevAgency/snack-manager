import { PILOT_FACTS, PILOT_QUOTE, PILOT_STATS, VS_WITH, VS_WITHOUT } from "./content";
import { MkIcon } from "./icons";

/**
 * Preuve sociale : le restaurant pilote Class'Food (chiffres réels de la base)
 * puis le comparatif « sans / avec ». Rouge et vert gardent ici leur sens
 * fonctionnel : le rouge signale ce qui coince, le vert ce qui est réglé.
 */
export function SocialProof() {
  return (
    <section className="mk-section" id="pilote">
      <div className="mk-wrap">
        <div className="mk-head mk-head--center" data-rv>
          <span className="mk-eyebrow">Né au comptoir</span>
          <h2 className="mk-h2">Construit dans un vrai restaurant, pas dans un bureau</h2>
        </div>

        <div className="mk-panel mk-pilot" style={{ marginTop: 32 }} data-rv>
          <div className="mk-pilot-visual">
            {PILOT_STATS.map((s) => (
              <div className="mk-pilot-stat" key={s.label}>
                <b className="mk-num">{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <div>
            <blockquote className="mk-quote">« {PILOT_QUOTE} »</blockquote>
            <p className="mk-sign">
              Les fondateurs · <span className="mk-kw">Class&apos;Food</span>, restaurant pilote — Perriers-sur-Andelle
            </p>
            <div className="mk-facts">
              {PILOT_FACTS.map((f) => (
                <span className="mk-chip" key={f}>
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="mk-vs" style={{ marginTop: 44 }}>
          <div className="mk-vs-col" data-side="lose" data-rv>
            <span className="mk-vs-title">
              <MkIcon name="hourglass" size={16} />
              Sans Snack Manager
            </span>
            <ul className="mk-vs-list">
              {VS_WITHOUT.map((t) => (
                <li key={t}>
                  <span className="mk-mark" data-tone="red" aria-hidden="true">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round">
                      <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <div className="mk-vs-col" data-side="win" data-rv style={{ transitionDelay: "80ms" }}>
            <span className="mk-vs-title">
              <MkIcon name="bolt" size={16} />
              Avec Snack Manager
            </span>
            <ul className="mk-vs-list">
              {VS_WITH.map((t) => (
                <li key={t}>
                  <span className="mk-mark" data-tone="green" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m4.5 12.5 5 5 10-11" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
