import { TRUST } from "./content";
import { MkIcon } from "./icons";

/** RGPD, hébergement UE, conformité caisse (loi anti-fraude TVA) et support. */
export function Compliance() {
  return (
    <section className="mk-section mk-section--tight" id="conformite">
      <div className="mk-wrap">
        <div className="mk-head" data-rv>
          <span className="mk-eyebrow">Sérieux, pas seulement joli</span>
          <h2 className="mk-h2">Vos données, votre caisse, vos obligations</h2>
        </div>

        <div className="mk-trust-grid" style={{ marginTop: 28 }}>
          {TRUST.map((t, i) => (
            <article key={t.title} className="mk-card mk-trust" data-rv style={{ transitionDelay: `${i * 60}ms` }}>
              <span className="mk-trust-ico" aria-hidden="true">
                <MkIcon name={t.icon} size={17} />
              </span>
              <h4>{t.title}</h4>
              <p>{t.text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
