import { CONTACT_EMAIL, NAV } from "./content";

/** Pied de page : rappel de l'offre, navigation secondaire, mentions. */
export function SiteFooter() {
  const year = 2026;

  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <div className="mk-footer-top">
          <div>
            <a className="mk-logo" href="#top" aria-label="Snack Manager — accueil">
              <span className="mk-logo-mark" aria-hidden="true">
                S
              </span>
              Snack Manager
            </a>
            <p className="mk-body" style={{ marginTop: 14, maxWidth: 340 }}>
              La suite qui fait tourner les snacks et fast-foods indépendants : caisse, cuisine, commande en ligne et
              back-office. Hébergé en Europe, sans engagement.
            </p>
            <p className="mk-body" style={{ marginTop: 14 }}>
              <a className="mk-link" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>

          <div>
            <h4>Le produit</h4>
            <ul>
              {NAV.map((n) => (
                <li key={n.href}>
                  <a href={n.href}>{n.label}</a>
                </li>
              ))}
              <li>
                <a href="#pilote">Le restaurant pilote</a>
              </li>
            </ul>
          </div>

          <div>
            <h4>Accès</h4>
            <ul>
              <li>
                <a href="#contact">Demander une démo</a>
              </li>
              <li>
                <a href="#conformite">RGPD & conformité caisse</a>
              </li>
              <li>
                <a href="/admin">Espace restaurateur</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mk-footer-legal">
          <span>© {year} Snack Manager. Tous droits réservés.</span>
          <span>Données hébergées en Europe · Prix hors taxes</span>
        </div>
      </div>
    </footer>
  );
}
