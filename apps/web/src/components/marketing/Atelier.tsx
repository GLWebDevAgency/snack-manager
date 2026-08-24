import Link from "next/link";
import { ATELIER_CARDS, ATELIER_PORTE, section } from "./content";

/**
 * « Le site, la fiche Google, les réseaux : l'Atelier s'en occupe. » — la
 * porte vers `/atelier`.
 *
 * UNE PORTE, PAS UN ÉTALAGE. L'accueil vend le LOGICIEL ; les services
 * d'agence ont leur page, et cette section n'existe que pour qu'on la trouve.
 * D'où trois cartes sans un seul montant : un prix posé ici entrerait en
 * concurrence avec la grille tarifaire deux sections plus bas, et la page de
 * l'Atelier affiche déjà chacun des siens.
 *
 * TROIS CARTES, ET PAS TROIS RANGÉES — l'inverse exact de `Canaux`, et c'est
 * voulu : les rangées de la section précédente sont des lignes de devis (un
 * prix au bout de chacune), ces cartes sont des LIENS. Une carte cliquable en
 * entier se comprend comme une destination ; une rangée, comme une ligne de
 * facture. La note sous la grille dit où mènent les trois, et pourquoi y
 * aller : les prix sont là-bas.
 *
 * Tout est rendu au serveur — aucun état, aucune image : posée entre la bande
 * photographique des services et la rangée de pictogrammes du matériel, la
 * section est une respiration, pas une surface de plus à charger.
 */
export function Atelier() {
  const { badge, title } = section("atelier");

  return (
    <section className="section at-section" id="atelier">
      <div className="section-head at-head rv">
        {badge ? <span className="badge">{badge}</span> : null}
        <h2 className="h2">{title}</h2>
      </div>

      <div className="at-cards rv">
        {ATELIER_CARDS.map((card) => (
          // La carte ENTIÈRE est le lien, comme sur les cartes du blog : la
          // cible de clic est la surface, pas les deux mots dorés du bas.
          <Link className="at-card spot" href={ATELIER_PORTE.href} key={card.id}>
            <h3 className="at-cardtitle">{card.title}</h3>
            <p className="at-cardline">{card.line}</p>
            <span className="at-cardcta">{ATELIER_PORTE.cta}</span>
          </Link>
        ))}
      </div>

      <p className="at-note rv">{ATELIER_PORTE.note}</p>
    </section>
  );
}
