"use client";

import Link from "next/link";
import { Reseaux } from "./Reseaux";
import { FOOTER_COLUMNS, FOOTER_EDITEUR, LANDING_TOP, ancre, type ReseauPublié } from "./content";
import { LogoMark } from "../brand/Logo";
import { SmallFillet } from "./icons";

/**
 * Pied de page en carte, avec l'onglet-encoche du logo posé sur son bord haut
 * (et ses deux congés qui le raccordent au noir).
 *
 * ═══ IL N'EST PLUS LE REFLET DU MENU, IL EST LA NAVIGATION SECONDAIRE ═══
 *
 * Il dérivait ses liens de `NAV_LEFT` / `NAV_RIGHT`, et c'était la bonne idée
 * pour la mauvaise raison : ça empêchait bien les ancres mortes — il avait
 * porté « Expertise → #pourquoi » des semaines après la suppression du
 * composant visé — mais ça le condamnait à ne jamais montrer plus que
 * l'encoche. Or l'encoche ne peut pas tenir sept entrées, et lui, si.
 *
 * Les colonnes vivent donc dans `FOOTER_COLUMNS` (content.ts), où chaque ancre
 * passe par `ancre()` : la protection contre les liens morts est conservée —
 * une section supprimée fait tomber le rendu au lieu de laisser un lien qui ne
 * fait rien — mais le pied de page peut désormais porter ce que le menu a dû
 * laisser tomber, à commencer par les deux routes `/offres` et `/blog`.
 *
 * TOUS LES HREFS SONT ABSOLUS. Ce composant est rendu au bas de CHAQUE page du
 * site, y compris d'un article de blog : un `#tarifs` écrit ici serait un lien
 * mort partout sauf sur la landing, et muet — pas de 404, pas d'erreur, rien.
 *
 * La liste reste explicitement fermée tant qu'aucun service d'inscription
 * n'est branché. Les classes et la structure visuelle du footer sont conservées.
 */
/**
 * Comme `Hero`, ce pied de page est un îlot CLIENT : il reçoit les réseaux au
 * lieu de les lire. Les quatre pages du site le montent, et les quatre doivent
 * donc passer la liste — en oublier une la ferait disparaître de cette page-là
 * seulement, sans qu'aucune vérification ne s'en aperçoive.
 */
export function SiteFooter({ reseaux }: { reseaux: readonly ReseauPublié[] }) {
  const year = new Date().getFullYear();

  return (
    <footer>
      <div className="foot-wrap">
        <div className="foot-card">
          <div className="foot-notchtab">
            <Link className="foot-notchcontent" href={LANDING_TOP} aria-label="Accueil">
              <LogoMark size={19} />
              <span className="logo-wordmark" style={{ fontSize: 18 }}>
                Snack Manager
              </span>
            </Link>
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
                <p className="subheading foot-newsletterlabel">La liste de lancement arrive bientôt</p>
                  <form
                    className="foot-form"
                    onSubmit={(e) => e.preventDefault()}
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
                      disabled
                    />
                    <input type="submit" value="Bientôt" className="foot-subscribe" disabled />
                  </form>
              </div>
              {/*
               * LES RÉSEAUX SONT ICI, ET C'EST L'ENDROIT ÉVIDENT — un pied de
               * page est le seul lieu d'un site où l'on cherche un compte sans
               * qu'on ait à vous y pousser. Ils sont sous l'inscription à la
               * liste parce que les deux disent la même chose (« suivez-nous »)
               * et que l'e-mail est celui des deux qui nous appartient.
               *
               * Tant qu'aucune URL n'est renseignée dans `RESEAUX`, `Reseaux`
               * rend `null` : ni rangée vide, ni titre orphelin.
               */}
              <Reseaux reseaux={reseaux} variant="pied" />
            </div>

            <div className="foot-linkcols">
              {FOOTER_COLUMNS.map((col) => (
                <div className="foot-linkcol" key={col.title}>
                  <p className="foot-colheading">{col.title}</p>
                  {col.links.map((l) =>
                    // `mailto:` n'est pas une route de l'application : `Link`
                    // n'a rien à préparer et le routeur n'a rien à intercepter.
                    l.href.startsWith("mailto:") ? (
                      <a className="ui-link foot-link" href={l.href} key={l.href}>
                        {l.label}
                      </a>
                    ) : (
                      <Link className="ui-link foot-link" href={l.href} key={l.href}>
                        {l.label}
                      </Link>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="foot-legals">
            <p className="foot-credit">© {year} Snack Manager. Tous droits réservés.</p>
            {/*
             * LA MENTION D'ÉDITEUR EST DU TEXTE, PAS UN LIEN, et c'est délibéré :
             * « Mentions légales » et « Politique de confidentialité » n'ont pas
             * encore de page, et les annoncer refaisait en bas de page la faute
             * exacte que la table des réseaux existe pour empêcher — promettre
             * une destination qu'on n'a pas.
             *
             * Le lien vers la FAQ reste : « Vos données vous appartiennent » y
             * a une réponse écrite, et c'est aujourd'hui la seule que le site
             * puisse tenir.
             */}
            <p className="foot-credit foot-editeur">{FOOTER_EDITEUR}</p>
            <Link href={ancre("faq").href} className="ui-link foot-link">
              Vos données vous appartiennent
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
