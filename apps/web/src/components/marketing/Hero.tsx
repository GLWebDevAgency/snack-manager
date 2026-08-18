import { FOUNDER_SEATS_LEFT, FOUNDER_SEATS_TOTAL } from "./content";
import { MkIcon } from "./icons";
import { Mockup } from "./Mockups";

/**
 * Hero : promesse, argument ROI chiffré, double appel à l'action et la preuve
 * « construit derrière un vrai comptoir ». Server component — aucune animation
 * qui nécessite du JS, hors la révélation au scroll pilotée par RevealObserver.
 */
export function Hero() {
  return (
    <section className="mk-hero" id="top">
      <div className="mk-wrap">
        <div className="mk-hero-grid">
          <div className="mk-hero-copy">
            <span className="mk-badge" data-rv>
              <b>Nouveau</b>
              Conçu par des restaurateurs
            </span>

            <h1 className="mk-h1" data-rv style={{ transitionDelay: "60ms" }}>
              On fait tourner votre restaurant.
              <br />
              Pas l&apos;inverse.
            </h1>

            <p className="mk-lead" data-rv style={{ transitionDelay: "120ms" }}>
              Caisse, cuisine, back-office et commande en ligne réunis dans <span className="mk-kw-w">une seule
              plateforme</span> — <span className="mk-kw">à vos couleurs</span>, pensée par des gens qui ont{" "}
              <span className="mk-kw-w">tenu le comptoir</span>.
            </p>

            <div className="mk-roi" data-rv style={{ transitionDelay: "180ms" }}>
              <span className="mk-roi-fig mk-num" aria-hidden="true">
                1–2
              </span>
              <span className="mk-roi-txt">
                <b>Jusqu&apos;à 1 à 2 postes économisés par mois</b> — en réorganisant le travail plutôt qu&apos;en
                l&apos;ajoutant : téléphone déchargé, commandes qui ne repassent plus par la caisse, heures qui ne se
                recomptent plus à la main.
              </span>
            </div>

            <div className="mk-hero-actions" data-rv style={{ transitionDelay: "220ms" }}>
              <a className="mk-btn mk-btn--primary" href="#contact">
                Demander une démo
                <MkIcon name="arrow" size={17} />
              </a>
              <a className="mk-btn mk-btn--ghost" href="#tarifs">
                Voir les tarifs
              </a>
            </div>

            <p className="mk-hero-trust" data-rv style={{ transitionDelay: "260ms" }}>
              <span>Sans engagement</span>
              <i aria-hidden="true" />
              <span>Installé en quelques jours</span>
              <i aria-hidden="true" />
              <span>Testé en service réel 7 j/7</span>
            </p>

            <p className="mk-body" data-rv style={{ transitionDelay: "300ms" }} suppressHydrationWarning>
              Construit derrière un vrai comptoir, au restaurant pilote{" "}
              <a className="mk-link" href="#pilote">
                Class&apos;Food
              </a>{" "}
              — pas dans un bureau. Offre fondateur : {FOUNDER_SEATS_LEFT} places restantes sur {FOUNDER_SEATS_TOTAL}.
            </p>
          </div>

          <div className="mk-hero-stage" data-rv style={{ transitionDelay: "140ms" }}>
            <Mockup variant="kds" />
            <div className="mk-hero-live">
              <div className="mk-livechip">
                <i className="mk-dot" aria-hidden="true" />
                <span>
                  <span className="mk-livechip-t">Commande en ligne · 18,90 € payée</span>
                  <span className="mk-livechip-s">Ticket parti en cuisine — sans passer par la caisse</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
