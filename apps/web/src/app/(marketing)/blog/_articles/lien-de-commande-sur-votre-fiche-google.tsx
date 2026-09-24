/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { Etape, Etapes, Note, Renvoi, Ui } from "./blocs";

export function corps() {
  return (
    <>
      <p className="bl-p">
        Une personne trouve votre restaurant sur Google, regarde votre carte et souhaite commander.
        Le lien proposé doit l'amener au bon établissement, avec les bons horaires et un parcours utilisable.
        Avant de modifier la fiche, vérifiez donc la destination. Une adresse correcte évite de demander au
        client de chercher une seconde fois votre restaurant sur une autre page.
      </p>

      <h2 className="bl-h2" id="preparer">Préparer la fiche et la page de commande</h2>
      <p className="bl-p">
        Vous devez disposer de l'accès de gestion à une fiche validée. Préparez l'adresse complète de votre
        page de commande, puis ouvrez-la sur un téléphone sans utiliser votre session de restaurateur.
        Vérifiez le nom de l'établissement, l'adresse de retrait, la carte et les moyens de paiement.
      </p>
      <p className="bl-p">
        Google demande une page dédiée à l'établissement où le client peut effectuer l'action annoncée.
        Un bouton de commande ne doit pas mener à un réseau social, un service de messagerie ou un
        réducteur de liens. Consultez les <a className="bl-renvoi" href="https://support.google.com/business/answer/13769188?hl=fr">règles officielles relatives aux liens</a> avant l'ajout.
      </p>
      <Note titre="Carte et commande ont deux rôles distincts">
        Un lien « Menu » aide à choisir. Un lien de commande permet de sélectionner des produits et de
        transmettre la commande. Un PDF de votre carte peut être utile, mais ne remplace pas ce parcours.
      </Note>

      <h2 className="bl-h2" id="ajouter">Ajouter le lien et choisir votre préférence</h2>
      <p className="bl-p">
        La <a className="bl-renvoi" href="https://support.google.com/business/answer/10842217?hl=fr">procédure Google de gestion des commandes</a> décrit les réglages suivants.
        Leur présentation peut varier selon le pays et les options de votre fiche.
      </p>
      <Etapes>
        <Etape titre="Ouvrir les options de commande">
          <p className="bl-p">Connectez-vous avec le compte qui gère la fiche, puis ouvrez <Ui>Commande de repas</Ui>.</p>
        </Etape>
        <Etape titre="Ajouter la destination">
          <p className="bl-p">Choisissez <Ui>Ajouter un lien</Ui>, renseignez votre page directe et enregistrez.</p>
        </Etape>
        <Etape titre="Définir votre préférence">
          <p className="bl-p">Sélectionnez ce lien, puis <Ui>Définir comme préféré</Ui>. Choisissez le retrait ou la livraison, selon les services réellement proposés, et enregistrez.</p>
        </Etape>
        <Etape titre="Contrôler le résultat public">
          <p className="bl-p">Consultez ensuite votre fiche dans la recherche et sur Maps, en dehors de l'interface de gestion. Ouvrez le lien et refaites le parcours côté client.</p>
        </Etape>
      </Etapes>
      <p className="bl-p">
        Si vous ne voyez pas le même intitulé, consultez aussi l'aide Google sur les
        <a className="bl-renvoi" href="https://support.google.com/business/answer/6218037?hl=fr"> liens des établissements locaux</a>.
        L'affichage peut présenter le type de transaction, par exemple retrait et livraison, avant le choix du lien préféré.
      </p>

      <h2 className="bl-h2" id="verifier">Tester ce que voit réellement votre client</h2>
      <p className="bl-p">
        Faites un contrôle en situation : téléphone tenu à une main, connexion mobile et aucune connaissance
        de votre outil. Le client doit comprendre où il retire sa commande et à quel moment elle sera disponible.
        Voici la grille que nous conseillons de parcourir avec un membre de l'équipe.
      </p>
      <ul className="bl-liste bl-check">
        <li>La page s'ouvre sans erreur ni connexion réservée au personnel.</li>
        <li>Le nom et l'adresse correspondent au restaurant recherché, y compris si vous avez plusieurs établissements.</li>
        <li>Les horaires de retrait et les éventuelles fermetures sont cohérents avec votre service.</li>
        <li>Les produits indisponibles et les suppléments sont compréhensibles avant validation.</li>
        <li>Le récapitulatif distingue produits, frais éventuels et total à payer.</li>
        <li>La confirmation indique la suite : réception, préparation et lieu de retrait selon le parcours prévu.</li>
      </ul>
      <p className="bl-p">
        Pour préparer les opérations derrière ce lien, utilisez notre guide pour
        <Link className="bl-renvoi" href="/blog/ouvrir-le-click-and-collect-sans-se-tromper"> ouvrir le click & collect</Link>.
        Une page accessible ne suffit pas si l'équipe ignore où arrivent les commandes.
      </p>

      <h2 className="bl-h2" id="lien-absent">Si le lien est absent ou refusé</h2>
      <p className="bl-p">
        Commencez par relever le message exact et le compte connecté. Contrôlez ensuite la validation de la
        fiche, l'orthographe de l'adresse et la destination. Google vérifie les liens et peut retirer ceux
        qui ne respectent pas ses règles. La page doit également être accessible à ses outils de vérification.
      </p>
      <p className="bl-p">
        Évitez d'enchaîner des variantes du même lien sans diagnostic. Notez le lien saisi, la date du changement
        et le résultat observé. Ces éléments rendent une demande d'assistance exploitable. Nous ne pouvons pas
        annoncer un délai de publication ou garantir la présence du bouton : son affichage reste géré par Google.
      </p>

      <h2 className="bl-h2" id="entretenir">Entretenir le lien dans la durée</h2>
      <p className="bl-p">
        Ajoutez ce contrôle à chaque changement de site, d'horaires ou d'outil de commande. Conservez un relevé
        simple : date de vérification, adresse utilisée, anomalie constatée et personne chargée de la correction.
        Pendant une fermeture exceptionnelle, vérifiez aussi la page située au bout du lien.
      </p>
      <p className="bl-p">
        La préférence de commande est un réglage de parcours. Elle ne constitue pas une promesse de position
        dans les résultats. Pour travailler le reste de votre présence, poursuivez avec
        <Link className="bl-renvoi" href="/blog/visibilite-restaurant-google-site-internet"> notre méthode fiche Google et site de restaurant</Link>.
      </p>
      <p className="bl-p">
        Snack Manager propose une <Link className="bl-renvoi" href="/commande-en-ligne">page de commande avec son espace de gestion</Link>.
        Si vous avez déjà une solution, <Link className="bl-renvoi" href="/atelier">l'Atelier peut aussi vous accompagner sur votre site et votre fiche Google</Link>,
        avec ou sans nos logiciels. Les accès, réglages et livrables sont précisés avant l'intervention :
        <Renvoi section="contact"> décrivez-nous votre besoin</Renvoi>.
      </p>
    </>
  );
}
