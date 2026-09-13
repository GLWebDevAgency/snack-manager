/*
 * `react/no-unescaped-entities` est désactivée ici, et par fichier : la prose
 * d'un article est du texte JSX (gras, emphase et renvois au milieu des
 * phrases), là où tout le reste du dépôt affiche des CHAÎNES venues de
 * `content.ts`, que la règle ne voit pas. Le raisonnement complet est dans
 * `_articles/blocs.tsx`, en tête de fichier.
 */
/* eslint-disable react/no-unescaped-entities */
import { Note, Renvoi } from "./blocs";

/**
 * Article de terrain — ce qui casse un service quand on démarre le retrait.
 *
 * ═══ PAS UNE SOURCE, ET C'EST ASSUMÉ ═══
 *
 * Les deux autres articles décrivent des interfaces et des tarifs qui ne sont
 * pas les nôtres : ils citent leurs sources. Celui-ci décrit des RÉGLAGES —
 * durée de créneau, temps de préparation, plafond — et les conséquences qu'ils
 * ont sur un service. Il n'y a rien à sourcer là-dedans, et surtout rien à
 * chiffrer : le bon créneau dépend d'une friteuse et d'un nombre de bras, pas
 * d'une étude.
 *
 * D'où la règle de rédaction de ce texte : ON DONNE LA MÉTHODE POUR TROUVER LE
 * NOMBRE, JAMAIS LE NOMBRE. « Quinze minutes » serait faux chez la moitié des
 * lecteurs, et faux de façon invérifiable — c'est-à-dire le pire cas.
 *
 * ═══ LA LIMITE QUI NE BOUGE PAS ═══
 *
 * Le tunnel s'arrête au CRÉNEAU DE RETRAIT. Aucune phrase de cet article ne doit
 * laisser croire qu'on fournit un livreur, et la dernière section le dit en
 * clair plutôt que de compter sur le lecteur pour le deviner.
 */

export function corps() {
  return (
    <>
      <p className="bl-p">
        Avant d’ouvrir le click & collect, vérifiez trois réglages avec votre équipe : la durée des créneaux,
        le temps de préparation annoncé et les produits proposés en ligne. Ils doivent correspondre à votre capacité réelle.
      </p>
      <p className="bl-p">
        Voici ce qu'il faut avoir décidé avant de publier le lien, et comment trouver vos propres nombres plutôt que de
        recopier ceux de quelqu'un d'autre.
      </p>

      <h2 className="bl-h2">Ce que le client achète, ce n'est pas un plat</h2>
      <p className="bl-p">
        C'est une heure. Il commande à 18 h 12 pour 19 h 30 parce qu'il passe à 19 h 30, entre le travail et la maison.
        Le plat, il sait déjà qu'il sera bon — il l'a déjà mangé, ou il vient de lire vos avis.
      </p>
      <p className="bl-p">
        Cela change tout le reste. Un plat servi cinq minutes en retard en salle, personne n'en parle. Un sac pas prêt à
        19 h 30 alors que la page a écrit « 19 h 30 », c'est une promesse rompue — et un client qui reste planté devant
        un comptoir en plein coup de feu, ce qui est exactement le pire endroit où le mettre.
      </p>

      <Note titre="La règle qui découle de tout l'article">
        En retrait, votre produit est un horaire. Tout ce qui suit consiste à ne promettre que des horaires que la
        cuisine peut tenir.
      </Note>

      <h2 className="bl-h2">Réglage 1 — la durée du créneau</h2>
      <p className="bl-p">
        Un créneau trop long fait attendre : le client vise 19 h 15, la page lui propose « 19 h 00 – 19 h 30 », il arrive
        à 19 h 00 et son sac n'existe pas encore.
      </p>
      <p className="bl-p">
        Un créneau trop court fait pire : il découpe le service en tranches si fines que la cuisine reçoit une salve
        toutes les cinq minutes, sans jamais pouvoir grouper deux fritures.
      </p>
      <p className="bl-p">
        La bonne durée ne se lit pas sur une horloge, elle se lit sur votre <strong>débit</strong>. Comptez ce que la
        cuisine sort réellement en un quart d'heure de rush, un vendredi. C'est ce nombre-là — pas votre optimisme — qui
        fixe la taille du créneau et le nombre de commandes qu'il accepte.
      </p>
      <p className="bl-p">
        Et le créneau n'a de sens qu'avec son <strong>plafond</strong>. Un créneau sans limite de commandes n'est pas un
        créneau, c'est une file d'attente sans porte : dix personnes peuvent viser la même demi-heure, et elles le
        feront, parce que 19 h 30 est l'heure à laquelle tout le monde rentre.
      </p>

      <h2 className="bl-h2">Réglage 2 — le temps de préparation annoncé</h2>
      <p className="bl-p">
        C'est le délai minimum entre « je valide » et le premier créneau proposé. Trois erreurs classiques :
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Le régler une fois pour toutes.</strong> Le temps de préparation d'un mardi 15 h et celui d'un
          vendredi 20 h n'ont rien à voir. Si votre outil permet de le relever pendant le coup de feu, servez-vous-en —
          c'est le seul bouton qui protège vraiment un service.
        </li>
        <li>
          <strong>Le régler sur le meilleur cas.</strong> Vous connaissez votre temps quand tout va bien. Annoncez celui
          quand il y a déjà six tickets au mur, sinon vous ne vous êtes pas donné de marge, vous vous êtes donné un
          objectif.
        </li>
        <li>
          <strong>Oublier le temps d'attente du client.</strong> Un client qui arrive en avance attend debout. Prévoyez
          où.
        </li>
      </ul>
      <p className="bl-p">
        Une bonne façon de trancher : annoncez un délai que vous tiendriez neuf fois sur dix un vendredi soir. Vous serez
        en avance le mardi, et personne ne s'en est jamais plaint.
      </p>

      <h2 className="bl-h2">Réglage 3 — la carte en ligne n'est pas la carte de la salle</h2>
      <p className="bl-p">
        Vous choisissez vos prix et les produits adaptés au retrait. La carte en ligne peut être plus courte que celle de la salle.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Ce qui voyage mal.</strong> Un produit qui ramollit dans un sac fermé pendant huit minutes n'est plus
          le vôtre quand le client l'ouvre. Il vaut mieux ne pas le proposer que de le proposer mal.
        </li>
        <li>
          <strong>Ce qui bloque un poste.</strong> Le plat qui monopolise la plancha vingt minutes n'a rien à faire dans
          un créneau de pointe. Réservez-le à la salle, ou aux heures creuses.
        </li>
        <li>
          <strong>Ce qui n'est pas descriptible.</strong> En salle, un client demande. En ligne, il devine. Une option
          qui ne s'explique pas en une ligne produit une réclamation au retrait.
        </li>
      </ul>
      <p className="bl-p">
        Le configurateur de la page en ligne doit se comporter exactement comme celui du comptoir : mêmes options, mêmes
        suppléments, mêmes prix. Un client qui compose son tacos en ligne et découvre autre chose en salle ne recommande
        pas en ligne. C'est ce qu'on <Renvoi section="produit">peut vérifier en démonstration</Renvoi> plutôt que sur
        parole.
      </p>

      <h2 className="bl-h2">Le coup de feu — quand tout tombe en même temps</h2>
      <p className="bl-p">
        Le samedi soir, trois flux arrivent sur la même cuisine : la salle, les plateformes, et vos commandes en ligne.
        Les deux premiers, vous les subissez déjà. Le troisième est le seul que vous puissiez régler — profitez-en.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Plafonnez le créneau</strong> avant d'ouvrir, pas pendant. Un plafond baissé à 20 h 15 ne rattrape rien.
        </li>
        <li>
          <strong>Sachez fermer un créneau.</strong> Un créneau complet qui disparaît de la page vaut mieux qu'une
          commande acceptée qu'on n'honorera pas. Le client choisit 20 h 00 sans savoir qu'il vient d'éviter un problème.
        </li>
        <li>
          <strong>Sachez mettre la page en pause.</strong> Panne de friteuse, absence, salle pleine : il faut un bouton
          qui ferme la boutique en ligne en un geste, depuis votre espace de gestion, selon les fonctions disponibles.
        </li>
      </ul>

      <h2 className="bl-h2">Le retrait lui-même : cinq mètres carrés qui décident de tout</h2>
      <p className="bl-p">
        Le tunnel numérique s'arrête, et c'est votre comptoir qui prend le relais. C'est là que l'expérience se gagne ou
        se perd, et ça ne coûte rien à régler.
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Un endroit pour attendre</strong>, qui ne soit pas la file de la caisse. Sinon votre client en ligne
          fait la queue derrière ceux qui n'ont pas commandé — et il se demande à quoi servait de commander.
        </li>
        <li>
          <strong>Un numéro, appelé.</strong> Un écran, une voix, peu importe : le client doit savoir sans demander.
        </li>
        <li>
          <strong>Un sac étiqueté.</strong> Le nom, le numéro, l'heure. Trois sacs identiques sur un comptoir, c'est une
          erreur qui vous attend.
        </li>
        <li>
          <strong>Un ticket qui part en cuisine tout seul.</strong> Une transmission automatique peut éviter une ressaisie,
          à condition que votre commande en ligne et votre écran cuisine soient reliés. Avec une caisse tierce, vérifiez l’intégration disponible.
        </li>
      </ul>

      <h2 className="bl-h2">Paiement en ligne ou au retrait ?</h2>
      <p className="bl-p">
        Le choix dépend de votre clientèle, du risque d’absence au retrait et des frais de paiement.
      </p>
      <p className="bl-p">
        <strong>Payé en ligne</strong>, le règlement est confirmé avant la préparation selon le parcours configuré.
        Cela peut simplifier le retrait et limiter le risque d’impayé en cas d’absence. Les frais de paiement,
        annulations et éventuels remboursements restent à prendre en compte.
      </p>
      <p className="bl-p">
        <strong>Payé au retrait</strong>, vous conservez le choix des moyens de paiement acceptés sur place.
        Vous préparez toutefois avant d’être réglé et supportez le coût des commandes qui ne sont pas retirées.
      </p>
      <p className="bl-p">
        En pratique : commencez en laissant les deux, regardez un mois, et fermez le paiement au retrait si les
        abandons vous coûtent plus que les frais de carte.
      </p>

      <h2 className="bl-h2">La première semaine : ouvrez petit</h2>
      <p className="bl-p">
        C'est le conseil le plus utile de cet article, et le moins suivi. Un click and collect qui s'ouvre en grand un
        vendredi soir avec la carte entière produit exactement ce qu'on redoutait, et vous n'aurez pas envie de
        recommencer.
      </p>
      <ol className="bl-etapes bl-etapes-simple">
        <li className="bl-etape">
          <p className="bl-p">
            <strong>Semaine 1 — les midis seulement, carte réduite.</strong> Vos dix meilleures ventes, celles que la
            cuisine sort les yeux fermés. Peu de créneaux, plafonds bas.
          </p>
        </li>
        <li className="bl-etape">
          <p className="bl-p">
            <strong>Semaine 2 — vous regardez.</strong> À quelle heure les créneaux se remplissent-ils ? Combien de
            clients arrivent en avance ? Qu'est-ce qui est sorti en retard, et pourquoi ?
          </p>
        </li>
        <li className="bl-etape">
          <p className="bl-p">
            <strong>Semaine 3 — vous élargissez ce qui a tenu.</strong> Les soirs, puis le week-end, puis la carte
            complète. Un cran à la fois, jamais deux.
          </p>
        </li>
      </ol>
      <p className="bl-p">
        Une ouverture progressive permet d’ajuster la capacité avant d’accepter davantage de commandes.
        Informez les clients des horaires disponibles et observez les retards, les abandons et leurs retours.
      </p>

      <h2 className="bl-h2">Ce que le click and collect ne règle pas</h2>
      <p className="bl-p">
        Le click & collect organise le retrait. Snack Manager propose séparément un périmètre de livraison en pilote,
        après configuration et validation. Aucun livreur tiers n’est fourni.
      </p>
      <p className="bl-p">
        Si vous souhaitez organiser vos livraisons, vérifiez avec nous le périmètre du pilote, vos zones, vos tarifs
        et vos moyens humains. Cette fonction est prévue dans Boost ou dans le module dédié ; les frais de livraison
        et l’organisation de vos livreurs restent à votre charge. Comparez ce fonctionnement aux services des plateformes.
      </p>
      <p className="bl-p">
        Il ne remplace pas non plus le comptoir. Le retrait grignote la file, il ne la supprime pas.
      </p>

      <h2 className="bl-h2">La liste à cocher avant de publier le lien</h2>
      <ul className="bl-liste bl-check">
        <li>La durée du créneau est calée sur le débit réel de la cuisine, pas sur une intuition.</li>
        <li>Chaque créneau a un plafond de commandes, et il est bas la première semaine.</li>
        <li>Le temps de préparation annoncé est celui d'un vendredi soir, pas celui d'un mardi après-midi.</li>
        <li>La carte en ligne ne contient rien qui voyage mal ou qui bloque un poste.</li>
        <li>Les prix et les frais affichés correspondent à votre offre et sont compris avant validation.</li>
        <li>Les horaires de la page correspondent aux horaires de la cuisine, jours de fermeture compris.</li>
        <li>La réception des commandes et leur transmission en cuisine ont été vérifiées avec les outils retenus.</li>
        <li>Votre équipe sait mettre la commande en ligne en pause depuis l’espace de gestion.</li>
        <li>Quelqu'un sait où le client attend, et comment on l'appelle.</li>
        <li>Vous avez vérifié le parcours sur téléphone, y compris le paiement et le traitement d’une annulation, avant l’ouverture.</li>
      </ul>

      <p className="bl-p">
        Ces réglages sont préparés avec vous selon le périmètre de mise en service convenu. Les interventions sur site
        sont détaillées au devis : consultez <Renvoi section="lancement">les étapes du démarrage</Renvoi> ou
        <Renvoi section="contact">parlons de votre restaurant</Renvoi>.
      </p>
    </>
  );
}
