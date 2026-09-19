# Affectation depuis la caisse

Le caissier ouvre une livraison dans **Le service**, choisit un livreur dans la fiche de commande et confirme l’affectation. La commande doit être prête, sans affectation ni départ déjà confirmé. La fiche affiche ensuite le nom confirmé par le serveur. Le panier courant, le paiement, le statut de préparation et le départ ne sont pas modifiés.

Les responsables conservent leurs possibilités existantes de préparation anticipée, remplacement et retrait d’affectation dans le back-office. La caisse n’obtient aucun droit de création, invitation ou révocation des accès livreur.

## Disponibilité et charge

`GET /delivery/operators/available?after=<id>` retourne uniquement l’identifiant, le nom, la révision et les compteurs de missions actives de chaque accès admissible. La capacité livraison, le restaurant, l’activation de l’accès et la validité de l’équipier lié sont vérifiés côté serveur. Aucun secret, lien d’invitation ou champ RH n’est exposé à la caisse.

La charge affichée compte les commandes affectées en attente de départ. Un livreur peut en recevoir plusieurs pour préparer une tournée. Dès qu’une de ses missions actives est partie, il est exclu des nouveaux choix en caisse. Ce choix ne représente pas une présence en ligne ni une géolocalisation ; il repose sur les états enregistrés des missions. Une livraison historique partie avec seulement un prénom libre ne peut pas être rattachée automatiquement à un accès livreur.

La liste est paginée par 50 accès, sans cache. Une page filtrée peut être vide et conserver un curseur : le bouton de chargement reste alors accessible. Le rafraîchissement relit les pages déjà parcourues et conserve une sélection encore admissible. Une coupure réseau désactive immédiatement les actions dans le navigateur.

## Écriture et reprise

Le POS utilise le protocole d’affectation existant : UUID durable, révision de mission et révision d’opérateur attendues, validation serveur et CAS dans le document de commande. La caisse ne peut ni retirer ni remplacer une affectation. Le serveur rejoue une opération identique avant de vérifier les nouvelles préconditions, pour permettre une reprise après départ ou réaffectation ultérieure par un responsable.

Le journal partagé `@sm/client-core/delivery-assignment` ne conserve que les identifiants, révisions et motif fixe, dans le stockage protégé par l’appairage. Il contient au plus 128 actions non acquittées, sans purge sur délai. Un acquittement doit correspondre à l’UUID, à la mission et à la révision attendue. Un refus métier journalisé est également acquitté. Un conflit explicite `DELIVERY_MISSION_CHANGED` ne libère l’intention qu’après relecture d’une révision plus récente.

Après timeout, fermeture ou rechargement, **Vérifier l’affectation** reprend exactement le même corps avec le même auteur. La référence reste accessible dans le service même lorsque la commande quitte la liste active. Le désappairage et l’effacement sont bloqués tant qu’une affectation reste incertaine. Les affectations ne sont pas ajoutées à la file de ventes hors ligne. Le journal et ses contrats sont portables web/Expo ; la surface emploie les primitives React Native existantes.

## Limite de cohérence

Le CAS protège atomiquement une commande et son journal. Le serveur relit aussi les autres missions du livreur immédiatement avant une affectation de caisse. Comme les commandes sont des documents distincts et que le déploiement accepte Mongo standalone, un départ sur une autre commande peut encore croiser cette dernière lecture. Ce changement ne prétend pas offrir une réservation atomique de tournée entière. Les limites existantes de révocation et de remboursement en vol restent décrites dans [le protocole des missions](MISSIONS-LIVREUR.md#limites-de-cohérence-à-ne-pas-masquer).

## Validation

Les suites de contrats et du journal vérifient notamment corruption, concurrence, identité de l’auteur, rejeu et protection de purge. Les tests Nest/HTTP avec Mongo locale isolée couvrent droits et tenant, première affectation prête, plusieurs commandes avant départ, livreur déjà parti, révisions périmées, refus durables et concurrence entre caisses. Les services externes y sont remplacés par des doublures.

`e2e/local/pos-delivery-assignment.mjs` utilise le vrai POS sur loopback et une API interceptée : formats 390/820/1440 px, navigation clavier, charge, panier conservé, hors ligne, liste vide/paginée/en erreur, réponse perdue et reprise du même UUID après rechargement. `e2e/demo/caisse-livraison.test.mjs` vérifie le transport volatil de démonstration sans écriture distante. Ces recettes ne valent pas preuve d’une tournée réelle sur téléphone ni d’une affectation dans la base staging ; le compte rendu de livraison distingue les niveaux de validation réellement exécutés.
