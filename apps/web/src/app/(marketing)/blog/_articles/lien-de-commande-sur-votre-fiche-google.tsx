/*
 * `react/no-unescaped-entities` est désactivée ici, et par fichier : la prose
 * d'un article est du texte JSX (gras, emphase et renvois au milieu des
 * phrases), là où tout le reste du dépôt affiche des CHAÎNES venues de
 * `content.ts`, que la règle ne voit pas. Le raisonnement complet est dans
 * `_articles/blocs.tsx`, en tête de fichier.
 */
/* eslint-disable react/no-unescaped-entities */
import { Etape, Etapes, Note, Renvoi, Sources, Ui, type Source } from "./blocs";

/**
 * Article pratique — le meilleur argument de la vitrine, déplié en mode d'emploi.
 *
 * ═══ CE QUI EST VÉRIFIÉ, ET CE QU'ON NE DIRA PAS ═══
 *
 * Toute la procédure est recopiée de la page d'aide Google (answer/10842217),
 * libellés d'interface compris et à l'identique — un libellé « amélioré » est un
 * libellé introuvable pour le lecteur qui a l'écran sous les yeux.
 *
 * DEUX PHRASES SONT INTERDITES DANS CET ARTICLE, et elles reviendraient toutes
 * seules si on ne les nommait pas :
 *
 *   · « Google retirera les liens des plateformes. » Rien ne le garantit, et
 *     nous n'avons aucun moyen de le tenir à la place de Google.
 *   · « Comptez X jours. » Google ne publie aucun délai de prise en compte.
 *     Un délai inventé se vérifie tout seul, et contre nous.
 *
 * Le fond commercial suit la règle de la maison : les plateformes sont un ATOUT
 * — elles amènent des clients qu'on n'aurait pas eus et elles portent les sacs.
 * On AJOUTE un lien, on n'en retire aucun.
 */

const SOURCES: readonly Source[] = [
  {
    url: "https://support.google.com/business/answer/10842217?hl=fr",
    libelle: "Google — Gérer les options de commande en ligne (aide Profil d'établissement)",
    consultee: "21 août 2026",
  },
];

export function corps() {
  return (
    <>
      <p className="bl-p">
        Ouvrez votre restaurant sur Google, depuis un téléphone, comme le ferait un client à 19 h 40. Il y a de fortes
        chances qu'un bouton de commande soit déjà là. Et il y a de fortes chances qu'il ne mène pas chez vous.
      </p>
      <p className="bl-p">
        Ce bouton n'est pas une erreur, et ce n'est pas non plus une fatalité : Google vous laisse ajouter votre propre
        lien de commande à votre fiche, et le désigner comme le lien <strong>préféré</strong>. C'est gratuit, ça se fait
        depuis votre fiche d'établissement, et ça prend moins de temps que de composer un menu. Voici où cliquer,
        exactement, et ce qu'il faut avoir préparé avant.
      </p>

      <h2 className="bl-h2">Ce que votre client voit aujourd'hui</h2>
      <p className="bl-p">
        Sur une fiche de restaurant, Google agrège des <em>options de commande</em>. Elles viennent de fournisseurs
        tiers connectés à votre établissement — les plateformes de commande et de livraison, principalement — et de tout
        lien que vous avez vous-même renseigné. Le client, lui, ne voit pas cette plomberie : il voit un bouton, il
        appuie, il atterrit quelque part.
      </p>
      <p className="bl-p">
        C'est tout l'enjeu de l'affaire. Ce n'est pas une histoire de référencement, c'est une histoire de{" "}
        <strong>destination du clic</strong>. Votre fiche fait déjà son travail : elle vous a trouvé le client. La seule
        question qui reste est de savoir où ce client termine sa commande, et sous quelles conditions.
      </p>

      <h2 className="bl-h2">Avant d'ouvrir l'interface : trois choses à avoir sous la main</h2>
      <ul className="bl-liste">
        <li>
          <strong>L'accès à votre fiche d'établissement.</strong> Le compte Google qui gère l'établissement, celui qui
          vous sert à répondre aux avis. Si c'est une agence ou un ancien salarié qui l'a, réglez ça d'abord : sans
          accès, rien de ce qui suit n'est possible.
        </li>
        <li>
          <strong>L'adresse exacte de votre page de commande.</strong> Pas la page d'accueil de votre site : la page qui
          affiche la carte, prête à commander. Un client qui doit chercher « commander » après avoir cliqué sur
          « Commander » a déjà perdu deux gestes, et souvent la patience.
        </li>
        <li>
          <strong>Savoir ce que cette page accepte.</strong> Retrait seul ? Retrait et livraison ? Vous allez devoir le
          déclarer, et une préférence déclarée que la page ne tient pas se retourne contre vous au premier essai.
        </li>
      </ul>

      <h2 className="bl-h2">La procédure, étape par étape</h2>
      <p className="bl-p">
        Les libellés ci-dessous sont ceux de l'interface française, recopiés tels quels. Si le vôtre diffère, c'est que
        Google a bougé son écran depuis notre dernière vérification — la date de consultation est en bas de page.
      </p>

      <Etapes>
        <Etape titre="Ouvrez votre fiche d'établissement">
          <p className="bl-p">
            Depuis la recherche Google en étant connecté au compte gestionnaire, ou depuis la gestion de votre profil.
            C'est le même endroit que pour modifier vos horaires.
          </p>
        </Etape>
        <Etape titre={"Sélectionnez « Commande de repas »"}>
          <p className="bl-p">
            C'est la section qui pilote tout : les fournisseurs tiers, vos propres liens, et le fait même d'accepter ou
            non les commandes depuis la fiche. Vous y trouverez la liste des options déjà en place — souvent une
            surprise, la première fois.
          </p>
        </Etape>
        <Etape titre="Ajoutez votre lien">
          <p className="bl-p">
            En bas de la liste des options, <Ui>Ajouter un lien</Ui> vous laisse coller l'adresse de votre page de
            commande. Collez l'adresse complète, protocole compris, et ouvrez-la une fois dans un onglet privé avant de
            valider : c'est le seul moyen de voir ce que verra un client qui n'a jamais commandé chez vous.
          </p>
        </Etape>
        <Etape titre="Sélectionnez votre lien dans la liste, puis « Définir comme préféré »">
          <p className="bl-p">
            C'est l'étape qui compte, et c'est celle qu'on oublie : un lien ajouté sans être désigné comme préféré est
            un lien de plus dans une liste, rien d'autre.
          </p>
        </Etape>
        <Etape titre={"Réglez « À privilégier pour le retrait » et « À privilégier pour la livraison »"}>
          <p className="bl-p">
            Les deux se règlent séparément, et c'est une bonne nouvelle : vous pouvez déclarer votre page préférée{" "}
            <strong>pour le retrait</strong> et laisser la livraison aux plateformes, qui la font. N'activez que ce que
            votre page tient réellement.
          </p>
        </Etape>
        <Etape titre="Enregistrez, puis vérifiez depuis un téléphone">
          <p className="bl-p">
            Pas depuis votre ordinateur, où vous êtes connecté à votre propre compte : depuis un téléphone, en navigation
            privée, comme le ferait le client de 19 h 40. Faites le parcours en entier jusqu'au panier.
          </p>
        </Etape>
      </Etapes>

      <Note titre="Le réglage qui répond à la vraie question">
        Vous n'avez pas à choisir entre les plateformes et vous. « À privilégier pour le retrait » d'un côté, la
        livraison de l'autre : chacun met en avant ce qu'il fait le mieux, sur la même fiche, sans que personne ne
        disparaisse.
      </Note>

      <h2 className="bl-h2">Choisir la bonne adresse — là où la plupart se plantent</h2>
      <p className="bl-p">
        Le lien vaut ce que vaut la page au bout. Quatre erreurs reviennent tout le temps :
      </p>
      <ul className="bl-liste">
        <li>
          <strong>Pointer vers la page d'accueil.</strong> Le client a appuyé sur « Commander », il attend une carte, pas
          une photo de devanture et un menu de navigation.
        </li>
        <li>
          <strong>Pointer vers un PDF de la carte.</strong> Un PDF ne prend pas de commande, ne dit pas ce qui est en
          rupture, et se lit mal sur un téléphone. C'est un catalogue, pas un tunnel.
        </li>
        <li>
          <strong>Pointer vers une page qui n'est pas pensée pour le téléphone.</strong> L'écrasante majorité de ces
          clics vient d'un mobile, souvent debout, souvent pressé.
        </li>
        <li>
          <strong>Pointer vers une page qui ment sur vos horaires.</strong> Une page qui accepte une commande à 15 h
          alors que la cuisine est fermée vous coûte un client, et un avis.
        </li>
      </ul>
      <p className="bl-p">
        Si votre page de commande affiche les mêmes prix qu'en salle, connaît vos horaires et sait dire « plus de
        tacos » à 22 h 30, ce lien travaille pour vous. Sinon, réglez la page d'abord — vous n'aurez pas deux fois le
        premier clic. C'est <Renvoi section="commander">ce qu'on installe avec vous</Renvoi>, et ce qui rend la fiche
        Google utile plutôt que décorative.
      </p>

      <h2 className="bl-h2">Ce que ça fait, et ce que ça ne fait pas</h2>
      <p className="bl-p">
        Soyons précis, parce que c'est là que les promesses commencent à déborder. Désigner votre lien comme préféré
        indique votre préférence à Google sur votre propre fiche. Cela ne fait pas de vous le premier résultat local,
        cela ne modifie pas votre position sur la carte, et cela n'oblige personne à cliquer chez vous.
      </p>
      <p className="bl-p">
        Cela ne fait pas non plus disparaître les autres options. L'interface propose bien une entrée{" "}
        <Ui>Supprimer le lien</Ui> pour un fournisseur donné — nous ne conseillons pas de vous en servir, et nous ne
        promettons aucun résultat si vous le faites. Un restaurateur qui vit d'une partie de son volume sur les
        plateformes n'a aucun intérêt à fermer une porte qui lui amène des clients qu'il n'aurait pas eus.
      </p>
      <p className="bl-p">
        Enfin, nous ne vous donnerons aucun délai de prise en compte : Google n'en publie pas, et un délai inventé se
        vérifie tout seul, contre celui qui l'a inventé. Vérifiez le lendemain, puis la semaine suivante.
      </p>

      <h2 className="bl-h2">Alors pourquoi s'embêter, si les plateformes restent ?</h2>
      <p className="bl-p">
        Parce que les deux canaux ne font pas le même travail, et que vous avez besoin des deux.
      </p>
      <p className="bl-p">
        Une plateforme <strong>acquiert</strong>. Elle amène devant votre carte quelqu'un qui ne connaissait ni votre nom
        ni votre rue, et quand il y a une livraison, elle la fait. C'est un travail réel, et il se facture — cher, mais
        il se facture.
      </p>
      <p className="bl-p">
        Votre lien direct, lui, <strong>fidélise</strong>. L'habitué qui commande chez vous paie le prix affiché en
        salle, ses points de fidélité se cumulent dans votre page, son numéro et son historique vous appartiennent. Et
        si vous voulez lui écrire un jour pour annoncer une nouveauté, vous le pouvez.
      </p>
      <p className="bl-p">
        La fiche Google est le seul endroit du web où ces deux logiques se rencontrent devant le même client, au même
        moment. C'est pour ça qu'elle mérite dix minutes de votre après-midi.
      </p>

      <h2 className="bl-h2">À revérifier une fois par trimestre</h2>
      <ul className="bl-liste">
        <li>Le lien préféré est-il toujours le vôtre ? Une intégration ajoutée entre-temps peut avoir peuplé la liste.</li>
        <li>La page au bout du lien répond-elle toujours ? Un changement de site casse un lien sans prévenir personne.</li>
        <li>Vos horaires sur la fiche et sur la page de commande disent-ils la même chose ?</li>
        <li>Le parcours tient-il sur un téléphone, en 4G, en trois gestes ?</li>
      </ul>

      <Note titre="En une phrase">
        Ajoutez votre lien, désignez-le comme préféré au moins pour le retrait, et vérifiez la page au bout depuis un
        téléphone. Le reste de votre fiche travaille déjà pour vous.
      </Note>

      <p className="bl-p">
        Sur ce point comme sur le reste, nous n'inventons pas de délai et nous ne promettons pas de résultat : nous
        faisons le réglage avec vous pendant la mise en route, et vous repartez avec la procédure entre les mains. Si
        vous voulez qu'on regarde votre fiche ensemble, <Renvoi section="contact">laissez-nous votre numéro</Renvoi>.
      </p>

      <Sources items={SOURCES} />
    </>
  );
}
