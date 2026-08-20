import { DIRECT_DELIVERY, SERVICES, section } from "./content";

/**
 * « Un logiciel ne suffit pas. On s'occupe du reste. » — les trois services.
 *
 * CE QUE LA SECTION EST DEVENUE, ET POURQUOI. Elle listait des CANAUX sous le
 * titre « Vos clients commandent chez vous. Pas chez eux. » Deux défauts que le
 * fondateur a vus d'un coup : « chez eux » ne désigne personne — le lecteur ne
 * sait même pas de qui on parle — et la section n'expliquait NULLE PART
 * l'avantage qu'il y a à commander chez le restaurateur plutôt que sur une
 * plateforme. Elle annonçait une préférence sans jamais donner sa raison.
 *
 * Elle dit maintenant ce qu'on FAIT, et chaque service porte son prix. Un
 * service dont le prix se demande est un service qu'on ne demande pas.
 *
 * TROIS RANGÉES PLEINE LARGEUR, JAMAIS TROIS CARTES, et ce n'est pas une
 * question de goût : la grille tarifaire est deux sections plus bas. Trois
 * cartes ici feraient lire la fiche Google comme un troisième choix parmi
 * trois, alors que c'est le mécanisme qui rend le 0 % possible.
 *
 * La première rangée est la plus haute. C'est le meilleur argument de la page :
 * il doit se voir avant d'être lu.
 *
 * Aucun appel à l'action. On explique, on ne demande rien — et la clause de
 * livraison ferme la section, à l'endroit exact où le lecteur qui vient de
 * comprendre qu'il peut reprendre son volume se demande qui porte les sacs.
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
        {SERVICES.map((service, i) => (
          // `SERVICES[0]` est la fiche Google, et l'ordre du tableau est l'ordre
          // d'affichage : la rangée de tête n'est pas choisie ici.
          <li className={i === 0 ? "ch-row lead rv" : "ch-row rv"} key={service.id}>
            {/* La fracture verticale est conservée — c'est elle qui fait lire
                une RANGÉE et non une carte. L'accroche reste collée au titre :
                elle en est la suite, pas le début du détail. */}
            <div className="ch-head-cell">
              <h3 className="ch-title">{service.title}</h3>
              <p className="ch-lead">{service.lead}</p>
            </div>
            <p className="ch-line">{service.line}</p>
            {/* Le prix tient sa colonne plutôt que de finir en queue de
                paragraphe : c'est la première chose qu'on cherche dans une
                liste de services, et la dernière qu'on trouve quand elle est
                noyée dans la prose. Le montant seul, puis sa condition sous
                lui — mise en service, devis, formule qui l'inclut. */}
            <p className="ch-price">
              {service.price}
              {service.priceNote ? <span className="ch-pricenote">{service.priceNote}</span> : null}
            </p>
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
