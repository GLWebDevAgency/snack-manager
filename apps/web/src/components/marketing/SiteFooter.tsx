"use client";

import { useState } from "react";
import { NAV_LEFT, NAV_RIGHT } from "./content";
import { LogoMark, SmallFillet } from "./icons";

/**
 * LA COLONNE « PAGES » EST DÉRIVÉE DE LA NAVIGATION, ELLE N'EST PLUS RECOPIÉE.
 *
 * Elle portait « Expertise » → `#pourquoi`, une ancre qui appartenait à
 * Process ; le composant supprimé, le lien ne menait plus nulle part et rien
 * ne le signalait — un défaut invisible en développement et évident en
 * production. La dériver de `NAV_LEFT` / `NAV_RIGHT` rend ce cas impossible :
 * une ancre qui disparaît disparaît des deux endroits à la fois.
 *
 * `#faq` est retirée du groupe : la colonne voisine porte déjà « Questions
 * fréquentes », et un pied de page qui propose deux fois le même lien à dix
 * centimètres d'écart se lit comme une erreur.
 */
const PAGES = [...NAV_LEFT, ...NAV_RIGHT].filter((p) => p.href !== "#faq");

/**
 * Pied de page en carte, avec l'onglet-encoche du logo posé sur son bord haut
 * (et ses deux congés qui le raccordent au noir).
 *
 * L'inscription à la liste n'a pas de back-end : on le dit, plutôt que de faire
 * semblant — le formulaire renvoie vers le rappel téléphonique.
 */
export function SiteFooter() {
  const [sent, setSent] = useState(false);
  const year = new Date().getFullYear();

  return (
    <footer>
      <div className="foot-wrap">
        <div className="foot-card">
          <div className="foot-notchtab">
            <div className="foot-notchcontent">
              <LogoMark width={19} height={19} />
              <p className="logo-wordmark" style={{ fontSize: 18 }}>
                Snack Manager
              </p>
            </div>
            <span className="foot-filletleft" aria-hidden="true">
              <SmallFillet rotate={90} />
            </span>
            <span className="foot-filletbottom" aria-hidden="true">
              <SmallFillet />
            </span>
          </div>

          <div className="foot-columns">
            <div className="foot-left">
              <p className="foot-tagline">Simplifier le quotidien du service</p>
              <div className="foot-newsletter">
                <p className="subheading foot-newsletterlabel">Rejoignez la liste pour suivre le lancement</p>
                {sent ? (
                  <p className="foot-note" role="status">
                    Merci — on vous écrit au prochain jalon. Pour une démo tout de suite,{" "}
                    <a className="faq-helplink" href="#contact">
                      demandez un rappel
                    </a>
                    .
                  </p>
                ) : (
                  <form
                    className="foot-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setSent(true);
                    }}
                  >
                    <label className="ct-hp" htmlFor="foot-email">
                      Votre adresse e-mail
                    </label>
                    <input
                      id="foot-email"
                      type="email"
                      name="email"
                      placeholder="nom@email.com"
                      className="foot-input"
                      autoComplete="email"
                      required
                    />
                    <input type="submit" value="S'inscrire" className="foot-subscribe" />
                  </form>
                )}
              </div>
            </div>

            <div className="foot-linkcols">
              <div className="foot-linkcol">
                <p className="foot-colheading">Pages</p>
                {PAGES.map((p) => (
                  <a className="ui-link foot-link" href={p.href} key={p.href}>
                    {p.label}
                  </a>
                ))}
              </div>
              <div className="foot-linkcol">
                <p className="foot-colheading">Contact</p>
                <a className="ui-link foot-link" href="mailto:contact@snackmanager.fr">
                  contact@snackmanager.fr
                </a>
                <a className="ui-link foot-link" href="#faq">
                  Questions fréquentes
                </a>
              </div>
            </div>
          </div>

          <div className="foot-legals">
            <p className="foot-credit">© {year} Snack Manager. Tous droits réservés.</p>
            <a href="#faq" className="ui-link foot-link">
              Vos données vous appartiennent
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
