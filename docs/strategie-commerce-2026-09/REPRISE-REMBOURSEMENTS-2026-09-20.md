# Reprise des remboursements avant le crédit fidélité web

La [revue séparée de PR #170](../reviews/PR-170-REPRISE-FIDELITE-2026-09-20.md)
a retrouvé le socle serveur déjà intégré par PR #173. Le présent lot complète
sa reprise dans le back-office ; il ne crée ni gain web ni compensation de points.

## Comportement

Le navigateur conserve l'intention avant tout POST : restaurant, auteur,
commande, UUID, montant et motif. Le mot de passe et le jeton ne sont jamais
journalisés. Le noyau `@sm/client-core` reçoit un adaptateur de stockage pour
rester partageable avec Expo. Le navigateur exige un stockage durable relu et
un verrou inter-onglets. Un journal indisponible, corrompu ou appartenant à un
autre auteur ne devient pas une nouvelle demande. Fermer ou recharger conserve
exactement la même intention.

`GET /orders/:id/refunds/journal` lit le document local sans appel fournisseur,
écriture Mongo, réparation de l'audit ni notification Redis. Cette route reste
accessible au propriétaire autorisé lorsque le drapeau est fermé, avec
`Cache-Control: private, no-store`. La projection contient montant, motif, date,
état et possibilité de reprise par l'auteur ; elle exclut identité de l'auteur,
compte Connect, PaymentIntent, clés et métadonnées fournisseur. La portée du
reçu doit correspondre au paiement enregistré, indépendamment de l'activation.
Changer de clé runtime ferme la reprise sans effacer un reçu historique cohérent.

Le rapprochement bancaire est une action explicite. Un reçu `known` signifie
que l'opération fournisseur existe : `pending` ou `requires_action` ne sont pas
présentés comme un remboursement réussi. Seul un reçu exact acquitte l'intention
locale. Le rafraîchissement de la commande est distinct : son échec après un
remboursement enregistré ne prépare pas un nouveau POST.

`POST /orders/:id/refunds/withdraw`, avec réauthentification du propriétaire,
retire une intention uniquement avant tout départ fournisseur. Le même CAS
que celui du départ enregistre un état terminal `withdrawn`, y compris si un
ancien POST n'est pas encore arrivé. L'UUID reste conservé et ne peut plus
déclencher de remboursement. La réserve n'est libérée qu'en l'absence de date
de départ et de preuve fournisseur. Une demande déjà partie ou incertaine reste
réservée. L'audit append-only `order.refund.withdraw` est réparable par reprise.

Les erreurs réseau ne prouvent jamais qu'un remboursement n'a pas eu lieu.
Stripe peut aussi oublier une clé d'idempotence après sa période de conservation ;
la sécurité repose sur le journal local durable et la fenêtre bornée existante,
pas sur une clé fournisseur réutilisée indéfiniment.
[Référence Stripe](https://docs.stripe.com/api/idempotent_requests).

## Déploiement et limites

`withdrawn` fait évoluer le protocole : un binaire de PR #173 comprend le journal
initial mais ne reconnaît pas ce nouvel état terminal. Aucun ancien writer ne
doit rester actif après le premier retrait. Garder le drapeau fermé pendant la
bascule, retirer et drainer les anciennes instances, puis ouvrir uniquement en
staging. Après la première écriture, rester sur un binaire compatible ; fermer
le drapeau et corriger en avant. Ne supprimer aucun reçu pour autoriser un rollback.

Une opération déjà partie dont la preuve demeure incertaine exige toujours un
rapprochement. La limite de 128 opérations conserve les preuves au lieu de
recycler les identifiants. Perdre le stockage local avant qu'une demande ne soit
connue du serveur ne fournit pas une preuve d'abandon. Un autre auteur ne peut
pas reprendre à son nom une intention déjà enregistrée.

## État observé avant livraison

Le 20 septembre, staging sert `56699753884136daee4b5db1bb532ac2aa69fee4` :
smoke 8/8, configuration compte valide en mode `production_paid` sur la cible
**staging**, compte existant authentifié visible dans Chrome et carte liée à
ce compte. Ce relevé ne rejoue ni inscription, ni SMS, ni création de passkey.
Le drapeau remboursement est fermé ; aucune commande Classfood ne porte alors
de journal, de montant remboursé ou de réserve de remboursement.

Les preuves de livraison du nouveau lot doivent identifier séparément le commit,
la CI, les services déployés et les scénarios réellement exécutés. Les tests
locaux avec Mongo et un fournisseur simulé ne constituent pas un remboursement
Stripe de test exécuté en staging.

## Validation locale du lot

- Contrats : 728 tests ; noyau client : 279 tests ; schémas DB : 556 tests,
  10 ignorés. API globale : 4 079 tests, 886 ignorés faute de leurs environnements
  dédiés ; ces ignorés ne constituent pas une recette distante.
- Mongo natif dédié : 66 scénarios de remboursement, auxquels s'ajoutent
  8 tests indépendants de portée des reçus. Perte de réponse, retrait concurrent
  au départ fournisseur, audit perdu, retrait répété, reprise tardive interdite
  et nouvelle demande volontaire après retrait sont exercés.
- Frontière d'autorisation et HTTP local Nest/JWT/Mongo : 40 tests, dont la
  réauthentification réelle Argon2, les rôles, le tenant, les droits d'offre,
  la révocation de session et la lecture sans fournisseur. Le fournisseur est
  simulé dans ces tests ; aucun argent réel n'est engagé.
- Interface : 44 tests ciblés, dont 23 dans Chromium avec le composant réel,
  localStorage et les verrous du navigateur. Fermeture, rechargement, réponse
  perdue, bascule de session et concurrence entre onglets sont couverts.
  Captures et géométrie vérifiées à 320, 390, 820 et 1 440 px. Les réponses HTTP
  sont simulées dans cette recette ; elle ne valide pas Safari ni un appareil.

Les journaux et captures locaux sont conservés hors du dépôt dans
`../loyalty-completion-evidence/`. Les comptes de suites qui se recouvrent ne
doivent pas être additionnés pour annoncer un total artificiel.

## Suite fidélité

Le gain web doit partir de l'attribution immuable déjà enregistrée à la vente,
de la règle historique et d'une preuve de vente payée/remise. La méthode actuelle
`earn(source: online)` ne doit pas être activée telle quelle : elle utilise la
règle courante sans vérifier la vente Mongo comme le chemin POS.

Le lot suivant doit livrer ensemble : intention de gain sur nouvelle vente,
writer PostgreSQL transactionnel, unicité canonique web/POS déjà existante,
allocation explicite produits/livraison des remboursements et journal cumulatif
de correction. Prévoir reprise après commit SQL/ACK Mongo perdu, remboursement
avant/après gain et points déjà consommés, sans dette ni correction tronquée
implicites. La consommation d'une récompense sur une vraie vente reste également
distincte et actuellement fermée. Aucun ancien achat n'est rattaché par téléphone.
