# Compte client — clé d’accès et code de secours

Décision du fondateur, 8 septembre 2026 : **clé d’accès + code de secours** pour
la reconnexion, en conservant la vérification initiale du téléphone. Ce document
décrit les lots successifs et distingue le parcours testé de son ouverture réelle.
Il ne vaut ni ouverture du pilote, ni autorisation de consommation Verify.

## Lot préparé : primitives et reçu de session commun

La migration additive `0005_customer_session_publications` porte un reçu
immuable lié au parent, au restaurant, à la session, à l’intention et à la
génération du navigateur. Ses méthodes `phone`, `passkey` et `recovery` ne sont
pas des autorisations : seul un cas d’usage ayant vérifié sa preuve peut publier
dans la même transaction. Aucun faux challenge SMS n’est créé pour les deux
nouvelles méthodes. Les routes privées et la clôture d’intention utilisent ce
reçu ; les contrôles existants de session et de publication attendue demeurent.

Le vérificateur stateless repose sur SimpleWebAuthn 14. La page doit être en
HTTPS, l’origine est exacte et le RP correspond à son seul hostname. Présence
et vérification de l’utilisateur sont requises ; clé découvrable demandée,
attestation `none`, algorithmes explicitement fixés à ES256, RS256 et EdDSA.
L’alias du compte et le userHandle ne contiennent ni nom ni téléphone. Les
identifiants sont comparés avant vérification ; aucun message cryptographique
brut n’est renvoyé. La bibliothèque navigateur est une dépendance de test de
l’API, pas un formulaire déjà intégré au web.

Le générateur de secours produit 128 bits aléatoires via le CSPRNG système,
présentés en huit groupes hexadécimaux préfixés `SM1`. Seules les variantes de
casse et séparateurs ASCII sont admises. Son empreinte HMAC possède une clé
dérivée dédiée et lie parent et restaurant. **Ces primitives ne stockent,
n’activent et ne consomment aucun code.** L’usage unique reste à réaliser dans
le protocole transactionnel, pas dans une fonction de hash.

Preuves locales : 293 tests customer avec PostgreSQL, API identité 609, runner
dédié 109 PG puis 6 HTTP, bootstrap 94 dont upgrade réel, WebAuthn 47 dont 15 avec authentificateur
virtuel Chromium, secours/crypto 107 inclus dans customer. Ces chiffres se
recouvrent, ne pas les additionner. Ni téléphone physique ni SMS réel dans ces
preuves ; aucune authentification publique passkey/secours disponible encore.

## Préparation suivante : journal local perdu

Le lot `customer-browser-restore` ajoute une lecture explicite du seul sélecteur
de navigateur, à partir du cookie HttpOnly existant. PostgreSQL exige le parent,
le restaurant, l'empreinte exacte, une préparation déjà confirmée et son
échéance SQL non dépassée. Aucune ligne n'est créée, confirmée ou prolongée ;
aucun quota SMS ni reçu de session n'est modifié. Aucune nouvelle migration.

Le BFF ne rend que les quatre champs publics de préparation et ne réémet ni
ne supprime de cookie. `restoreMissingJournal()` reste une opération explicite,
non raccordée à un bouton public : verrou natif, journal strictement absent,
transaction IndexedDB CAS vers `ready` **sans intention ni publication**.
Un journal corrompu ou apparu entre-temps n'est jamais remplacé. L'expiration
est recontrôlée après le dernier commit local ; en cas d'incertitude, le
sélecteur conservé n'est pas annoncé prêt. Les journaux de commande et de
fidélité sont hors de ce chemin.

Preuves du lot : 118 tests PostgreSQL et 8 HTTP signés réels, sans skip dans
ces exécutions ; les ports fournisseur y sont simulés. Les 16 tests navigateur
de préparation utilisent les vrais cookies, IndexedDB, Web Locks et handlers
BFF, avec un amont API isolé. La contre-revue a identifié puis fait corriger
le franchissement de l'expiration pendant le commit IndexedDB. Ce socle ne
rétablit toujours ni profil, ni carte, ni historique et ne remplace pas la
preuve forte de reconnexion. Un cookie remplacé hors protocole peut rendre un
sélecteur inutilisable ; les appels suivants le refusent sans adopter un compte.

## Lot inscription protégée — implémentation du 9 septembre 2026

La migration `0006_customer_protected_enrollment` remplace la création d'un
nouveau compte sur OTP seul par une inscription provisoire de dix minutes au
plus. Elle ne donne aucun profil ni session. Le parcours web du panneau
**Mon compte** utilise les vrais contrats BFF/API : téléphone, SMS, création
WebAuthn, assertion de cette même clé, affichage explicite du secours et
ressaisie de ce secours avant activation atomique. La bibliothèque navigateur
est désormais une dépendance de production du web, chargée à la demande.

La base exige au COMMIT l'ensemble compte, contact, clé, secours, session et
publication commune. Un ancien writer ne peut plus créer un compte incomplet.
Les anciens comptes sont conservés, pas convertis depuis leur seul téléphone.
Les préparations de clé et d'assertion sont immuables ; une nouvelle réponse ne
remplace pas la preuve précédemment enregistrée. Les signatures sont vérifiées
hors transaction puis les autorisations et échéances recontrôlées sous verrou.

Le secours n'est affiché qu'après sa première écriture confirmée ; sa reprise
n'en renvoie jamais le clair. Trois versions explicites au maximum, puis un
seul identifiant d'activation fixé au premier essai et cinq erreurs de
confirmation au maximum. Le navigateur garde les seuls identifiants publics
dans son journal, jamais le téléphone, l'OTP, le code ou une réponse WebAuthn.
Après COMMIT, `activate` comme `activation-result` lit le reçu exact de cette
publication si les preuves privées sont toujours valides : aucune nouvelle
vérification du code ni session supplémentaire.

La disponibilité du parcours et celle de l'envoi SMS sont séparées. Une preuve
de financement absente bloque un nouvel envoi/check fournisseur, pas les étapes
de protection déjà engagées. Aucun envoi automatique lors d'une reprise.

Preuves locales : 135 tests PostgreSQL customer et 8 HTTP Nest signés passent
sans skip ; ces suites utilisent de vraies signatures d'un authentificateur
virtuel Chromium, avec le fournisseur téléphonique simulé. La suite web passe
ses 2144 tests, dont les scénarios rendus de l'inscription, du hors-ligne et des
réponses perdues. Ces nombres se recouvrent avec les suites ciblées et ne
constituent pas une recette SMS ou appareil physique. Captures inspectées aux
largeurs 320, 390 et 1440 px avec une identité de fixture, pas celle d'un client.

**Le lot 0006 n'ouvre pas les comptes publics.** À cette étape, la reconnexion
passkey, la récupération et la remise en protection restent à raccorder ;
`accessAvailable` demeure faux. Aucun SMS, paiement ni production autorisé par
cette livraison. La PR #147 est fusionnée vers `develop` à la révision
`44ae82bfe27fb523a3dbdb5855222cdaea2f8c7c`. Son statut de déploiement doit être
établi séparément sur la révision réellement servie, pas déduit de ce document.

Pour la récupération suivante, le choix retenu est une preuve provisoire liée
à l'intention, sans consommation anticipée du seul secours. La consommation
définitive, le remplacement de clé et de secours et la révocation des anciennes
sessions seront atomiques, après confirmation de toutes les nouvelles preuves.
Une interruption ne doit donc pas rendre définitivement irrécupérable un compte
dont le propriétaire a justement perdu sa clé.

## Lot reconnexion et récupération — 0007

Le panneau **Mon compte** propose la reconnexion par clé découvrable, ou le code
de secours. Les deux passent par les contrats stricts BFF/API et PostgreSQL :
aucune identification par numéro ou QR. La signature exige la vérification de
l'utilisateur et son `userHandle`, le challenge durable de l'intention, le RP
et le restaurant exacts. Le claim précède la cryptographie ; le compteur, la
version du compte, l'intention et sa génération sont recontrôlés au commit.
Une signature refusée produit un résultat terminal, pas une deuxième
vérification automatique. Un résultat perdu se relit sans renouveler la session.

Le bon secours ouvre uniquement une remise en protection provisoire exclusive.
Il ne dévoile pas le compte, ne consomme pas encore le code et n'invalide pas les
anciens accès. Après création **et assertion** de la nouvelle clé, un nouveau
secours doit être ressaisi. Le commit final consomme l'ancien code, révoque
l'ancienne clé et les anciennes sessions, écrit les nouvelles preuves et publie
la session ensemble. Une interruption avant ce commit laisse l'ancien secours
utilisable après clôture ou expiration du grant. Une reprise après commit lit
le reçu exact ; elle ne consomme ni ne génère de code supplémentaire.

Les admissions ont leurs limites durables indépendantes des SMS : 5 par
intention, 20 par navigateur/heure, 30 par source/15 minutes, 300 par
restaurant/heure, 1000 par parent/heure. Il s'agit des plafonds conservateurs du
pilote, pas de quotas commerciaux. L'horloge SQL fait autorité et les rejeux ne
remettent aucun compteur à zéro. Aucune dépense ni lecture de financement pour
la reconnexion. Le pilote global fermé reste fermé ; `accessAvailable: true`
ne s'expose que derrière sa configuration explicitement autorisée.

Le journal IndexedDB ne conserve que les identifiants publics d'étapes. Un
parcours d'accès engagé masque toute ancienne publication d'inscription,
également s'il est suspendu ou expiré. Verrou Web Locks, CAS local, actions de
reprise explicites et lecture du reçu empêchent une réponse tardive d'adopter
une autre session. Une réponse d'intention perdue se distingue d'une assertion
incertaine ; aucune cérémonie native ne redémarre automatiquement.

Preuves locales du lot : 165 tests PostgreSQL puis 11 HTTP Nest→PostgreSQL,
sans skip dans le runner dédié ; 124 tests bootstrap avec upgrade réel
0006→0007 et rôle ordinaire. Les signatures sont produites par un
authentificateur virtuel Chromium, le fournisseur SMS est simulé. La recette
web passe 2203 tests sur 145 fichiers, dont 14 scénarios natifs d'accès et 11
d'inscription : déconnexion/reconnexion, secours, réponses perdues, Web Locks
entre onglets, stockage réel et petits écrans. API générale : 3310 tests passent,
585 scénarios à services externes sont ignorés dans cette commande ; les 11 HTTP
ci-dessus sont exécutés séparément avec PostgreSQL. Contrats : 529 tests verts.
Typage/lint : 33 tâches ; build : 25 tâches ; autres suites Turbo : 17 tâches.
Ces totaux se recouvrent, ne pas les additionner. Ces preuves ne sont ni une recette SMS
réelle, ni une validation sur téléphone physique. Le déploiement de ce lot doit
encore être reçu sur son propre commit.

**L'identité forte ne rattache pas encore automatiquement les cartes et
commandes historiques.** Les commandes de cet appareil gardent leurs preuves
propres ; le compte n'adopte pas un historique par correspondance de téléphone.
Le raccord métier, son préremplissage et ses droits restent un lot distinct à
vérifier avant d'annoncer un compte client unifié.

## Lot commandes privées — raccord serveur et lecture dans Mon compte

Les **nouvelles** commandes créées par la route de compte protégée portent un
propriétaire serveur immuable : parent, établissement et compte. PostgreSQL
résout ce propriétaire depuis la session exacte affichée ; aucun téléphone,
QR, identifiant de compte reçu du navigateur ou ancien ticket ne le choisit.
Les sessions historiques non protégées restent exclues de cette autorité.

Le checkout public et celui du compte exécutent désormais le même cas d'usage
pour les prix, options, promotions, capacité, anti-robot et paiement. La preuve
C01 est obligatoire pour la route de compte. Le propriétaire précède tous les
rejeux et traverse admission, snapshot puis commande. Une réponse perdue se
reprend sans recréer la vente ; une reprise invitée ne peut pas transformer une
commande en commande de compte. La capacité C01 d'une tentative déjà admise
peut encore la récupérer ou l'abandonner après déconnexion, sans modifier son
propriétaire. Ce n'est pas une autorisation de consulter les autres commandes.

La permission PostgreSQL est relue juste avant le CAS MongoDB, puis avant la
réponse privée. **Il n'existe pas de transaction distribuée entre les bases** :
une opération déjà admise peut croiser une révocation, mais ne peut jamais
adopter un autre compte. Le propriétaire est masqué des réponses et événements
existants. L'index Mongo `customer_order_history` est additif et non unique ;
aucune reprise d'historique ou réécriture de commandes existantes n'est lancée.

Dans **Mon compte**, la lecture privée propose toutes/en cours/terminées,
pagination stable, détail des articles/options/retraits, prix, paiement et étapes
confirmées. Les requêtes fixent la publication effectivement affichée avant et
après lecture. Ni coordonnées, ni identifiants de paiement, ni jetons de suivi
ne sont exposés par l'historique. Les réponses sont bornées et `no-store` ; la
vue n'est gardée qu'en mémoire et disparaît à l'invalidation, hors connexion ou
au changement d'accès. Elle ne promet pas de mise à jour temps réel : le client
dispose d'une action explicite d'actualisation.

Preuves locales de ce lot : 174 tests PostgreSQL et 14 HTTP Nest signés passent
sans skip avec les services locaux ; trois de ces parcours HTTP utilisent aussi
le vrai checkout Mongo, ses prix, admissions et CAS. Le transport SMS, Turnstile
et les quotas HTTP externes y sont simulés. La recette Mongo dédiée comprend
17 scénarios réels et 5 gardes de cible. La CI impose les deux services pour ces
recettes et vérifie aussi quatre ordres de chargement CommonJS des contrats.
Les preuves UI natives sont distinctes : HTTP local simulé, vraie interface,
session sélectionnée, verrou/journal/lecteur client ; elles ne remplacent pas
une recette BFF→Nest→PostgreSQL→Mongo sur staging.

**Le tunnel Checkout n'appelle pas encore cette nouvelle route.** Le choix de
conservation des raccourcis de suivi après déconnexion reste à valider avant ce
raccord ; les journaux invités existants ne sont pas effacés ni convertis. Le
préremplissage par le nouveau compte, le lien fidélité et « recommander » restent
à recevoir ensuite. Aucun pilote public, SMS payant ou déploiement production
n'est ouvert par ce lot. La réception staging se rapporte séparément au SHA
réellement servi, pas au seul statut de fusion.

## Parcours complet à recevoir avant ouverture

1. **Créer mon compte** : téléphone → code SMS → inscription provisoire bornée.
   Elle n’autorise ni ancien profil, ni commandes privées, ni historique. Une
   inscription abandonnée peut recommencer vide après une nouvelle preuve
   téléphone ; elle ne reprend jamais un compte actif. Les comptes existants ne
   sont pas transformés implicitement en inscriptions provisoires.
2. **Protéger mon compte** : créer la clé d’accès, recevoir le code de secours,
   confirmer sa sauvegarde, puis activer atomiquement le compte protégé. Ne pas
   annoncer la protection comme terminée après une réponse perdue. Aucun code
   dans l’URL, les logs, le journal public ou un stockage navigateur automatique.
3. **Me reconnecter** : clé d’accès proposée par l’appareil ; Face ID, empreinte
   ou code de déverrouillage sont des exemples, pas une biométrie imposée. Le
   serveur recherche le credential dans le restaurant ET le RP courant, vérifie
   le challenge de cette intention, puis consomme et publie atomiquement.
4. **Utiliser mon code de secours** : vérifier la version active et consommer
   une seule fois, sous limites d’essais durables, avec un reçu récupérable par
   la preuve privée de l’intention. Réponse perdue : lire ce reçu, sans consommer
   une seconde fois ni prolonger une session. La remise en protection et le
   remplacement explicite du code doivent être inclus au parcours livré.
5. **Journal navigateur perdu** : action explicite pour retrouver seulement la
   préparation confirmée liée au cookie encore valide, sans réémettre le cookie
   ni allonger sa durée. Aucune publication personnelle n’est restaurée par ce
   geste ; une nouvelle authentification forte reste nécessaire. Ne jamais
   effacer les journaux de commande pour résoudre ce cas.

La seule correspondance du téléphone et le QR fidélité ne donnent aucun accès
à un historique existant. Une clé liée au domaine personnalisé ne devient pas
valide sur le domaine plateforme. Plusieurs restaurants hébergés sur une même
origine exigent toujours une recherche de credential isolée par tenant.

## Réception du parcours complet

- Interrompre chaque étape d’inscription ; prouver l’absence d’accès privé avant
  activation et le refus d’un ancien compte après OTP seul.
- Deux activations simultanées et deux consommations du même code : un seul
  succès ; état et reçu atomiques, aucune suppression opportuniste d’historique.
- Reconnexion après déconnexion, changement d’appareil et perte du seul journal.
- Réponse A tardive après publication B : aucune substitution de compte.
- Challenge expiré, autre origine/tenant, credential révoqué, userHandle erroné,
  signature fausse, vérification utilisateur absente : refus fermé.
- Compteurs WebAuthn à zéro : aucune dépendance au seul compteur pour empêcher
  le rejeu ; le challenge durable est consommé une seule fois.
- Formulaire réel dans le Sheet Mon compte, identité du restaurant préservée,
  essais 320/390/1440 px, clavier/focus, erreurs locales et réduction des motions.
- Recette fournisseur explicitement budgétée, puis seulement ouverture ciblée.

## Références techniques

- [SimpleWebAuthn — serveur](https://simplewebauthn.dev/docs/packages/server) :
  génération et vérification des options/réponses.
- [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/) : portée du RP et vérification
  d’une preuve cryptographique, distincte de l’autorisation métier.
- [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html) : référence de
  conception pour les risques PSTN et codes de récupération à usage unique ;
  aucune certification de conformité n’est revendiquée pour ce socle.
