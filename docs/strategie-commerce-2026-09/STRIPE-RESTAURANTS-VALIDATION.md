# Paiements restaurants — implémentation et recette

État au 5 septembre 2026 : code et tests locaux, pas une attestation de recette Stripe distante. Aucun compte Stripe réel n’a été modifié par ce chantier et aucun paiement/remboursement réel n’a été déclenché. La facturation des abonnements Snack Manager est un flux distinct de celui documenté ici.

## Choix conservé

Les commandes utilisent les PaymentIntents existants en **charges directes sur le compte connecté du restaurant**, sans commission applicative. Le compte ayant encaissé est conservé sur la commande pour relire son paiement et rembourser sur ce même compte, même si le restaurant raccorde ensuite un autre compte. L’ancien historique encaissé sur la plateforme reste distingué par l’absence de compte connecté ; aucun nouveau paiement restaurant ne se replie sur la plateforme.

## Ajouts de ce lot

- Création de PaymentIntent idempotente par commande ; réutilisation du paiement existant. Une erreur de lecture/mise à jour Stripe, un paiement réussi ou une autorisation en attente ne déclenche plus de nouvelle intention. Seule une intention explicitement annulée peut être remplacée.
- Confirmation webhook liée au compte connecté, à l’identifiant PaymentIntent enregistré et au montant serveur exact en centimes. Un rejeu ne repaye pas une commande remboursée.
- Remboursement partiel ou total avec montant entier, motif, identifiant d’opération et confirmation du mot de passe du propriétaire. Aucun employé ni module RH n’est nécessaire.
- Solde remboursable diminué des remboursements réussis **et en attente**. Un échec bancaire ne devient pas un succès dans l’interface.
- Reprise de la même opération après une réponse perdue, avec idempotence Stripe et recherche de son identifiant dans les métadonnées des remboursements existants.
- Réconciliation des webhooks depuis l’état actuel de Stripe, sans appliquer aveuglément un vieux statut d’événement. Version de synchronisation atomique pour empêcher une réponse concurrente plus ancienne d’écraser la plus récente.
- Actions et lectures isolées par restaurant. Une offre web seule ne donne accès qu’aux commandes du canal en ligne, pas à l’historique POS.
- Back-office : annulation propriétaire, remboursement, état partiel/en attente, adresse et frais de livraison, confirmation de départ. L’annulation et le remboursement sont deux actions séparées, annoncées comme telles.
- Suivi client : uniquement statut/méthode de paiement et montants remboursés/en attente ; ni identifiant Stripe, ni motif interne, ni adresse de livraison dans cette projection publique.

## API propriétaire

Toutes ces routes exigent le rôle propriétaire et la fonction commandes autorisée par l’offre. Les écritures sont limitées en fréquence et revérifient son mot de passe.

| Route | Données | Effet |
| --- | --- | --- |
| `GET /orders/:id/refunds` | session | Relit Stripe et renvoie le solde et les états des remboursements |
| `POST /orders/:id/refunds` | `password`, `reason`, `amountCents`, `operationId` UUID | Demande un remboursement sur le paiement d’origine |
| `POST /orders/:id/cancel-owner` | `password`, `reason` | Annule l’avancement, sans remboursement automatique |

Un identifiant d’opération représente un montant et un motif immuables. Le client doit conserver cet identifiant en cas de réponse réseau perdue. Modifier le montant nécessite une nouvelle opération explicite. Les motifs et identifiants internes sont réservés aux opérateurs autorisés.

## Configuration de recette sandbox

Utiliser uniquement un environnement et des comptes Stripe de test. Les valeurs des secrets ne doivent apparaître ni dans Git, ni dans les captures ou comptes rendus.

1. Configurer `STRIPE_SECRET_KEY` et `STRIPE_PUBLISHABLE_KEY` de test, ainsi que `WEB_PUBLIC_URL` pour le back-office de recette.
2. Raccorder un compte restaurant de test via le parcours Encaissement et confirmer ses droits d’encaissement.
3. Configurer l’endpoint des **comptes connectés** `/public/stripe/webhook/connect` et son `STRIPE_CONNECT_WEBHOOK_SECRET` propre. Événements : `account.updated`, `account.application.deauthorized`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`.
4. Pour l’historique plateforme uniquement, `/public/stripe/webhook` utilise son secret distinct `STRIPE_WEBHOOK_SECRET` et les événements paiements/remboursements pertinents.
5. En local, la transmission des événements Connect nécessite `stripe listen --forward-connect-to localhost:3001/public/stripe/webhook/connect` ; employer le secret indiqué par cette session locale. Ne pas confondre les secrets CLI, sandbox distante et production.

Les fixtures génériques `stripe trigger` avec un simple `metadata.orderId` ne suffisent plus à valider un paiement : le PaymentIntent doit être celui effectivement créé et enregistré par l’application, avec son vrai compte et son montant.

## Recette bout en bout à effectuer avant mise en service

1. Restaurant web seul, propriétaire sans fiche Staff : vérifier accès aux commandes web, menu, créneaux, marque et encaissement ; refus de l’historique POS par URL/API.
2. Créer une vraie commande de test via le module public puis payer sur le compte connecté test. Vérifier montant en centimes, webhook, état payé côté client et back-office.
3. Rafraîchir/rejouer la demande de paiement et les événements : aucun second PaymentIntent exploitable ni seconde transition payée.
4. Rembourser une partie (par exemple 2,50 € sur 12,50 €), vérifier solde 10,00 €, statut payé maintenu, affichage partiel et écriture d’audit.
5. Rejouer la même opération : un seul remboursement. Utiliser le même UUID avec un montant différent : refus.
6. Rembourser le solde : statut remboursé ; vérifier qu’un ancien événement de paiement réussi ne réactive pas la commande.
7. Vérifier remboursements en attente puis échoués/annulés : l’attente réserve le solde ; un échec le libère et n’est pas affiché comme un versement réussi. Rejouer les événements dans un ordre différent.
8. Refus d’un mauvais mot de passe, d’un autre restaurant, d’un rôle non propriétaire, de centimes fractionnaires et d’un montant au-delà du solde.
9. Annuler une commande payée puis rembourser explicitement. L’annulation seule ne signifie jamais que l’argent a été rendu.
10. Livraison payée : préparer, confirmer le départ, marquer livrée ; vérifier adresse/frais au back-office et uniquement les états non nominatifs au suivi public.

## Validation locale et limites

Les suites ajoutées couvrent les montants, remboursements partiels/totaux/en attente/échoués, l’isolation compte/restaurant/canal, la réauthentification propriétaire, les replays, les réponses concurrentes et les pannes de lecture PaymentIntent. Les suites existantes commandes/promotions/webhooks ont été relancées. Les typechecks API et web sont passés sur le worktree intégré au moment de cette vérification.

Cela ne remplace pas la recette Stripe sandbox ci-dessus, les migrations sur la base cible, une inspection visuelle réelle, ni un contrôle des endpoints/secrets du déploiement. La clé d’idempotence Stripe n’est pas une conservation illimitée : un incident où la création d’un PaymentIntent réussit mais où l’enregistrement local échoue durablement requiert une réconciliation opérateur, pas une promesse d’exactement-une-fois éternelle.

Les remboursements ne recalculent pas automatiquement les points fidélité ou les coûts de livraison ; aucune restitution automatique de points n’est annoncée par ce lot. La comptabilisation détaillée des remboursements, les litiges et un rapprochement comptable complet restent des chantiers distincts.

### Lecture des statistiques

Le « CA » existant est un **indicateur brut opérationnel** : somme des totaux des commandes prêtes ou livrées, classées à leur date de création. Il n’est pas un montant bancaire rapproché, ne déduit pas les remboursements partiels/totaux et peut inclure une commande prête encore impayée au comptoir. Les exports conservent le total historique et le statut de paiement ; ils ne constituent pas un journal des mouvements de remboursement. Ne pas présenter ces chiffres comme un chiffre d’affaires net encaissé ou une comptabilité. Changer cette sémantique requiert des indicateurs distincts et datés, pas une modification silencieuse des totaux historiques.

La revue indépendante a ajouté des tests sur chacun des dix chemins de lecture des commandes dans les statistiques : une offre web seule impose `channel: online`, y compris dans l’export. Elle a aussi vérifié les métadonnées réelles des contrôleurs mixtes (routes publiques et administratives), ainsi que la prise en compte d’un retrait de capacité pendant une connexion WebSocket existante. Les routes publiques d’appareils et d’écrans restent authentifiées par leurs jetons propres ; les nouveaux gardes commerciaux de navigation ne doivent pas être confondus avec une révocation automatique de ces jetons historiques.

Références officielles consultées : [charges directes et remboursements](https://docs.stripe.com/connect/direct-charges#issue-refunds), [cycle de vie des remboursements](https://docs.stripe.com/refunds), [webhooks](https://docs.stripe.com/webhooks), [liste des remboursements par PaymentIntent](https://docs.stripe.com/api/refunds/list).
