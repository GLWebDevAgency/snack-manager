# L2.2 — Affectation et départ des missions livreur

## État et périmètre

Code et tests du lot réunis dans la [PR #127](https://github.com/GLWebDevAgency/snack-manager/pull/127), issue de `develop` `86ca72a`. La révision effectivement déployée et la recette distante sont attestées dans les commentaires de cette PR ; ce document de protocole ne vaut pas preuve de déploiement. L’accès L2.1 et sa correction d’horloge (#125, #126) sont déjà sur staging ; l’unique accès de recette Classfood reste révoqué. Aucune nouvelle commande, aucun compte ni paiement fournisseur n’est créé pour cette implémentation locale.

Le gérant prépare une affectation depuis la fiche de commande du back-office. Il choisit un **accès livreur existant**, pas un prénom libre. Il peut affecter pendant la préparation, réaffecter ou retirer l’affectation tant que le départ n’est pas confirmé. L’affectation ne prépare pas, n’encaisse pas et ne fait pas partir la commande.

Dans `/livreur`, la personne associée consulte uniquement ses missions actives : **À récupérer** et **En route**. Le départ est un geste explicite, confirmé par le serveur, pour une commande prête et dont le paiement enregistré est confirmé, sans remboursement ou blocage financier connu. La caisse habilitée peut également confirmer le départ d’une mission affectée ; elle ne gère pas les habilitations ni l’affectation.

**Hors de ce lot :** remise par le livreur, preuve PIN/QR, incidents, transfert après départ, tournée/GPS, fonctionnement hors réseau et validation d’une PWA installée sur un vrai téléphone. L2.3 reste nécessaire. La clôture manuelle existante du back-office n’est pas une preuve de remise client.

## Frontières et données

- Les accès livreur restent séparés des JWT professionnels. Aucun rôle cuisine/caisse n’est ajouté à une session livreur ; les règles générales de lecture des commandes ne sont pas élargies.
- Les routes manager sont sous `/delivery/missions`. L’affectation exige owner/gérant ; lecture et départ acceptent également la caisse. La capacité livraison et le restaurant sont contrôlés côté serveur.
- Les routes API `/delivery-access/missions` exigent la session dédiée, avec quotas partagés avant authentification. Le BFF `/livreur/missions` conserve la session en cookie HttpOnly, vérifie l’origine des mutations et interdit la mise en cache.
- La projection livreur contient numéro, horaire, état, articles/quantités, nom/téléphone et adresse/instructions utiles à la livraison. Elle exclut prix, montant payé, identifiants Stripe, QR/secret fidélité, jeton de suivi et journal interne.
- L’affectation utilise l’identifiant pérenne de l’opérateur. Une nouvelle session de ce même opérateur ne réaffecte pas toutes ses commandes. Un accès révoqué/inactif ou un équipier lié devenu invalide bloque les requêtes suivantes.
- Les coordonnées restent en mémoire d’interface. Le journal navigateur ne conserve que les identifiants/révisions de l’action et un motif prédéfini, jamais l’adresse ou le secret de session. Pas de suppression automatique d’une opération incertaine sur un simple délai.

## Une commande, une preuve atomique

`Order.deliveryMission` conserve la version du protocole, une révision monotone, l’affectation et un journal borné de 128 opérations. Ce champ est privé (`select:false` et exclusion des sérialisations). Il ne possède pas de TTL. Les commandes historiques restent à `null`, sans affectation inventée.

Le client sauvegarde son UUID d’opération et la révision attendue **avant** le POST. Le serveur compare l’identité du restaurant/auteur, l’action, le corps strict et les préconditions. Il écrit l’affectation ou le départ et sa preuve dans le même document par CAS ; `__v` et la révision de mission progressent ensemble. L’acquittement exige `majority` avec journal et la récupération relit sur le primaire avec lecture majoritaire.

- Même opération et même corps : retour idempotent, avec **vue actuelle** de la mission, pas restauration d’une ancienne affectation.
- Même UUID mais autre action/corps/auteur : conflit, jamais nouvel effet.
- Réponse perdue : reprendre la même opération. Une absence de preuve après une erreur DB reste incertaine ; elle ne prouve pas l’absence d’écriture.
- Refus métier acquitté (pas prête, accès choisi devenu invalide, paiement bloqué…) : une preuve `outcome: rejected` consomme aussi la révision, **sans appliquer l’action**. Un ancien POST retardé ne pourra donc pas agir plus tard. Aucun audit n’affirme à tort un départ pour ce refus.
- Le journal saturé refuse les nouvelles opérations ; les anciennes preuves ne sont pas tronquées pour faire de la place.
- L’ancien départ au prénom libre refuse atomiquement toute commande portant une mission, y compris si une affectation est créée entre sa lecture et son écriture.

Le journal d’audit append-only et l’événement de mise à jour sont secondaires, réparables par le rejeu de la preuve. L’auteur livreur est identifié comme `delivery_access`, pas comme un compte owner fabriqué. Le motif, le rôle et l’identité de l’opération restent attachés à sa preuve. Un incident de journal/publication peut donc afficher une reprise à vérifier alors que l’écriture métier est déjà faite ; ce n’est pas un deuxième départ à créer.

## Limites de cohérence à ne pas masquer

1. **Remboursement en vol :** le service de remboursement actuel peut appeler Stripe avant d’avoir réservé durablement une intention locale. Les compteurs `refundedCents`/`pendingRefundCents` et le verrou de version empêchent un départ face à un remboursement déjà enregistré, pas face à un appel fournisseur encore invisible localement. Les phases de paiement acceptées sont exclusivement absente/historique ou `settled`. Une exclusion complète remboursement/départ nécessite un lot de réservation durable commun avant l’appel Stripe ; elle n’est pas livrée ici. Les changements effectués directement chez Stripe ont en outre leur délai de notification/rapprochement.
2. **Révocation concurrente :** l’autorisation (opérateur/équipier/restaurant) et la commande sont dans des documents distincts. Elles sont relues au cours de la requête et avant de rendre le résultat, mais une révocation peut croiser une requête déjà autorisée en vol. Les nouvelles requêtes sont refusées. Ne pas vendre cela comme une transaction atomique multi-document.
3. **Notifications :** pas de worker universel d’outbox. Les missions se rafraîchissent et un rejeu répare le journal/publication ; un test Redis ne certifie pas une notification reçue sur téléphone.
4. **Données personnelles :** le retrait d’accès nettoie la vue applicative, pas une capture d’écran réalisée antérieurement. La politique globale de conservation des commandes/adresses reste un chantier transversal.

## Recette requise

Les tests d’intégration utilisent une base Mongo locale jetable par suite, avec garde explicite d’hôte/préfixe et propriété du nettoyage. Les services externes sont des doublures ; aucun SMS, Stripe ni commande client ne part.

Passe locale du 7 septembre : contrats 471, domaine 368, DB 409 tests verts (10 tests d’index/capacité hors variable dédiée ignorés dans cette passe). Missions Mongo et HTTP réels 45/45, dont 8 gardes de cible ; les HTTP utilisent la vraie `AuditService` et vérifient l’auteur ainsi que l’absence de doublon après rejeu. BFF accès/missions 125/125. Les comptes se recoupent avec les suites globales et ne doivent pas être additionnés comme une métrique produit. La CI du SHA final doit en plus exécuter ses bases PostgreSQL/Mongo dédiées et les builds complets.

Vérifier contrats et confidentialité, droits/tenant, pagination, attribution pendant préparation, départ prêt/payé, refus terminal puis nouvelle action, révocation/équipier inactif, réaffectation, course assignation/départ, CAS perdu, rejeu après ACK perdu, conflit d’UUID, journal saturé et fermeture de l’ancien départ. Tester les vraies routes Nest et BFF, pas seulement des fonctions isolées.

Recette d’interface : téléphone étroit et bureau, états vide/chargement/erreur/hors ligne, confirmations et reprise explicites, rafraîchissement sans perdre l’intention, focus/clavier, défilement, absence de débordement et mouvement réduit. Une fixture Chromium n’est ni une session Classfood réelle ni un téléphone physique.

Passe UI locale : 69/69 contrôles ciblés, dont 18 recettes Chromium avec vrais composants/DS et API locale isolée. Les captures liste 320 px/bureau, paiement en attente, reprise incertaine et départ confirmé ont été inspectées. La géométrie reste compacte pendant la revalidation d’accès. La revue a corrigé le rattachement du journal BO à l’auteur, son isolation par mission, les réponses retardées après changement d’identité et le dépassement de sa capacité sans écriture parasite. Les refus restent des avertissements, pas des succès verts. Les serveurs/navigateurs de fixture sont fermés en fin de suite ; aucun build Next complet local (espace disque limité).

Après PR et CI du SHA final : fusion dans `develop`, vérification des quatre services Railway, migrations, révision servie et smoke. La recette métier staging avec création d’accès/commandes doit rester bornée et identifiée ; ne pas réactiver sans accord le seul accès révoqué de L2.1. Production : GO distinct après recette du périmètre exact.
