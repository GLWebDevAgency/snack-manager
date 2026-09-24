/* eslint-disable react/no-unescaped-entities */
import Link from "next/link";
import { Note, Renvoi } from "./blocs";

export function corps() {
  return (
    <>
      <p className="bl-p">
        Refaire un menu commence par une question de lecture : que doit comprendre le client au moment de
        choisir ? Sur un dépliant, il peut prendre le temps de comparer. Devant une TV au comptoir, il doit
        repérer rapidement les catégories, les formules et leur prix. Une identité commune est utile ;
        copier la même composition sur chaque support l'est beaucoup moins.
      </p>

      <h2 className="bl-h2" id="brief">Préparer un brief qui évite les allers-retours</h2>
      <p className="bl-p">
        Réunissez une version de référence de votre carte : produits, descriptions, prix, suppléments,
        formules et horaires particuliers. Désignez une personne qui valide ces informations. Un tableau
        partagé avec une ligne par référence suffit pour commencer ; des corrections dispersées entre
        plusieurs conversations sont beaucoup plus difficiles à vérifier.
      </p>
      <ul className="bl-liste">
        <li><strong>Votre usage :</strong> menu distribué, carte à table, vente à emporter, écran au comptoir ou plusieurs supports.</li>
        <li><strong>Votre contenu :</strong> nombre de références, variantes, langues et règles des formules.</li>
        <li><strong>Votre identité :</strong> logo disponible, couleurs, photos autorisées et exemples de rendu souhaité.</li>
        <li><strong>Vos contraintes :</strong> format ouvert et fermé, quantité papier, emplacement et orientation des écrans.</li>
        <li><strong>Votre rythme :</strong> prochaine échéance et fréquence probable des changements.</li>
      </ul>
      <p className="bl-p">
        Un restaurant japonais pourra devoir distinguer pièces, assortiments et accompagnements ; une
        brasserie, formule du midi et carte du soir ; un restaurant thaï, choix de protéines et suppléments.
        La structure suit les décisions du client, sans imposer la même grille à toutes les spécialités.
      </p>

      <h2 className="bl-h2" id="papier">Concevoir le papier à taille réelle</h2>
      <p className="bl-p">
        Un trois-volets comporte six faces. Définissez leur rôle avant de placer les plats : couverture,
        ouverture, catégories principales et informations pratiques. Répartissez le contenu selon l'ordre
        de lecture et faites un pliage d'essai pour vérifier ce qui apparaît réellement à chaque étape.
      </p>
      <p className="bl-p">
        Demandez le gabarit de l'imprimeur retenu avant de finaliser la maquette. Les dimensions des volets,
        les fonds perdus et les zones de sécurité dépendent de la fabrication. Gardez les prix et les
        textes essentiels à distance des plis et de la coupe. Un aperçu sur ordinateur ne valide pas la
        lisibilité d'un petit caractère imprimé.
      </p>
      <p className="bl-p">
        Imprimez une épreuve à l'échelle, même sur une imprimante de bureau pour contrôler la lecture.
        Vérifiez ensuite couleurs et finitions avec votre imprimeur selon le niveau d'exigence du projet.
        Le bon à tirer doit porter la version des textes et des prix que vous souhaitez réellement produire.
      </p>

      <h2 className="bl-h2" id="tv">Construire une lecture stable sur TV</h2>
      <p className="bl-p">
        Partez du recul du client et du nombre d'écrans disponibles. Choisissez une orientation et la
        résolution de diffusion, puis testez le rendu sur l'installation prévue. Conservez des contrastes
        nets, des prix faciles à rapprocher des plats et une hiérarchie constante entre les compositions.
      </p>
      <p className="bl-p">
        L'animation peut attirer l'attention sur un produit, mais la lecture doit rester possible pendant
        le choix. Évitez de faire disparaître une formule avant que le client ait compris ses options.
        Si plusieurs vues alternent, placez les informations permanentes dans une zone stable et ajustez
        la durée de boucle après un essai depuis la file d'attente.
      </p>
      <Note titre="Le test de validation le plus utile">
        Depuis l'emplacement où attend le client, demandez à une personne qui ne connaît pas la carte
        de retrouver un plat, son prix et ce qui est compris. Notez les hésitations. Faites ce test sur
        la TV réelle, puis sur le papier fermé et déplié.
      </Note>

      <h2 className="bl-h2" id="ventes">Choisir les mises en avant à partir de vos données</h2>
      <p className="bl-p">
        Si vous avez un export de ventes, retenez une période représentative et rapprochez chaque ligne
        du produit de votre carte. Distinguez quantités vendues, chiffre d'affaires, remises et périodes
        de rupture. Un produit peu vendu parce qu'il a été indisponible ne se juge pas comme un produit
        resté disponible toute la période.
      </p>
      <div className="bl-tablewrap" tabIndex={0} role="region" aria-label="Ce que les données permettent réellement de décider">
        <table className="bl-table">
          <caption>Ce que les données permettent réellement de décider</caption>
          <thead><tr><th scope="col">Vous disposez de…</th><th scope="col">Vous pouvez examiner…</th><th scope="col">Limite à garder en tête</th></tr></thead>
          <tbody>
            <tr><th scope="row">Quantités et ventes</th><td>Popularité, répartition des catégories et présentation</td><td>Un produit populaire n'est pas forcément le plus rentable.</td></tr>
            <tr><th scope="row">Recettes, portions et achats fiables</th><td>Contribution estimée après coûts retenus</td><td>Les pertes et variations de coût doivent être prises en compte.</td></tr>
            <tr><th scope="row">Observations du service</th><td>Questions fréquentes et blocages de préparation</td><td>Un problème visuel peut aussi venir d'une formule trop complexe.</td></tr>
          </tbody>
        </table>
      </div>
      <p className="bl-p">
        Exemple fictif : une formule se vend bien, mais ses options provoquent de nombreuses questions.
        Avant de l'agrandir sur la TV, clarifiez ce qui est inclus et ce qui entraîne un supplément.
        Mesurez ensuite les demandes d'explication et les ventes sur des services comparables. Vous
        testez une hypothèse ; vous ne promettez pas un résultat commercial.
      </p>

      <h2 className="bl-h2" id="devis">Séparer conception, fabrication et diffusion dans le devis</h2>
      <p className="bl-p">
        Pour comparer deux propositions, alignez le nombre de supports, les formats, les références,
        les langues, les retours et les fichiers livrés. Demandez qui fournit les textes et les photos,
        puis ce qui se passe lorsqu'un prix change après validation.
      </p>
      <ul className="bl-liste">
        <li><strong>Conception :</strong> adaptation ou création, composition, corrections prévues et fichiers finaux.</li>
        <li><strong>Fabrication papier :</strong> imprimeur, quantité, papier, finition, livraison et éventuelle coordination.</li>
        <li><strong>Diffusion TV :</strong> logiciel, matériel compatible, installation et paramètres de la boucle.</li>
        <li><strong>Évolution :</strong> retouche simple, nouveau format ou refonte, avec un périmètre différent pour chaque besoin.</li>
      </ul>
      <p className="bl-p">
        À <Link className="bl-renvoi" href="/atelier">l'Atelier Snack Manager</Link>, les prestations papier se
        choisissent avec ou sans nos logiciels. Impression et livraison sont chiffrées séparément au coût
        de l'imprimeur, sur devis accepté ; une éventuelle coordination est distincte. La mise en scène
        TV s'appuie sur les compositions existantes et sa diffusion nécessite une suite compatible.
        Le matériel, une vidéo originale et un export MP4 ne sont pas implicitement compris.
      </p>

      <h2 className="bl-h2" id="validation">Valider, publier et tenir les versions à jour</h2>
      <p className="bl-p">
        Relisez chaque prix, quantité, supplément, coordonnée et lien. Pour les informations alimentaires
        et l'affichage réglementaire, référez-vous aux
        <a className="bl-renvoi" href="https://entreprendre.service-public.gouv.fr/vosdroits/F22387"> obligations présentées par Service Public Entreprendre</a>.
        Le restaurant valide les informations de sa carte ; le graphiste organise leur présentation.
      </p>
      <p className="bl-p">
        Archivez le fichier validé avec sa date, puis notez les supports à remplacer lors de la prochaine
        modification : papier, TV, site, commande et fiche Google. Une nouvelle version numérique ne
        change pas les exemplaires déjà imprimés. Prévoyez cette remise à jour dans votre calendrier.
      </p>
      <p className="bl-p">
        Pour relier la nouvelle carte à votre présence en ligne, consultez
        <Link className="bl-renvoi" href="/blog/visibilite-restaurant-google-site-internet"> le guide visibilité du restaurant</Link>.
        Pour préparer une création ou une analyse, <Renvoi section="contact">envoyez-nous les supports
        souhaités et les éléments disponibles</Renvoi> : le périmètre sera défini avant le travail.
      </p>
    </>
  );
}
