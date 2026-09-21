# Commande, récompenses et remboursements — livraison du 21 septembre 2026

Ce lot complète les gains web livrés par la PR #204 : consommation d’une récompense dans la commande protégée, devis click & collect autoritaire, restitution des points utilisés, remboursements comptoir et compensation des gains POS. Le déploiement et les essais distants doivent être accompagnés d’un reçu portant la révision effectivement servie. Les tests locaux ne prouvent pas une livraison en production, une réception SMS, une clé d’accès physique ou un mouvement d’espèces.

## Parcours client

Le compte vérifié et la carte rattachée partagent le portefeuille existant. La carte autonome continue de fonctionner au comptoir. Les capacités du forfait du restaurant, son état commercial et son programme actif restent contrôlés côté serveur ; la simple présence d’un bouton ne donne aucun droit.

À la validation du panier, le serveur recalcule les produits, options, promotions et frais. Le click & collect possède maintenant son devis, comme la livraison. Le client transmet le total attendu : si le tarif a changé, aucune commande à un autre montant n’est acceptée silencieusement. Le devis n’est pas une réservation de créneau, de stock ou de points ; l’admission reste la décision finale.

Un compte rattaché peut choisir une récompense éligible. Le solde privé n’est ni persistant ni partagé avec une commande invitée ; il disparaît à l’expiration de sa preuve ou au changement d’identité. Les nouveaux champs privés/publics sont négociés explicitement pour conserver la compatibilité des anciens clients stricts.

Règles commerciales de cette version :

- Une récompense par commande, sans cumul avec une promotion.
- Une remise fixe est plafonnée au montant des produits ; elle ne paie pas la livraison et son coût en points reste celui annoncé.
- Une récompense produit exige un véritable produit de la carte. Elle offre une unité de base éligible, la moins chère si plusieurs tailles sont présentes. Suppléments et autres quantités restent payants.
- Un produit encore saisi sous forme de texte dans une ancienne récompense doit être rattaché à la carte depuis **Fidélité → Récompenses**. Son édition historique reste possible sans perte de données. Les récompenses libres ne sont pas automatiquement converties en remise.
- Un reste à payer en ligne inférieur à 0,50 € est refusé avant l’acceptation ; choisir le paiement au retrait ou modifier le panier. Un panier entièrement offert peut être accepté sans Stripe ni encaissement physique.
- Les gains portent sur les produits effectivement payés après remise. Une visite entièrement offerte n’attribue pas un nouveau tampon.

Le solde disponible exclut les points déjà réservés par une autre tentative. La réservation devient un débit unique lorsque la commande est acceptée. Un refus terminal libère la réservation. Une annulation durable avant paiement ou un remboursement intégral confirmé restitue le coût initial une seule fois. Fermer le panier ou perdre le réseau n’annule pas une commande acceptée. Un remboursement partiel corrige les gains sur la vente mais ne restitue pas la récompense entière.

## Reprises et données

La coordination Mongo/PostgreSQL est un protocole durable, pas une transaction distribuée. Le journal d’admission Mongo enregistre la tentative avant toute réservation SQL. La fermeture terminale crée une preuve SQL qui interdit une réservation arrivée en retard. Un délai seul n’autorise jamais à libérer des points : le worker doit d’abord obtenir le changement d’état atomique de l’admission.

Le reçu immuable conserve propriétaire, restaurant, commande, produit/règle et coût. Ledger, solde, réserves et consommation sont engagés dans la même transaction SQL. Des contraintes différées vérifient le total des réservations et leurs liens exacts avec les opérations, redemptions et écritures. Le verrouillage suit l’ordre des writers historiques. Les anciens ajustements ne peuvent pas dépenser des points déjà réservés ; le reverse générique ne peut pas contourner une récompense liée à une commande.

Le worker reprend les réponses perdues sans nouvel UUID ni nouveau débit. Les encaissements Stripe et comptoir attendent sa confirmation. Un worker en retard ne peut ni changer le propriétaire ni remplacer une décision financière plus récente. Les instantanés privés sont retirés des réponses publiques et des événements.

Les files Mongo sont indexées et bornées. Une nouvelle réservation est refusée de manière réessayable si ses index ne sont pas prêts. Les traitements déjà acceptés continuent quand le flag de création est fermé.

## Remboursements comptoir

Le journal comptoir est distinct du journal Stripe. Seuls un encaissement comptoir prouvé ou un ticket POS d’origine cohérent peuvent être remboursés par ce chemin. L’opérateur prépare un montant et sa ventilation produits/livraison, puis demande une autorisation du geste physique. Son expiration ne constitue pas une preuve que rien n’a été remis.

Le journal local conserve l’identité exacte de l’intention, sans le secret opérateur. L’autorisation physique reste uniquement en mémoire et ne peut pas être recréée par un rechargement. Après le geste, l’opérateur atteste le résultat. Une incertitude bloque un nouveau geste ; le responsable peut rapprocher explicitement une opération sans effet après la fenêtre autorisée. Les reprises conservent l’auteur, les montants et le reçu original. Fermer le module interdit de nouvelles préparations/démarrages, mais laisse terminer les opérations existantes.

Le journal de caisse distingue montant brut, remboursements confirmés et net. L’historique affiche une limite explicite si ses 200 dernières commandes ne couvrent pas toute la période ; il ne prétend pas constituer un export comptable exhaustif. Aucun test logiciel ne certifie la remise réelle d’espèces ou le remboursement sur un terminal indépendant.

Les [compensations de gains POS](COMPENSATIONS-GAINS-POS.md) reprennent les reçus déjà achevés. Les gains web conservent l’assiette produits nette historique. Si le client a déjà dépensé ses points et que la compensation ne tient plus dans le solde disponible, aucun découvert ni débit partiel automatique n’est créé : **Fidélité → Ventes fidélité** expose la décision propriétaire à traiter.

## Déploiement contrôlé

Dépendances : journal de remboursement durable et gains web existants, migrations loyalty `0008_order_reward_reservations` et `0009_pos_sale_compensation`, rôle runtime limité, RLS forcée, propriétaires/ACL des fonctions et index Mongo exacts.

Flags de création fermés par défaut :

- `LOYALTY_ORDER_REWARDS_ENABLED` : sélection et nouvelles réservations web ;
- `ORDER_COUNTER_REFUNDS_ENABLED` : préparation/démarrage de nouveaux remboursements physiques ;
- `LOYALTY_POS_COMPENSATION_ENABLED` : adoption des gains POS à compenser.

Ordre : compiler et tester → déployer migrations et code → vérifier bootstrap/RLS/indexes et révision des services → retirer les anciennes instances → activer les flags sur la cible autorisée → exécuter la recette → conserver le reçu. Ne pas activer les réservations avec d’anciens writers qui ignorent `reserved_units`. Un rollback ferme les créations et conserve les nouveaux workers capables d’achever les intentions ; il ne supprime ni tables, ni reçus, ni réserves. Un retour aveugle à un ancien binaire avec réserves existantes est interdit.

## Recette attendue

Les suites locales couvrent PostgreSQL limité et Mongo réels, migrations sur portefeuille peuplé, isolement tenant, concurrence avec les anciens writers, pertes de réponse, rejet terminal avant réservation tardive, matérialisation C01, reçu produit, panier offert, compensation cumulative et masquage privé. Les suites Chromium couvrent les composants réels de checkout, compte, configuration des récompenses et remboursements POS, avec fournisseurs HTTP contrôlés.

Sur staging, conserver séparément : révision servie, préflight migrations/indexes/flags, scénario vertical et effets exacts, éventuels paiements Stripe **test**, recette navigateur connecté, appareil/WebAuthn/SMS et manipulation physique. Un scénario serveur sur collections QA prouve les services et les écritures, mais pas le parcours navigateur ni un webhook externe non exécuté. Aucun restaurant de production ne doit être créé pour cette recette.
