import type { CSSProperties } from "react";
import { VS_WITH, VS_WITHOUT, section } from "./content";
import { CmpBolt, CmpToday } from "./icons";

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
 * être EN FACE, sur la même ligne. D'où le tableau ligne à ligne :
 * `VS_WITHOUT[i]` répond à `VS_WITH[i]`, et c'est un contrat que le contenu
 * tient (voir le garde-fou ci-dessus).
 *
 * ═══ LA SÉMAPHORE ROUGE/VERT EST PARTIE, ET CE N'EST PAS COSMÉTIQUE ═══
 *
 * Chaque ligne portait une croix rouge à gauche et une coche verte à droite.
 * Deux défauts, dont le second est le vrai :
 *
 *  1. le rouge et le vert sont les couleurs de SENS de la direction artistique
 *     — « alerte » et « prêt », dans la caisse et dans la cuisine. Les dépenser
 *     ici pour décorer un argumentaire les use là où elles portent un état ;
 *  2. surtout, une croix face à une coche est une COMPARAISON — deux choses
 *     qu'on met côte à côte pour choisir. Or il n'y a rien à choisir : il y a
 *     un avant et un après, et le lecteur est censé se voir PASSER de l'un à
 *     l'autre.
 *
 * D'où le flux. La douleur reste éteinte à gauche, une lueur parcourt le rail
 * qui traverse la ligne, et la réponse s'allume À SON ARRIVÉE — pas avant. Les
 * six lignes se déclenchent en cascade, chacune décalée sur la précédente
 * (`--i`), ce qui donne à lire un processus qui s'exécute plutôt qu'un tableau
 * qui s'affiche. Tout est en CSS : aucun état React, aucun temporisateur, rien
 * qui puisse se désynchroniser.
 *
 * L'animation ne part qu'une fois la section révélée (`.cmp-mirror.in`), sinon
 * la cascade se jouerait pendant que le visiteur est encore trois écrans plus
 * haut. Sous `prefers-reduced-motion`, l'état final est posé d'emblée.
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
            <CmpToday />
            <span>{HEADS[0]}</span>
          </span>
          <span className="cmp-headpill right">
            <CmpBolt />
            <span>{HEADS[1]}</span>
          </span>
        </div>

        <ul className="cmp-rows">
          {VS_WITHOUT.map((pain, i) => (
            /* `--i` porte le rang de la ligne : c'est lui, et lui seul, qui
               décale la cascade. Le CSS n'a aucun autre moyen de savoir qu'il
               est la quatrième ligne d'une liste. */
            <li className="cmp-row" key={pain} style={{ "--i": i } as CSSProperties}>
              <span className="cmp-cell left">{pain}</span>

              {/* Le rail et sa lueur. Purement décoratif : la relation entre
                  les deux cellules est déjà portée par leur voisinage dans la
                  même ligne de liste. */}
              <span className="cmp-flow" aria-hidden="true">
                <span className="cmp-spark" />
              </span>

              <span className="cmp-cell right">{VS_WITH[i]}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
