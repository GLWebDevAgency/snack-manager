import { VS_WITH, VS_WITHOUT, section } from "./content";
import { CmpBolt, CmpCross, CrossDot, TickDot } from "./icons";

/**
 * LE MIROIR N'A DE SENS QUE SI LES DEUX COLONNES ONT LE MÊME NOMBRE DE LIGNES.
 *
 * Chaque douleur de gauche est écrite pour la réponse qui lui fait face, à la
 * même hauteur. Une colonne plus longue que l'autre ne décale pas seulement la
 * mise en page : elle met une réponse en face de la mauvaise question. Même
 * garde-fou que `section()` — ça casse au build, jamais en production.
 */
if (VS_WITHOUT.length !== VS_WITH.length) {
  throw new Error(`Le miroir est dépareillé : ${VS_WITHOUT.length} douleurs pour ${VS_WITH.length} réponses.`);
}

/**
 * LES DEUX EN-TÊTES SONT LES DEUX PROPOSITIONS DU TITRE, DÉCOUPÉES AU POINT.
 *
 * Les réécrire à la main ferait vivre le même texte à deux endroits, ce que
 * `SECTIONS` existe précisément pour empêcher : le jour où le titre bouge, les
 * en-têtes bougent avec lui au lieu de le contredire à dix pixels d'écart. Le
 * titre est écrit en deux phrases pour cette raison — « Votre service
 * aujourd'hui. Votre service lundi prochain. » — et le point final de la
 * seconde n'a rien à faire dans une pastille.
 */
const HEADS = section("votre-service")
  .title.split(". ")
  .map((half) => half.replace(/\.$/, ""));

/**
 * « Votre service aujourd'hui. Votre service lundi prochain. »
 *
 * LA SECTION A CHANGÉ DE MÉTIER : elle ne conclut plus la page, elle l'ouvre.
 * Un lecteur qui vient d'arriver ne compare pas deux inventaires posés côte à
 * côte — il cherche sa journée dans la colonne de gauche, et la réponse doit
 * être EN FACE, sur la même ligne, pas quelque part dans la liste voisine.
 * D'où le tableau ligne à ligne : `VS_WITHOUT[i]` répond à `VS_WITH[i]`, et
 * c'est un contrat que le contenu tient (voir le garde-fou ci-dessus).
 *
 * AUCUNE CARTE, et c'est un arbitrage. Deux plateaux encadrés se liraient
 * comme deux offres à choisir ; ici il n'y a rien à choisir, il y a un avant
 * et un après. C'est aussi ce qui distingue cette section de la grille
 * tarifaire, quatre écrans plus bas, où il y a vraiment trois colonnes à
 * comparer.
 *
 * C'est le SEUL endroit de la page où la douleur est écrite. Au survol du
 * miroir, la colonne d'aujourd'hui s'éteint : le geste dit ce qu'aucune phrase
 * ne dirait sans se vanter.
 */
export function Comparison() {
  const { badge, title } = section("votre-service");

  return (
    <section className="section cmp-section" id="votre-service">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 820 }}>
        {title}
      </h2>

      <div className="cmp-mirror rv">
        <div className="cmp-heads">
          <span className="cmp-headpill left">
            <CmpCross />
            <span>{HEADS[0]}</span>
          </span>
          <span className="cmp-headpill right">
            <CmpBolt />
            <span>{HEADS[1]}</span>
          </span>
        </div>
        <span className="cmp-divider" aria-hidden="true" />

        <ul className="cmp-rows">
          {VS_WITHOUT.map((pain, i) => (
            <li className="cmp-row" key={pain}>
              <span className="cmp-cell left">
                <CrossDot />
                <span>{pain}</span>
              </span>
              <span className="cmp-cell right">
                <TickDot />
                <span>{VS_WITH[i]}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
