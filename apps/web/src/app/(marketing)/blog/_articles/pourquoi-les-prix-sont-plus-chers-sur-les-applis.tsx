/*
 * `react/no-unescaped-entities` est désactivée ici, et par fichier : la prose
 * d'un article est du texte JSX (gras, emphase et renvois au milieu des
 * phrases), là où tout le reste du dépôt affiche des CHAÎNES venues de
 * `content.ts`, que la règle ne voit pas. Le raisonnement complet est dans
 * `_articles/blocs.tsx`, en tête de fichier.
 */
/* eslint-disable react/no-unescaped-entities */
import { COMMISSIONS } from "@/components/marketing/content";
import { Note, Renvoi, Sources, type Source } from "./blocs";

/**
 * Article d'EXPLICATION, et surtout pas de plaidoyer.
 *
 * ═══ POURQUOI CE TON-LÀ, ET PAS UN AUTRE ═══
 *
 * Le lecteur visé vend déjà sur une plateforme, ou hésite à s'y mettre. Un texte
 * qui commence par attaquer Uber Eats lui dit, en creux, qu'on lui demande de
 * renoncer à du volume — et il arrête de lire à la troisième ligne. Or le fait
 * est là : une plateforme fait un travail réel (amener un inconnu, porter le
 * sac) et le facture. Notre canal en fait un autre (fidéliser). On explique
 * l'addition, on ne fait le procès de personne.
 *
 * ═══ LES CHIFFRES, ET D'OÙ ILS VIENNENT ═══
 *
 * Aucun taux n'est saisi dans ce fichier. Les seuls montants affichés sont ceux
 * de `COMMISSIONS` (content.ts), c'est-à-dire ceux que la vitrine assume déjà —
 * « jusqu'à 30 % » et non « 30 % », « environ 1,5 % » et non un taux ferme.
 * Deux endroits où vit le même chiffre, c'est deux endroits qui divergent.
 *
 * Et surtout : ON NE CITE PAS UN CONCURRENT POUR APPUYER UNE VENTE. Les seules
 * pages qui publient des grilles de commission détaillées sont des éditeurs qui
 * vendent la même chose que nous ; leurs chiffres arrangent leur démonstration
 * comme les nôtres arrangeraient la nôtre. Cet article explique donc une
 * MÉCANIQUE — qui paie quoi, à qui — et laisse le lecteur mettre ses propres
 * nombres dedans. C'est aussi ce qui le rend vrai plus de six mois.
 */

const SOURCES: readonly Source[] = [
  {
    url: "https://merchants.ubereats.com/us/en/technology/simplify-operations/menu-management/",
    libelle: "Uber Eats — gestion du menu par le commerçant (documentation commerçants)",
    consultee: "21 août 2026",
  },
];

export function corps() {
  return (
    <>
      <p className="bl-p">
        Un client vous le dira un jour, à moitié gêné, en récupérant son sac : « chez vous c'est moins cher que sur
        l'appli ». Il a raison, et ce n'est ni une arnaque ni une erreur de saisie. C'est une addition — et elle
        s'explique en trois minutes.
      </p>

      <h2 className="bl-h2">Il n'y a pas une facture, il y en a deux</h2>
      <p className="bl-p">
        Sur une commande passée via une plateforme, deux factures se superposent sur le même kebab, et elles ne sont pas
        envoyées à la même personne.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Celle que vous payez, vous.</strong> Une commission, calculée sur le montant de la commande. Elle est
          prélevée avant que l'argent n'arrive sur votre compte, ce qui la rend beaucoup moins visible qu'une facture de
          fournisseur : vous ne la réglez pas, elle est déjà partie.
        </li>
        <li>
          <strong>Celle que paie le client.</strong> Des frais de service, souvent proportionnels au panier, et des
          frais de livraison. Ils s'ajoutent au prix affiché, en bas du récapitulatif, au moment où il a déjà composé sa
          commande.
        </li>
      </ul>
      <p className="bl-p">
        Aucune des deux n'apparaît sur la carte. Le client, lui, ne voit qu'un total — et le compare au vôtre.
      </p>

      <h2 className="bl-h2">Le troisième écart : celui que vous créez vous-même</h2>
      <p className="bl-p">
        C'est le point le moins connu, et c'est celui qui explique le gros de la différence. Sur une plateforme, les
        prix de la carte sont saisis et modifiés <strong>par le restaurateur</strong>, dans l'interface commerçant. Rien
        n'oblige à y afficher exactement le prix de la salle.
      </p>
      <p className="bl-p">
        Et beaucoup ne le font pas, pour une raison arithmétique simple : si une part du montant part en commission,
        vendre au prix de la salle revient à vendre à marge réduite. Alors on relève la carte en ligne. La commission ne
        se voit nulle part sur la fiche produit du client — mais elle est dedans.
      </p>

      <Note titre="La phrase à retenir">
        Le prix plus élevé sur l'appli n'est pas décidé par l'appli. Il est décidé par le restaurateur, pour absorber ce
        que l'appli lui facture. C'est la même dépense, écrite à un autre endroit.
      </Note>

      <h2 className="bl-h2">Ce que cet argent achète — parce qu'il achète quelque chose</h2>
      <p className="bl-p">
        Il serait facile, et malhonnête, de s'arrêter là. La commission n'est pas un péage posé sur une route que vous
        avez construite. Elle paie deux choses, et les deux sont réelles.
      </p>
      <p className="bl-p">
        <strong>L'acquisition.</strong> Une plateforme met votre carte devant quelqu'un qui ne connaissait ni votre nom
        ni votre rue. C'est un client que vous n'aviez pas, et que vous n'auriez pas eu ce soir-là. Aucun panneau, aucun
        prospectus, aucune page de commande ne fait ça tout seul.
      </p>
      <p className="bl-p">
        <strong>La logistique.</strong> Quand il y a livraison, quelqu'un porte le sac, quelqu'un répond au client dont
        la commande est en retard, quelqu'un rembourse quand ça se passe mal. Ce travail existe, il coûte, et vous n'avez
        ni à l'organiser ni à l'assurer.
      </p>
      <p className="bl-p">
        Un restaurateur qui supprime ce canal du jour au lendemain supprime aussi ce travail-là, et il le découvre le
        vendredi suivant. Ce n'est pas ce que nous conseillons, et ce n'est pas ce que nous vendons.
      </p>

      <h2 className="bl-h2">Alors où est le problème ?</h2>
      <p className="bl-p">
        Il n'est pas dans le prix de l'acquisition. Il est dans le fait de <strong>payer l'acquisition deux fois</strong>.
      </p>
      <p className="bl-p">
        Le premier soir, la plateforme vous amène un inconnu : la commission achète une rencontre, et elle les vaut. Le
        onzième soir, ce même client sait très bien qui vous êtes, ce qu'il veut, et à quelle heure il passera. Il n'y a
        plus rien à acquérir — et pourtant la commission est identique.
      </p>
      <p className="bl-p">
        Un habitué qui commande via une plateforme est donc, mécaniquement, votre commande la moins rentable. C'est le
        seul reproche que nous formulons, et il ne vise personne : c'est la structure du tarif, pas une intention.
      </p>

      <h2 className="bl-h2">Le canal direct ne fait pas le même travail</h2>
      <p className="bl-p">
        Une page de commande à vous ne vous amènera pas d'inconnu à 21 h. Ce n'est pas son métier, et prétendre le
        contraire serait vous vendre du vent. Son métier, c'est le onzième soir.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Le prix est celui de la salle.</strong> Pas de commission à absorber, donc pas de carte à relever.
          C'est exactement l'écart que votre client a remarqué — et cette fois, il joue pour vous.
        </li>
        <li>
          <strong>La fidélité se cumule.</strong> Points ou tampons, dans la même page, sans carte en carton à perdre au
          fond d'une poche.
        </li>
        <li>
          <strong>Le client est le vôtre.</strong> Son numéro, son historique, ses habitudes. C'est la différence entre
          un chiffre d'affaires et un fonds de commerce.
        </li>
      </ul>

      <h2 className="bl-h2">Les trois taux, côte à côte</h2>
      <p className="bl-p">
        Voilà ce qui se prélève sur une commande, selon par où elle passe. Les deux premières lignes sont des ordres de
        grandeur ; la troisième est celle qu'on préfère taire, alors nous l'affichons nous-mêmes.
      </p>
      {/*
       * Le tableau vit dans son propre conteneur défilant : trois colonnes de
       * texte ne tiennent pas dans 320 px, et une page dont le corps entier
       * défile latéralement est cassée pour tout le monde, pas seulement pour le
       * tableau.
       */}
      <div className="bl-tablewrap">
        <table className="bl-table">
          <thead>
            <tr>
              <th scope="col">Qui</th>
              <th scope="col">Prélevé</th>
              <th scope="col">Sur quoi</th>
            </tr>
          </thead>
          <tbody>
            {COMMISSIONS.map((c) => (
              <tr key={c.who}>
                <th scope="row">{c.who}</th>
                <td className="bl-taux">{c.rate}</td>
                <td>{c.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="bl-p">
        Les frais d'encaissement carte, eux, se paient sur les deux canaux : c'est votre prestataire de paiement, et cet
        argent ne revient à personne d'autre. Les faire disparaître d'un comparatif serait exactement le genre d'omission
        qu'on découvre sur son premier relevé.
      </p>

      <h2 className="bl-h2">La bonne question n'est pas « laquelle », c'est « laquelle pour qui »</h2>
      <p className="bl-p">
        Il n'y a pas un canal à garder et un à supprimer. Il y a deux canaux, et deux moments différents dans la vie d'un
        client.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Le client qui ne vous connaît pas</strong> arrive par la plateforme, ou par votre fiche Google. La
          commission est le prix de la rencontre : elle est chère, et elle est justifiée.
        </li>
        <li>
          <strong>Le client qui revient</strong> devrait commander en direct. C'est là que la commission cesse d'acheter
          quoi que ce soit, et c'est là que vous avez le plus à gagner.
        </li>
      </ul>
      <p className="bl-p">
        Tout le travail consiste donc à faire passer le second groupe d'un canal à l'autre, sans rien casser du premier.
        Un lien de commande sur votre fiche Google, un sticker sur le sac, un mot au comptoir, des points qui se cumulent
        : c'est lent, c'est cumulatif, et ça ne se voit pas en une semaine.
      </p>

      <h2 className="bl-h2">Ce que vous pouvez regarder dès ce mois-ci</h2>
      <p className="bl-p">
        Trois nombres, que vous avez déjà, et qui ne demandent aucun outil pour être posés sur un papier :
      </p>
      <ol className="bl-etapes bl-etapes-simple">
        <li className="bl-etape">
          <p className="bl-p">
            La part de votre chiffre d'affaires qui passe par les plateformes. Pas en euros : en pourcentage. C'est votre
            exposition.
          </p>
        </li>
        <li className="bl-etape">
          <p className="bl-p">
            Ce que la commission représente sur un mois complet, tous canaux confondus. Le montant surprend souvent, parce
            qu'il n'arrive jamais sous forme de facture.
          </p>
        </li>
        <li className="bl-etape">
          <p className="bl-p">
            Le nombre de clients qui ont commandé plus de deux fois. Ceux-là sont votre marge, et aujourd'hui vous ne
            savez probablement pas qui ils sont.
          </p>
        </li>
      </ol>
      <p className="bl-p">
        Le troisième est le seul que vous ne pouvez pas obtenir aujourd'hui si tout passe par un tiers : la liste des
        clients qui reviennent ne vous appartient pas. C'est, à notre avis, le vrai coût — et il ne figure sur aucun
        relevé.
      </p>

      <Note titre="Et la livraison, dans tout ça ?">
        Nous n'en fournissons aucune. Notre tunnel de commande s'arrête au créneau de retrait, et si vous livrez, vous
        continuez comme aujourd'hui — vos tournées, vos horaires. C'est aussi pour ça que les plateformes ne sont pas nos
        adversaires : elles font un métier que nous ne faisons pas.
      </Note>

      <p className="bl-p">
        Si vous voulez poser vos propres chiffres dans ce raisonnement, <Renvoi section="simulateur">le calcul est sur
        la page d'accueil</Renvoi> — et nous le refaisons avec vous, avec vos vrais volumes, si vous{" "}
        <Renvoi section="contact">nous laissez votre numéro</Renvoi>.
      </p>

      <Sources items={SOURCES} />
    </>
  );
}
