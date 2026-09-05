# Réservations impayées — conception du prochain lot

État au 5 septembre 2026. **Proposition d’architecture, non implémentée.** Cette note résulte d’une lecture du code du worktree commerce et de la documentation Stripe ; elle ne constitue ni une recette de paiement réel ni une procédure d’expiration déjà exploitable.

Décision recommandée : ne pas ouvrir la livraison à un service soutenu avant une expiration avec état durable et réconciliation bancaire. Un délai de dix minutes rend une commande éligible à un examen ; il ne prouve jamais qu’elle est impayée.

## 1. Risque actuel, vérifiable dans le dépôt

| Point existant | Conséquence |
| --- | --- |
| `SlotsService.countPerSlot` compte les commandes dont le statut n’est pas `cancelled`, sans filtre de paiement. | Une commande abandonnée avant paiement occupe une place cuisine et une place livraison. Elle ne disparaît du créneau qu’après annulation ; aucune expiration de réservation n’est implémentée. |
| `OrdersController.createOnline` contrôle le créneau sous verrou, puis persiste la commande avant `PaymentsService.createIntent`. | La commande persistée matérialise aujourd’hui la place occupée ; aucun objet de réservation autonome n’existe. Enregistrement et début du paiement sont deux étapes distinctes. |
| `createIntent` appelle Stripe puis enregistre l’identifiant de PaymentIntent sur la commande. | Après panne d’écriture ou perte de réponse, l’absence d’identifiant local ne prouve pas l’absence de PaymentIntent chez Stripe. |
| `createIntent` vérifie l’état au début ; les annulations propriétaire/PIN modifient la commande séparément. | Une annulation peut croiser une création/confirmation de paiement déjà en cours. Annuler localement ne révoque pas un `client_secret` déjà remis au client. |
| Le webhook confirme le compte, l’intention et le montant, puis applique le paiement sur `payment.status: pending`. | Un paiement réellement réussi doit être rapproché, y compris après un retard de webhook. Le statut local `pending` ne constitue pas une preuve bancaire. |
| Le verrou Redis public protège la création sur un créneau, pas le cycle PaymentIntent/annulation. | Un second verrou Redis seul, ou un booléen mémoire dans un worker, ne résout pas la reprise après crash et les courses entre instances. |

Sources locales : [créneaux](../../apps/api/src/modules/ordering/slots.service.ts), [création publique](../../apps/api/src/modules/orders/orders.controller.ts), [paiements](../../apps/api/src/modules/ordering/payments.service.ts), [annulations](../../apps/api/src/modules/orders/orders.service.ts), [verrou actuel](../../apps/api/src/modules/orders/public-order-gate.ts).

À proscrire : exclure des compteurs toutes les commandes `pending` de plus de dix minutes ; supprimer les commandes par index TTL ; marquer une commande annulée avant confirmation d’annulation bancaire ; recréer un PaymentIntent sur erreur réseau ; déduire l’absence de débit de l’absence de webhook.

## 2. Périmètre et politique métier proposés

Premier lot limité aux **nouvelles commandes `online + delivery`** marquées explicitement comme éligibles à cette politique. Ne pas expirer les commandes POS, téléphone ou retrait réglables au comptoir. Ne pas appliquer rétroactivement une échéance déduite aux anciennes commandes : les recenser et les traiter comme un historique à rapprocher.

- Réservation nominale : dix minutes depuis la création serveur, sans prolongation par rafraîchissement, rejeu `clientId` ou nouvelle tentative de carte. Balayage proposé toutes les soixante secondes, lots bornés, reprises avec temporisation croissante.
- La grille livraison doit intégrer ce budget de paiement **en plus** du délai préparation/transport, ou garantir une échéance de paiement compatible avec l’heure promise. Un créneau situé à seulement quarante-cinq minutes ne peut pas offrir dix minutes de paiement puis promettre encore quarante-cinq minutes de préparation/livraison.
- Le serveur fournit `paymentDeadlineAt` ; le compte à rebours client n’est qu’une aide. À échéance, les nouvelles demandes de paiement sont fermées ; les confirmations déjà engagées restent à réconcilier.
- Tant que le résultat bancaire est incertain, conserver la réservation et afficher « Vérification du paiement ». Ne jamais afficher « non débité » sans preuve.
- `processing` et `requires_capture` ne sont pas auto-annulés dans cette première version. Une alerte opérationnelle et une décision sur la remise/refund prennent le relais si le délai de service est dépassé.
- Examiner les moyens de paiement réellement activés : le code actuel utilise `automatic_payment_methods`. Le pilote doit limiter explicitement son offre aux moyens compatibles avec une préparation immédiate, sans supposer que tous les moyens sont synchrones. Stripe documente des traitements asynchrones potentiellement longs. [Cycle PaymentIntent](https://docs.stripe.com/payments/paymentintents/lifecycle).

## 3. Architecture minimale durable

Conserver le monolithe et **MongoDB, qui porte déjà les commandes**. Ni déplacement vers PostgreSQL, ni nouveau broker requis pour ce lot. Le patron de worker fidélité est réutilisable pour la cadence et l’arrêt propre, pas comme preuve que la logique paiement est déjà sûre : [outbox fidélité](../../apps/api/src/modules/loyalty/loyalty-order-earn.processor.ts).

### Agrégat commande et tentative bancaire

Ajouter un sous-document privé `checkoutReservation` dans `OrderSchema`, créé atomiquement avec la commande. Proposition de champs à préciser par les contrats et tests :

| Donnée | Rôle |
| --- | --- |
| `policyVersion`, `deadlineAt` | Distinguer les nouvelles commandes éligibles, figer l’échéance et permettre un déploiement progressif. |
| `state` : `reserved`, `payment_pending`, `closing`, `confirmed`, `expired`, `review_required` | État de réservation distinct du statut cuisine et du statut de paiement. `closing` conserve la capacité. |
| `attemptId`, `generation`, `stripeAccountId`, `amountCents`, `currency`, paramètres de création immuables | Décrire la tentative **avant** le premier appel réseau, avec sa clé d’idempotence stable et son compte d’origine. |
| `requestStartedAt`, `paymentIntentId`, `lastProviderStatus`, `providerCheckedAt` | Distinguer « aucun appel bancaire commencé » de « appel commencé, résultat inconnu ». |
| `operationId`, `leaseToken`, `leaseUntil`, `revision`, `nextAttemptAt`, `attemptCount`, `lastErrorCode` | Attribution atomique du travail, reprise bornée, rejet des écritures d’un ancien worker. Le bail n’est pas la règle métier. |
| `closedAt`, `closeReason`, effets à publier | Preuve de fermeture et intentions d’audit/notification enregistrées avec la transition métier. |

Ne pas stocker de données de carte ni de secret Stripe dans cet état ; garder les champs techniques hors des projections publiques, du ticket et des événements POS/KDS. Les références de paiement existantes restent la source consommée par remboursement et suivi, sans copies divergentes.

Index non-TTL sur l’état/échéance de travail, et sur les baux à reprendre. Utiliser des écritures atomiques conditionnelles `findOneAndUpdate` avec état attendu, révision et token de bail. Toutes les mises à jour concurrentes, y compris webhook, doivent faire évoluer la même version ; `optimisticConcurrency` sur `save()` ne protège pas à lui seul les `findOneAndUpdate` bruts.

### Un seul protocole pour ouvrir et fermer le paiement

1. `createIntent` relit la commande et gagne un CAS autorisant une tentative sur réservation ouverte, avant échéance. Il fige les paramètres, l’identité du compte et la génération avant Stripe.
2. Avant de commencer la requête Stripe, il marque durablement `requestStartedAt` sous les mêmes gardes. Si le worker d’expiration a gagné, aucune création bancaire ne doit démarrer.
3. La création utilise toujours la clé et les paramètres de cette tentative. Son résultat est rattaché par CAS. Le serveur ne remet le secret au navigateur qu’après rattachement et relecture de l’état ouvert. Un retour arrivé pendant `closing` est confié à la réconciliation, jamais exposé comme nouveau paiement disponible.
4. Le worker d’expiration gagne le CAS vers `closing`. Cette décision durable empêche les nouvelles tentatives même après expiration de son bail. Elle ne supprime ni commande ni capacité.
5. Il résout la tentative connue auprès de Stripe puis décide selon la table ci-dessous. Une reprise récupère **la même opération**, pas une génération fraîche.

Point critique : un bail/fencing token protège Mongo, pas un appel Stripe déjà en vol. Tous les travailleurs utilisent le même identifiant de tentative, la même clé bancaire et les mêmes paramètres ; un ancien travailleur ne peut ni publier son secret ni écraser le résultat courant. L’expiration d’un bail ne prouve jamais qu’aucun appel externe n’a eu lieu.

### Tentative commencée mais identifiant Stripe absent

Récupérer le résultat de la même création par rejeu idempotent, uniquement dans une fenêtre de reprise conservatrice, proposée à une heure, avec les paramètres immuables. Si l’appel initial n’était pas parti, ce rejeu peut créer une intention : ne jamais la confirmer ou exposer son secret, la rattacher puis l’annuler avant de libérer la place. Une réponse ambiguë conserve `closing` ou `review_required`.

La clé Stripe n’est pas un registre éternel : Stripe peut purger les clés après au moins vingt-quatre heures et conserve aussi certains résultats d’erreur. Au-delà de la fenêtre de reprise choisie, **ne pas rejouer aveuglément une création** ; rapprocher les événements/objets du compte et escalader. Une recherche sans résultat ne devient pas une preuve absolue d’absence. [Idempotence Stripe](https://docs.stripe.com/api/idempotent_requests).

### Décision après relecture du fournisseur

| Observation | Action proposée | Capacité |
| --- | --- | --- |
| Aucune tentative commencée, garanti par l’état durable et le CAS commun | Annulation locale atomique, fermer toute ouverture future | Libérée au commit |
| `requires_payment_method`, `requires_confirmation`, `requires_action` | Demander `cancel` avec motif `abandoned`, puis vérifier une réponse terminale `canceled` | Conservée jusqu’à cette preuve |
| `canceled` déjà observé | Finaliser l’expiration locale idempotente | Libérée au commit |
| `succeeded` | Appliquer le même cas d’usage de rapprochement que le webhook ; ne pas recréer de débit | Conservée ; commande payée |
| `processing`, `requires_capture` | Recontrôler et alerter selon l’âge ; pas d’auto-annulation dans le pilote | Conservée |
| Erreur, délai réseau, compte déconnecté, incohérence compte/montant/devise, tentative introuvable non expliquée | Reprise bornée puis revue opérateur | Conservée |

Le `cancel` peut perdre la course contre une confirmation : relire Stripe après le refus et appliquer son état réel. Seule la confirmation terminale d’annulation empêche les charges ultérieures sur cette intention. Stripe accepte aussi certains autres cas d’annulation ; ne pas les activer implicitement dans notre politique conservatrice. [API d’annulation](https://docs.stripe.com/api/payment_intents/cancel).

Tous ces appels utilisent **le compte connecté figé sur la tentative**, pas le compte actuel du restaurant et jamais la plateforme par défaut. [Portée des charges directes](https://docs.stripe.com/connect/direct-charges?platform=web&ui=elements).

### Finalisation, promotion et événements

- Le commit terminal met ensemble réservation `expired`, commande `cancelled`, historique, preuve de fermeture et effets à publier. `SlotsService` continue à compter `closing` et les cas incertains ; ne pas y introduire de filtre basé sur l’âge.
- Le rapprochement payé contrôle compte, intention, génération, devise et montant exact. Extraire un cas d’usage partagé par webhook et worker ; ne pas fabriquer de faux événement signé. Un résultat tardif incompatible avec une fermeture antérieure devient un incident financier, pas une remise en cuisine silencieuse.
- L’annulation manuelle d’une commande ayant un paiement en cours doit emprunter le même protocole. La confirmation propriétaire/PIN demeure, mais ne remplace pas la fermeture bancaire.
- Décider explicitement de la restitution du quota promotion : une annulation de commande existante ne le restitue pas aujourd’hui. Pour une restitution automatique exactement une fois, mutation commande/promotion et marqueur de compensation doivent être dans une **transaction Mongo** ; vérifier le support replica set sur la cible avant de choisir cette voie. Aucun appel Stripe dans cette transaction. Si cette condition manque, conserver provisoirement le quota et signaler la compensation à traiter ; ne pas décrémenter en boucle « best effort ».
- Audit et notification sont des effets durables avec identifiant d’événement idempotent. Une panne Redis ne remet pas la réservation en attente. Le consommateur doit tolérer un rejeu après publication suivie d’un crash.

## 4. Points de patch du prochain lot

| Zone | Modification attendue |
| --- | --- |
| `packages/domain/src/ordering/` | Politique pure d’éligibilité/décision et états de réservation, horloge injectée ; aucun SDK Stripe. |
| `packages/contracts/src/ordering.ts` et `packages/db/src/schemas.ts` | Échéance/projection client minimales ; état privé durable, indexes non-TTL et masquage des champs internes. |
| `orders.service.ts`, `orders.controller.ts` | Créer la réservation avec la commande ; préserver `clientId` et l’échéance au rejeu ; router les annulations en cours de paiement vers le protocole commun. |
| `ordering/payments.service.ts` | Préparer et rattacher la tentative avant exposition du secret ; interdire les réouvertures ; partager le rapprochement payé avec le worker. |
| Nouveau `ordering/checkout-reservation.service.ts` et adaptateur Stripe | CAS, reprises de tentative, lecture/annulation sur le bon compte, compensation terminale ; port SDK injectable pour les tests. |
| Nouveau `ordering/checkout-expiry.processor.ts`, `ordering.module.ts` | Worker borné, balayage indexé, attribution atomique entre instances, arrêt propre ; feature flag serveur désactivé par défaut. |
| `slots.service.ts` | Budget de paiement dans les créneaux ; capacité libérée uniquement par transition terminale, pas par lecture d’horloge. |
| `Checkout.tsx`, `StripeCard.tsx`, `Tracking.tsx`, écran commandes | Compte à rebours informatif, paiement en vérification, expiration confirmée, retour au menu avec nouveau créneau ; ne pas recréer automatiquement la commande ou le paiement. |
| `stripe-webhook.test.ts` et tests d’intégration Mongo/Stripe sandbox | Reprises, isolement tenant/compte, courses et résultat après arrêt de processus. |

## 5. Preuves exigées avant activation

1. Deux instances réclament la même réservation : une transition terminale, un audit métier ; ancien token de bail rejeté.
2. Frontière d’échéance testée avec horloge injectée ; refresh et rejeu `clientId` ne prolongent rien. Retrait au comptoir, POS, téléphone et historique ne sont pas expirés.
3. Crash avant tentative, après préparation, après `requestStartedAt`, après création Stripe, après `cancel`, après commit local et après publication : reprise de la même tentative sans nouvelle intention exploitable.
4. Timeout/500 de création : absence d’identifiant local ne libère pas la place ; fin de fenêtre idempotente déclenche une revue, pas une nouvelle création.
5. Confirmation client contre expiration, webhook avant rattachement local, webhook tardif/doublé/désordonné : paiement réussi rapproché, aucune commande payée annulée comme impayée.
6. `processing`, `requires_capture`, compte déconnecté, erreur Stripe et montants/devise/compte discordants : aucune libération automatique.
7. Après annulation Stripe confirmée, ancien secret inutilisable ; aucun nouveau PaymentIntent sur une réservation fermée, même depuis un onglet ancien.
8. Capacité cuisine/livraison libérée une fois, préservée pendant `closing` ; promotion restituée une fois si la transaction de compensation est retenue.
9. Capture/acquittement/audit d’un cas payé après l’heure utile : pas d’exécution cuisine automatique injustifiée ; décision restaurant et remboursement explicite si nécessaire.
10. Tests avec vraie base de test multi-instance et Stripe sandbox sur le compte connecté ; les mocks seuls ne certifient ni annulation bancaire ni reprise après crash.

Déployer d’abord le schéma compatible et les protections de création/annulation ; ne lancer le worker qu’une fois toutes les instances mises à jour. Faire un balayage en lecture seule, puis activer sur un tenant de recette. Arrêter les nouveaux balayages doit rester possible ; un rollback ne doit pas réactiver un ancien code capable de créer des paiements malgré `closing`. Surveiller le nombre et l’âge des réservations, les réconciliations incertaines, la latence webhook, les erreurs de compte et les compensations à traiter. Aucun secret, adresse ou téléphone dans les métriques.

## 6. Conduite provisoire manuelle

La mention « en attente » dans Snack Manager n’autorise pas à annuler une commande sous prétexte qu’elle est ancienne. Vérifier **dans le bon compte Stripe et le bon environnement** l’intention, le montant et le résultat. Si un paiement est réussi/autorisé/en traitement, ne pas classer le ticket comme impayé : rapprocher, contacter le restaurant/client si nécessaire et traiter séparément un éventuel remboursement.

Pour une intention réellement annulable, obtenir sa confirmation d’annulation dans Stripe avant l’annulation locale, et conserver la trace de vérification. Mais cela ne suffit pas tant que la route actuelle peut recréer une intention annulée : il faut également empêcher toute réouverture et résoudre toute requête en vol sur la commande. Une simple pause de la vitrine ne garantit pas cette fermeture. **Sans moyen opérationnel vérifié de fermer ce chemin, conserver la réservation et escalader plutôt que prétendre qu’une annulation manuelle est sûre.**

Si l’identifiant Stripe manque ou si le rapprochement est ambigu, ne pas conclure « aucun débit » et ne pas demander au client de repayer. Aucune manipulation de secret, modification directe de base ou suppression de commande n’est prescrite par cette note. Voir aussi [recette des paiements restaurants](STRIPE-RESTAURANTS-VALIDATION.md).

## 7. Bilan des captures déjà obtenues

Recette locale du même code Next, API et Stripe simulés ; Chrome/Playwright, mobile 390 × 844 et bureau 1440 × 1000. Aucun build ni serveur supplémentaire lancé pour rédiger cette note.

- Accueil et offres : contenu présent, hiérarchie et identité sombre/dorée conservées, pas de débordement horizontal détecté à 390 px ; offre livraison explicitement présentée comme pilote à valider. Les captures longues ne remplacent pas un audit de contraste exhaustif.
- Back-office offre retrait seule : entrée Livraison visible avec cadenas, couche commerciale explicite et sans paiement implicite ; aucune requête `/delivery/settings` tant que le module est verrouillé.
- Back-office livraison activée : zones, codes postaux, frais/minimum, délai et capacité accessibles ; la modification de 3,20 € a produit 320 centimes dans l’API factice. Contrôles lisibles sur mobile ; barre d’enregistrement visible au-dessus de la navigation basse. La capture mobile ne montre pas tout le contenu du conteneur défilant : vérification de tous les états clavier/lecteur d’écran encore à prévoir.
- Tunnel : adresse hors zone refusée, total frais compris, paiement en attente après erreur, reprise sans seconde commande ; zéro erreur applicative JavaScript relevée. Ce succès ne valide pas l’expiration décrite dans cette note.

Captures temporaires locales : `/tmp/sm-delivery-qa.vpsZni/` (`home-mobile.png`, `offres-mobile.png`, `offres-desktop.png`, `access-locked-desktop.png`, `delivery-admin-mobile.png`, `delivery-admin-desktop.png`). Artefacts non versionnés et non garantis après nettoyage de la machine. Recette distante, accessibilité exhaustive et scénario réel d’expiration restent à faire.
