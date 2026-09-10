# Compte client et carte fidélité — raccordement

État au 10 septembre 2026 : **association durable #156 reçue sur staging**, sur
`2efb77f6d418cf17b353abbfcdd4d2b7547c19ab`. La transaction protégée #155 et la
migration de liaison sont livrées ; elles ne créent pas encore de carte depuis
le compte. Le lot suivant, sur `feat/customer-account-loyalty`, prépare
l'adhésion neuve avec contrats, API, BFF et interface client : **PR #157 ouverte,
pas encore fusionnée ni déployée**. Aucun fournisseur ni pilote supplémentaire
n'est ouvert ; la production n'est pas modifiée par ces lots.

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

La frontière commune livrée par #155 reste côté serveur uniquement :

1. Valider le restaurant, le navigateur et la publication attendue.
2. Ouvrir une transaction SQL bornée et prendre le verrou d'identité existant.
3. Vérifier la session protégée, le compte actif, la clé et le secours.
4. Exécuter les écritures locales nécessaires sur ce même client SQL.
5. Recontrôler toute l'autorité protégée avant le commit ; sinon tout annuler.

Aucun appel réseau ou fournisseur ne doit être effectué dans ce verrou.
L'état commercial du restaurant reste dans Mongo : le contrôler fraîchement
avant la transaction et avant la réponse ne crée pas une transaction distribuée.
Une perte de réponse après commit reste possible ; le nouveau writer prépare
une reprise idempotente depuis l'association durable. Le wrapper ne prétend
pas résoudre seul cette ambiguïté.

## Liaison durable et compatibilité

La liaison livrée par #156 conserve les références parent, restaurant, compte,
membre et opération d'adhésion. Ses clés étrangères composites, l'unicité compte
et membre, l'isolation RLS et son immutabilité empêchent une association croisée
au niveau de ces contraintes ; le writer doit encore prouver leur cohérence métier.
Le profil fidélité reste chiffré avec son domaine de clés propre ; les HMAC
de téléphone des deux modules ne se comparent pas directement.

La migration additive `0008_customer_loyalty_memberships` est reçue dans le
journal `customer`, après les migrations `loyalty`. Le migrateur customer ne
lance pas implicitement celui de fidélité. Les fixtures customer préparent
les véritables migrations fidélité ; les tests du migrateur limité vérifient
les seuls droits de référence nécessaires. Pas de suppression des contraintes,
de réécriture du SQL historique ou de quatrième journal de migration.

La remise QR **en caisse** dure toujours **30 minutes** avec reprise,
acquittement et expiration. Son propriétaire initial est un poste professionnel :
ce protocole ne doit pas être exposé directement au client en remplaçant son
auteur par un numéro de téléphone.

**Décision après revue du parcours compte : ne pas recopier cette échéance.**
Pour une adhésion neuve demandée sous session protégée, le compte est le
propriétaire durable dès le commit atomique. Une réponse réseau perdue ne doit
pas entraîner l'anonymisation d'une carte que le client peut retrouver après
reconnexion. Le writer du lot en préparation indique `enrollment_handoff_at = joined_at`
pour exprimer la remise au compte, pas un acquittement ou affichage navigateur.
Il ne réutilise ni la préparation ni le propriétaire de reprise du POS.

Le client ne reçoit un résultat qu'après commit et nouvelle vérification des
capacités ; un retry authentifié retrouve l'association, sans deuxième carte,
sans points gratuits et sans prolonger la session. Le QR courant doit tenir
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

## Historique de la première étape — preuve locale antérieure à #155

Le relevé ci-dessous décrit la préparation de #155, désormais intégrée à la
base staging #156. Ses comptes de tests ne décrivent pas le nouveau lot d'adhésion.

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

Ce socle n'ajoutait **ni migration de liaison, ni writer de carte, ni
action publique, ni UI, ni appel fournisseur**. Sa preuve locale restait
distincte de la réception PR/CI/staging qui a suivi.

## Deuxième étape — association durable reçue sur staging #156

[Déploiement 34401578258](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34401578258)
reçu sur le SHA `2efb77f6d418cf17b353abbfcdd4d2b7547c19ab` : bootstrap **96 objets**,
révision staging confirmée et smoke **8/8**.
[E2E 34402988306](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34402988306) :
**12 démonstrations réussies, quatre parcours authentifiés ignorés**. Ces skips
ne valident ni inscription réelle, ni compte public, ni téléphone physique.
Cette réception staging n'est pas une livraison en production.

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

Cette étape ne constitue **pas encore le cas d'usage d'adhésion** : elle livre
les contraintes et leur exploitation, sans writer ni écran d'adhésion neuve.
Le raccordement applicatif décrit à l'étape suivante n'est pas compris dans
cette réception. Le pilote de comptes reste fermé.

Historique de préparation locale de #156 : **22 tests SQL d'association**, suite customer **407/407**
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

## Troisième étape — adhésion neuve en préparation de PR, non livrée

Le lot `feat/customer-account-loyalty` ajoute les contrats stricts `view`,
`join`, `card`, leur orchestration serveur, le relais BFF signé et l'écran
fidélité depuis Mon compte. Le navigateur ne transmet ni téléphone d'autorité,
ni identifiant de propriétaire, ni consentement publicitaire. Les conditions
versionnées précèdent la confirmation ; un nom absent renvoie à Mon compte.
Une commande et l'accès à son historique n'exigent pas cette adhésion.

Le writer utilise exclusivement le client SQL de la session protégée. Un commit
crée **sept lignes métier liées** : opération, membre, profil chiffré,
portefeuille à zéro, événement `joined`, jeton hashé et association durable.
L'opération est complétée dans cette même transaction. Ce ne sont pas sept
nouveaux objets de schéma : le bootstrap reste à **96 objets**, sans nouvelle
migration dans ce lot. Une erreur ou la perte de protection avant commit annule
toutes ces écritures. La collision avec une création caisse passe par l'index
téléphone natif ; elle ne récupère pas la carte existante.

Le retour d'adhésion ne contient aucun QR. La lecture `card` prouve séparément
le membre actif, le programme actif, le jeton actuel, sa génération, son hash
et son opération d'origine ou de remplacement. Une rotation POS ne fait jamais
revenir au QR initial. Le dernier contrôle de publication revalide le compte,
la session, la capacité et le QR après les attentes externes ; les statuts
restaurant autorisés restent `trial` et `active`. Une association demeure
réservée à son compte même si la carte a été bloquée ou anonymisée.

**Preuves locales ciblées disponibles, pas réception globale :** les huit
premiers cas PostgreSQL ont produit sept échecs attendus avec le writer encore
fermé, puis la suite étendue passe **23/23**. Elle couvre notamment les verrous
réellement observés entre caisse et web, deux rotations via le service POS,
le re-chiffrement d'un nom de 120 caractères, la dérive QR et le rollback à
l'expiration de session. Le lecteur existant de la caisse reconnaît cette carte
et le nom complet ; après chacune des deux rotations, il refuse l'ancien QR.
La recette dédiée exécute **217 tests PostgreSQL du socle**, puis **41 tests
HTTP/writer**, sans skip. Elle couvre aussi la perte de réponse, la reconnexion
par clé d'accès sans nouveau SMS et la déconnexion avant publication.
Le contre-test HTTP du restaurant devenu `churned` juste avant publication
était rouge (200 au lieu de 503), puis passe avec le contrôle final renforcé.
Les deux tests des conditions longues UTF-8/JSON échappé étaient rouges au
plafond de 16 KiB ; le plafond borné de 48 KiB couvre le contrat de 6000 caractères.
Typage/lint/build : **38 tâches réussies**, module API compilé chargé. La passe
globale `pnpm verify --concurrency=1` réussit **51/51 tâches** : mêmes tests et
délais, exécutions de paquets bornées. Le web passe **2491/2491**, dont 17 tests
du nouveau harnais et 22 du BFF ; l'API générale passe **3368 succès / 640 skips**
sans variables d'intégration. Les groupes se recouvrent et ne s'additionnent pas.
La CI du SHA final et la livraison staging restent à recevoir.

La première passe navigateur a exposé des notifications Chromium `ERR_ABORTED`
malgré des lectures terminées. Leur traitement de test exige désormais, pour
la réponse exacte, EOF et nombre d'octets, JSON et contrat valides, puis le
rendu vérifié ou le rejet prouvé d'une ancienne identité. Corps tronqué,
JSON/contrat invalide et ancienne preuve UI restent rouges. Aucune cause
interne Chromium ni chronologie CDP n'est prétendue. Une autre passe globale
a dépassé le délai de fermeture de deux anciennes suites livreur : leur reprise
isolée passe 18/18 et la passe globale séquencée réussit, sans modifier ces
suites ni relever leurs délais.

La [première CI #157 du SHA `167593ac`](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34445786117)
a ensuite échoué sur le délai agrégé de cinq secondes d'un test de navigation
antérieur : **2490 tests web réussis, un échec**. Le rejeu inchangé passe en
local, sans identifier la cause précise du dépassement distant. Le test est
séparé en trois cas de géométrie (320/390/1440) et un cas de navigation entre
les fenêtres ; les assertions, le contre-exemple de reflow et les délais sont
conservés. Un diagnostic de phase n'est émis qu'en cas d'échec. Cette séparation
ne constitue pas un correctif produit et ne dispense pas d'une nouvelle CI.
Après séparation, le fichier passe **40/40** et la suite web complète passe
**2494/2494** ; typage et lint restent verts. Les trois cas supplémentaires
proviennent du découpage, pas de nouvelles fonctionnalités.

La [CI suivante du SHA `81d704f8`](https://github.com/GLWebDevAgency/snack-manager/actions/runs/34447614645)
valide ces cas, puis échoue sur une notification `ERR_ABORTED` du scénario de
réponse tardive après fermeture : réponse 200, **227 octets lus jusqu'à EOF**,
JSON/contrat valides, mais preuve UI post-EOF absente. Ce scénario attend
désormais la réponse exacte retenue : section démontée avant libération,
réception complète puis profil visible et absence de carte/solde après EOF.
La classification est réservée à cette preuve et possède ses contre-tests ;
elle n'exempte ni les réponses tronquées ni les erreurs arbitraires de fermeture.
Le runtime et les délais restent inchangés. Nouvelle CI requise avant fusion.

**Non compris / à recevoir ensuite :** rattachement explicite d'une ancienne
carte POS avec preuve renforcée, gains des commandes web, consommation d'une
récompense sur une vraie vente et compensation lors d'une annulation ou d'un
remboursement. Ni la nouvelle carte ni le QR ne réattribuent d'anciennes commandes
à partir d'un numéro de téléphone. Les fournisseurs et le pilote restent fermés ;
aucun budget Verify, envoi SMS, test de paiement réel ou GO production n'est
déduit de cette préparation.
