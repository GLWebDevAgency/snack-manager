import { FOUNDER_SEATS_LEFT, FOUNDER_SEATS_TAKEN, FOUNDER_SEATS_TOTAL, PLAN_ROWS, PLANS } from "./content";
import { MkIcon } from "./icons";

/**
 * Tarifs : 3 formules + tableau comparatif complet, barre « offre fondateur »
 * (10 places, tarif gelé à vie) et rappel sans engagement / export des données.
 */
export function Pricing() {
  return (
    <section className="mk-section" id="tarifs">
      <div className="mk-wrap">
        <div className="mk-head mk-head--center" data-rv>
          <span className="mk-eyebrow">Tarifs</span>
          <h2 className="mk-h2">Un lancement accompagné, un abonnement simple</h2>
          <p className="mk-lead">
            Un prix par restaurant, tout compris. Installation 290 € en une fois — carte importée depuis vos photos,
            équipe créée, matériel réglé, équipe formée.
          </p>
        </div>

        <div className="mk-founder" style={{ marginTop: 34 }} data-rv>
          <span className="mk-founder-chip">Offre fondateur</span>
          <p>
            Les <b>{FOUNDER_SEATS_TOTAL} premiers restaurants</b> conservent leur tarif <b>à vie</b>. Snack Manager est
            en lancement accompagné — le tarif deviendra public ensuite. C&apos;est prévu, c&apos;est assumé.
          </p>
          <span className="mk-seats">
            <span className="mk-seats-dots" aria-hidden="true">
              {Array.from({ length: FOUNDER_SEATS_TOTAL }, (_, i) => (
                <i key={i} data-off={i < FOUNDER_SEATS_TAKEN ? "true" : undefined} />
              ))}
            </span>
            <span className="mk-seats-label">
              <b className="mk-num">{FOUNDER_SEATS_LEFT} places restantes</b> sur {FOUNDER_SEATS_TOTAL}
            </span>
          </span>
        </div>

        <div className="mk-plans" style={{ marginTop: 16 }}>
          {PLANS.map((p, i) => (
            <article
              key={p.key}
              className="mk-card mk-plan"
              data-popular={p.popular ? "true" : undefined}
              data-rv
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              {p.popular ? <span className="mk-plan-tag">Le plus choisi</span> : null}
              <span className="mk-plan-name">{p.name}</span>
              <span className="mk-plan-price">
                <b className="mk-num">{p.price}</b>
                <span>{p.unit}</span>
              </span>
              <p className="mk-plan-desc">{p.desc}</p>
              <a
                className={`mk-btn ${p.popular ? "mk-btn--primary" : "mk-btn--ghost"} mk-btn--block`}
                href="#contact"
              >
                Demander une démo
              </a>
            </article>
          ))}
        </div>

        <div className="mk-table-wrap" style={{ marginTop: 16 }} data-rv>
          <table className="mk-table">
            <caption className="mk-hp">Comparatif détaillé des trois formules Snack Manager</caption>
            <colgroup>
              <col />
              <col />
              <col className="is-pop" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Ce qui est inclus</th>
                <th scope="col">Essentiel</th>
                <th scope="col" className="is-pop">
                  Complet
                </th>
                <th scope="col">Multi-sites</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <Cell value={row.essentiel} label={`Essentiel — ${row.label}`} />
                  <Cell value={row.complet} label={`Complet — ${row.label}`} />
                  <Cell value={row.multisite} label={`Multi-sites — ${row.label}`} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mk-card" style={{ marginTop: 16, padding: 20 }} data-rv>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 650 }}>
              <MkIcon name="download" size={17} />
              Sans engagement veut dire sans otage
            </span>
            <p className="mk-body" style={{ flex: "1 1 320px" }}>
              Résiliable à tout moment, sans préavis ni pénalité. Vous exportez à la demande{" "}
              <span className="mk-kw-w">l&apos;intégralité de vos données</span> — menu, historique des commandes,
              clients — en CSV standard, depuis votre back-office. Prix affichés hors taxes, par établissement.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Cell({ value, label }: { value: boolean | string; label: string }) {
  if (typeof value === "string") {
    return (
      <td>
        <small>{value}</small>
      </td>
    );
  }
  return (
    <td>
      <span className={value ? "yes" : "no"} role="img" aria-label={`${label} : ${value ? "inclus" : "non inclus"}`}>
        {value ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4.5 12.5 5 5 10-11" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M5 12h14" />
          </svg>
        )}
      </span>
    </td>
  );
}
