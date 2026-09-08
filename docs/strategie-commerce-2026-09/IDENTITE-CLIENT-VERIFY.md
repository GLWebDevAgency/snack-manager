# L3a — identité client : raccordement Verify

État du 8 septembre 2026. Complète [l'espace client](HISTORIQUE-ESPACE-CLIENT.md).
**L3a.1 et L3a.2 sont livrés sur staging par #134 et #135. La persistance et les
cas d'usage serveur sont vérifiés ; l'inscription publique n'est pas encore opérationnelle.**
[Preuve de livraison L3a.2](https://github.com/GLWebDevAgency/snack-manager/pull/135#issuecomment-5583195612) :
révision `d645c9f2ad92bb74ef015231bd81306d11af3c00`, trois migrations,
quatre services actifs, smoke 8/8 et démos 9/9. Quatre parcours authentifiés
ignorés faute d'identifiants ne constituent pas une recette réelle.

## L3a.1 — code et limites

- Port de vérification de téléphone et adaptateur HTTP Twilio Verify, sans nouvelle
  dépendance : SMS en français, protections fournisseur maintenues, origine HTTPS
  fixe, redirections interdites, délai et corps de réponse bornés.
- Le contrôle utilise la référence exacte et vérifie compte, service, téléphone,
  canal et état dans la réponse. Aucun statut ambigu, erreur ou `404` ne vaut succès.
  Aucun retry automatique : une réponse perdue peut suivre un envoi ou une
  approbation effectivement exécutés. Pas de fallback vocal/WhatsApp/Lookup.
- Préflight pur de recette fermée : staging déclaré, un restaurant/service
  explicite, 1 à 5 mobiles français autorisés et vérifiés, compte `Trial` actif,
  observation de moins de 15 minutes, échéance non dépassée et allocations
  gratuites attestées pour SMS **et** Verify. Les segments potentiels par envoi
  doivent aussi être bornés d'après le template/service : un OTP ne vaut pas
  nécessairement une seule unité SMS. La validité fournisseur doit être attestée
  à 600 secondes maximum (`maxTokenValiditySeconds`). Toute information inconnue ferme le
  préflight ; un solde monétaire n'atteste pas ces allocations.
- Limites applicatives du pilote : délai minimal de 60 secondes, sans promesse
  de renvoi tant que la garde inter-challenges reste active ;
  3 réservations d'envoi par téléphone/24 h, 5 par IP/24 h, 10 par restaurant et
  globalement/24 h ; 5 essais par challenge, 10 minutes maximum. Le total de
  recette est explicitement configuré, plafonné à 50 et réduit par les unités
  gratuites observées. Ce ne sont ni des quotas Twilio promis ni un budget payant.

**À la livraison de L3a.1, aucun contrôleur, provider Nest, worker ou écran n'importait ce code.** Aucune
variable d'activation Railway n'est ajoutée. Les tests injectent un transport
HTTP simulé ; ils ne créent ni SMS, ni compte, ni connexion réelle.

### Préflight ≠ réservation durable

`planTrialPhoneVerification` retourne `reservation_required`, jamais une
permission d'envoyer. L'adaptateur HTTP est un port d'infrastructure bas niveau,
pas un service d'authentification exposable. Il ne sait ni qui est l'utilisateur,
ni s'il reste du budget : ne pas le brancher directement sur une route.

Le repository L3a.2 réserve **atomiquement et durablement** toutes les
bornes, puis persister la tentative avant l'appel fournisseur. Un timeout
consomme sa réservation conservatoire ; aucun remboursement de quota sur simple
erreur réseau. Rejouer un préflight, rafraîchir une observation, changer de
service ou redémarrer le processus ne remet pas les compteurs à zéro. Garder le
budget global au niveau du compte parent, pas seulement du restaurant/service ;
rapprocher les unités réservées depuis l'observation. Redis peut compléter
l'anti-abus, pas être seul garant de la dépense.

L'évidence vient de l'opérateur/serveur de confiance, jamais du navigateur. Sa
fraîcheur ne garantit pas atomiquement le solde fournisseur : activité extérieure,
upgrade ou configuration changée exigent vérification et arrêt conservatoire.
L'orchestrateur vérifie aussi l'environnement de sa configuration serveur.
L3a.3 ajoute une composition Nest fermée, dérivée de l'identité native Railway
et de cibles opérateur distinctes, pas seulement de `policy.environment`.
L'absence de configuration d'activation conserve le déploiement sans envoi.

## Vérification fournisseur du 8 septembre — relevés distincts

Le premier relevé CLI 6.2.4 était incomplet (lecture Account 401 et navigateur
non connecté). Il a été suivi d'une connexion du fondateur à la Console et de
son autorisation explicite d'utiliser ses unités gratuites sur son propre numéro.

Un seul SMS **Programmable Messaging**, modèle Trial imposé, a été envoyé à
09:50:06 GMT+2 : journal fournisseur `Delivered`, quota **99 → 98 / 100**, compte
toujours `Trial`. Aucun OTP ni donnée de commande dans ce message. Aucun upgrade,
recharge, achat de numéro ou activation payante. [Preuve distincte du test SMS](https://github.com/GLWebDevAgency/snack-manager/pull/134#issuecomment-5581342726).
Ce résultat ne prouve ni Verify ni l'inscription à SnackManager ; il ne remplace
pas une observation fraîche des droits gratuits avant une nouvelle opération.

Avant tout OTP réel : vérifier en Console le compte Trial, les droits gratuits
**Verify**, leur échéance et les destinataires autorisés. Les unités Messaging
générales ne constituent pas une allocation Verify. Service, destinataires Verify,
Fraud Guard, segments et durée de validité restent à attester. Aucun secret à
copier dans une PR ; aucun autre envoi effectué par les tests logiciels L3a.2.

### Reconnexion et blocage Verify confirmés le 8 septembre

La Console du compte est maintenant accessible. Elle affiche toujours **Trial,
27 jours restants et 98 SMS gratuits restants**. La page Verify propose une mise à niveau ; le lien
**Services** redirige vers `/us1/upgrade/v2`, où Twilio demande d'ajouter des fonds
pour accéder à la plateforme complète. Cette proposition a été fermée sans
validation. Aucun service Verify, clé, recharge, achat de numéro ni nouvel SMS
n'a été créé pendant cette vérification.

La contrainte du fondateur reste **essai gratuit uniquement**. L'allocation
Messaging précédemment observée ne lève pas ce blocage. Ne pas contourner le
parcours en créant un service par API, ni déduire les droits effectifs du compte
d'une page de quickstart générique. La [documentation des essais](https://www.twilio.com/docs/usage/trials)
distingue les unités par produit et impose des contenus prédéfinis : ces SMS ne
remplacent pas un service OTP applicatif configurable.

Le raccordement logiciel peut être développé et testé avec un fournisseur simulé,
mais reste fermé en déploiement. Avant une recette Verify réelle, une décision
distincte du fondateur sur le fournisseur ou le cadre d'accès sera nécessaire ;
aucun changement payant n'est implicitement autorisé par la reconnexion.

## L3a.2 — socle durable implémenté, non exposé

- Nouveau package `@sm/customer`, pool PostgreSQL partagé, migration additive et
  journal propre. Neuf tables, RLS forcée, FK composites et contact unique par
  restaurant/téléphone, y compris si le parent fournisseur change. Les quatre
  journaux/gardes opérationnels sont isolés au parent pour les quotas communs ;
  les projections de comptes et sessions sont isolées au parent **et** restaurant.
- Réservation avant chaque appel, plafond lifetime jamais remis à zéro ni relevé
  par une nouvelle observation, essais et SID fournisseur à usage corrélé unique.
  Incertitude réseau = réservation conservée, aucun retry automatique. La garde
  téléphone couvre la validité fournisseur même si le challenge applicatif expire
  plus tôt. Un parent sérialise ses seules transactions SQL, pas ses appels HTTP :
  choix conservateur de pilote, pas une promesse de débit multi-enseignes.
- Noms/téléphones chiffrés AES-256-GCM avec contexte lié au tenant/sujet ; HMAC par
  usage et clés dérivées d'une clé dédiée de 32 octets. Aucun secret brut de session,
  OTP ou téléphone clair dans les journaux SQL. Aucune clé runtime créée dans ce lot.
- Service applicatif de réservation/confirmation, profil minimal avec modification
  explicite et contrôle de version, session absolue de sept jours et révocation
  serveur. L'approbation et sa session sont atomiques. Une réponse perdue ne peut
  restituer que la même session encore valide au navigateur d'origine, sans
  prolonger sa durée ni rappeler le fournisseur.
- **Téléphone seul ≠ récupération d'un compte existant.** Une nouvelle inscription
  est possible dans les tests ; un compte existant exige encore une session valide
  de continuité. La récupération après perte/expiration de cette session et sur
  un nouvel appareil reste à livrer. Le choix passkey/code de récupération est
  demandé au fondateur ; aucun rattachement implicite par numéro réattribué.
- CI et démarrage API vérifient les trois contextes `supply`, `loyalty`, `customer`.
  Le bootstrap n'adopte que l'inventaire connu et n'autorise pas le rôle runtime
  à migrer. Les tests réels utilisent une base/role UUID jetables en loopback et
  le rôle applicatif ordinaire, pas un superuser qui contournerait RLS.

Tests : cryptographie et orchestration unitaire, PostgreSQL réel (concurrence,
quotas, délais de verrous, rollback, continuité, révocation, rejeu), migration neuve,
extension de deux à trois contextes et reprise idempotente. Le fournisseur est
simulé : **aucun OTP réel, aucune route HTTP ou inscription navigateur validée
par ces tests**. Les résultats de CI et de staging sont consignés dans la PR.

**Non livré dans ce sous-lot :** provider Nest/controller/BFF, cookies personnels,
anti-robot public, écrans d'inscription et préremplissage du compte, lien sûr vers
les cartes existantes, propriété des commandes, historique personnel et réachat.
Conservation/suppression des données, rotation de clé et migration de parent
nécessitent aussi leurs procédures avant ouverture. Aucun lancement public ni
déploiement production par cette note.

## L3a.3 — frontière API/BFF fermée

Ce lot raccorde les cas d'usage serveur, **sans écran d'inscription et sans
activation du pilote**. Le parcours invité, le panier et le QR fidélité restent
inchangés. Il ne livre pas encore le compte complet attendu par le client.

| Entrée same-origin du site sous `/r/:slug/compte/` | Fonction |
|---|---|
| `GET capacites` | Disponibilité ; `available:false` si le pilote est fermé |
| `POST navigateur` | Prépare un secret navigateur HttpOnly avant le challenge |
| `POST verification` | Téléphone E.164, identifiant de tentative, preuve Turnstile |
| `POST confirmation` | Contrôle le code à six chiffres et établit la session |
| `POST resultat` | Reprend seulement le résultat du contrôle initial, sans code ni nouvel appel Verify |
| `GET / DELETE session` | Lit le profil personnel / révoque la session ou toutes ses sessions |
| `PATCH profil` | Modifie explicitement le nom avec contrôle de version |

Le BFF appelle uniquement les actions POST signées de `/public/customer/:slug/`.
Les enveloppes strictes sont partagées dans `@sm/contracts`. Le navigateur ne
peut pas fournir un tenant, un identifiant de compte, un secret serveur ou une
preuve humaine supposée. L'API exige une signature dédiée `customer-v1` liée à
l'action, au chemin exact, à l'origine, au corps, à une source IP pseudonymisée
et à un horodatage de moins de 60 secondes. Ni JWT professionnel, QR partagé,
ancien relais public ni appel direct non signé ne valent autorité personnelle.

- Les cookies `__Host-sm_customer_browser_<slug>` et
  `__Host-sm_customer_session_<slug>` sont Secure, HttpOnly, SameSite Strict,
  Path `/`, sans Domain. Le préfixe impose cette portée hôte ; le nom et
  l'autorité serveur restent liés au restaurant. Aucun jeton dans le JSON,
  l'URL ou localStorage. Pas de SSO implicite entre domaines.
- Une déconnexion révoque côté serveur ; elle **n'émet pas de suppression de
  cookie**. Le jeton devenu inerte expire ou sera remplacé. Cela évite qu'une
  réponse tardive de déconnexion efface une session ouverte entre-temps. Même
  règle pour un ancien GET 401. Aucune déconnexion optimiste si le serveur
  n'a pas confirmé. La future UI devra sérialiser les mutations d'identité
  entre onglets, ignorer les réponses obsolètes et vider ses projections privées.
- Une réponse de confirmation perdue se récupère avec les mêmes références
  et le même navigateur, seulement si une session a effectivement été créée
  et reste valide. Ni le délai ni le quota ne sont prolongés.
- Origines et domaines personnalisés contrôlés à chaque demande ; pour un
  domaine restaurant, résolution fraîche du slug côté API. En-têtes privés
  et no-store, limites de corps et délais complets, réponses d'erreur fixes.
  Les erreurs JSON avant guard sont également normalisées avant réponse et
  journal Ops ; les routes non personnelles conservent leur comportement.
- Quota HTTP Redis partagé ; une panne ferme la route. Le budget SMS reste
  réservé durablement dans PostgreSQL. Turnstile vérifie côté serveur hostname,
  action `customer-account-start` et cdata `<slug>_<operationId>` ; clés de test
  refusées. Le fournisseur est à nouveau précédé d'une lecture tenant primaire
  et du contrôle inchangé de la configuration et de l'évidence réservées.
  Mongo, PostgreSQL et Twilio ne forment **pas** une transaction distribuée.

### Configuration requise, non provisionnée

Pour `api` **et** `web` : `SM_CUSTOMER_ACCOUNT_MODE=closed_trial`, environnement
natif Railway `staging`, `SM_ENV` absent ou `staging`. Les identifiants natifs
`RAILWAY_PROJECT_ID` et `RAILWAY_ENVIRONMENT_ID` doivent égaler des cibles opérateur
indépendantes `SM_CUSTOMER_PILOT_PROJECT_ID` et `SM_CUSTOMER_PILOT_ENVIRONMENT_ID`.
Ajouter les tableaux JSON `SM_CUSTOMER_PILOT_SLUGS` (un seul restaurant pour ce
pilote) et `SM_CUSTOMER_PILOT_ORIGINS` (origines HTTPS exactes), ainsi qu'une clé
aléatoire dédiée `SM_CUSTOMER_RELAY_SIGNING_KEY` de 32 octets en base64 canonique.
Le Web utilise son `NEXT_PUBLIC_API_URL` HTTPS existant.

Pour `api` seul : `SM_CUSTOMER_PILOT_TENANT_ID`,
`SM_CUSTOMER_IDENTITY_KEY` (32 octets base64, distincte de la clé de relais),
`SM_CUSTOMER_VERIFY_ACCOUNT_SID`. Les opérations d'envoi/contrôle nécessitent
aussi `SM_CUSTOMER_VERIFY_API_KEY_SID`, `SM_CUSTOMER_VERIFY_API_KEY_SECRET`,
`SM_CUSTOMER_TURNSTILE_SECRET_KEY` et les objets JSON
`SM_CUSTOMER_VERIFY_POLICY` / `SM_CUSTOMER_VERIFY_EVIDENCE` conformes au préflight
L3a.1. Les sessions existantes, le profil, la révocation et la récupération d'un
résultat acquis ne dépendent pas du renouvellement de l'évidence SMS.

**Avant toute activation** : attester que l'entrée Railway écrase `x-real-ip`
avec l'IP réelle (pas celle fournie par le client), contrôler les proxys/domaines,
les clés et les droits Trial Verify. Le logiciel ne certifie pas l'infrastructure.
Les variables ne sont ni générées ni ajoutées par ce lot ou par le pipeline.
Pas de fallback vers une clé fidélité/JWT ou un compte payant. La production
reste refusée par le runtime, même avec un mode `closed_trial` copié.

Vérification logicielle : gardes, quotas et courses asynchrones, faux fournisseur,
HMAC du **vrai code Web** vers un serveur Nest en loopback (pas deux signatures
réécrites dans des fixtures), limites HTTP et sorties privées. Ces preuves ne
remplacent pas une inscription réelle navigateur → Twilio → compte.

Passe locale du 8 septembre : `pnpm verify` 51/51 tâches réussies (23 reprises
du cache). L'écriture finale du cache Turbo a signalé un disque saturé ; aucune
tâche n'a échoué et aucun cache/worktree n'a été supprimé. Après les derniers
contre-tests : API identité + Ops 280/280, dont 17 HTTP interop ; typage et lint
ciblés verts. BFF + proxy + relais QR voisin 133/133. Orchestration PostgreSQL
réelle 10/10, dont quatre nouveaux cas de récupération, sous rôle ordinaire ;
les bases/rôles UUID de test ont été retirés après vérification. La perte de
réponse est simulée après commit SQL, pas une coupure réseau réelle. Une
composition Nest des vrais modules avec connexions remplacées en mémoire a
aussi vérifié leurs exports DI et le refus fermé sans appel DB. La CI et la
preuve de staging du SHA fusionné restent consignées dans la PR de ce lot.

## Conditions restantes avant ouverture

1. **Contexte PostgreSQL `customer` distinct** (socle implémenté) de `User` professionnel et de
   `loyalty.members` : compte opaque, contact vérifié, challenge, sessions et
   journal de quotas. Pool partagé, RLS, FK tenant composites, migrations et
   privilèges testés. Un compte n'impose pas l'achat du module fidélité.
2. **Challenge lié au navigateur/restaurant** (socle implémenté) : secrets aléatoires, empreintes
   serveur, téléphone chiffré, réservations, renvois/essais bornés et consommation
   conditionnelle. Une référence Verify n'est pas une session. Empêcher qu'une
   vérification réutilisée par le fournisseur pour un service/téléphone valide
   deux challenges/tenants : service dédié au pilote et unicité locale des
   références fournisseur. Une réponse perdue ne crée jamais un accès supposé.
3. **BFF same-origin et session personnelle HttpOnly** : origine/CSRF,
   anti-robot serveur, source IP attestée, réponses non énumérantes, `no-store`,
   révocation et aucun profil dans le cache PWA. Le QR ne devient pas un login.
   Aucun partage implicite de session entre plateforme, restaurant ou iframe.
4. **Profil/checkout** : champs vierges seulement, saisie commencée préservée,
   mémoire locale L3a0 distincte, invité conservé, adresse demandée seulement
   pour livraison. Commander pour autrui ne modifie pas le profil en silence.
5. **Propriétaire de commande** : l'API est actuellement appelée directement,
   sans BFF. Raccorder l'autorité serveur à C01/C15 sans `customerRef` public et
   sans réattribuer une tentative figée après connexion/déconnexion. Ne pas
   diffuser ce propriétaire au KDS ou aux événements publics.
6. **Fidélité** : l'index unique `member_profiles(tenant_ref, phone_lookup_hash)`
   peut contenir un téléphone déclaré, non vérifié. Le compte personnel doit
   rester créable sans récupérer cette carte ou ses achats. Nouvelle adhésion
   explicite ; ancienne carte par preuve dédiée, conflits et reprise traités.

Réception : deux clients, même téléphone dans deux tenants, QR partagé, challenge
concurrent/rejoué, réponse perdue, révocation, compte changé pendant une tentative,
stockage quota indisponible, configuration gratuite incomplète/expirée, domaines
personnalisés et PWA. La recette réelle Twilio/appareils reste distincte des tests
simulés. Historique personnel et réachat appartiennent à L3b.

## Références vérifiées

- [Création Verify](https://www.twilio.com/docs/verify/api/verification) : SMS,
  format E.164, `RiskCheck=enable`, restrictions de destinataires en essai.
- [Contrôle Verify](https://www.twilio.com/docs/verify/api/verification-check) :
  référence exacte et `approved` ; `404` peut suivre expiration, approbation ou
  épuisement d'essais et ne prouve donc jamais une approbation.
- [60202 : contrôles](https://www.twilio.com/docs/api/errors/60202) et
  [60203 : envois](https://www.twilio.com/docs/api/errors/60203).
- [Essai Twilio](https://www.twilio.com/docs/usage/trials) et
  [test credentials](https://www.twilio.com/docs/iam/test-credentials) : ne pas
  assimiler les unités Messaging à Verify ni les simulations à des OTP réels.
- [Bonnes pratiques Verify](https://www.twilio.com/docs/verify/developer-best-practices) :
  les SMS Verify sont facturés par segment ; ne pas compter seulement les OTP.
