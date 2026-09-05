# Stripe — état distant vérifié le 5 septembre 2026

Audit en lecture seule via Stripe CLI et Railway. Aucune clé, donnée de carte, identité client ou valeur de secret n'est consignée ici. Aucun compte, endpoint, paiement, remboursement ni variable distante n'a été créé ou modifié pendant cet audit.

## Observations

| Périmètre | Vérification | Conséquence |
| --- | --- | --- |
| Staging API | Clés secrète/publique de test présentes ; compte obtenu par la clé Railway identique à celui du CLI, nommé « Environnement de test Snack Manager » | Pas de mélange test/live observé pour ces deux clés. Leur présence ne prouve pas la recette. |
| Compte plateforme de test | `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false` | Le paiement des factures sur la plateforme ne peut pas être déclaré prêt. Ne pas assimiler cet état à celui des restaurants Connect. |
| Comptes connectés de test | Quatre comptes : trois avec exigences d'onboarding en retard et encaissement désactivé ; un avec encaissement/versements activés et aucune exigence actuellement due | Classfood est rattaché à l'un des comptes non finalisés, pas au compte fonctionnel. Ne pas remplacer son rattachement arbitrairement. |
| Webhooks test | Deux endpoints activés vers l'API staging : commandes historiques plateforme et Connect. Un ancien endpoint Connect identique est désactivé | Réutiliser les endpoints actifs ; conserver l'ancien désactivé tant que son historique n'a pas été rapproché. |
| Événements Connect | `account.updated`, `account.application.deauthorized`, `payment_intent.succeeded`, `payment_intent.payment_failed` | Les événements de remboursement du nouveau code ne sont pas souscrits. |
| Événements plateforme historiques | `payment_intent.succeeded`, `payment_intent.payment_failed` | Même complément de remboursements à prévoir si cet historique est concerné. |
| Factures Snack Manager | Aucun endpoint dédié `/public/stripe/billing/webhook`. Secret dédié et URL de retour absents, flag Checkout non défini sur staging et production | Le nouveau Checkout reste désactivé. Ne pas réutiliser le secret Connect. |
| Catalogue du compte de test | Zéro produit et zéro prix ; listes complètes (`has_more=false`) | Ce constat ne dit rien du catalogue live. Ne pas dupliquer une offre supposée manquante en production. Le Checkout ponctuel de facture n'exige pas un catalogue récurrent. |
| Production API Railway | `STRIPE_SECRET_KEY` et `STRIPE_PUBLISHABLE_KEY` absentes ; secrets de webhook historiques/Connect présents | L'encaissement en ligne n'est pas prêt à être activé sur ce service. La présence des secrets ne prouve pas l'existence ni le bon rattachement d'endpoints live. |
| Accès Stripe live | CLI refuse : authentification live à reconfigurer | Catalogue, comptes, webhooks, versements et identité juridique live **non audités**. Reconnexion officielle requise ; aucune clé à coller dans une conversation. |

L'URL des endpoints test est `https://api-staging-a5e8.up.railway.app/public/stripe/webhook`, avec suffixe `/connect` pour Connect. Les endpoints v1 listés n'imposent pas une version explicite (`api_version=null`) : contrôler la version effective du compte et la compatibilité SDK avant modification ; ne pas choisir une version ancienne par habitude.

Complément de lecture ciblée : la projection `slug/name/encaissement` de Classfood en Mongo staging donne le compte `acct_1U90sl3ZvR0kqbr0`. Sa relecture Stripe avec la clé de test de l'API confirme les trois indicateurs désactivés et `requirements.past_due`. Aucun changement de rattachement ni acceptation de conditions n'a été réalisé. Le diagnostic Mongo `hello` retourne `setName=null`, `isWritablePrimary=true`, `msg=null` : aucune prise en charge de transactions multi-documents par replica set n'est établie sur cette cible.

## Ordre recommandé

1. Fermer les invariants logiciels bloquants : émission unique d'une échéance de facture ; réservation/annulation d'une commande en cours de paiement ; encaissement explicite d'une commande existante. Voir les notes liées ci-dessous. Ni un webhook ajouté ni un test carte réussi ne ferment ces courses concurrentes.
2. Fusionner le code approuvé dans `develop`, vérifier CI/migrations puis SHA de l'API, web, POS et KDS sur staging. Les nouveaux handlers doivent être déployés avant la recette distante.
3. Rapprocher le compte Connect de Classfood en lecture seule puis terminer son onboarding **de test** par le parcours prévu. Ne jamais accepter des conditions juridiques ou inventer une identité pour terminer un compte réel.
4. Ajouter aux endpoints concernés les événements `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, en conservant les événements existants et leurs secrets. Vérifier ensuite réception et rapprochement sur une commande effectivement créée par l'application.
5. Créer uniquement l'endpoint plateforme dédié aux factures, si toujours absent après relecture : `checkout.session.completed`, `checkout.session.async_payment_succeeded`. Injecter son secret par le gestionnaire de secrets ; garder le flag fermé jusqu'à résolution de l'émission concurrente et recette.
6. Recette Stripe sandbox : paiement réussi/refusé, authentification forte, réponse perdue et reprise, webhook retardé/doublé, remboursement partiel/total, mauvais tenant/compte/montant, retour navigateur sans webhook. Aucun débit réel nécessaire.
7. Reconnecter le compte live et auditer sa configuration existante avant de proposer sa préparation. Activation production distincte, après staging et nouveau GO explicite.

Ne pas activer maintenant prélèvements récurrents, Stripe Invoicing, Customer Portal ou migration de contrats. Le CRM reste la source des factures dans ce lot ; la bascule Billing exige une décision de migration et de numérotation. Les charges directes restaurants et les factures plateforme restent séparées.

Références : [recette restaurants](STRIPE-RESTAURANTS-VALIDATION.md), [factures et invariant bloquant](STRIPE-FACTURES-STAGING.md), [réservations impayées](RESERVATIONS-IMPAYEES.md), [webhooks Stripe](https://docs.stripe.com/webhooks), [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create).
