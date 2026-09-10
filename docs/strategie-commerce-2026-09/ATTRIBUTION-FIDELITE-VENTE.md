# Attribution fidélité immuable à une vente protégée

État au 10 septembre 2026 : raccord fusionné dans [#161](https://github.com/GLWebDevAgency/snack-manager/pull/161),
après le socle de calcul [#160](GAINS-VENTE-REMBOURSEMENTS.md), et inclus dans la
[réception staging #168](https://github.com/GLWebDevAgency/snack-manager/pull/168#issuecomment-5620914049).
La recette locale ci-dessous ne vaut pas recette privée du compte. **Aucun crédit web,
débit, consommation, migration ou ouverture du pilote dans ce lot.**

## Ce qui devient durable

Pour une **nouvelle** commande du compte protégé, le serveur résout les produits,
options, remise et livraison, puis prépare l'attribution fidélité. Aucun membre,
programme, solde ou prix n'est accepté depuis le formulaire client.

La lecture PostgreSQL vérifie le compte et sa session initiale, l'appartenance
fidélité prouvée par son opération terminée, son reçu et son événement, ainsi
que le programme et la version de règle publiée. Elle conserve la règle de la
vente, qui peut être plus récente que la version consentie lors de l'adhésion.
Elle ne déchiffre ni profil, téléphone ni QR, et ne lit pas le solde.

L'instantané privé contient :

- identité canonique de la vente `tenantRef + clientId` et propriétaire initial ;
- instant de lecture et assiette `merchandise-net-v1`, produits après remise,
  frais de livraison distincts et total facturé contrôlé en centimes ;
- soit membre, opération d'appartenance, programme, version et règle complète ;
- soit une absence explicite : non-adhérent, programme inactif, membre inactif
  ou fonctionnalité indisponible.

Une panne, une incohérence de reçu ou une règle corrompue **n'est pas une absence
d'adhésion** : le checkout reste fermé et réessayable sur la même tentative.

## Frontières de transaction et de reprise

La capacité commerciale Mongo est lue avant la transaction PostgreSQL. Le
programme est verrouillé en lecture, puis sa version est relue dans une seconde
requête : une publication concurrente ne mélange pas ancienne règle et nouvelle
version après attente du verrou. Le contrôle final de session reste appliqué.
Aucun appel Mongo ou fournisseur n'est exécuté sous le verrou PostgreSQL.

Après cette préparation, le dernier contrôle d'autorité confirme le propriétaire
initial. La comparaison A→B est une perte d'autorité ; une panne du contrôle reste
une indisponibilité technique, sans rejet permanent de la tentative. Cette borne
n'est **pas une transaction distribuée** entre les deux bases : la règle capturée
est une décision historique de préparation, pas une preuve de paiement ni une
garantie que les réglages n'ont pas changé pendant l'intervalle.

L'instantané est engagé avec l'identité et les places de la commande dans le même
CAS Mongo `validating → committing`. Deux préparations concurrentes peuvent
différer ; seule celle du CAS gagnant devient durable. Aucun solde n'est modifié.

La matérialisation de l'Order vérifie son attribution contre celle du journal
avant publication et acquittement. Une divergence reste à rapprocher, jamais
écrasée. Une insertion ou une réponse perdue conserve l'instantané gagnant ; la
reprise ne relit ni la carte actuelle ni la règle courante. Un Order déjà créé
avec acquittement perdu repasse par ce contrôle et répare son journal. Une
ancienne commande sans admission conserve son chemin historique.

Les anciennes commandes à attribution `null` restent à `null` : pas de
rattachement rétroactif par numéro de téléphone, carte actuelle ou reconnexion.

## Confidentialité et intégration

`Order.customerSaleAttribution` est privé (`select: false`), immuable dans l'ODM,
strictement validé et masqué des transformations publiques. Le contrat contrôle
les identités et l'égalité avec les totaux du ticket ; les valeurs primitives
mal typées ne sont pas converties silencieusement. Les mises à jour administrateur
Mongo brutes ne sont pas une frontière protégée par l'ODM.

Les réponses checkout, historique, détail, réachat, reprise C01, vues POS/KDS et
événements de commande n'exposent pas cet instantané. Les publications paiement
et remboursement le retirent explicitement, ainsi que le propriétaire privé.
Les champs legacy de gain POS restent nuls pour ces nouvelles ventes web.

## Recette exigée et limites

La recette native locale utilise des bases PostgreSQL et Mongo **jetables et
isolées**, pas Classfood ni un fournisseur réel. Elle couvre notamment :

- contrat strict, totaux serveur et rejet des conversions ODM à l'insertion ;
- preuve d'appartenance join/attach, programme inactif, membre bloqué et preuves
  corrompues ; publication concurrente de version sous verrou PostgreSQL ;
- deux connexions et deux candidats distincts atteignant le dernier contrôle
  avant CAS ; attribution unique du gagnant ;
- indisponibilité PostgreSQL, perte d'autorité, compensation de promotion et
  libération de la validation avant tout engagement durable ;
- insertion perdue après CAS, acquittement perdu, divergence de matérialisation,
  reprise sans nouvelle préparation et absence d'adoption de l'historique ;
- parcours HTTP signé → runtime → PostgreSQL → Mongo, réponse perdue, publication
  de règle suivante, ancienne attribution inchangée et nouvelle vente à jour ;
- masquage privé et absence de crédit dans le ledger après ces commandes.

Passe native finale séquentielle : **175/175**, sans skip : lecteur fidélité
PostgreSQL 61, service d'attribution 21, HTTP protégé 22, orchestration commerce
29 et commandes Mongo 42. Les deux suites voisines admission/capacité apportent
**54/54** ; les deux suites de publication paiement/remboursement **40/40**.
Les comptes incluent leurs tests existants et se recouvrent avec la passe globale.

Contrat strict **37/37**, schéma ODM **51/51** ; paquets complets contrats
**611/611**, DB **488 passés / 10 ignorés** hors leurs variables dédiées.
Vérification globale finale **51/51 tâches**, dont **47 réutilisées du cache
local** ; API **3414 passés / 700 ignorés** hors variables natives, web **2528/2528**,
POS **271/271**, KDS **53/53**, domaine **501/501**. Typage, lint et builds verts.

Les essais ont révélé puis corrigé une conversion ODM indue des centimes,
une lecture de version après attente de verrou, une classification technique
incorrecte de la perte de propriétaire et une reprise sautant l'acquittement
du journal. Les contre-tests restent dans les suites. Une erreur de typage du
modèle dans le test à deux connexions a aussi été corrigée avant cette passe.

Une passe globale intermédiaire a réussi les 3414 assertions API mais échoué
sur le nettoyage Chromium du test de signatures WebAuthn, après 10 secondes.
La fixture possède son processus et ne produit ni HAR ni vidéo : elle attend
désormais directement sa fermeture et vérifie la déconnexion, sans allonger le
délai ni ignorer d'erreur. [Contrat Playwright de fermeture](https://playwright.dev/docs/api/class-browser#browser-close).
La passe globale finale ci-dessus inclut ce changement ; la recette distante
reste distincte.

Les authentificateurs et transports de vérification du harnais sont simulés :
ils ne constituent pas la recette privée « Mon compte » sur staging.

## Suite, dans l'ordre

1. Définir une preuve financière durable et l'unicité du gain sur
   `tenantRef + clientId`, y compris paiement web repris au comptoir.
2. Raccorder le writer de gain avec reprise après commit PostgreSQL, sans double
   crédit après perte d'accusé Mongo ni relecture de la règle actuelle.
3. Raccorder consommation et allocation explicite des remboursements ; un total
   Stripe global ne distingue pas livraison et produits.
4. Traiter le rapprochement si les points ont déjà été dépensés, après décision
   du fondateur ; aucune dette ou solde négatif automatique n'est autorisé ici.
5. Effectuer la recette privée du compte et des intégrations avant ouverture
   contrôlée. La capacité publique Classfood reste `available: false`.
