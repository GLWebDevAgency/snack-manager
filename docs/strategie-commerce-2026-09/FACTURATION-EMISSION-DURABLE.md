# Émission durable des factures — procédure de mise en service

Correctif logiciel du 5 septembre 2026. Le test initial reproduisait deux factures d'abonnement pour deux appels concurrents de la même période. Le nouveau chemin réserve en base la période et son identifiant de pièce, puis son numéro annuel. Il ne modifie ni les tarifs, ni les contrats, ni les anciennes pièces, ni la numérotation déjà utilisée.

## Protocole

1. Valider l'instantané avant réservation : identité, nature, dates, période, montants entiers, TVA, libellé et statut stockable. Une période d'abonnement est un mois UTC, quel que soit le fuseau de l'instance ou l'année de son échéance.
2. Vérifier les abonnements actifs historiques. Une pièce existante signifie « déjà facturé » ; plusieurs exigent un rapprochement. Ne jamais supprimer ou sélectionner arbitrairement une pièce historique.
3. `invoiceIssuances._id = tenant:abonnement:YYYY-MM` arbitre la période par unicité native. Son instantané comporte un `_id` de facture préalloué. Une reprise ne change pas ses prix ou son libellé pour refléter une nouvelle demande.
4. La boucle de numérotation lit d'abord le compteur annuel et son `seq`. Si une pièce est en attente, elle l'insère avec `$setOnInsert`, vérifie ses champs immuables puis nettoie `pendingInvoice` par CAS. Sinon, elle vérifie l'existence de la pièce demandée et réserve ensemble `seq + 1` et son instantané par CAS sur le compteur lu.
5. Une réponse réseau perdue conserve cette réservation. La même pièce peut être achevée par un autre appelant, sans nouveau numéro et sans toucher au paiement, à l'envoi ou à l'annulation éventuellement intervenus après insertion.
6. Seule une facture réellement `annulee` autorise le remplacement de sa réservation par comparaison de son ancien identifiant. Un helper retardé n'efface jamais une nouvelle génération et ne ressuscite jamais l'ancienne pièce.

Les lectures critiques imposent le primaire. Les écritures critiques demandent `w: majority`, `j: true` et un délai d'acquittement borné. Un timeout ne prouve pas que l'écriture a échoué : il impose une reprise, jamais une restitution de numéro. Le fonctionnement standalone et la journalisation sont documentés par [MongoDB](https://www.mongodb.com/docs/manual/reference/write-concern/).

## Comportement visible et limites

- Une émission concurrente ou la reprise d'une pièce déjà créée renvoie « déjà facturé » et demande d'actualiser l'historique. Cela ne crée pas une deuxième créance ; la reprise ne prétend pas émettre au nouveau montant demandé.
- Une réservation incohérente, un numéro en collision ou plusieurs factures historiques actives exigent un rapprochement. La passe mensuelle ne les classe pas comme « déjà facturé » : seule `DuplicateInvoiceException` produit cette catégorie.
- L'aide à une réservation peut terminer une facture dont le premier appel a échoué. Le journal administratif actuel est écrit **après** la facture : l'atomicité facture/journal et une outbox d'audit exactement une fois ne sont pas livrées ici. Après interruption, vérifier aussi la présence du geste administratif et consigner le rapprochement sans inventer son auteur initial.
- Les options, installations et avoirs restent volontairement multiples. Cette modification ne fournit pas une clé d'idempotence métier globale à leurs demandes HTTP répétées ni une réservation atomique du plafond des avoirs.
- Le compteur annuel sérialise les allocations de numéros ; boucles bornées et refus temporaire sous contention. Une incohérence bloquante doit être corrigée par rapprochement, pas par purge ou timer.
- Un `pendingInvoice` déjà matérialisé peut rester après une réponse perdue. Le prochain passage au numéroteur le nettoie. Le simple refus préalable d'un doublon d'abonnement n'effectue pas nécessairement ce passage.

## Déploiement contrôlé requis

**Ne pas mélanger l'ancien et le nouveau protocole.** L'ancien writer ne connaît ni `invoiceIssuances`, ni `pendingInvoice` et peut rendre un numéro après erreur. Un déploiement roulant avec émissions en cours ne suffit pas à préserver le nouvel invariant.

1. Conserver `STRIPE_BILLING_CHECKOUT_ENABLED=false`. Prévoir une fenêtre sans émission CRM/conversion/passe mensuelle et arrêter les anciennes requêtes d'émission avant bascule des instances API. Ne pas présenter une simple pause du site public comme une fermeture de la facturation interne.
2. Lire l'historique et les compteurs sur la cible : doublons actifs par tenant/période, unicité des numéros et cohérence du compteur annuel. L'ancien index des périodes reste non unique. Ne pas créer d'index unique ou réparer l'historique sans inventaire et décision sur les cibles exactes.
3. Vérifier CI et tests Mongo réels, déployer les modèles et les trois services ensemble. `CrmModule` doit fournir writer et numéroteur ; `DatabaseModule` enregistre le nouveau modèle par `MODELS`.
4. Vérifier qu'aucun ancien processus API n'émet encore, puis reprendre les gestes de facturation sur un tenant de recette exclusivement. Contrôler le SHA des services et les migrations PostgreSQL selon le flow normal du projet.
5. Recette staging : même période dans deux sessions, réponse interrompue et reprise, annulation puis remplacement, coexistence abonnement/option, aucun seed de facture à la lecture. Utiliser des données de test identifiées, pas des factures destinées à un vrai client.
6. Seulement ensuite configurer et tester le Checkout plateforme avec le compte Stripe de test. Production après validation staging et GO distinct.

Rollback : ne pas réinstaller l'ancien writer sur un registre où des réservations ont été créées. Fermer temporairement les émissions et préférer un correctif en avant. Ne pas décrémenter les compteurs, retirer les claims ou supprimer des pièces pour « débloquer ». Le script `purge-test-invoices.ts` refuse désormais toute exécution sans même ouvrir la base.

## Démonstrations et données

Les méthodes de lecture du registre ne créent plus de factures fictives, même avec `SM_DEMO_SEED=on`. La démo frontend demeure séparée. Aucune ancienne facture n'est effacée par ce changement. Les bases des tests d'intégration doivent être locales, dédiées et identifiées par le préfixe `snackmanager_billing_test_` ; leur nettoyage ne vise jamais une base staging ou production.

## Vérification automatisée

Les tests de service utilisent le writer et le numéroteur réels. Les doublures ne remplacent que les opérations Mongo, avec unicité et comparaisons atomiques explicites. Une suite distincte exerce deux connexions Mongoose sur un MongoDB standalone local : émissions concurrentes, remplacement après annulation, historique ambigu et reprise après interruption aux frontières d'écriture.

La CI démarre sa propre instance Mongo et exécute explicitement cette recette. Sans `BILLING_TEST_MONGO_URL`, les douze scénarios Mongo sont ignorés par la suite générale : une suite générale verte seule ne vaut donc pas recette Mongo. Les dix tests de garde de l'URL restent actifs. Une URI distante ou non dédiée est refusée avant connexion.

Ces preuves ne couvrent ni un paiement Stripe réel ni la coexistence avec un ancien processus de facturation, interdite par la procédure de bascule ci-dessus.

Références : [atomicité documentaire MongoDB](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/), [unicité native et limites des index historiques](https://www.mongodb.com/docs/manual/core/index-unique/), [recette Checkout](STRIPE-FACTURES-STAGING.md).
