# Préflight opérateur du compte client

## Compte client et carte : un seul portefeuille

Le compte personnel porte l'identité vérifiée, les clés d'accès et les commandes
privées. `customer.loyalty_memberships` rattache ce compte au membre fidélité du
restaurant. Le solde reste dans `loyalty.wallets`, ses mouvements dans
`loyalty.ledger_entries` : le lien ne crée pas un second solde.

Une ancienne carte QR reste une preuve limitée utilisable en caisse. Le QR seul
ne devient pas une connexion au profil ou à l'historique privé. Le rattachement
en ligne conserve le membre, ses points et ses mouvements, avec un nouveau QR,
après contrôle de la carte et concordance du téléphone déjà vérifié. Un téléphone
seul n'adopte pas silencieusement une carte. La détection d'une carte existante
oriente maintenant vers ce rattachement au lieu de renvoyer inutilement au restaurant.

La recommandation produit est un compte principal avec une adhésion par
restaurant, conditionnée à son programme et à ses droits commerciaux. Les
anciennes cartes restent compatibles. Cette séparation rejoint le modèle
[Square, profil client et compte de fidélité](https://developer.squareup.com/docs/loyalty-api/loyalty-accounts) ;
elle ne justifie pas deux portefeuilles indépendants pour la même carte.

## Périmètre du diagnostic

Le préflight vérifie localement un instantané fourni par l’opérateur. Il ne crée
aucun compte, ne modifie aucun drapeau, ne réserve aucun budget et n’appelle ni
Railway, ni Twilio, ni une base de données. Son résultat n’est pas une
autorisation de dépense ou une preuve d’activation en production.

Le script réutilise les contrôles purs API `customerAccessConfiguration`,
`customerSendConfiguration`, `customerObservationConfiguration` et
`planCustomerPhoneVerification`. Il compare aussi la configuration du BFF avec
la cible explicitement revue, au moyen du contrat partagé
`CustomerAccountDeploymentTargetSchema`. La garde BFF privée n’est pas importée
ni exécutée : les vérifications locales de forme et de portée doivent être
maintenues avec elle.

## Exécution locale

Depuis la racine du dépôt, avec les dépendances installées et `@sm/contracts`
compilé :

```sh
pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-preflight.ts --help
pnpm --filter @sm/scripts exec vitest run customer-account-preflight.test.ts
```

Pour une inspection réelle, le contrôleur opérateur capture les réponses JSON
des lectures CLI autorisées dans la mémoire de ses subprocessus, construit le
document décrit ci-dessous, puis le transmet sur l’entrée standard du script.
Ne pas demander de copier des clés dans une conversation, les placer dans les
arguments du shell, ni écrire les instantanés complets dans un fichier ou un log.
Les sorties CLI brutes doivent rester capturées, y compris lors d’un échec.

Exemple d’appel depuis ce contrôleur, **après** ses lectures autorisées :

```js
const child = spawn(process.execPath, [tsxCli, preflightScript], {
  stdio: ['pipe', 'inherit', 'inherit'],
});
child.stdin.end(JSON.stringify({
  version: 1, api: apiSnapshot, web: webSnapshot,
  target: reviewedTarget, observations: operatorObservations,
}));
```

`tsxCli` se résout avec `createRequire` depuis `packages/customer/package.json` ;
`preflightScript` désigne `scripts/customer-account-preflight.ts`. La cible revue
doit venir de la décision opérateur, **pas être recopiée automatiquement depuis
les valeurs runtime qu’elle doit contrôler**. Aucune lecture externe n’est
déclenchée par le préflight lui-même et il ne lit pas `process.env` applicatif.

## Document d’entrée, version 1

Un seul objet JSON, limité à **256 Kio**. Les champs supplémentaires sont refusés
à chaque niveau structuré. `api` et `web` sont les dictionnaires d’environnement
du runtime, dont les clés et valeurs sont des chaînes ; ils peuvent contenir les
autres variables de ces services. Aucune de leurs valeurs n’est restituée.

| Champ | Contenu |
|---|---|
| `version` | Nombre `1`. |
| `api`, `web` | Variables capturées séparément pour chaque service, jamais fusionnées. |
| `target.environment` | `staging` ou `production`. |
| `target.projectId`, `target.environmentId` | UUID de projet/environnement explicitement attendus. |
| `target.tenantId`, `target.slug` | Identifiant Mongo et slug du restaurant attendu. |
| `target.origins` | Liste exhaustive de 1 à 5 origines HTTPS canoniques, sans chemin ni slash final ; aucun hôte supplémentaire implicite. |
| `target.apiOrigin` | Origine HTTPS exacte de l’API que doit utiliser le BFF. |
| `observations` | Facultatif ; preuves déjà recueillies par l’opérateur, séparées de la configuration. |

Lorsqu’il est fourni, `observations` contient `capturedAt` en millisecondes Unix,
puis éventuellement :

- `tenant: { id, slug, status }` : projection relue du restaurant ; `trial` ou
  `active` pour l’accès actuel.
- `postgres: { migrationsCurrent, runtimeRoleRestricted }` : deux booléens issus
  des contrôles de migration et des droits du rôle runtime.
- `redis: { reachable }` : booléen issu du contrôle de disponibilité.
- `ingress: { trustedClientIp }` : booléen attestant le remplacement de l’adresse
  client par l’ingress de confiance, pas une simple présence d’en-tête arbitraire.
- `passkeys: [{ origin, rpId, registration, authentication, recovery }]` : une
  entrée par origine attendue. Les trois derniers champs sont les résultats
  booléens de recettes réellement exécutées ; `rpId` est le hostname exact.
- `production` : observations distinctes décrites ci-dessous, nécessaires pour
  conclure l’inspection du mode `production_paid`.

Les observations absentes, âgées de cinq minutes ou datées dans le futur restent
`unverified`. Le script valide leur forme et leur cohérence, pas leur authenticité.
Un booléen fourni n’est jamais transformé en attestation du déploiement.

### Observations supplémentaires du mode `production_paid`

Chaque champ est facultatif pour le diagnostic : absent signifie **non vérifié**,
`null` signifie **lecture effectuée sans résultat admissible**, donc blocage.
Ces observations restent dans le document privé transmis sur stdin.

| Champ de `observations.production` | Projection attendue |
|---|---|
| `provider` | Résultat réel de `TwilioProductionObserver.observe` : `reference`, `accountSid`, `serviceSid`, `tenantRef`, `codeLength: 6`, `observedAt`, `settingsFingerprint`. |
| `budget` | Paramètres exacts de `productionSendAvailability` (`parentRef`, `tenantRef`, `authorizationRef`, `serviceSid`, `costEvidenceReference`, `reservePerSendMicrousd`) et son résultat booléen `available`. Aucun montant total autorisé n’est requis dans le préflight. |
| `admissions` | Projection `CustomerProductionAdmissionPolicy` relue : `parentRef`, `tenantRef`, `policyRef`, `windowMs`, `browserSourceLimit`, `browserTenantLimit`, `browserParentLimit`, `intentBrowserLimit`, `intentSourceLimit`, `intentTenantLimit`, `intentParentLimit`. |

La présence d’une politique d’admission ne réserve aucune place pour un appareil
ou une source. Une disponibilité budgétaire positive reste une observation : une
opération concurrente peut consommer ce budget avant la vraie réservation. Le
préflight vérifie les portées et le coût unitaire exact ; il ne refait pas les
requêtes SQL et n’appelle pas l’observateur fournisseur.

## Lecture du résultat

La sortie est un objet JSON avec `readOnly: true`, `source: provided_snapshot`,
des contrôles à codes fixes et les synthèses `access`, `provisioning`, `passkeys`,
`sms`. Ces synthèses portent **sur la configuration et les données nécessaires
au plan pur**, pas sur une autorisation effective d’opérer. En mode production,
`sms` et `provisioning` restent `unverified` tant que l’observation fournisseur
manque. Par exemple,
une passkey peut être correctement configurée tandis que la recette opérateur
du même mécanisme a échoué ; `decision` sera alors `blocked`.

| `decision` | Code de sortie | Sens |
|---|---:|---|
| `invalid_input` | 2 | Document invalide, trop volumineux ou mauvais mode d’appel ; contenu jamais recopié dans l’erreur. |
| `blocked` | 1 | Au moins une configuration est fermée/incohérente, ou une observation fraîche signale un refus. |
| `incomplete` | 1 | Configuration cohérente, mais observations opérateur manquantes ou périmées. |
| `configuration_valid` | 0 | Contrôles cohérents et observations complètes ; aucune promesse de compte créé, de budget réservé ou de production activée. |

Un financement Verify expiré bloque le démarrage d’une nouvelle inscription par
téléphone et les opérations fournisseur ; il ne ferme pas à lui seul la
configuration des sessions existantes, des passkeys ou de la récupération.
Inversement, une clé fournisseur valide ou un solde monétaire ne prouvent pas
l’autorisation de dépenser. Une permission de lire le service Verify sans pouvoir
attester les données du compte fournisseur ne suffit pas à fabriquer cette preuve.
Le plan accepte uniquement ses données complètes, cohérentes et encore valides.
Même un plan positif indique `durable_reservation_still_required` : seul le
runtime peut réserver atomiquement le budget restant, puis revalider les autres
conditions avant un appel. Le préflight ne lit pas ce registre.

Les modes `closed_trial` et `closed_paid_pilot` restent limités au staging ; leur
transposition en production retourne `production_intentionally_closed`. Le mode
distinct `production_paid` accepte une cible explicite staging ou production,
sans reprendre les valeurs ou la liste de téléphones du pilote.

## Configuration du mode de production

Pour `api` et `web`, `SM_CUSTOMER_ACCOUNT_MODE=production_paid` et
`SM_CUSTOMER_PRODUCTION_TARGET` contiennent la même cible versionnée :
`version: 1`, `environment`, `railwayProjectId`, `railwayEnvironmentId`,
`tenantRef`, `slug`, `verifyAccountSid`, `verifyServiceSid`, `origins`, `apiOrigin`.
Les identifiants natifs Railway doivent correspondre. Le BFF conserve son
`NEXT_PUBLIC_API_URL` exact et la clé de relais dédiée commune ; l’API conserve
sa clé d’identité indépendante. Aucun repli depuis les variables pilote.

L’API reçoit une politique `SM_CUSTOMER_VERIFY_POLICY` contenant le mode,
l’environnement et les portées compte/service/tenant, `authorizationRef`,
`costEvidenceReference`, `evidenceNotBefore`, `expiresAt`,
`globalSendReservations`, `tenantSendReservations` et `ipSendReservations`.
Ce dernier est obligatoire, entier entre 1 et 1 000 réservations par IP sur
24 heures, choisi explicitement par l’opérateur selon le contexte, notamment
le Wi-Fi partagé d’un restaurant. Il ne reprend aucune valeur par défaut du
pilote. La limite par téléphone reste de trois réservations sur 24 heures et
le délai minimal entre envois de 60 secondes. **Aucun montant de budget
n’est accepté dans cette politique.** Le périmètre reste les mobiles français
normalisés `+336`/`+337`, sans liste fermée de destinataires ; les protections par
téléphone, source et intention restent appliquées.

`SM_CUSTOMER_VERIFY_EVIDENCE` contient strictement `{ account, safeguards, costs }`.
Les schémas exacts sont exportés par
[`production-verification-policy.ts`](../../apps/api/src/modules/customer-identity/production-verification-policy.ts).
`account` est une attestation opérateur distincte : `reference`, `accountSid`,
`serviceSid`, `tenantRef`, `accountType: "Full"`, `accountStatus: "active"`,
`attestedAt` et `expiresAt` en millisecondes Unix. L’opérateur doit vérifier le
type et l’état réels ; un solde positif ou le seul libellé « Active » ne prouve
pas le type Full. Le préflight identifie explicitement cette attestation comme
une configuration opérateur, jamais comme une observation automatique.

L’ajout de `serverObservation` dans cette variable est refusé : l’observation du
service provient exclusivement du serveur, en mémoire. L’adaptateur utilise la
clé Verify existante `SM_CUSTOMER_VERIFY_API_KEY_SID`/`SECRET`, avec la permission
`twilio/verify/service/read` en plus des permissions nécessaires à l’envoi et à
la vérification. Aucune clé supplémentaire ni permission IAM Accounts n’est
requise. La [réponse Accounts GET](https://www.twilio.com/docs/iam/api/account#fetch-an-account-resource)
documente un champ secret `auth_token` : ce runtime ne lit jamais cette ressource
et ne doit pas recevoir une clé Main ou des droits de lecture Accounts.
Référence : [permissions Verify](https://docs-resources.prod.twilio.com/documents/Twilio_Restricted_API_Keys_Permissions_-_Verify_Permissions.pdf).

L’adaptateur relit uniquement le service Verify en GET authentifié, conserve un
cache de cinq minutes et effectue une nouvelle lecture au besoin après cette durée.
La validité technique maximale du plan est de quinze minutes. Un échec de
lecture ne rajeunit pas l’ancien succès. L’API de service ne prouve pas à elle
seule que SMS et Fraud Guard sont activés ni la durée maximale du code : ces
protections sont attestées séparément dans `safeguards`. L’empreinte des sept
paramètres exposés doit encore correspondre au service réellement lu.

Les attestations `account`, `safeguards` et `costs` ont chacune une validité explicite d’au
plus **sept jours**. Le rafraîchissement automatique de l’observation technique
ne modifie jamais leur date, leur contenu ou leur portée. Leur renouvellement
nécessite une nouvelle vérification opérateur ; aucune borne de segmentation,
de frais ou de coût n’est inventée à partir de la longueur du code ou d’un solde.

Le financement et les limites d’admission se provisionnent séparément par le
connexion migrateur existante, hors runtime, via
[`PostgresCustomerProductionOperator`](../../packages/customer/src/production-operator.ts).
L’autorisation financière est immuable, révocable et activée explicitement ;
son remplacement utilise la référence active attendue. Le runtime ne crée pas
de budget : il en lit la disponibilité, réserve atomiquement chaque envoi et
revalide son financement initial avant le fournisseur. Ni changement de JSON,
ni renouvellement d’attestation, ni passage à un autre budget ne transforme une
ancienne opération incertaine en nouvel envoi gratuit.

### Commande opérateur

[`customer-account-operator.ts`](../../scripts/customer-account-operator.ts) reçoit
sur stdin un document strict `{ action, target, input }`. `target` utilise le
contrat de déploiement ci-dessus ; `input` utilise les schémas exportés du port
opérateur. Les actions sont `authorize-budget`, `activate-budget`,
`revoke-budget` et `authorize-admissions`.

```sh
pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-operator.ts --help
# Aperçu sans accès réseau/base, depuis un producteur d'entrée opérateur :
operator-input-producer | pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-operator.ts
# Application explicite du même document, sur la cible revue :
operator-input-producer | pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-operator.ts --apply
```

`--apply` exige les identifiants natifs Railway concordants, `SM_ENV` explicite,
`DATABASE_MIGRATION_URL`, `DATABASE_MIGRATION_ROLE` et `DATABASE_RUNTIME_ROLE`.
La connexion chiffrée reste la même pour les contrôles et l'opération. Le rôle
migrateur doit être celui attendu, séparé du runtime, et les migrations à jour.
Une sonde vérifie aussi que le runtime ne dispose que de SELECT sur les quatre
tables opérateur, sans écriture, délégation ni privilège de colonne parasite.
La commande ne crée aucun rôle, ne répare aucun privilège et ne migre aucun
schéma. Le bootstrap déployé conserve ses deux rôles existants.

Tous les montants, plafonds et dates d'un budget sont explicites. Autoriser une
enveloppe et la sélectionner sont deux actions distinctes ; `activate-budget`
exige `expectedActiveAuthorizationRef`, y compris `null` pour la première.
Un résultat `unconfirmed` signifie que l'accusé d'application a été perdu : lire
le registre avant de poursuivre, sans inventer une autre référence budgétaire.
Les anciennes enveloppes et leurs consommations restent enregistrées.

La politique SQL d’admission est distincte des plafonds d’envoi et du budget :
une seule politique immuable par compte parent, liée à un seul tenant, définit
les fenêtres glissantes de 1 minute à 24 heures. Le port actuel ne remplace pas
ses limites et ne propose pas de réactivation après révocation. Les journaux
d’admission restent conservés ; l’expiration d’une fenêtre libère de la capacité
sans supprimer de reçu. Un budget épuisé ou révoqué ne ferme pas à lui seul
ces admissions ni les reconnexions par clé d’accès.

La création de cette politique scelle les **nouvelles** réservations du mode
pilote sur ce compte parent, même avant le premier financement de production.
Revenir à un ancien binaire ne constitue donc pas une procédure de reprise
des inscriptions : les protections SQL refusent ses nouvelles admissions et
ses nouveaux envois. Les journaux et les opérations existantes ne sont pas
réinitialisés. Vérifier la cible et les limites avant ce provisionnement.

## Avant de conclure à une ouverture

Conserver la preuve de révision réellement servie séparément du rapport. Une
variable web observée n’atteste pas le contenu compilé du bundle. Vérifier les
migrations et les droits runtime par les procédures PostgreSQL existantes,
puis exécuter la recette du parcours sur l’origine finale : création/protection,
connexion, récupération, fermeture de session et continuité compte/fidélité.
Chaque origine possède actuellement son RP exact ; une clé créée sur un autre
domaine ne devient pas utilisable simplement parce que ce domaine est autorisé.

L’adhésion fidélité continue à dépendre du programme et des droits du restaurant,
avec acceptation explicite et rattachement protégé de la carte existante. Le
préflight compte n’ouvre pas le module commercial et ne fusionne aucun solde.

Références : [identité et financement Verify](IDENTITE-CLIENT-VERIFY.md),
[passkeys et récupération](COMPTE-CLES-ACCES.md),
[compte et fidélité unifiés](REPRISE-COMPTE-FIDELITE-2026-09-12.md).

## État de vérification au 12 septembre 2026

Le code local du plan `production_paid` passe **111 tests** et le préflight
opérateur **66 tests**, avec typage strict ciblé ; le plan passe aussi le lint
ciblé. Ce sont des contrôles locaux, pas une preuve d’ouverture du service.

Le relevé staging communiqué par l’opérateur de cette recette, en lecture seule
(transaction PostgreSQL `READ ONLY`, Mongo primaire/majorité et Redis `PING`),
constate : Classfood actif en Boost, identité de cible concordante, aucun compte
client sur cette cible, neuf migrations du module customer présentes et Redis
joignable. Le rôle PostgreSQL runtime n’a ni privilège superutilisateur, ni droit
de créer rôles/bases, ni contournement RLS. Ce dernier constat ne remplace pas
l’audit complet des privilèges des nouvelles tables.

Les tables `production_budget_authorizations` et
`production_admission_policies` sont absentes de ce staging : les deux nouvelles
migrations portant le module à onze ne sont pas encore déployées. Le mode, la
politique et les attestations Verify sont également absents du dernier relevé
de configuration. Aucune variable distante n’a été modifiée lors de ce relevé.
**Activation staging et production non acquises à ce stade.** La révision servie,
les migrations, le financement explicite et les recettes réelles restent à
consigner après leur exécution.

Contrôles complémentaires locaux : web **2 998/2 998**, contrats **693/693**,
module API identité **949 réussis** (89 tests conditionnels absents de cette
passe), customer **421/421**, bootstrap **128/128**, et frontières API/store
**83/83** sur les passages PostgreSQL/Mongo locaux complémentaires, plus **6/6**
tests de quotas sur Redis local. Le correctif de
date de révocation a ensuite passé **15 tests PostgreSQL ciblés**. Les séries
se recouvrent : aucun total cumulé n'est une mesure de couverture. Typage, lint
et compilation des packages concernés : **25 tâches réussies** sur la dernière
passe. Le CLI opérateur passe **132 tests**, son typage strict ciblé et son lint.
La CI doit encore recevoir le commit final.

La lecture Mongo de production par slug `classfood` ne trouve aucun établissement.
La création de cet établissement n'est pas déduite de son existence en staging.
La recette réelle reste suspendue au numéro contrôlé par le testeur, à la
reconnexion Console, au financement explicite et aux protections fournisseur
vérifiées. Aucun SMS ni création de compte distant n'a été effectué lors de ces
contrôles.
