/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { Note, Renvoi } from "./blocs";

export function corps() {
  return (
    <>
      <p className="bl-p">
        Un client cherche un restaurant pour ce soir. Il peut commencer sur Google Maps, regarder une
        photo sur un réseau social ou demander une idée à un moteur de recherche avec IA. Dans tous
        les cas, il lui faut des réponses fiables : votre cuisine, votre carte, votre adresse, vos horaires
        et la façon de réserver ou commander. Commencez par rendre ce parcours cohérent.
      </p>

      <h2 className="bl-h2" id="diagnostic">Faire le tour de votre présence actuelle</h2>
      <p className="bl-p">
        Recherchez votre nom avec votre ville et relevez les pages qui vous représentent : fiche Google,
        site, réseaux, annuaires et plateformes. Ouvrez les liens depuis un téléphone. Notez les horaires
        contradictoires, les anciennes cartes, les liens cassés et les photos qui ne correspondent plus
        à l'établissement. Ce relevé donne une liste de corrections concrètes avant toute dépense publicitaire.
      </p>
      <div className="bl-tablewrap" tabIndex={0} role="region" aria-label="Un diagnostic simple à partager avec votre prestataire">
        <table className="bl-table">
          <caption>Un diagnostic simple à partager avec votre prestataire</caption>
          <thead><tr><th scope="col">Point du parcours</th><th scope="col">Contrôle</th><th scope="col">Action si nécessaire</th></tr></thead>
          <tbody>
            <tr><th scope="row">Trouver le restaurant</th><td>Nom, adresse, spécialité, repère local</td><td>Corriger l'information à sa source</td></tr>
            <tr><th scope="row">Choisir</th><td>Carte actuelle, prix, photos représentatives</td><td>Remplacer la version dépassée</td></tr>
            <tr><th scope="row">Préparer sa visite</th><td>Horaires, accès, services réellement proposés</td><td>Préciser les informations manquantes</td></tr>
            <tr><th scope="row">Agir</th><td>Appel, réservation ou commande</td><td>Tester le lien et sa destination</td></tr>
          </tbody>
        </table>
      </div>

      <h2 className="bl-h2" id="fiche-google">Compléter la fiche Google sans la surcharger</h2>
      <p className="bl-p">
        Vérifiez d'abord si une fiche existe et qui la gère. Évitez de créer un doublon pour remplacer
        une fiche dont vous avez perdu l'accès. Utilisez le nom réel de l'établissement, sa catégorie
        adaptée et ses coordonnées exactes, conformément aux
        <a className="bl-renvoi" href="https://support.google.com/business/answer/3038177?hl=fr"> consignes de représentation de Google</a>.
      </p>
      <p className="bl-p">
        Mettez à jour horaires habituels et exceptionnels, menu et services. Ajoutez des photos actuelles
        de la façade, de la salle et des plats réellement servis. La
        <a className="bl-renvoi" href="https://support.google.com/business/answer/7091?hl=fr"> documentation sur le classement local</a>
        rappelle le rôle de la pertinence, de la distance et de la notoriété : compléter une fiche ne
        garantit pas une place dans les résultats, et aucune position ne s'achète auprès de Google.
      </p>
      <p className="bl-p">
        Choisissez une photo de façade qui aide à reconnaître l'entrée et une carte lisible, plutôt qu'une
        collection d'images sans contexte. Après chaque modification, relisez la version publique. Pour
        les commandes, suivez notre <Link className="bl-renvoi" href="/blog/lien-de-commande-sur-votre-fiche-google">procédure d'ajout du lien direct</Link>.
      </p>

      <h2 className="bl-h2" id="site">Construire un site qui répond avant de convaincre</h2>
      <p className="bl-p">
        Votre site doit permettre de comprendre l'essentiel sans chercher dans plusieurs écrans : type
        de cuisine, emplacement, carte et prochaine action. Donnez un lien stable à la carte. Présentez
        les informations principales sous forme de texte lisible sur mobile ; un PDF peut compléter
        cette page pour le téléchargement.
      </p>
      <ul className="bl-liste">
        <li><strong>Une présentation précise :</strong> votre spécialité, le service proposé et des photos de votre établissement.</li>
        <li><strong>Une carte tenue à jour :</strong> catégories compréhensibles, formules expliquées et prix cohérents.</li>
        <li><strong>Les informations pratiques :</strong> adresse, horaires, téléphone, accès et services utiles réellement disponibles.</li>
        <li><strong>Une action adaptée :</strong> réservation, appel ou commande, selon votre fonctionnement.</li>
        <li><strong>Un entretien prévu :</strong> qui modifie une fermeture, un tarif ou un lien, et avec quel accès.</li>
      </ul>
      <p className="bl-p">
        Si vous avez plusieurs restaurants, chaque page locale doit aider à choisir le bon : adresse,
        horaires, carte et particularités de cet établissement. Multiplier des pages de villes où vous
        n'avez rien à proposer n'aide pas votre futur client. Un restaurant avec une seule adresse n'a
        pas besoin d'un catalogue de pages presque identiques.
      </p>
      <Note titre="Exemple de contenu utile">
        Pour un restaurant thaï, une page peut expliquer la composition des formules, les options
        réellement disponibles et les horaires de retrait. Pour une brasserie, elle peut distinguer
        service du midi, dîner et accueil des groupes. Le contenu part des questions reçues au restaurant.
      </Note>

      <h2 className="bl-h2" id="avis-reseaux">Relier avis, réseaux sociaux et visite réelle</h2>
      <p className="bl-p">
        Invitez vos clients à partager leur expérience, sans achat d'avis ni avantage conditionné à une
        note. Répondez aux retours de façon factuelle, en proposant un contact privé lorsqu'une situation
        demande des précisions. Google détaille les règles dans son
        <a className="bl-renvoi" href="https://support.google.com/business/answer/3474122?hl=fr"> aide pour obtenir des avis</a>.
      </p>
      <p className="bl-p">
        Sur vos réseaux, privilégiez les sujets que vous pouvez documenter : un plat préparé, une nouvelle
        carte, l'équipe avec son accord ou une information de service. Le lien du profil doit mener à
        une page utile. Avant de publier une offre du midi, vérifiez que sa composition, son prix et ses
        dates sont les mêmes sur le site et au restaurant.
      </p>
      <p className="bl-p">
        Choisissez un rythme compatible avec le service et prévoyez la collecte des images. Un planning
        impossible à tenir produit vite une page figée. Vous pouvez commencer par documenter les changements
        réels, puis enrichir la présentation de votre cuisine à partir des questions fréquentes des clients.
      </p>

      <h2 className="bl-h2" id="moteurs-ia">Préparer une information compréhensible par les moteurs IA</h2>
      <p className="bl-p">
        Les recommandations de Google pour ses
        <a className="bl-renvoi" href="https://developers.google.com/search/docs/appearance/ai-features"> fonctionnalités de recherche avec IA</a>
        reposent sur les fondamentaux du référencement : pages accessibles, contenu utile, liens internes
        et informations cohérentes. Un fichier spécial ou une balise « IA » ne garantit pas une citation.
        Google ne demande pas de fichier llms.txt pour apparaître dans ces résultats.
      </p>
      <p className="bl-p">
        Pour votre restaurant, publiez des réponses claires aux questions qui précèdent une visite : quel
        type de cuisine, à quelle adresse, quels services et comment vérifier la carte actuelle. Faites
        correspondre les données structurées du site à ces informations visibles. Ajoutez uniquement
        les attributs que vous pouvez confirmer ; un moteur ne doit pas recevoir une version plus flatteuse
        de l'établissement que votre client.
      </p>
      <p className="bl-p">
        Côté technique, votre prestataire peut vérifier l'accès des robots de recherche et l'indexabilité
        des pages publiques. Pour ChatGPT Search, OpenAI documente le rôle d'OAI-SearchBot dans sa
        <a className="bl-renvoi" href="https://help.openai.com/en/articles/12627856-publishers-and-developers-faq"> FAQ destinée aux éditeurs</a>.
        Être accessible rend la découverte possible ; cela ne garantit ni présence ni recommandation.
      </p>

      <h2 className="bl-h2" id="mesurer">Mesurer les actions utiles au restaurant</h2>
      <p className="bl-p">
        Notez votre point de départ, puis suivez les données auxquelles vous avez accès : requêtes et clics
        du site dans Search Console, interactions disponibles dans la fiche, demandes de réservation et
        commandes réellement reçues. Distinguez une visite, un clic et un client servi. Ils ne mesurent
        pas la même étape et ne peuvent pas toujours être rapprochés individuellement.
      </p>
      <p className="bl-p">
        Conservez la date de vos changements et comparez des périodes similaires en tenant compte des
        jours d'ouverture, vacances et promotions. Si vous utilisez des paramètres de suivi dans les liens,
        adoptez une convention stable. Les outils de mesure et leur configuration doivent respecter les
        choix de consentement applicables à votre site.
      </p>

      <h2 className="bl-h2" id="accompagnement">Choisir un accompagnement avec des livrables clairs</h2>
      <p className="bl-p">
        Un devis utile précise les pages travaillées, les réglages de fiche, les textes, les visuels,
        les accès nécessaires et la personne qui entretient ensuite chaque support. Séparez la création
        initiale, le suivi éditorial, la publicité payante et les éventuels frais techniques.
        Demandez un bilan des actions et des résultats mesurables, sans promesse de première place.
      </p>
      <p className="bl-p">
        <Link className="bl-renvoi" href="/atelier">L'Atelier Snack Manager</Link> peut vous accompagner sur votre
        identité, votre site, votre fiche Google et vos réseaux, avec ou sans nos logiciels. Si votre
        priorité concerne les supports en salle, commencez par
        <Link className="bl-renvoi" href="/blog/refaire-menu-restaurant-papier-tv"> les menus papier et TV</Link>.
        <Renvoi section="contact"> Présentez-nous votre présence actuelle et votre priorité</Renvoi> pour
        définir une intervention adaptée, même si vous conservez votre caisse et vos outils actuels.
      </p>
    </>
  );
}
