import { DIRECT_DELIVERY, ORDER_CHANNELS, section } from "./content";

/**
 * « Vos clients commandent chez vous. Pas chez eux. » — la bande-liste des
 * trois canaux directs.
 *
 * TROIS RANGÉES PLEINE LARGEUR, JAMAIS TROIS CARTES, et ce n'est pas une
 * question de goût : la grille tarifaire est deux sections plus bas. Trois
 * cartes ici feraient lire la fiche Google comme un troisième choix parmi
 * trois, alors que c'est le mécanisme qui rend le 0 % possible — et c'est
 * précisément pour ça que la section précède le prix.
 *
 * La première rangée est la plus haute et la plus grosse. C'est le meilleur
 * argument de la page : il doit se voir avant d'être lu.
 *
 * Aucun appel à l'action. On explique un mécanisme, on ne demande rien — et la
 * clause de livraison ferme la section, à l'endroit exact où le lecteur qui
 * vient de comprendre qu'il peut reprendre son volume se demande qui va porter
 * les sacs.
 */
export function Canaux() {
  const { badge, title } = section("commander");

  return (
    <section className="section ch-section" id="commander">
      <div className="section-head ch-head rv">
        {badge ? <span className="badge">{badge}</span> : null}
        <h2 className="h2">{title}</h2>
      </div>

      <ol className="ch-rows">
        {ORDER_CHANNELS.map((channel, i) => (
          // `ORDER_CHANNELS[0]` est la fiche Google, et l'ordre du tableau est
          // l'ordre d'affichage : la rangée de tête n'est pas choisie ici.
          <li className={i === 0 ? "ch-row lead rv" : "ch-row rv"} key={channel.id}>
            <h3 className="ch-title">{channel.title}</h3>
            <p className="ch-line">{channel.line}</p>
          </li>
        ))}
      </ol>

      {/*
       * Le hors-tunnel, en toutes lettres : nous nous arrêtons au créneau de
       * retrait et nous ne fournissons aucun livreur. Ce n'est volontairement
       * pas une pastille de fonctionnalité — une pastille se lit comme quelque
       * chose qu'on fournit.
       */}
      <p className="ch-delivery rv">
        <strong>{DIRECT_DELIVERY.lead}</strong> {DIRECT_DELIVERY.line}
      </p>
    </section>
  );
}
