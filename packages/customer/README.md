# Identité client privée — stockage du pilote fermé

Ce package fournit des transactions PostgreSQL, pas une route ou une activation
Twilio. Il utilise le pool runtime partagé et ne possède ni identité POS/KDS, ni
carte fidélité, ni association aux anciennes commandes. Le parent fournisseur
et le tenant sont déterminés par le serveur, jamais par le navigateur.

Les migrations ont leur propre journal `drizzle.__drizzle_customer_migrations`.
Les comptes, contacts chiffrés, challenges, essais et sessions sont soumis à RLS
forcée parent **et** tenant. Les quatre tables opérationnelles de budget, garde
téléphone et preuves de réservation/fournisseur sont isolées au parent serveur
pour permettre le budget partagé entre tenants ; elles ne contiennent aucun
téléphone ou nom clair. Elles ne sont jamais des projections publiques.

Le verrou du budget parent sérialise les transactions locales, jamais l'appel
fournisseur. Chaque réservation est définitivement comptée, y compris échec ou
réponse perdue. Les plafonds lifetime sont le minimum des observations reçues :
une observation, un service ou une preuve plus récents ne remettent rien à zéro.
Cette borne conservatrice peut fermer le pilote avant épuisement fournisseur ;
ce n'est pas une réconciliation de facture. Le plafond absolu est 50 envois.

## Financement payant fermé, distinct de l'essai

La migration additive `0001_customer_paid_budget` conserve `0000`, ses lignes
et son hash. Elle ajoute une autorisation unique par parent, en microdollars USD
entiers, un plafond qui ne peut que baisser, un réservé qui ne peut que monter
et une expiration qui ne peut que raccourcir. La référence d'autorisation ne se
remplace pas. Chaque réservation payante garde son montant, son expiration
initiale et sa référence de preuve de coût, sans inventer d'unités gratuites.

Trial et Paid prennent **le même verrou parent**, puis Paid verrouille son budget.
Ils partagent le nombre d'envois lifetime, les quotas journaliers et la garde
téléphone. La bascule Paid abaisse définitivement les deux plafonds gratuits à
zéro, y compris pour un parent historique. Les consommations gratuites passées
restent intactes ; les nouveaux envois payants ne les augmentent pas. Le plafond
historique d'envois peut être inférieur à 50 car Trial le dérivait aussi des
crédits gratuits : le financement payant ne le relève jamais.

La projection `PendingChallenge.funding` vient du reçu immuable ; seule son
expiration effective est le minimum entre reçu et budget courant. Abaisser un
plafond financier à zéro ferme les **nouveaux** envois mais laisse terminer les
cycles déjà provisionnés. Une expiration explicitement passée ferme leurs
nouvelles vérifications. Un trigger SQL refuse aussi l'ancien INSERT de check
Trial après la bascule Paid. Cela ne peut pas arrêter un appel fournisseur déjà
autorisé/en vol : fermer le pilote et arrêter les anciennes instances avant
changement de mode reste une précondition opératoire.

Rollback : fermer le pilote et revenir au code précédent si nécessaire, **sans
down migration ni suppression des budgets/réservations**. Les plafonds gratuits
à zéro et le garde SQL restent actifs ; ce rollback ne réactive pas l'essai.
Ni recharge, ni renouvellement d'autorisation, ni migration de parent n'est livré.

Les challenges expirent au plus tard après 10 minutes et les sessions après
7 jours absolus selon l'horloge PostgreSQL. La garde téléphone reste au moins
10 minutes + 5 secondes après réservation, indépendamment d'une expiration
applicative plus courte ; un résultat d'envoi connu prolonge monotonement cette
garde à au moins 10 minutes après son observation. **Activation interdite tant
que la validité Verify de 10 minutes n'a pas été attestée.** Une durée fournisseur
différente exige de modifier cette politique avant activation, pas un nouvel SMS
de test. Aucun renvoi ne libère automatiquement un check resté incertain.

Le SID fournisseur est une preuve immuable `(parent, service, SID)` ; un checkId
ne s'exécute qu'une fois. Seule une réponse `pending` certaine permet un autre
checkId. Depuis `0006`, une première approbation ne crée qu'une inscription
provisoire, jamais un compte/contact/session. La continuité d'un compte déjà
authentifié reste distincte et peut produire une session `phone`.
Une collision téléphone exige une session de continuité valide du même compte ;
le téléphone seul ne récupère aucun compte. L'unicité tenant/téléphone empêche
aussi un doublon après changement de parent fournisseur, sans divulguer l'ancien
compte. Une migration de parent relève d'une procédure explicite non livrée ici.

`recoverCheck` distingue une inscription provisoire encore ouverte d'une session
originale de continuité encore valide, corrélée au
browserHash, operationId, preuve d'intention, challengeId, checkId, empreinte du
corps et sessionHash exacts. Aucune extension de TTL.
Les expirations sont relues après attente des verrous. Un rollback échoué détruit
la connexion au lieu de la remettre dans le pool.

## Préparation, intention et publication attendue

`0003` impose la préparation navigateur confirmée et sa durée absolue de sept
jours au maximum. `0004` ajoute les intentions, leur preuve privée émise une
seule fois (dix minutes au maximum) et les reçus de confirmation immuables.
La clôture avant admission écrit un tombstone ; après publication elle révoque
seulement sa propre session encore courante, sans toucher une publication B.
Le verrou transactionnel commun est pris avant celui du budget lorsqu'il existe.
Préparer/clôturer une intention ne crée ni ne remet à zéro un budget fournisseur.

`resultIntent` relit le résultat exact sans nouvelle vérification fournisseur.
Un check absent ou incertain ne permet jamais un renvoi automatique. Les
publications approuvées doivent encore correspondre à la session courante.
Session, nom et révocation exigent `expectedOperationId`/`expectedCheckId`,
sélecteurs non secrets vérifiés avec les cookies navigateur/session. Leur
validité ne dépend pas de la courte expiration de la preuve de reprise.

`0005_customer_session_publications` matérialise le reçu commun immuable
`phone | passkey | recovery`, lié à la session, à son navigateur/génération et à
l'intention exacte. Le repository ne vérifie pas lui-même la cryptographie
WebAuthn : il reçoit le résultat du vérificateur API. Toute publication écrit ce reçu dans la même transaction ;
les lectures privées, les modifications et la clôture ne fabriquent plus de
challenge Verify pour représenter une publication.

Le backfill conserve seulement les sessions OTP déjà autorisées par les
jointures exactes de `0004` (approbation, empreinte de check, intention, navigateur
confirmé et session courante valide). L'expiration de l'intention ne raccourcit
pas une session légitime. Aucun lien n'est inféré depuis les anciennes valeurs
NULL ; les lignes sources et budgets restent intacts. Le migrateur propriétaire
NOBYPASSRLS lève seulement FORCE sur les sources, **dans la transaction Drizzle**,
sans retirer ENABLE RLS ; FORCE est restauré avant commit ou par rollback.

Déployer ce changement **pilote fermé**, puis remplacer toutes les anciennes
instances avant réouverture. Aucun trigger de compatibilité ne crée de reçu
pour un writer `0004` encore actif après la migration : sa nouvelle session
restera inerte pour le nouveau code. Retour au code précédent uniquement pilote
fermé, sans down migration ni suppression de reçu.

Le helper `recovery-code` génère un code CSPRNG de 128 bits et une empreinte HMAC
séparée, liée au parent/tenant. La primitive ne publie rien à elle seule.
Voir [le parcours clés d'accès](../../docs/strategie-commerce-2026-09/COMPTE-CLES-ACCES.md).

## Inscription protégée — 0006

La preuve privée de l'intention n'autorise que les étapes provisoires. Le reçu
OTP terminal `verified` pointe vers `registration_enrollments` et ne devient
jamais `approved`. Il n'occupe pas l'unicité du contact : une inscription
abandonnée ne crée aucun ancien compte récupérable par téléphone.

Les options registration/assertion sont persistées avant le vérificateur, avec
origine/RP exacts, challenge unique et userHandle opaque. Les lectures de
vérification ne créent rien ; le compteur original reste disponible après une
réponse perdue. Le port reçoit exclusivement les résultats du vérificateur API,
pas une assertion de confiance fournie directement par le navigateur.

Une vraie assertion après registration est nécessaire avant émission du secours.
Trois versions au maximum, rotation explicite CAS, empreintes seules ; une
reprise ne réémet aucun code clair. Le premier essai d'activation fixe un unique
activationId. Cinq confirmations incorrectes au maximum sont comptées en SQL ;
une correction explicite conserve cet ID. Aucune rotation après ce premier
essai, et seul un succès conserve l'empreinte de la confirmation. Tous les
délais restent ceux de l'intention initiale (dix minutes au total, sans renouvellement).

L'activation crée compte/contact/clé/code confirmé/session/publication dans une
seule transaction, avance la génération et consomme l'intention. Une contrainte
différée refuse un compte partiellement activé même au COMMIT. La publication
est `passkey`, liée à l'activationId, jamais à un faux check Verify. La reprise
exacte ne renouvelle pas la session ; une publication ultérieure ou déconnexion
la rend inerte. La session active reste valable après les dix minutes, selon ses
propres sept jours absolus et la préparation navigateur.

La migration ne réécrit aucun compte historique : son `enrollment_id` reste NULL.
Un nouvel INSERT sans cette référence échoue, y compris celui du writer 0005.
Déployer pilote fermé et remplacer toutes les instances avant réouverture ; un
rollback applicatif reste fermé, sans down migration ni suppression des preuves.
Le lot `0006` seul n'implémente ni reconnexion ni consommation du secours.
Le raccord PostgreSQL `0007` ci-dessous les ajoute, sans constituer à lui seul
un parcours navigateur public ni autoriser son activation.

## Reconnexion et remise en protection — 0007

`credential_access_attempts` conserve options, claims single-flight et résultats
terminaux. La recherche de clé exige parent, tenant, RP et userHandle exacts.
Une vérification locale rejetée devient un reçu `failed`; un code de secours
incorrect devient `denied`. Une tentative incertaine n'autorise ni un nouvel ID
automatique ni la réexécution du vérificateur. Les erreurs de quota n'admettent
aucune tentative. Le journal d'intention existant et sa preuve privée restent
obligatoires ; les UUID publics seuls ne donnent aucune autorité.

`account_recovery_grants` réserve un compte exclusivement pour cette intention
pendant ses dix minutes absolues. Le secours source reste valide et non consommé.
Fermeture/expiration libèrent seulement la réservation lors d'une nouvelle
demande explicite ; ni le compte, ni sa clé, ni ses sessions ne sont supprimés.
La nouvelle demande conserve tous les essais déjà comptabilisés. La clé d'origine
reste utilisable jusqu'au remplacement final ; ce n'est pas une révocation
anticipée d'un appareil potentiellement compromis.

La remise en protection exige une nouvelle registration, une assertion distincte
vérifiée, puis un nouveau secours confirmé. Trois émissions relatives au maximum,
aucun réaffichage du clair, un activationId figé et cinq confirmations incorrectes
maximum. Le commit final consomme le secours source par CAS, révoque l'ancienne
clé et toutes les anciennes sessions, insère la nouvelle clé et le secours à
`sourceVersion + 1`, puis publie une session `recovery` et son reçu commun. Le
grant activé est immuable et contrôlé à COMMIT. Toute erreur/expiration provoque
le rollback intégral ; il ne reste ni secours brûlé ni révocation partielle.

Une clé révoquée est conservée ; seul l'index des clés actives est unique par
compte. Les compteurs de clé et versions de compte sont comparés aux snapshots
capturés avant vérification ; un ancien login en vol ne passe plus après le
remplacement. Un résultat exact restaure seulement sa session encore courante,
sans prolongation. Les routes privées restent indépendantes du TTL dix minutes,
avec leurs cookies et sélecteurs de publication exacts (attemptId pour login,
activationId pour récupération). Aucun faux check SMS ni adoption d'un ancien
compte par numéro de téléphone.

`credential_auth_reservations` est un journal immuable de métadonnées
pseudonymisées, RLS parent pour compter entre restaurants, écriture limitée au
tenant courant. Sous le verrou parent, avant cryptographie : cinq admissions
par intention, vingt par navigateur/heure, trente par source/quinze minutes,
trois cents par restaurant/heure et mille par parent/heure. SQL est l'horloge
autoritaire. Rejeux sans nouvelle réservation ; aucune suppression ou remise à
zéro, aucune lecture de crédit ou consommation Twilio. Les anciens comptes et
preuves `0006` sont préservés ; le pilote doit rester fermé pendant migration
et remplacement des instances. Pas de down migration destructive.

Plafonds conservateurs du pilote : 128 préparations et 128 intentions persistées
par parent/restaurant ; trois preuves d'intention non expirées par navigateur,
même après clôture. Ce ne sont ni des comptes ni des quotas SMS. Pas de purge
automatique ni de hausse implicite ; politique de rétention/grande échelle à
livrer séparément. Anciennes lignes sans liens conservées mais inertes. Déployer
API/Web pilote fermé ; aucun down, réattribution ou effacement du journal de commande.

## Validation locale et CI

`pnpm --filter @sm/customer build`, puis `test:integration` avec
`CUSTOMER_TEST_DATABASE_URL` visant uniquement un PostgreSQL loopback, base
`postgres` ou `snackmanager_*_test_ci` existante. La fixture crée une base et un
rôle UUID neufs et supprime uniquement ces deux cibles. Le rôle utilisé par le
repository n'est ni superuser, ni propriétaire, ni BYPASSRLS. Sans cible sûre,
le runner échoue avant connexion. Les tests orchestration utilisent le vrai
service API mais un fournisseur simulé. Le runner enchaîne aussi les tests HTTP
Nest→PostgreSQL locaux : aucune dépense, aucun SMS, aucune route de staging ou
installation navigateur physique n'est validé par ces tests.
