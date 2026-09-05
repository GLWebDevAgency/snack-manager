# Paiement des factures Snack Manager — recette sandbox

## Ce qui est livré

Pont de paiement **ponctuel** d'une facture Snack Manager déjà émise : Checkout hébergé Stripe, carte, EUR, montant TTC dérivé du montant et du régime TVA figés sur la facture. Le repli documenté des anciennes factures est conservé ; aucune migration ni nouvelle numérotation. `invoice_creation` est désactivé ; aucun document Stripe Invoicing n'est généré. Les paiements de commandes restaurant restent sur les comptes Connect et n'utilisent pas ce flux.

La confirmation passe exclusivement par un webhook signé, puis relit la session sur le compte plateforme. Concordance obligatoire de la session enregistrée, facture, tenant, devise, montant, mode et environnement Stripe. La transition vers `payee` et les références Stripe sont atomiques ; les rejouements n'effectuent aucune seconde transition. Aucun paiement ne réactive automatiquement un compte suspendu ni ne modifie ses droits.

Le propriétaire peut ouvrir le paiement depuis « Abonnement », y compris pendant une suspension commerciale. Son identité, son rôle et la validité de sa session sont néanmoins relus. Le comptable conserve la lecture mais ne paie pas via cette route. Une facture brouillon, annulée, déjà réglée, un avoir ou un montant inférieur au minimum carte ne peut pas ouvrir Checkout.

## Configuration staging, jamais de clé live pour cette recette

1. Utiliser un compte Stripe en environnement de test/sandbox appartenant à Snack Manager. Vérifier le mode du compte avant toute action de configuration. Ce développement n'a créé ni paiement ni endpoint Stripe réel.
2. API : `STRIPE_SECRET_KEY` = clé secrète **test** plateforme déjà utilisée par l'intégration ; ne pas placer de secret côté navigateur.
3. API : `STRIPE_BILLING_RETURN_URL=https://<hôte-back-office-staging>/admin/abonnement`. URL HTTPS fixe, aucun paramètre ni fragment, jamais une URL fournie par le client.
4. Créer un endpoint Stripe de **compte plateforme**, distinct des événements Connect : `https://<hôte-api-staging>/public/stripe/billing/webhook`.
5. Souscrire `checkout.session.completed` et `checkout.session.async_payment_succeeded`. La version doit être compatible avec le SDK installé (Stripe 22.5.0 / API 2026-07-29.dahlia au moment de ce lot). Ne pas reprendre une version datée d'un ancien guide sans contrôle.
6. API : `STRIPE_BILLING_WEBHOOK_SECRET` = secret de cet endpoint exact. Il ne remplace ni le secret des commandes ni celui des comptes Connect.
7. Vérifier l'accès public de l'endpoint, la conservation du corps brut Nest, l'horloge serveur et l'absence de règle proxy transformant le corps/signature.
8. Activer `STRIPE_BILLING_CHECKOUT_ENABLED=true` seulement lorsque les étapes précédentes sont prêtes. Sans le flag, clé, secret ou URL valide, le bouton n'est pas proposé et la création de session est refusée.

En local, Stripe CLI peut transférer ces événements vers l'endpoint API local ; employer le secret `whsec_…` de cette écoute, distinct du secret staging. Le navigateur revient sur l'URL HTTPS configurée du back-office de test. Ne jamais copier les secrets dans tickets, commits, captures ou logs.

## Scénarios de réception

- Créer une facture sandbox émise, positive et à TVA connue. Comparer au centime le TTC du PDF, du tableau et de Checkout. Un prix d'abonnement HT n'est pas le montant à payer.
- Propriétaire du bon tenant : le bouton ouvre Stripe. Comptable, cogérant, tablette, session révoquée et tenant voisin : refus sans fuite de facture.
- Double clic / deux onglets : une même génération de Checkout, pas deux liens de paiement actifs. Revenir sans payer puis reprendre : même session tant qu'elle est ouverte.
- Expiration effective Stripe : un nouveau Checkout peut être créé à partir de la génération précédente. Pas de nouvelle facture SM.
- Réaliser le paiement avec un moyen de test officiel Stripe. Attendre le webhook, puis actualiser : statut payé, moyen carte, date et références session/intent/event. Le numéro et les montants de la facture ne changent pas.
- Rejouer l'événement puis envoyer un événement d'échec tardif : aucune seconde transition ni retour à « impayée ».
- Tester un événement signé mais référence/montant/devise erronés : aucune facture soldée ; réponse non-2xx à investiguer. Une signature invalide renvoie 400.
- Retour navigateur sans webhook : ne pas afficher « payé » sur la seule URL. Le message invite à actualiser ; fermer le navigateur n'empêche pas la confirmation serveur.
- Paiement/annulation manuel CRM pendant Checkout ouvert : le service expire d'abord la session, la relit, puis compare l'état de la facture avant mutation. Si Stripe a déjà encaissé ou si une nouvelle session a gagné la course, le geste manuel est refusé.
- Paiement d'une facture d'un compte suspendu : facture soldée, compte toujours suspendu jusqu'à décision séparée du support.
- Vérifier également le règlement des commandes restaurant : ce lot ne doit changer ni leurs comptes Connect ni leurs webhooks.

## Exploitation et limites explicites

### Invariant de facturation — correctif logiciel, activation toujours fermée

La faille préexistante a été reproduite par un test : deux émissions simultanées créaient deux factures pour la même échéance. Le correctif remplace cette recherche/création par `InvoiceWriterService` : une réservation persistée à identifiant unique tenant/abonnement/période UTC, un identifiant de pièce et un instantané figés. Une annulation confirmée autorise le remplacement par comparaison atomique de l'ancienne génération. Plusieurs pièces actives historiques provoquent un incident explicite, pas un choix arbitraire.

L'invariant métier reste au plus un abonnement non annulé par tenant et période ; options, avoirs et mises en place peuvent légitimement cohabiter. Aucun index unique n'est ajouté à l'historique non audité. La création de factures de démonstration à la lecture est retirée, même avec `SM_DEMO_SEED=on` ; aucune facture déjà stockée n'est supprimée.

`InvoiceNumberingService` conserve le numéro et la pièce en cours dans le même compteur annuel. Une autre instance peut achever l'insertion conditionnelle puis nettoyer cette réservation ; aucun décrément, expiration de bail ou réécriture d'une facture déjà réglée/annulée. Lectures primaires, écritures acquittées sur journal disque. Ce protocole fonctionne sur Mongo standalone, configuration observée sur staging, sans imposer un nouveau replica set. Le script historique de purge/remise à zéro est retiré pour ne pas invalider ces réservations.

**Checkout reste désactivé avant recette et déploiement contrôlé.** Tous les anciens écrivains doivent être arrêtés avant les nouveaux : l'ancien code ignore les réservations et peut décrémenter le compteur. Les tests locaux, y compris Mongo réel, ne remplacent pas cette condition de mise en service, l'audit de l'historique ni la recette Stripe sandbox. Voir [procédure et limites de reprise](FACTURATION-EMISSION-DURABLE.md).

La course distincte `send()` / annulation est corrigée dans ce lot : l'envoi ne réussit que si la pièce appartient toujours au même tenant et reste `brouillon` au moment de l'écriture. Le test empêche de ressusciter une facture annulée.

Chaque règlement conserve `stripeCheckoutSessionId`, `stripePaymentIntentId`, `stripePaymentEventId` sur la facture. Une erreur de concordance est un incident de rapprochement, pas une raison de modifier les montants pour faire passer le webhook. Les livraisons Stripe non-2xx doivent être surveillées et rejouées après correction. En cas d'écriture locale échouée après création Checkout, la même clé d'idempotence récupère la session ; aucune URL n'est rendue avant son rattachement à la facture.

Remboursements plateforme, contestations, rapprochement bancaire automatisé et journal CRM dédié aux événements système restent des chantiers distincts. Ne pas annuler une facture réglée pour simuler un remboursement ; conserver le processus d'avoir et un rapprochement explicite avec Stripe. Les quatre références persistées ne remplacent pas un suivi opérationnel des échecs de webhook.

L'[ADR 0005](../adr/0005-facturation-stripe-billing-ou-maison.md) prévoit une bascule ultérieure vers Stripe Billing. Les abonnements, prélèvements récurrents, prorations, Customer Portal et relances automatiques ne sont **pas** activés dans ce lot : il faut d'abord décider de la coupure de numérotation, migration des contrats/remises, source d'échéance et traitement des anciennes pièces. Aucun renouvellement manuel par PaymentIntent n'est ajouté.

Correctif associé : l'émission manuelle CRM sans montant explicite utilise désormais l'échéancier, et non le MRR normalisé. Un contrat annuel est facturé pour son échéance annuelle ; hors anniversaire seuls ses services mensuels sont dus. Une facturation exceptionnelle reste possible via un montant explicite tracé.

Sources techniques vérifiées : [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhooks](https://docs.stripe.com/webhooks), [confirmation Checkout](https://docs.stripe.com/payments/checkout/fulfill-orders). Les tests locaux utilisent des doublures et un HMAC de test ; aucune recette Stripe sandbox/staging n'a encore été exécutée par cet agent.
