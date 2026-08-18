import { PILLARS } from "./content";
import { MkIcon, MkTick } from "./icons";

/**
 * Les 3 piliers de l'offre : suite logicielle (MRR), studio (one-shot) et
 * chiffre d'affaires additionnel (variable). L'accent laiton ne sert qu'aux
 * prix et aux liens — jamais en aplat sur la carte.
 */
export function Pillars() {
  return (
    <section className="mk-section" id="offre">
      <div className="mk-wrap">
        <div className="mk-head mk-head--center" data-rv>
          <span className="mk-eyebrow">L&apos;offre</span>
          <h2 className="mk-h2">Le logiciel, le studio, et le chiffre d&apos;affaires en plus</h2>
          <p className="mk-lead">
            Trois façons de travailler ensemble. Vous pouvez n&apos;en prendre qu&apos;une — la plupart des restaurants
            commencent par la suite, puis ajoutent le reste quand le service tourne.
          </p>
        </div>

        <div className="mk-grid-3" style={{ marginTop: 34 }}>
          {PILLARS.map((p, i) => (
            <article
              key={p.title}
              className="mk-card mk-pillar"
              data-rv
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  className="mk-trust-ico"
                  aria-hidden="true"
                  style={{ width: 30, height: 30, borderRadius: 9 }}
                >
                  <MkIcon name={p.icon} size={16} />
                </span>
                <span className="mk-pillar-n">{p.n}</span>
              </div>

              <h3 className="mk-h3">{p.title}</h3>

              <p className="mk-pillar-price mk-num">
                {p.price} {p.priceNote ? <small>{p.priceNote}</small> : null}
              </p>

              <p className="mk-body">{p.desc}</p>

              <ul>
                {p.items.map((it) => (
                  <li key={(it.b ?? "") + it.text}>
                    <MkTick className="mk-tick" />
                    <span>
                      {it.b ? <b>{it.b}</b> : null}
                      {it.text}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mk-pillar-foot">{p.foot}</p>

              <a className="mk-btn mk-btn--quiet" href={p.cta.href} style={{ marginTop: 4 }}>
                {p.cta.label}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
