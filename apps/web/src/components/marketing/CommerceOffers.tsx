import { COMMERCE_OFFERS, COMMERCE_TERMS } from "./commerce-offers";
import { ancre, euros } from "./content";

/** Gabarit partagé avec la grille existante ; aucune vente automatique du pilote. */
export function CommerceOffers() {
  return (
    <section className="section of-section" id="applications-seules" aria-labelledby="commerce-title">
      <span className="badge">À la carte</span>
      <h2 className="h2 center-h2" id="commerce-title">Votre besoin d’abord. La suite quand vous en avez besoin.</h2>
      <p className="subheading of-lead">
        Gardez votre caisse et votre site. Choisissez la fidélité ou la commande en ligne :
        chaque application comprend le back-office nécessaire pour l’utiliser.
      </p>
      <div className="pr-grid">
        {COMMERCE_OFFERS.map((offer) => (
          <article className="pr-card spot" key={offer.id}>
            <p className="body-text">{offer.status}</p>
            <h3 className="h5">{offer.title}</h3>
            <p className="pr-price"><span className="pr-amt">{euros(offer.monthlyCents)}</span><span className="pr-period"> HT / mois</span></p>
            <ul className="pr-modules">
              {offer.points.map((point) => (
                <li className="pr-module" key={point}><span className="pr-dot" aria-hidden="true" /><span>{point}</span></li>
              ))}
            </ul>
            <p className="body-text pr-desc">
              {offer.note}
            </p>
            <a className="btn light" href={ancre("contact").href}>
              {offer.cta}
            </a>
          </article>
        ))}
      </div>
      <p className="body-text">
        Mise en service standard : {euros(COMMERCE_TERMS.setup)} une fois, précisée au devis.
        Boost comprend le click & collect et le pilote fidélité accompagné ; la livraison ajoute {euros(COMMERCE_TERMS.supplement)} HT/mois
        après validation. Les frais de paiement et les coûts de livraison restent séparés.
      </p>
      <p className="body-text">{COMMERCE_TERMS.note}</p>
    </section>
  );
}
