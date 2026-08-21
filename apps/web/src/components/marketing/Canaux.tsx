import { Photo } from "./Photo";
import { DIRECT_DELIVERY, SERVICES, SERVICES_BAND, section } from "./content";

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
 *
 * ═══ LA SEULE IMAGE DE LA SECTION EST DERRIÈRE ELLE ═══
 *
 * Trois couches, dans l'ordre des bandes de `/offres` (`.of-bandmedia` /
 * `.of-bandveil` / contenu) : la photo à fond perdu, le voile, puis les rangées.
 * Les deux premières sont EN POSITION ABSOLUE, donc hors du flux de la colonne
 * flex — la section garde au pixel près les 794 px qu'elle mesurait sans image.
 * C'est la condition qui rendait ce fond perdu acceptable : une photo posée sous
 * un paragraphe aurait été une rallonge, celle-ci occupe le noir qui était déjà
 * là.
 *
 * ELLE NE SE POSE PAS À CÔTÉ D'UNE AUTRE. `AppsShowcase` la précède (la scène de
 * démonstration) et `Materiel` la suit (quatre pictogrammes sur fond nu) : la
 * bande ne touche aucune autre surface photographique de la page.
 */
export function Canaux() {
  const { badge, title } = section("commander");

  return (
    <section className="section ch-section" id="commander">
      {/* Décorative, et les deux drapeaux sont posés (`decorative` met `alt=""`
          ET `aria-hidden` sur l'enveloppe) : la scène est entièrement floue,
          elle ne porte aucune information qu'un lecteur d'écran doive entendre
          entre le titre de la section et le premier prix. */}
      <span className="ch-media">
        <Photo shot={SERVICES_BAND} decorative sizes="100vw" />
      </span>
      {/*
       * LE VOILE EST MESURÉ, PAS SUPPOSÉ — et il est plus dense que celui des
       * bandes de `/offres` parce que le texte le plus petit de la section est
       * plus petit : `.ch-pricenote` fait 12,5 px en blanc à 50 %.
       *
       * Méthode : on redessine la photo dans un canevas au cadrage `cover` que
       * la bande rend vraiment (1 430 × 794 au bureau, 390 × 1 340 au
       * téléphone), on applique l'alpha du voile ligne par ligne, et on prend le
       * PIRE pixel du cadre — jamais la moyenne. Les pastilles de bokeh de cette
       * photo montent à 245 en sRGB ; sous 82 % de noir elles retombent à 45, et
       * à 45 :
       *
       *   blanc (`.ch-title`, 20 px) ......................... 13,69:1
       *   or #c9a15a (`.ch-price`, 17 px) ..................... 5,69:1
       *   gris #999 (`.ch-line`, 16 px) ....................... 4,81:1
       *   blanc 50 % (`.ch-pricenote`, 12,5 px) ............... 4,64:1
       *
       * Le seuil AA d'un texte courant est 4,5:1, et les quatre le tiennent sur
       * le pixel le plus clair de la photo, aux trois largeurs. Le voile ne
       * descend donc jamais sous 82 % : c'est la contrainte du 12,5 px, pas un
       * réglage d'ambiance.
       */}
      <span className="ch-veil" aria-hidden="true" />

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
