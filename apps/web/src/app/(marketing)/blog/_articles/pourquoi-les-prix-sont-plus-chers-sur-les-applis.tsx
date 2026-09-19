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
        l'appli ». Cette différence peut venir des prix des plats, des promotions et des frais appliqués.
        Pour la comprendre, il faut distinguer ce que paient le restaurant et le client.
      </p>

      <h2 className="bl-h2">Il n'y a pas une facture, il y en a deux</h2>
      <p className="bl-p">
        Sur une commande passée via une plateforme, deux factures se superposent sur le même repas, et elles ne sont pas
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
        prix de la carte sont saisis et modifiés <strong>par le restaurateur</strong>, dans l'interface commerçant. Les conditions de vente et les options de tarification sont à vérifier dans votre contrat commerçant.
      </p>
      <p className="bl-p">
        À coûts identiques, une commission réduit la contribution d’une vente. Certains restaurants adaptent leurs prix
        pour en tenir compte. Comparer les canaux demande aussi d’intégrer l’emballage, les promotions et la livraison.
      </p>

      <Note titre="La phrase à retenir">
        Le montant final dépend du prix des plats, des promotions et des frais. Comparez le détail de la commande
        et votre relevé commerçant pour comprendre ce qui revient réellement au restaurant.
      </Note>

      <h2 className="bl-h2">Ce que cet argent achète — parce qu'il achète quelque chose</h2>
      <p className="bl-p">
        Il serait facile, et malhonnête, de s'arrêter là. La commission n'est pas un péage posé sur une route que vous
        avez construite. Elle paie deux choses, et les deux sont réelles.
      </p>
      <p className="bl-p">
        <strong>L'acquisition.</strong> Une plateforme met votre carte devant quelqu'un qui ne connaissait ni votre nom
        ni votre rue. Cette visibilité peut vous faire connaître de nouveaux clients. Son intérêt se mesure avec les commandes
        obtenues et leur contribution, au même titre que vos autres moyens de communication.
      </p>
      <p className="bl-p">
        <strong>La logistique.</strong> Quand il y a livraison, quelqu'un porte le sac, quelqu'un répond au client dont
        la commande est en retard, quelqu'un rembourse quand ça se passe mal. La répartition de ces services et de leurs coûts dépend de l’offre souscrite auprès de la plateforme.
      </p>
      <p className="bl-p">
        Un restaurateur qui supprime ce canal du jour au lendemain supprime aussi ce travail-là, et il le découvre le
        vendredi suivant. Ce n'est pas ce que nous conseillons, et ce n'est pas ce que nous vendons.
      </p>

      <h2 className="bl-h2">Quel coût pour les clients qui reviennent ?</h2>
      <p className="bl-p">
        Pour vos clients réguliers, examinez <strong>le coût complet de chaque canal</strong> et le service qu’il apporte.
      </p>
      <p className="bl-p">
        Un client régulier peut apprécier la simplicité d’une plateforme ou sa livraison. Il peut aussi préférer
        votre page directe pour retrouver votre carte et choisir son retrait. Ces usages ont des coûts différents.
      </p>
      <p className="bl-p">
        Une commande directe n’est pas automatiquement plus rentable : abonnement, paiement, emballage et éventuelle
        livraison restent à financer. Le bon calcul compare ce qui reste pour votre établissement après ces dépenses.
      </p>

      <h2 className="bl-h2">Le canal direct ne fait pas le même travail</h2>
      <p className="bl-p">
        Votre page directe peut être découverte depuis votre site, votre fiche Google ou vos supports. Elle donne
        aussi aux clients qui vous connaissent un accès simple à votre carte et à vos créneaux.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Vous définissez vos prix.</strong> Snack Manager ne prélève pas de commission sur vos commandes.
          L’abonnement et les frais de paiement restent distincts.
        </li>
        <li>
          <strong>Un programme fidélité en pilote accompagné.</strong> Cartes, points ou tampons et récompenses sont
          configurables. Le cumul automatique après commande en ligne et l’utilisation sécurisée des récompenses restent à finaliser.
        </li>
        <li>
          <strong>Une relation directe.</strong> Vous accédez aux informations utiles au traitement des commandes
          et aux données disponibles dans le cadre des consentements recueillis.
        </li>
      </ul>

      <h2 className="bl-h2">Les coûts du canal direct à distinguer</h2>
      <p className="bl-p">
        Le coût du canal direct ne se résume pas à la commission du logiciel. Séparez l’abonnement, le paiement et,
        si vous la proposez, la livraison organisée par votre établissement.
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
        Les frais de paiement dépendent de chaque contrat : ils peuvent être inclus dans certains services ou facturés
        séparément. Utilisez vos relevés pour les compter une seule fois dans votre comparaison.
      </p>

      <h2 className="bl-h2">La bonne question n'est pas « laquelle », c'est « laquelle pour qui »</h2>
      <p className="bl-p">
        Il n'y a pas un canal à garder et un à supprimer. Il y a deux canaux, et deux moments différents dans la vie d'un
        client.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Pour vous faire connaître</strong>, plusieurs canaux sont possibles : plateformes, fiche Google,
          site et communication locale. Comparez leur apport et leurs coûts.
        </li>
        <li>
          <strong>Pour faciliter le retour</strong>, rendez votre commande directe visible et simple à utiliser,
          tout en conservant les services utiles à votre clientèle.
        </li>
      </ul>
      <p className="bl-p">
        Tout le travail consiste donc à faire passer le second groupe d'un canal à l'autre, sans rien casser du premier.
        Un lien de commande sur votre fiche Google, un sticker sur le sac, un mot au comptoir : ces actions peuvent
        encourager le retour en direct. Leur effet se mesure dans la durée, sans résultat garanti.
      </p>

      <h2 className="bl-h2">Ce que vous pouvez regarder dès ce mois-ci</h2>
      <p className="bl-p">
        Trois indicateurs à réunir à partir de vos ventes et relevés disponibles :
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
            Le total mensuel des commissions, frais de paiement et dépenses de livraison, à partir de vos relevés
            et factures, sans compter deux fois le même coût.
          </p>
        </li>
        <li className="bl-etape">
          <p className="bl-p">
            La fréquence de retour des clients, lorsqu’elle peut être mesurée avec les données et consentements
            disponibles. Distinguez-la de la contribution financière des commandes.
          </p>
        </li>
      </ol>
      <p className="bl-p">
        Les données accessibles varient selon vos outils et vos contrats. Vérifiez ce que vous pouvez exporter
        ou analyser avant de promettre un suivi individualisé des clients qui reviennent.
      </p>

      <Note titre="Et la livraison, dans tout ça ?">
        Snack Manager ne fournit pas de livreurs. La livraison organisée par votre restaurant est proposée en pilote,
        après configuration et validation du parcours. Elle est prévue dans Boost ou dans le module dédié ; vos livreurs,
        le matériel et les dépenses de livraison restent distincts.
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
