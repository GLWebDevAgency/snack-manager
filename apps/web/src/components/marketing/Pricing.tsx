import { FOUNDER_SEATS_LEFT, FOUNDER_SEATS_TAKEN, FOUNDER_SEATS_TOTAL, PLANS } from "./content";
import { TickDot } from "./icons";

/**
 * Tarifs — la barre « offre fondateur » (avec ses pastilles de places
 * restantes) au-dessus des trois formules, la formule Pro mise en avant.
 */
export function Pricing() {
  return (
    <section className="section" id="tarifs">
      <span className="badge">Tarifs</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 650 }}>
        Un lancement accompagné, un abonnement simple
      </h2>

      <div className="pr-founderbar rv">
        <span className="pr-founderchip">Offre fondateur</span>
        <p className="pr-foundertext">
          Les <strong>{FOUNDER_SEATS_TOTAL} premiers restaurants</strong> conservent un tarif préférentiel,{" "}
          <strong>à vie</strong>. Snack Manager est en lancement accompagné — le tarif deviendra public ensuite. C&apos;est
          prévu, c&apos;est assumé.
        </p>
        <span className="pr-founderseats">
          <span className="pr-seatdots" aria-hidden="true">
            {Array.from({ length: FOUNDER_SEATS_TOTAL }, (_, i) => (
              <span className={i < FOUNDER_SEATS_TAKEN ? "pr-seat off" : "pr-seat"} key={i} />
            ))}
          </span>
          <span className="pr-seatlabel">
            <b>{FOUNDER_SEATS_LEFT} places restantes</b> sur {FOUNDER_SEATS_TOTAL}
          </span>
        </span>
      </div>

      <div className="pr-grid">
        {PLANS.map((plan, i) => (
          <div className="rv" key={plan.name} style={{ transitionDelay: `${i * 0.1}s` }}>
            <article className={plan.popular ? "pr-card popular spot" : "pr-card spot"}>
              {plan.popular ? <span className="pr-badge">Populaire</span> : null}
              <h5 className="h5">{plan.name}</h5>
              <p className="pr-price">{plan.price}</p>
              <p className="body-text pr-desc">{plan.desc}</p>
              <a className={plan.popular ? "btn light pr-cta" : "btn dark pr-cta"} href="#contact">
                Demander un devis
              </a>
              <p className="pr-featlabel">{plan.featLabel}</p>
              <ul className="pr-features">
                {plan.features.map((f) => (
                  <li key={f}>
                    <TickDot />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </article>
          </div>
        ))}
      </div>
    </section>
  );
}
