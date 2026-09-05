# SnackManager Studio — l’atelier sur mesure

Statut : proposition produit et technique, pas une fonctionnalité commercialisée ni déployée. Complète le travail d’animation des quinze modèles inclus, sans modifier leur accès.

## La séparation à vendre

| Offre | Valeur livrée | Facturation recommandée |
| --- | --- | --- |
| Modèles TV inclus | Choisir une composition animée, son orientation et sa présentation ; contenu relié à la carte | Reste dans le périmètre logiciel existant |
| Studio Identité | Logo, système visuel et déclinaisons utilisables dans toutes les applications | Création ponctuelle, périmètre et nombre de retours définis |
| Studio Cinématique | Direction artistique propre au restaurant, mise en scène des produits, animation de marque et transitions spécifiques | Devis de création selon scènes, écrans, formats et médias à produire |
| Studio Campagnes | Nouveaux lancements produits ou campagnes saisonnières | Prestations ponctuelles ou cadence optionnelle contractualisée |

Nom public recommandé : **« SnackManager Studio — l’atelier sur mesure »**. C’est l’évolution des prestations Atelier existantes, pas un second catalogue concurrent. Ne pas renommer les codes de contrats historiques ni modifier les tarifs signés dans ce chantier. Le prix d’une création ne couvre pas implicitement les futures refontes artistiques ; inversement, une modification courante de prix issue du catalogue ne doit pas devenir une prestation créative facturée.

Promesse : « Vos menus deviennent un spectacle. Vos prix restent à jour. » Ne promettre ni hausse chiffrée du panier ni synchronisation parfaite entre téléviseurs sans preuve.

## Ce qui existe vraiment

- Les prestations ponctuelles et récurrentes Atelier existent dans `packages/contracts/src/crm.ts`, le CRM `/sm`, et la page publique `/atelier`.
- Le suivi `/sm/production` concerne actuellement les prestations récurrentes hebdomadaires : ce n’est pas encore un dossier de création avec devis, versions et validation client.
- Les quinze scénographies actuelles sont des composants inscrits au registre du lecteur. Aperçu et TV partagent le même hôte, la marque, les produits et le cache.
- Le kit local `classfood-kit` est non versionné dans le worktree principal au moment de l’inspection. Il n’a pas été déplacé, supprimé ni publié par ce chantier.
- Ses cinq fichiers « TV Ecran » sont des compositions HTML/React animées, exportables en vidéo. Aucun `.mp4`, `.webm` ou `.mov` n’a été trouvé dans ce dossier. Les écrans 1 et 5 ont été ouverts en navigateur, sans erreur JavaScript.
- Le kit apporte déjà une écriture visuelle : produits détourés, titres monumentaux, médaillon tamponné, déroulé des lignes, transition ticket et séquences dédiées par zone du restaurant.

## Parcours à construire

**Gérant :** entrée « Studio » dans Présence + liens contextuels depuis Identité et Écrans → exemples → bref formulaire (besoin, écrans, formats, produits, visuels disponibles) → devis → validation → aperçu versionné et retours → bon à diffuser → création disponible dans « Mes créations », assignable aux écrans.

**Équipe SnackManager :** demande rattachée au client CRM existant → cadrage/devis → production → aperçu → corrections → validation tracée → publication d’une version et possibilité de revenir à la précédente. La demande de devis ne déclenche ni débit ni publication. Les droits de validation commerciale et de publication restent explicites, avec contrôle serveur du restaurant.

Ne pas imposer un nouvel outil de dessin au restaurateur. Il choisit, donne son avis et programme ses écrans ; le Studio réalise le travail de direction artistique.

## Intégration conseillée : composition vivante, médias pré-rendus si nécessaire

Le catalogue/API reste l’unique source des noms, variantes, prix, ruptures et horaires. Une création sur mesure référence les identifiants stables des produits et catégories, pas leur position ni leur libellé. La réalisation artistique définit leur placement, les séquences, le rythme et les médias décoratifs.

1. Porter une première composition Classfood en module React/CSS de confiance, dans le lecteur existant. Conserver ses éléments distinctifs, pas le runtime de démonstration complet.
2. Prévoir un manifeste versionné : identifiant de création, restaurant autorisé, version, orientations, durée, références catalogue et liste des médias. Le serveur décide de l’éligibilité ; le navigateur ne reçoit pas simplement une URL arbitraire à exécuter.
3. Réutiliser cache, préchargement, affichage hors ligne, aperçu et télémétrie du lecteur. Publication atomique seulement quand les fichiers de la version sont prêts, repli sur la dernière version valide et retour arrière.
4. Pour les effets lourds, pré-rendre la partie décorative en vidéo muette optimisée ; superposer les prix et informations commerciales dynamiques. Tester décodage, autoplay, boucle et mémoire sur le matériel réel.

Un MP4 avec prix incrustés reste possible pour une campagne figée et datée, mais ne doit pas être vendu comme un menu synchronisé. Un import libre de HTML/JavaScript client ou une iframe avec accès au back-office n’est pas le raccourci de production recommandé.

## Écarts du kit à traiter lors du portage

- Remplacer `window.MENU` et les informations saisies dans les fichiers par les références API ; valider les mentions marketing avec le gérant.
- Générer un vrai QR de commande : l’écran 5 contient explicitement un faux QR.
- Embarquer les dépendances et polices autorisées : les fichiers chargent React développement, Babel dans le navigateur et des polices/scripts externes.
- Retirer l’éditeur/exporteur de la diffusion TV ; aucune compilation JSX ni rendu React complet à chaque frame sur le lecteur léger.
- Revoir cadrages, dimensions et densités sur les formats vendus : l’écran 1 de référence recouvre partiellement sa dernière ligne avec le bandeau inférieur dans la capture observée.
- Adapter les détails animés coûteux : garder le rendu voulu avec couches précomposées, transform/opacity et/ou vidéo décorative, puis mesurer sur TV.
- Un pack de cinq écrans peut former une direction artistique cohérente sans être synchronisé à la frame. Une fresque synchronisée est un lot technique distinct (horloge partagée, dérive, reprise hors ligne).

## Ordre réaliste pour un développeur seul

1. Finir et valider les animations des modèles inclus.
2. Porter **un écran Classfood Signature** de bout en bout, avec un vrai changement de prix et une rupture, puis vérifier le lecteur réel. Ce pilote devient la preuve commerciale.
3. Ajouter la demande Studio et le dossier de création au CRM/back-office existants, avec validation et publication versionnée.
4. Décliner les quatre autres écrans, puis industrialiser uniquement les primitives réellement réutilisées. Aucun éditeur de montage généraliste ni marketplace à construire avant ces premières ventes.

Acceptation du pilote : prix exacts, catalogue unique, aucune information masquée, QR réel, aucun débordement en formats annoncés, boucle complète, reprise hors ligne, mouvement réduit, preuve d’isolation entre restaurants et retour arrière testé.
