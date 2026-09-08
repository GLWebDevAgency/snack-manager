# L3a — identité client : raccordement Verify

État du 8 septembre 2026. Complète [l'espace client](HISTORIQUE-ESPACE-CLIENT.md).
**L3a.1 est livré sur staging par #134. L3a.2 prépare la persistance et les
cas d'usage serveur ; l'inscription publique n'est pas encore opérationnelle.**

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

**Aucun contrôleur, provider Nest, worker ou écran n'importe ce code.** Aucune
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
L'orchestrateur vérifie aussi l'environnement de sa configuration serveur ; sa
future composition Nest devra le dériver de l'environnement réel du processus,
pas seulement de `policy.environment`. La protection actuelle contre toute dépense
reste l'absence de raccordement runtime.

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

## L3a.2 — conditions avant ouverture

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
