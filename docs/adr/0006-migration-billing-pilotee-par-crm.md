# ADR 0006 — Inscrire la migration Stripe Billing au chantier commerce

- **Statut** : acceptée pour préparation et implémentation progressive ; non implémentée, non activée.
- **Date** : 05/09/2026.
- **Décideur** : le fondateur, demande « ajoute cela au travail en cours ».
- **Relation** : complète l'[ADR 0005](0005-facturation-stripe-billing-ou-maison.md). Remplace son report de préparation à M9, pas ses principes de séparation métier/encaissement ni les conditions de mise en production.

## Contexte

Le fondateur développe seul avec un budget limité. Après comparaison des frais et de la charge de maintenance, il ajoute au travail en cours une migration vers Stripe Billing/Invoicing, pilotable depuis le CRM.

Le code actuel n'est pas déjà une intégration Billing : `apps/api/src/modules/billing/invoice-checkout.gateway.ts` crée un Checkout `mode: payment` pour une facture SM existante, avec `invoice_creation: false`. `InvoiceWriterService` et `InvoiceNumberingService` sécurisent l'émission locale ; `BillingService.runMensuel` reste son geste d'émission périodique. Ces protections restent nécessaires tant que ce moteur émet.

Le CRM et ses règles se conservent. Les abonnements Stripe, leurs correspondances locales et la synchronisation complète de leur cycle de vie restent à construire. Cette décision n'est ni une migration de données réalisée ni une promesse commerciale de disponibilité.

## Décision

**Stripe devient le moteur de facturation des contrats migrés ; le CRM reste l'interface quotidienne.**

- Billing pour les abonnements Snack Manager ; Invoicing pour les prestations ponctuelles migrées. Pas de boucle de renouvellement maison avec PaymentIntents.
- Conserver chez nous les offres, devis, combinaisons de modules, conditions négociées et règles d'accès. Les références de prix Stripe sont une traduction versionnée des conditions vendues, pas un deuxième catalogue métier autonome.
- Piloter depuis le CRM les souscriptions, changements d'offre, échéances, résiliations, factures, avoirs et suivi des impayés. Présenter explicitement les opérations en cours ou à rapprocher, sans faux succès local.
- Proposer le SEPA pour les abonnements B2B et la carte en alternative. Mandat et saisie du moyen de paiement passent par les surfaces sécurisées Stripe ; aucune donnée bancaire brute dans notre CRM. Une confirmation SEPA différée n'est pas assimilée à un paiement encaissé.
- Maintenir les paiements des commandes restaurant sur leur circuit Connect actuel. La migration Billing n'ajoute pas ses frais aux repas et ne résout pas la course distincte annulation/PaymentIntent des commandes.
- Limiter les développements supplémentaires du moteur maison à la sécurité, aux corrections et à l'exploitation indispensable. Ne pas y construire une deuxième automatisation de renouvellement, de relance ou de proration.

Les actions courantes restent dans le CRM. Le Dashboard Stripe reste accessible pour la configuration financière et les investigations ; ne pas promettre de reproduire toutes ses fonctions.

## Ordre et périmètre des lots

La fermeture de la course annulation/paiement des commandes reste prioritaire. La migration est un lot distinct du correctif commerce en cours, avec ses propres commits et PR ; elle n'est pas une condition implicite ajoutée à la fusion de toute la PR commerce.

| Lot | Livrable | Preuve de sortie attendue |
| --- | --- | --- |
| B1 — Contrats et correspondances | Moteur émetteur par contrat, références Stripe, date de bascule, traduction des montants et échéances ; audit du catalogue cible avant création | Comparaison au centime des contrats simples, fondateurs, annuels et mixtes ; anciennes pièces inventoriées sans écriture ; routage vers un émetteur unique prêt avant B2 |
| B2 — Abonnement simple en sandbox | Adaptateur Billing, création depuis CRM, parcours carte/SEPA, synchronisation persistée et reprise | Double clic, réponse perdue et rejeu ne créent qu'une obligation ; vraie recette Stripe test, pas seulement des doublures |
| B3 — Cycle commercial complet | Changements d'offre, options, essais, remises, résiliation et règles d'impayés ; affichage et permissions CRM | Prorations prévisualisées, dates et consentements explicites, webhooks retardés/désordonnés et paiements asynchrones testés |
| B4 — Prestations et historique | Invoicing, avoirs/remboursements autorisés, historique unifié des deux sources, arrêt de l'émission locale pour les obligations migrées | Aucun numéro réutilisé, aucune créance historique réémise, aucune double émission ou double relance |
| B5 — Recette et bascule | Contrat pilote sur staging, rapprochement, supervision et procédure de reprise ; préparation live séparée | CI verte, staging validé, identité/paramètres Stripe et numérotation vérifiés ; production uniquement après GO distinct |

Les contrats complexes ne migrent pas tant que leur équivalence n'est pas prouvée. En particulier : remise fondateur **en montant figé avec sa date de fin**, logiciel annuel à dix mensualités, services Atelier restant mensuels, démarrage après essai. Choisir la structure des objets Stripe après validation de ces échéanciers, sans imposer un intervalle unique artificiel ni recopier les anciens paramètres de coupon sans contrôle.

## Invariants et critères de réception

- Un seul émetteur par obligation commerciale/période. La coexistence de pièces historiques et de pièces Stripe est autorisée ; deux moteurs émettant la même échéance ne le sont pas. Fermer tous les chemins locaux concernés, pas seulement le bouton de passe mensuelle.
- Identité du compte plateforme, environnement test/live, tenant, contrat, devise et montants vérifiés avant toute mutation. Aucune confusion avec le compte Connect du restaurant.
- Enregistrer l'intention d'une opération avant appel fournisseur ; idempotence, reprise après réponse inconnue et rapprochement explicite. Ne jamais créer une deuxième souscription pour contourner un timeout.
- Webhooks signés, dédoublonnés, traités sans dépendre de leur ordre ; relecture fournisseur et reprise des événements manquants. Ni le retour navigateur ni le seul statut d'abonnement ne prouvent l'encaissement d'un paiement différé.
- Définir et tester la politique d'impayés et de grâce avant activation. Séparer droits commerciaux, paiement en cours et suspension administrative : un webhook payé ne lève pas une suspension de sécurité.
- Conserver numéros, pièces/PDF et règlements historiques. Identifier leur source dans les projections ; ne pas recréer les anciennes factures comme de nouvelles créances Stripe. Définir la coupure de numérotation avant bascule et préserver les pièces déjà remises : début d'exercice ou préfixe distinct validé, conformément à l'ADR 0005.
- Une panne après début de bascule ne réactive pas aveuglément l'ancien émetteur. Suspendre l'opération incertaine, rapprocher les deux systèmes, puis reprendre le même travail.
- Garder autorisations, confirmations et journal des opérations financières dans le CRM. Recette requise pour mauvais tenant/rôle, double geste, crédit/remboursement concurrent et modification faite depuis Stripe.

La validation de l'identité de l'entreprise, des mentions de facture, de la TVA, de la numérotation et des besoins de facturation électronique reste un prérequis de mise en service, pas une conformité supposée par l'usage de Stripe.

## Options écartées et conséquences

**Tout conserver en interne** évite les frais Billing et offre une maîtrise fine ; écarté pour les nouvelles automatisations car le renouvellement, les impayés et leurs reprises mobilisent durablement le développeur seul. Le moteur local sécurisé reste exploité pour les obligations non migrées.

**Tout gérer uniquement dans le Dashboard Stripe** minimise l'interface à développer ; écarté pour les opérations quotidiennes car les conditions vendues, les services à produire et les droits restent dans le CRM.

**Basculer tous les contrats d'un coup** raccourcit la coexistence ; écarté avant preuve sur les échéanciers mixtes et rapprochement historique. La migration progressive coûte une gestion temporaire des deux sources, mais pas deux émissions concurrentes.

Tarifs publics vérifiés le 5 septembre : Billing à l'utilisation **0,7 %** du volume Billing ; Invoicing Starter **0,4 %** par facture ponctuelle payée, en plus de l'encaissement. Budgéter séparément paiement, facturation et options ; contrôler les conditions effectives du compte avant activation. Aucun nouveau service payant, prix Stripe, abonnement, mandat ou paiement n'est activé par cette décision. Sources : [Billing](https://stripe.com/fr/billing/pricing), [Invoicing](https://stripe.com/fr/invoicing/pricing).

## Comment on saura qu'on s'est trompé

- Une seule double émission, un montant divergent ou une mauvaise période sur le pilote bloque l'élargissement.
- Un scénario commercial courant nécessite encore une action quotidienne dans deux interfaces : revoir le périmètre de l'adaptateur CRM avant généralisation.
- Une opération financière reste sans rapprochement plus de 24 heures lors de la recette : ne pas ouvrir la production sans procédure de détection/reprise démontrée.
- Après trois mois d'usage, comparer les frais effectifs et le temps de maintenance à l'hypothèse de départ ; rouvrir l'arbitrage si l'économie de maintenance n'est pas démontrée.

Suivi opérationnel : [suite du chantier commerce](../strategie-commerce-2026-09/SUITE-APRES-COMMERCE.md). Références techniques : [cycle de vie asynchrone des abonnements](https://docs.stripe.com/billing/subscriptions/webhooks), [mandats et paiements SEPA](https://docs.stripe.com/payments/sepa-debit).
