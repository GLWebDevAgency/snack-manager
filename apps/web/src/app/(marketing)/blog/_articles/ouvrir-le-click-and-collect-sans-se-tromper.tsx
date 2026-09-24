/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { Note, Renvoi } from "./blocs";

export function corps() {
  return (
    <>
      <p className="bl-p">
        Le click & collect relie une commande en ligne à un retrait dans votre restaurant. Son lancement
        demande autant de préparation côté équipe que côté écran. Une carte facile à comprendre, un délai
        réaliste et un point de retrait identifié constituent un meilleur départ qu'une ouverture immédiate
        de tous les produits sur tous les services.
      </p>

      <h2 className="bl-h2" id="perimetre">Choisir un premier service maîtrisable</h2>
      <p className="bl-p">
        Définissez le restaurant concerné, les horaires de retrait, les produits proposés et la personne
        qui surveille les nouvelles commandes. Commencez sur un service que l'équipe sait tenir. Le midi
        n'est pas forcément le plus calme : choisissez à partir de votre activité réelle.
      </p>
      <p className="bl-p">
        Une carte de lancement peut être plus courte que la carte en salle. Retenez des plats dont la
        préparation et le conditionnement sont maîtrisés. Testez le trajet entre la fin de préparation et
        l'ouverture de l'emballage : température, tenue, sauces et séparation des éléments comptent autant
        que la présentation de la photo.
      </p>

      <h2 className="bl-h2" id="capacite">Définir la capacité avec la cuisine</h2>
      <p className="bl-p">
        Partez du poste le plus contraint : four, friture, assemblage ou emballage. Relevez sa charge sur un
        service normal, puis décidez ce qu'il peut absorber en plus. Un nombre de commandes n'est pas
        toujours une mesure suffisante : deux grandes commandes peuvent occuper davantage la cuisine
        que plusieurs petits paniers.
      </p>
      <Note titre="Exemple de test, à adapter à votre équipe">
        Ouvrez un seul créneau de retrait sur un service choisi. Simulez un petit panier puis un panier
        de groupe, en tenant compte des commandes sur place. Notez l'heure de réception, le démarrage
        en cuisine, la fin de préparation et le retrait. Ajustez avant d'élargir.
      </Note>
      <p className="bl-p">
        Vérifiez les réglages réellement disponibles dans votre outil : horaires, délai de préparation,
        fermeture ponctuelle et éventuel plafonnement. N'annoncez pas une capacité que votre organisation
        ne sait pas suivre. Si le logiciel ne propose pas le réglage souhaité, adaptez le périmètre
        d'ouverture avec votre prestataire avant de publier le lien.
      </p>

      <h2 className="bl-h2" id="carte">Préparer les informations avant la commande</h2>
      <ul className="bl-liste bl-check">
        <li>Noms de plats compréhensibles, descriptions utiles et variantes sans ambiguïté.</li>
        <li>Prix, suppléments, frais éventuels et composition des formules vérifiés.</li>
        <li>Disponibilités cohérentes avec la cuisine et procédure en cas de rupture.</li>
        <li>Informations alimentaires et mentions adaptées à votre offre.</li>
        <li>Adresse exacte, horaires de retrait et moyen de joindre l'établissement en cas de problème.</li>
      </ul>
      <p className="bl-p">
        Pour les informations réglementaires, vérifiez notamment les exigences applicables aux allergènes
        et à l'origine des viandes avec les
        <a className="bl-renvoi" href="https://www.economie.gouv.fr/dgccrf/les-fiches-pratiques/etiquetage-des-denrees-alimentaires-les-regles-connaitre"> indications de la DGCCRF</a>.
        Votre restaurant valide les informations sur ses recettes ; une mise en page ne les détermine pas.
      </p>
      <p className="bl-p">
        Si la même carte existe sur papier et sur écran, préparez une liste commune des produits et des
        prix. Notre guide pour <Link className="bl-renvoi" href="/blog/refaire-menu-restaurant-papier-tv">refaire les menus papier et TV</Link>
        propose une méthode pour limiter les versions contradictoires.
      </p>

      <h2 className="bl-h2" id="parcours-equipe">Organiser le trajet de la commande au comptoir</h2>
      <p className="bl-p">
        Attribuez une responsabilité à chaque étape : réception, vérification, préparation, contrôle du sac
        et remise. Le client ne doit pas être le premier à signaler une commande oubliée dans un onglet.
        Prévoyez aussi qui prévient le client si un retard ou une rupture nécessite une décision.
      </p>
      <ul className="bl-liste">
        <li><strong>En cuisine :</strong> une source identifiée et un numéro lisible pour rapprocher commande et préparation.</li>
        <li><strong>Au conditionnement :</strong> un contrôle des produits, variantes et compléments avant fermeture du sac.</li>
        <li><strong>Au retrait :</strong> un emplacement signalé et une vérification du numéro avant remise.</li>
        <li><strong>En cas d'incident :</strong> un responsable, un contact client et une procédure d'annulation ou de remboursement.</li>
      </ul>
      <p className="bl-p">
        Avec Snack Manager, le back-office de
        <Link className="bl-renvoi" href="/commande-en-ligne"> commande en ligne</Link> permet de traiter les commandes.
        Si vous utilisez notre <Link className="bl-renvoi" href="/cuisine">écran cuisine KDS</Link>, elles rejoignent aussi
        sa file. Avec des outils tiers, faites vérifier l'intégration au lieu de supposer une transmission automatique.
      </p>

      <h2 className="bl-h2" id="paiement">Tester le règlement et les exceptions</h2>
      <p className="bl-p">
        Choisissez les moyens de paiement selon votre organisation et les options disponibles. Le paiement
        en ligne et le paiement au retrait n'ont pas les mêmes conséquences sur la remise du sac, les frais
        et les commandes non retirées. Formalisez à quel moment l'équipe considère le règlement comme confirmé.
      </p>
      <p className="bl-p">
        Avant le lancement, vérifiez une commande acceptée, un paiement échoué, une demande d'annulation et
        une indisponibilité. Utilisez l'environnement de test proposé par votre prestataire ; si une vérification
        réelle est nécessaire, convenez du montant et du traitement avec lui. Une confirmation à l'écran
        doit correspondre à un état compris côté restaurant.
      </p>

      <h2 className="bl-h2" id="lancement">Lancer, observer, puis élargir</h2>
      <p className="bl-p">
        Pendant les premiers services, tenez un relevé simple : commandes reçues, commandes servies à
        l'heure, retards, erreurs et demandes d'aide. Notez la cause observée, pas seulement le symptôme.
        « Sac prêt, client introuvable » appelle une autre correction que « commande non vue en cuisine ».
      </p>
      <p className="bl-p">
        Après un service maîtrisé, élargissez un élément à la fois : plage horaire, capacité ou carte.
        Une fois le parcours validé, ajoutez
        <Link className="bl-renvoi" href="/blog/lien-de-commande-sur-votre-fiche-google"> votre lien de commande sur Google</Link>
        et sur vos supports. Comparez ensuite le coût du canal à l'aide de
        <Link className="bl-renvoi" href="/blog/pourquoi-les-prix-sont-plus-chers-sur-les-applis"> notre guide de lecture des frais</Link>.
      </p>
      <p className="bl-p">
        Vous avez déjà une caisse ou vous souhaitez relier plusieurs outils ?
        <Renvoi section="contact"> Présentez-nous votre organisation</Renvoi>.
        Nous préciserons le périmètre de mise en service, les connexions disponibles et les contrôles à
        réaliser avant l'ouverture. Le retrait et la livraison sont deux projets distincts : les moyens
        humains nécessaires à une livraison doivent être prévus séparément.
      </p>
    </>
  );
}
