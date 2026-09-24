/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { Note, Renvoi } from "./blocs";

export function corps() {
  return (
    <>
      <p className="bl-p">
        Le prix d'un repas sur une application peut différer du prix au comptoir. Pour l'expliquer, il faut
        séparer trois choses : le prix des plats, les frais payés par le client et les coûts supportés par
        le restaurant. Un total élevé côté client ne dit pas, à lui seul, ce qui reste à l'établissement.
      </p>

      <h2 className="bl-h2" id="decomposer">Décomposer le prix et les frais</h2>
      <div className="bl-tablewrap" tabIndex={0} role="region" aria-label="Les lignes à rapprocher d'une commande et de votre relevé commerçant">
        <table className="bl-table">
          <caption>Les lignes à rapprocher d'une commande et de votre relevé commerçant</caption>
          <thead><tr><th scope="col">Élément</th><th scope="col">Où le vérifier</th><th scope="col">Question à poser</th></tr></thead>
          <tbody>
            <tr><th scope="row">Prix des plats et suppléments</th><td>Carte de chaque canal</td><td>Le panier contient-il exactement les mêmes produits et quantités ?</td></tr>
            <tr><th scope="row">Frais facturés au client</th><td>Récapitulatif client</td><td>Quels frais de livraison ou de service s'ajoutent ?</td></tr>
            <tr><th scope="row">Frais du restaurant</th><td>Contrat, relevé et facture</td><td>Quelle base de calcul est utilisée et quels services sont couverts ?</td></tr>
            <tr><th scope="row">Promotion et remboursement</th><td>Détail des ajustements</td><td>Qui finance la réduction ou supporte l'annulation ?</td></tr>
          </tbody>
        </table>
      </div>
      <p className="bl-p">
        Les conditions varient selon le contrat et les services. Dans sa
        <a className="bl-renvoi" href="https://merchants.ubereats.com/fr/fr/resources/articles/menu-pricing/"> documentation destinée au marché français</a>,
        Uber Eats indique que les frais de mise en relation sont convenus à l'inscription selon la formule.
        Le commerçant peut aussi modifier les prix de ses articles. Une grille publiée pour les États-Unis
        ne permet donc pas de déterminer la commission de votre restaurant en France.
      </p>

      <h2 className="bl-h2" id="comparer">Comparer des commandes équivalentes</h2>
      <p className="bl-p">
        Prenez une période récente et identique pour chaque canal. Séparez retrait et livraison, puis notez
        les remises, les annulations et le nombre de commandes effectivement servies. Comparer un retrait
        au comptoir avec une livraison à domicile sans intégrer le transport fausse la décision.
      </p>
      <p className="bl-p">
        Travaillez avec les mêmes conventions de montants et faites vérifier le traitement des taxes avec
        votre comptable si nécessaire. Le virement reçu de la plateforme n'est pas une mesure suffisante
        de votre chiffre d'affaires ni de votre résultat : des frais ou ajustements ont déjà pu être déduits.
      </p>
      <Note titre="Le calcul utile pour décider">
        Produit de la vente, moins les coûts variables associés : matières, emballage, frais du canal,
        paiement, promotion financée et livraison supportée. Cette contribution sert encore à couvrir
        les charges fixes. Elle n'est pas le bénéfice net du restaurant.
      </Note>

      <h2 className="bl-h2" id="exemple">Un exemple de comparaison, sans taux présenté comme universel</h2>
      <p className="bl-p">
        Exemple pédagogique en montants HT, avec des coûts fictifs : un panier apporte 20 € après réduction.
        Les matières et l'emballage représentent 7 €. Si les frais variables du canal A sont de 5 €, la
        contribution est de 8 €. Si ceux du canal B sont de 2 €, elle est de 11 €.
      </p>
      <p className="bl-p">
        Les 3 € d'écart ne deviennent pas automatiquement un gain. Il faut encore financer les éventuels
        frais fixes du canal B et vérifier qu'il rend le même service. Un transport réalisé par votre
        équipe doit être chiffré ; un client qui ne vous aurait pas découvert autrement a aussi une valeur
        commerciale. Remplacez chaque nombre par votre coût réel avant de décider.
      </p>

      <h2 className="bl-h2" id="direct">Ce que coûte aussi la commande directe</h2>
      <ul className="bl-liste">
        <li><strong>L'outil.</strong> Abonnement, mise en service et éventuelles options définies au contrat.</li>
        <li><strong>Le règlement.</strong> Frais du prestataire de paiement, à compter une seule fois s'ils sont déjà inclus ailleurs.</li>
        <li><strong>Le service.</strong> Préparation, emballage, accueil au retrait ou livraison organisée par le restaurant.</li>
        <li><strong>La visibilité.</strong> Temps ou budget consacrés au site, aux supports et à la communication.</li>
        <li><strong>Les incidents.</strong> Erreurs, reprises, annulations et remboursements réellement supportés.</li>
      </ul>
      <p className="bl-p">
        Snack Manager ne prélève pas de commission sur les commandes. L'abonnement et les frais de paiement
        restent distincts. Le périmètre est présenté sur la page
        <Link className="bl-renvoi" href="/commande-en-ligne"> commande en ligne</Link> ; cette différence tarifaire
        ne dispense pas du calcul complet ci-dessus.
      </p>

      <h2 className="bl-h2" id="decider">Choisir le rôle de chaque canal</h2>
      <p className="bl-p">
        Une plateforme peut répondre à un besoin de découverte ou de livraison. Votre canal direct peut
        simplifier le retour d'un client qui vous connaît déjà. Évaluez séparément ces usages, puis gardez
        les canaux dont le service, la charge de travail et la contribution correspondent à votre activité.
      </p>
      <p className="bl-p">
        Pour rendre le direct accessible, commencez par un
        <Link className="bl-renvoi" href="/blog/lien-de-commande-sur-votre-fiche-google"> lien de commande sur votre fiche Google</Link>
        et une adresse claire sur vos supports. Préparez ensuite le
        <Link className="bl-renvoi" href="/blog/ouvrir-le-click-and-collect-sans-se-tromper"> parcours de retrait avec l'équipe</Link>.
        Le changement de canal doit rester un choix simple pour le client.
      </p>

      <h2 className="bl-h2" id="mesurer">Le relevé à préparer chaque mois</h2>
      <ol className="bl-etapes bl-etapes-simple">
        <li className="bl-etape"><p className="bl-p">Regroupez ventes servies, nombre de commandes et panier moyen, par canal et par mode de remise.</p></li>
        <li className="bl-etape"><p className="bl-p">Rapprochez les frais des contrats et des factures. Isolez les promotions temporaires pour comprendre ce qui restera après leur fin.</p></li>
        <li className="bl-etape"><p className="bl-p">Ajoutez les coûts matière exploitables, l'emballage et la livraison. Notez les données manquantes au lieu de leur attribuer une précision artificielle.</p></li>
        <li className="bl-etape"><p className="bl-p">Choisissez un changement à tester, puis comparez une période de service similaire. Conservez aussi les retards et erreurs dans votre bilan.</p></li>
      </ol>
      <p className="bl-p">
        Pour exploiter vos ventes, partez des exports disponibles dans votre
        <Link className="bl-renvoi" href="/caisse"> caisse</Link> ou vos outils actuels.
        <Link className="bl-renvoi" href="/atelier"> L'analyse de carte de l'Atelier</Link> s'appuie sur des données
        exploitables ; sans coûts renseignés, elle porte sur les ventes et la présentation, pas sur la rentabilité.
        <Renvoi section="contact"> Nous pouvons examiner ce périmètre avec vous</Renvoi>.
      </p>
    </>
  );
}
