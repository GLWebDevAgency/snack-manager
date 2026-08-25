import Link from "next/link";
import { Photo } from "./Photo";
import { ATELIER_PORTE, DIRECT_DELIVERY, SERVICES, SERVICES_BAND, section } from "./content";

/**
 * « Un logiciel ne suffit pas. On s'occupe du reste. » — L'ATELIER, en une
 * seule section.
 *
 * CE QUE LA SECTION EST DEVENUE, ET POURQUOI. Elle listait des CANAUX, puis
 * trois services chiffrés — et le 25/08 une seconde section « porte de
 * l'Atelier » est venue répéter les mêmes services en trois cartes juste en
 * dessous. Le fondateur a vu ce que le lecteur voyait : deux sections pour la
 * même chose. La porte est morte ; TOUT l'Atelier vit ici — cinq rangées, la
 * fiche Google en tête (tout le monde en a une, et c'est le mécanisme du zéro
 * commission), chaque service et son prix, et le renvoi vers `/atelier` en
 * seul appel. La maquette offerte reste la garantie DU service site, jamais
 * la tête d'affiche : un restaurateur peut ne rien vouloir changer à son site
 * et tout confier de sa fiche ou de ses réseaux (fondateur, 25/08).
 *
 * CINQ RANGÉES PLEINE LARGEUR, JAMAIS CINQ CARTES, et ce n'est pas une
 * question de goût : la grille tarifaire est deux sections plus bas. Des
 * cartes ici feraient lire chaque service comme un choix parmi cinq, alors
 * que c'est un devis affiché — on le lit en colonne, prix sous prix.
 *
 * La première rangée est la plus haute. C'est le meilleur argument de la
 * page : il doit se voir avant d'être lu.
 *
 * Un SEUL appel à l'action, en navigation (« Découvrir l'Atelier ») — et la
 * clause de livraison ferme la section, à l'endroit exact où le lecteur qui
 * vient de comprendre qu'il peut reprendre son volume se demande qui porte
 * les sacs.
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
          // `SERVICES[0]` est la fiche Google, et l'ordre du tableau est
          // l'ordre d'affichage : la rangée de tête n'est pas choisie ici.
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

      {/* Le seul appel de la section — une navigation, pas une demande : les
          prix sont déjà là, la page de l'Atelier montre la démarche (regarder,
          choisir service par service, confier) et le détail de chacun. */}
      <div className="ch-cta rv">
        <Link className="btn light" href={ATELIER_PORTE.href}>
          {ATELIER_PORTE.cta}
        </Link>
        <span className="ch-ctanote">{ATELIER_PORTE.note}</span>
      </div>

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
