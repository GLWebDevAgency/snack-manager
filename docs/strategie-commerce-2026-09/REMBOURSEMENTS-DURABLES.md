# Remboursements : intention durable avant Stripe

Lot L3b, première étape, préparé sur `fix/order-refund-durable-intent`.
Ce document décrit le code et sa recette locale ; il ne constitue pas un reçu
de déploiement ni une activation en production. Aucun remboursement réel n'a
été exécuté pour cette recette.

## Garantie et périmètre

Avant `refunds.create`, un CAS Mongo persiste dans la commande l'opération,
l'auteur, le motif, les centimes, le PaymentIntent, son compte Connect original,
le mode test/live et la clé d'idempotence. La même écriture réserve le montant
et incrémente `__v` et `refundSyncVersion`. Le départ fournisseur est lui aussi
daté durablement. Lectures primary/majority bornées à dix secondes, écritures
majority + journal ; une réponse Mongo perdue n'est reconnue qu'après relecture
exacte de la transition. Sinon, aucun nouveau départ fournisseur.

Le même UUID et les mêmes paramètres reprennent la même opération ; UUID et
ObjectId sont canoniques indépendamment de la casse. Montant, motif ou auteur
différents sont refusés. Une intention sans preuve fournisseur bloque toute
autre nouvelle opération sur la commande. Le journal privé est limité à 128
opérations : aucune purge ou expiration ne transforme un doute en autorisation.

La fenêtre de reprise de création est d'une heure après le premier départ,
jamais prolongée. Après cette fenêtre, seules des observations permettent un
rapprochement ; aucun nouvel appel `create` sous cette intention. Une liste vide,
une erreur réseau ou le temps écoulé ne libèrent pas la réserve. Un refus
fournisseur ou une preuve incohérente demande un rapprochement, pas une nouvelle
clé automatique. La clé est une protection complémentaire, pas un journal local.

Les réponses Stripe sont contrôlées (identifiant, compte de la requête, intention,
montant, devise, statut et métadonnées corrélées), puis réduites aux seuls champs
de preuve nécessaires. Le document SDK complet n'est ni conservé ni diffusé.
Une réponse `create` suffit à enregistrer la preuve même si `list` tarde à la
montrer ; une réponse de création rejouée n'écrase pas une observation plus récente.

Une liste tardive perd son CAS face à une réservation concurrente. Les IDs déjà
observés absents d'une nouvelle liste restent conservés. Les compteurs historiques
sans détail cohérent ne sont pas remis à zéro : ce cas est refusé pour
rapprochement. Une opération historique déjà identifiée reste consultable mais
n'est pas recréée, ni transformée en intention pré-départ fictive.

Le reçu financier précède `AuditService.logOnce`. Les reprises et webhooks
réparent cet audit de manière idempotente ; son identité utilise le reçu et non
un statut susceptible d'évoluer. Redis reste une notification auxiliaire après
persistance. Le journal, les données privées de compte et les métadonnées
fournisseur non nécessaires ne sortent pas dans les réponses/événements.

## Activation : obligatoire en deux temps

`ORDER_REFUNDS_DURABLE_ENABLED` est **fermé par défaut**. La valeur exacte `true`
ouvre uniquement les appels remboursement/rapprochement ; les paiements ordinaires
conservent leur configuration existante. Fermé, les demandes de remboursement et
les webhooks correspondants retournent une indisponibilité, jamais un faux succès.

1. Publier le code avec le drapeau absent ou `false`. Vérifier CI, migration et
   révision réellement servie. Ne pas confondre le drapeau fermé du nouveau code
   avec une protection appliquée à un ancien exécutable, qui ne le connaît pas.
2. Vérifier le retrait de **toutes** les anciennes instances API et le drainage
   de leurs requêtes remboursement ; rapprocher tout appel ancien resté incertain.
   Pendant cette transition, ne pas demander de nouveaux remboursements. Si une
   activité réelle est possible, fermer ces routes en amont avant la bascule.
3. Ouvrir le drapeau sur staging seulement, puis vérifier la révision et la
   configuration de chaque instance. Faire la recette avec un paiement Stripe
   de test explicitement choisi ; ne jamais utiliser une vente réelle implicite.
4. La production garde sa propre validation et son GO. Aucun drapeau production
   n'est modifié par ce lot.

**Retour arrière :** après la première intention `refundFlow`, ne pas redéployer
un ancien binaire. Il ignore ce champ, pourrait effacer la réserve via sa propre
réconciliation et diffuser le journal dans ses lectures lean. Fermer le drapeau
sur les binaires compatibles arrête les nouvelles opérations, sans supprimer les
preuves. Préférer un correctif en avant ; un rollback ancien exige une maintenance
bloquant routes, webhooks et anciens processus concernés, puis un rapprochement
explicite. Ne jamais supprimer le journal ou forcer les compteurs pour le permettre.

## Recette

Les suites Mongo utilisent deux connexions sur un standalone local, une base
suffixée par run et une preuve de propriété avant nettoyage. Aucun appel réseau
Stripe. Les tests interceptent de vraies écritures avant de perdre leurs réponses,
contrôlent les commandes du driver et utilisent un vrai AuditService/AuditLog.

Les cas incluent : réserve visible avant fournisseur, panne avant écriture,
réponse perdue avec/sans relecture, concurrence même/autre opération, ancien
document hydraté, observation tardive/vide, fenêtre expirée et clé purgée,
changement de mode, preuve invalide, objet SDK complet, audit perdu/réparé,
confidentialité, compteur historique sans détail, compte plateforme historique,
droits du restaurant et offre web seule. La CI rejoue ces tests avec Mongo réel,
séquentiellement avec les tests de cycle de paiement.

## Ce qui reste distinct

- Ce lot ne résout pas la coordination Mongo/PostgreSQL des gains, ni les crédits
  web, ni leur compensation après remboursement ou points déjà consommés.
- Les remboursements lancés dans le Dashboard Stripe ne passent pas par cette
  réservation préalable ; leurs webhooks sont rapprochés après observation.
- Le modal actuel conserve son UUID seulement tant qu'il reste ouvert. Une
  reprise UI durable après fermeture/changement d'appareil et un écran de
  rapprochement professionnel restent à livrer. Le backend bloque une nouvelle
  opération incertaine ; ce blocage n'est pas une expérience de reprise complète.
- Les appels d'un ancien binaire restent historiques : aucune preuve rétroactive
  de « jamais envoyé » n'est fabriquée à partir de leur absence en base.
