# Compte client et carte fidélité — raccordement

État au 9 septembre 2026 : raccordement après le socle transactionnel #155. Le compte protégé,
l'historique et la reprise de panier ne constituent pas encore une adhésion
fidélité en ligne. Aucun fournisseur ni pilote n'est ouvert par ce document.

## Parcours retenu

Depuis **Mon compte**, une personne authentifiée peut demander explicitement
sa carte pour ce restaurant. Le téléphone vérifié et le nom viennent du profil
serveur ; l'adresse n'est ni nécessaire ni demandée pour adhérer. Si le nom
manque, le parcours renvoie à sa saisie, sans recopier une ancienne commande.

Les conditions du programme sont présentées avant confirmation. L'adhésion ne
vaut pas consentement aux SMS ou courriels marketing. Le portefeuille commence
à zéro : aucune récompense ni aucun gain n'est crédité par l'inscription.

Le téléphone reste la clé anti-doublon. Si une carte utilise déjà ce numéro,
aucune deuxième carte n'est créée et l'ancienne n'est pas adoptée. Le compte
et ses commandes restent accessibles. Le client peut ensuite présenter sa
carte existante ou demander l'aide du restaurant, sans recevoir les données
du détenteur précédent. Un numéro vérifié ne suffit pas à prouver la propriété
d'une ancienne carte, notamment lorsque l'opérateur recycle un numéro.

Le rattachement d'une carte existante est une étape distincte : session
protégée, QR actif réellement remis, téléphone correspondant et absence de
liaison à un autre compte. Le QR ne devient jamais un moyen de connexion au
compte ni une autorisation de lire l'historique des commandes.

## Une seule transaction métier

Les deux modules utilisent déjà le même pool PostgreSQL. Leurs wrappers métier
historiques ouvrent des transactions séparées ; #155 fournit désormais une
transaction commune à session protégée. Appeler `createMember()` puis
enregistrer une liaison après son commit pourrait laisser une carte orpheline.

La première étape est donc une frontière commune, côté serveur uniquement :

1. Valider le restaurant, le navigateur et la publication attendue.
2. Ouvrir une transaction SQL bornée et prendre le verrou d'identité existant.
3. Vérifier la session protégée, le compte actif, la clé et le secours.
4. Exécuter les écritures locales nécessaires sur ce même client SQL.
5. Recontrôler toute l'autorité protégée avant le commit ; sinon tout annuler.

Aucun appel réseau ou fournisseur ne doit être effectué dans ce verrou.
L'état commercial du restaurant reste dans Mongo : le contrôler fraîchement
avant la transaction et avant la réponse ne crée pas une transaction distribuée.
Une perte de réponse après commit reste possible ; les opérations métier
devront être idempotentes et récupérables. Le wrapper ne prétend pas résoudre
seul cette ambiguïté.

## Liaison durable et compatibilité

La liaison prévue conserve les références parent, restaurant, compte, membre
et opération d'adhésion. Ses clés étrangères composites, l'unicité compte et
membre, l'isolation RLS et ses reçus doivent empêcher une association croisée.
Le profil fidélité reste chiffré avec son domaine de clés propre ; les HMAC
de téléphone des deux modules ne se comparent pas directement.

La migration sera additive dans le journal `customer`, après les migrations
`loyalty` : c'est déjà l'ordre du déploiement. Le migrateur customer ne doit
pas lancer implicitement celui de fidélité. Les fixtures customer prépareront
les véritables migrations fidélité, et le rôle migrateur limité recevra les
seuls droits de référence nécessaires. Pas de suppression des contraintes,
de réécriture du SQL historique ou de quatrième journal de migration.

La remise QR **en caisse** dure toujours **30 minutes** avec reprise,
acquittement et expiration. Son propriétaire initial est un poste professionnel :
ce protocole ne doit pas être exposé directement au client en remplaçant son
auteur par un numéro de téléphone.

**Décision après revue du parcours compte : ne pas recopier cette échéance.**
Pour une adhésion neuve demandée sous session protégée, le compte est le
propriétaire durable dès le commit atomique. Une réponse réseau perdue ne doit
pas entraîner l'anonymisation d'une carte que le client peut retrouver après
reconnexion. Le futur writer indiquera donc `enrollment_handoff_at = joined_at`
pour exprimer la remise au compte, pas un acquittement ou affichage navigateur.
Il ne réutilisera ni la préparation ni le propriétaire de reprise du POS.

Le client ne reçoit un résultat qu'après commit et nouvelle vérification des
capacités ; un retry authentifié retrouve l'association, sans deuxième carte,
sans points gratuits et sans prolonger la session. Le QR courant devra tenir
compte des rotations et vérifier génération, statut et hash du jeton actif :
rejouer aveuglément le QR initial de l'adhésion n'est pas admis. L'ancien
protocole de caisse, son nettoyage à expiration et ses acquittements sont inchangés.

## Réception par étapes

- **Transaction commune** : tests PostgreSQL natifs d'isolation, refus avant
  callback, expiration, perte de protection, rollback et concurrence avec la
  déconnexion. Aucune nouvelle route ni capacité ouverte à cette étape.
- **Association durable** : migration additive, références composites,
  unicités, preuve immuable et RLS parent/restaurant. Tests du migrateur limité
  et du bootstrap. Aucune adoption ou migration automatique des anciennes cartes.
- **Adhésion neuve** : écritures atomiques membre/profil/portefeuille/audit/liaison,
  collision avec une caisse, retry après réponse perdue et lecture protégée du
  QR courant. Aucun délai de remise POS appliqué au propriétaire compte.
- **Parcours client** : BFF signé, conditions lisibles, états d'erreur utiles,
  solde dans Mon compte, masquage après déconnexion/changement d'identité,
  tests deux onglets et captures aux identités et formats du restaurant.
- **Carte existante** : preuve renforcée et réception propre, sans adoption
  automatique par téléphone ni migration de soldes.

Les gains web, la consommation d'une récompense sur une vraie vente et leurs
compensations restent des lots suivants. La fidélité peut être souscrite sans
commande en ligne : contrôler sa propre capacité commerciale, pas `online`.
Chaque réception passe par PR, CI, develop et staging ; la production demande
un GO distinct.

## Première étape implémentée — réception locale, pas activation

La branche `feat/customer-loyalty-membership` ajoute
`withProtectedCustomerSession` et partage la preuve SQL existante avec
`authenticateProtected`, dont la projection publique et le refus `null` sont
conservés. Le nouveau callback reçoit une session chiffrée immuable et le
client SQL de sa transaction ; les identifiants attendus sont capturés avant
son exécution. Une preuve absente à l'entrée n'appelle pas le callback ; une
preuve perdue après son exécution provoque le rollback, sans rendre son résultat.

La déconnexion prend les mêmes verrous : si elle passe d'abord, le writer est
refusé ; si l'opération est déjà admise, elle peut commiter avant la déconnexion
en attente. Cela ne promet pas d'annuler rétroactivement une opération valide.

Preuves : six contre-tests étaient rouges sans vérification finale (clé,
secours, compte, session, navigateur ou échéance SQL), puis les **21 nouveaux
tests PostgreSQL** passent. L'ensemble customer passe **385/385**, sans skip,
dont les neuf anciens scénarios du principal protégé. Les **137 tests API
ciblés** passent, avec la frontière Nest/PG/Mongo explicite et le fournisseur
simulé. La passe API générale compte **3355 succès et 614 skips** sans variables
de bases dédiées ; ce n'est pas 3969 intégrations reçues. Typage/lint/build :
**38 tâches réussies** ; import CommonJS du module API compilé vérifié.
Ces groupes se recouvrent et ne s'additionnent pas.

Prérequis locaux conservés dans le reçu : le nouveau worktree nécessitait les
builds contracts et customer avant ses fixtures d'orchestration ; le build des
applications terrain nécessitait la paire API/Web locale explicite. Ces gardes
ont été respectés, pas désactivés, puis les suites ont été rejouées.

Ce socle n'ajoute encore **ni migration de liaison, ni writer de carte, ni
action publique, ni UI, ni appel fournisseur**. La réception PR/CI/staging
reste distincte de cette preuve locale.

## Deuxième étape — association durable en préparation

`0008_customer_loyalty_memberships` ajoute uniquement une table d'association,
sans donnée personnelle ni secret QR. Les références au compte, au membre et à
l'opération sont contraintes dans leur périmètre ; un compte ne peut posséder
deux associations, un membre ne peut avoir deux propriétaires et une opération
ne peut être réattribuée. L'association est immuable, même après blocage ou
anonymisation d'une carte ; ces états ne libèrent pas automatiquement sa propriété.

La migration ne crée aucune carte, ne recherche aucun téléphone et ne rattache
aucune carte existante. Les fixtures isolées préparent les vraies migrations
fidélité avant celles de customer, comme le déploiement. Le runtime du module
customer ne reçoit pas de nouveaux droits fidélité de ce seul fait. Le bootstrap
recense un objet supplémentaire ; l'ancien code reste compatible avec ce suffixe
de migrations. Le retour applicatif ne supprime pas cette table ni ses preuves.

Cette étape ne constitue **pas encore le cas d'usage d'adhésion** : conditions du
programme, chiffrement du profil, portefeuille, preuve joined, collision de
téléphone et récupération du QR restent à intégrer ensemble dans le writer.
L'API publique et le pilote restent fermés pendant cette préparation.

Réception locale : **22 tests SQL d'association**, suite customer **407/407**
sans skip, bootstrap **127/127** (dont l'intégration PostgreSQL), suites API
ciblées **137/137** avec PG/Mongo et fournisseur simulé. La passe API générale
compte **3355 succès / 614 skips** sans variables d'intégration. Typage/lint/build :
**38 tâches réussies**, chargement CommonJS de l'API vérifié. Ces populations
se recouvrent et ne s'additionnent pas. Le bootstrap a d'abord échoué sur cinq
contre-tests unitaires sans le manifeste, puis passé avec le seul objet ajouté.

Les anciens contrôles du journal ont été actualisés de huit à neuf migrations,
sans changer les hashes ni les lignes historiques. Une reprise complète a été
nécessaire après une veille système de 1 002 secondes ; le test concerné a
repassé isolément puis la suite entière a passé en 56 secondes, sans augmentation
de délai. Le nouveau worktree nécessitait également le build des dépendances
avant la recette API ; celle-ci a été rejouée une fois ces builds terminés.
