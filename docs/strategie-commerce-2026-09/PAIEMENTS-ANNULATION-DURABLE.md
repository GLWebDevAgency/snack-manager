# Paiement et annulation — protocole durable

Implémentation initiale le 5 septembre 2026, complétée le 6 septembre par le changement de moyen sur un retrait existant. **Pas une attestation de déploiement ni de recette Stripe distante.** Ce lot ferme les courses entre ouverture, fermeture et confirmation bancaire. Il ne livre pas encore l'expiration automatique, l'encaissement comptoir explicite indépendant de la remise ou le remboursement comptoir.

## Invariants et fonctionnement

- Toutes les nouvelles commandes portent une preuve privée `paymentFlow`, créée avec la commande. L'absence de ce champ sur l'historique ne vaut jamais « aucun paiement commencé ».
- Avant Stripe, un CAS fige compte, environnement test/live, montant, devise, métadonnées et clé idempotente. Un second CAS enregistre le début de l'appel bancaire. Les montants ne sont plus ajustés sur une intention déjà ouverte.
- Une seule intention par commande. Une intention annulée ne permet pas d'en recréer une autre pour cette commande. Le retour au menu n'est pas une autorisation de redébiter un paiement incertain.
- Une création dont la réponse a été perdue est récupérée avec les mêmes paramètres et la même clé, pendant une heure au maximum. Après cette fenêtre, rapprochement opérateur ; pas de nouveau `create` aveugle.
- Annuler enregistre d'abord la fermeture, puis relit le paiement sur son compte d'origine. Seule une absence d'appel prouvée ou une annulation bancaire terminale permet `status=cancelled`. Historique et preuve terminale sont écrits ensemble.
- Une réussite est rapprochée comme un paiement, jamais transformée en échec. `processing`, `requires_capture`, indisponibilité bancaire ou preuve incohérente conservent la commande et demandent une vérification. Aucun remboursement implicite.
- Le webhook arrivé avant le rattachement du PI récupère la tentative durable, puis compare le PI exact, le compte, le montant, la devise et l'environnement connu. Les métadonnées seules ne confirment pas une commande.
- Chaque mutation du protocole incrémente `__v`, également utilisé par les anciens `save()` optimistes. Le départ livraison et les remboursements participent à cette clôture des écritures concurrentes.
- Les lectures critiques demandent le primaire et `readConcern=majority`, avec temps borné. Les écritures demandent `w=majority`, `j=true`, avec attente bornée. Un timeout ne prouve pas l'absence d'effet.

Le secret client n'est rendu qu'après rattachement et relecture ouverte. Une réponse HTTP déjà en vol ne peut pas être rappelée : c'est l'annulation terminale **chez Stripe** qui rend l'ancienne intention inutilisable, pas l'affichage d'un message dans le navigateur.

## Historique et expérience opérateur

### Reprendre un retrait au comptoir

Le checkout et le suivi proposent « Payer au comptoir » pour un retrait actif dont le règlement en ligne reste en attente. Une confirmation explique que le serveur doit d'abord fermer le paiement bancaire. Le POST `public/orders/:id/payment-counter?t=…` exige le secret de **cette** commande et ne crée ni nouvelle commande, ni remise, ni remboursement. La livraison reste exclusivement prépayée.

La destination `counter` est persistée dans la même fermeture durable que l'annulation, distinguée de `cancel_order` (défaut historique). Les deux destinations concurrentes ne s'écrasent pas. Seule une absence d'appel prouvée ou un PI terminal `canceled`, relu sur son compte exact, permet `counter_ready`. Le statut opérationnel et l'historique cuisine restent inchangés ; `payment.status` reste `pending`, le choix devient `counter`, le tender est vide. Le PI et la tentative sont conservés comme preuves. Un replay reprend la décision, sans réouvrir `open`.

La caisse n'encaisse à la remise que si cette preuve est cohérente. Une annulation opérationnelle ultérieure reste possible sans rouvrir Stripe. Les remboursements Stripe et leur interface exigent un paiement réellement classé `online` : un ancien PI annulé conservé après encaissement au comptoir ne représente pas des fonds Stripe remboursables. Un événement bancaire contradictoire exige un rapprochement sans reclassifier silencieusement le règlement comptoir.

Le navigateur invalide les réponses de suivi antérieures à sa mutation, partage un verrou entre confirmation carte et changement de moyen, puis relit le serveur en cas de réponse perdue. Un simple message « indisponible », un timeout ou un paiement `processing` ne constituent jamais une autorisation d'encaisser ailleurs. Le récapitulatif utilise le **statut** du paiement : `pending` n'affiche plus « Payé en ligne ».

Recette locale : vrai Mongo standalone isolé, deux connexions concurrentes et fournisseur de test sans réseau bancaire ; cas sans Connect, réponse Stripe/Mongo perdue, concurrence ouverture/fermeture/remise/webhook, jetons invalides, livraison, historiques ambigus et remboursement comptoir refusé. Ces tests ne certifient pas la délivrabilité Stripe ni une transaction réelle sur staging.

Un PI historique connu est repris sur son compte exact, y compris la plateforme pour les anciens paiements uniquement. Un historique sans PI et sans preuve instrumentée devient `legacy_unknown` : ni nouvelle ouverture bancaire, ni annulation financière supposée sûre, ni remise commerciale qui modifierait son montant.

Une commande déjà payée nécessite un traitement financier distinct. Le remboursement Stripe existe ; le remboursement comptoir n'est pas livré par ce lot. Le paiement comptoir implicite historique à la remise reste seulement permis sur une nouvelle commande dont l'absence de tentative bancaire est prouvée. Il reste à le remplacer par une action explicite et auditée, indépendante de la remise.

Les états privés ne sortent ni dans les réponses publiques ni dans les événements POS/KDS. Une erreur opérateur explique la nécessité de vérifier ; aucun secret ni détail bancaire n'est journalisé. L'interface de rapprochement dédiée n'est pas encore fournie.

## Reprises et effets secondaires

La demande de fermeture est persistée. Réessayer la même annulation reprend cette fermeture, son motif initial et son identifiant bancaire. Ce lot n'ajoute pas de worker de reprise autonome.

Un rejeu du webhook déjà appliqué peut republier `order.updated` sans réécrire le paiement. Une panne Redis renvoie 503 pour provoquer une reprise Stripe. Les consommateurs doivent tolérer cette publication au moins une fois. Cela ne constitue pas une outbox générale d'audit/notification : une interruption après l'annulation et avant le journal opérateur reste à rapprocher. Le quota promotion n'est pas restitué automatiquement.

## Recette et déploiement

La suite `order-payment-lifecycle.integration.test.ts` utilise deux connexions à un vrai Mongo standalone et un fournisseur bancaire simulé persistant entre instances. Elle couvre notamment les réponses perdues après les écritures Mongo et Stripe, le webhook anticipé, la fermeture concurrente, les snapshots obsolètes et la fin de fenêtre de récupération. Les tests de signature et d'adaptation du SDK sont séparés. La CI exécute une étape Mongo dédiée ; une suite générale qui ignore ces scénarios ne suffit pas.

**Interdire la coexistence des anciens et nouveaux chemins d'écriture pendant la bascule.** Une ancienne API ignore `paymentFlow` et pourrait créer un paiement malgré une fermeture. Une simple mise à jour roulante ne démontre donc pas cet invariant.

1. CI verte, inventaire historique en lecture seule et fenêtre sans nouvelles opérations financières sur la cible.
2. Arrêter/drainer les anciens appels d'ouverture, annulation, remise et changement de montant, ainsi que les émissions CRM concernées par la [bascule du writer](FACTURATION-EMISSION-DURABLE.md). Vérifier réellement l'absence d'ancien processus, pas seulement le statut vert d'un nouveau déploiement.
3. Mettre en place schéma, API et gardes ensemble. Les webhooks temporairement indisponibles doivent rester rejouables.
4. Reprendre sur un tenant de recette, vérifier le SHA exact, tester Stripe sandbox et les chemins caisse/BO. Les contrats complexes et l'historique ambigu ne sont pas auto-réparés.
5. Déploiement production seulement après recette staging et GO distinct. Ne pas remettre l'ancien protocole sur les nouvelles commandes : en cas d'incident, fermer les opérations et corriger en avant.

Sources de conception : [idempotence Stripe](https://docs.stripe.com/api/idempotent_requests), [annulation d'une intention](https://docs.stripe.com/api/payment_intents/cancel), [atomicité documentaire MongoDB](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/). Suite : [réservations impayées](RESERVATIONS-IMPAYEES.md), [feuille de route](SUITE-APRES-COMMERCE.md).
