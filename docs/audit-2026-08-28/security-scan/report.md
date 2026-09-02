# Security Review: GLWebDevAgency/snack-manager

## Scope

Revue statique source-backed du monorepo SnackManager, centrée sur les frontières Internet, l'authentification, l'autorisation multi-tenant, POS/KDS, commandes, WebSockets, exports, télémétrie, paiements, sauvegardes et déploiement.

- Scan mode: repository
- Target kind: git_worktree
- Target ID: target_sha256_9ce15e7c0b0f07c75f7228afbe50cd200d63c7033ef61dcc16d2d20fcbbf47a5
- Revision: 5438fb2b88c09111b732ac971ee56677099a7803
- Snapshot digest: codex-security-snapshot/v1:sha256:24a83e361ed3eff4ea2adf37d0d191a8478353f840483d090c089586e4f4b30d
- Inventory strategy: repository
- Included paths: .
- Excluded paths: .git/, \*\*/node_modules/, \*\*/dist/, \*\*/.next/, docs/audit-2026-08-28/screenshots/
- Runtime or test status: Aucun test d'exploitation intrusif n'a été exécuté. Les quatre surfaces publiques de production ont été vérifiées par smoke test séparé.
- Artifacts reviewed: apps/api/src/, apps/web/src/, apps/pos/, apps/kds/, packages/contracts/src/, packages/client-core/src/, packages/db/src/, .github/workflows/, infra/

Limitations and exclusions:
- Aucun test d'intrusion dynamique ou authentifié contre la production.
- La configuration effective Railway, GitHub, Stripe, Cloudflare, MongoDB, PostgreSQL, Redis et Sentry n'était pas disponible.
- La branche a évolué pendant l'audit; les localisations ont été revérifiées sur la révision finale indiquée.
- Excluded \*\*/node_modules/\*\*: Dépendances tierces couvertes séparément par pnpm audit, pas par revue source exhaustive.
- Excluded \*\*/dist/\*\* et \*\*/.next/\*\*: Artefacts générés; le code source et les scripts de build/serveur ont été privilégiés.
- Excluded Exploitation intrusive de production: Hors autorisation et inutile pour établir les chemins source reportés.

### Scan Summary

| Field | Value |
| --- | --- |
| Scan outcome | completed |
| Reportable findings | 10 |
| Severity mix | high: 3, medium: 6, low: 1 |
| Confidence mix | high: 8, medium: 2 |
| Coverage | partial |
| Validation mode | Revue statique manuelle, traces source-vers-sink et contre-preuves. |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

SaaS restaurant multi-tenant exposant Next.js, POS/KDS Expo et API NestJS, avec MongoDB, PostgreSQL et Redis. Les actifs majeurs sont les commandes et données clients, identités utilisateurs et appareils, paiement Stripe, stock, personnel, secrets d'exploitation et sauvegardes.

### Assets

- Commandes, prix, réductions, noms et téléphones clients par tenant.
- Stock, recettes, coûts matière et mouvements PostgreSQL.
- Planning, pointage, coût du personnel et sessions PIN.
- JWT, jetons POS/KDS/écrans, tracking et sauvegarde.
- Secrets Stripe, statuts de paiement et comptes connectés.
- Autorité sm_admin cross-tenant, déploiement et configuration Railway.
- Sauvegardes MongoDB/PostgreSQL et journaux d'audit.

### Trust Boundaries

- Internet anonyme vers routes publiques de commande, suivi, appairage, télémétrie et webhooks.
- Navigateur back-office et stockage local vers authentification Bearer API.
- POS/KDS appairé puis PIN employé vers jeton appareil et JWT staff.
- Claims tenant signés vers requêtes MongoDB/PostgreSQL et rooms WebSocket.
- sm_admin vers opérations cross-tenant et contrôle du parc.
- API vers Stripe, Railway, Cloudflare, Sentry, MongoDB, PostgreSQL et Redis.
- Runner GitHub vers production et sauvegardes.

### Attacker Capabilities

- Un attaquant Internet peut appeler les routes publiques et WebSockets avec des entrées arbitraires sans accès initial aux secrets.
- Un client légitime peut posséder un token de suivi d'une commande mais pas l'autorité restaurant.
- Un salarié, ex-salarié ou voleur de tablette peut posséder un JWT ou jeton appareil précédemment valide.
- Un site malveillant peut attirer un utilisateur authentifié et tenter framing, redirections ou liens configurés.
- La compromission initiale des fournisseurs cloud et de leurs consoles n'est pas supposée.

### Security Objectives

- Isoler strictement tenants, rôles, appareils, écrans et clients.
- Révoquer immédiatement toute session ou connexion désactivée.
- Ne transmettre les secrets qu'aux origines prévues.
- Empêcher les commandes non vérifiées de perturber la cuisine.
- Préserver intégrité, confidentialité et restaurabilité des données.
- Séparer staging et production dans le code, les builds et les secrets.

### Assumptions

- Les contrôles d'infrastructure non présents dans le dépôt ne sont pas considérés comme actifs.
- Les clients web KDS/POS déployés exécutent le code source audité.
- Le reverse proxy peut ajouter X-Forwarded-For mais aucune garantie de reconstruction de cet en-tête n'est prouvée dans le dépôt.
- HACCP et IoT sont des fonctions futures et non des surfaces de sécurité actuelles.

## Findings

| Finding | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- |
| [Les connexions WebSocket survivent à l'expiration et à la révocation](#finding-1) | high | high | inline below |
| [Le paramètre d'URL KDS peut détourner les jetons appareil et employé](#finding-2) | high | high | inline below |
| [Des commandes anonymes non vérifiées peuvent saturer le flux cuisine](#finding-3) | high | high | inline below |
| [Les interfaces d'administration peuvent être intégrées dans un site malveillant](#finding-4) | medium | medium | inline below |
| [Les limites publiques utilisent une adresse X-Forwarded-For falsifiable](#finding-5) | medium | medium | inline below |
| [Une URL mal encodée peut arrêter les serveurs web POS et KDS](#finding-6) | medium | high | inline below |
| [Le fallback du formulaire de contact écrit les coordonnées prospects dans les logs](#finding-7) | medium | high | inline below |
| [La désactivation d'un salarié ou appareil ne révoque pas les JWT déjà émis](#finding-8) | medium | high | inline below |
| [Un nom client peut devenir une formule lors de l'export Excel](#finding-9) | medium | high | inline below |
| [Le temps de réponse du login révèle probablement l'existence d'un compte](#finding-10) | low | high | inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Les connexions WebSocket survivent à l'expiration et à la révocation

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | L'admission, le join de room et l'absence de revalidation sont explicites dans le gateway. |
| Category | websocket-authorization |
| CWE | CWE-613 |
| Affected lines | apps/api/src/modules/orders/orders.gateway.ts:68-76, apps/api/src/modules/orders/orders.gateway.ts:87-114, apps/api/src/common/auth.ts:103-130 |

#### Summary

Le gateway vérifie le JWT seulement à la connexion, rejoint tenant:\<tenantId\>, puis ne consulte plus l'état du tenant, du salarié ou de l'appareil et ne programme pas de déconnexion à exp. Les commandes complètes continuent d'être diffusées à la room.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue statique du gateway et comparaison avec le guard HTTP.

- **Status:** confirmed

Assertions:
- Une socket est fermée à exp et immédiatement après toute révocation liée.
- Une socket révoquée ne reçoit plus aucun order.created.

Counterevidence and remaining uncertainty:
- Signature et expiration sont vérifiées à la connexion initiale.
- Le flux public de suivi utilise un token et une projection réduite; le constat vise les rooms tenant.

#### Dataflow

The canonical finding records the affected path at apps/api/src/modules/orders/orders.gateway.ts:68-76, apps/api/src/modules/orders/orders.gateway.ts:87-114, apps/api/src/common/auth.ts:103-130, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — Une connexion ouverte peut recevoir indéfiniment des données clients après suspension, vol ou départ d'un salarié.

Le risque baisse avec une admission partagée, une déconnexion à exp et des événements de révocation.

#### Remediation

Utiliser un service de session commun HTTP/WebSocket, vérifier tenant, staff, rôle et appareil à l'admission, déconnecter à l'expiration du JWT et sur événements de révocation, avec revalidation périodique de secours.

Tests:
- Test WebSocket avec horloge contrôlée et expiration.
- Test de suspension tenant, désactivation staff et révocation appareil sur socket ouverte.

<a id="finding-2"></a>

### [2] Le paramètre d'URL KDS peut détourner les jetons appareil et employé

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | La chaîne query string vers localStorage, API_URL, headers et auth Socket.IO est directe dans le source. |
| Category | credential-exposure |
| CWE | CWE-346 |
| Affected lines | apps/kds/src/config.ts:15-38, apps/kds/src/useTenantSocket.ts:34-49, apps/kds/src/client.ts:295-348 |

#### Summary

Le build web KDS accepte et persiste une origine API arbitraire issue de ?api=, puis y envoie le jeton appareil et le JWT staff via HTTP et Socket.IO. Un lien piégé ouvert sur un KDS déjà appairé peut donc exfiltrer les deux secrets.

#### Root Cause

Une configuration de développement contrôlée par l'URL est autorisée dans le build web de production et alimente un transport porteur de credentials.

#### Validation

Validation outcomes are recorded below.

Validation method: Trace statique source-vers-sink.

- **Status:** confirmed

Assertions:
- Un build de production ignore ?api= et toute ancienne valeur locale.
- Aucun JWT ni jeton appareil n'est envoyé à une origine hors allowlist.

Counterevidence and remaining uncertainty:
- Le chemin est limité au web; les builds natifs ignorent l'override.
- CORS n'empêche pas l'exfiltration vers un serveur contrôlé par l'attaquant.

#### Dataflow

The canonical finding records the affected path at apps/kds/src/config.ts:15-38, apps/kds/src/useTenantSocket.ts:34-49, apps/kds/src/client.ts:295-348, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — La compromission expose données clients et mutations de commande avec des secrets persistants.

Le risque baisse si l'override est strictement désactivé dans tous les builds accessibles et les anciennes valeurs locales sont purgées.

#### Remediation

Supprimer l'override des builds de production. Si nécessaire en développement, l'activer uniquement sous flag explicite, sur localhost, après parsing et allowlist HTTPS exacte. Purger sm.kds.cfg.api et ne jamais construire un transport authentifié depuis un paramètre non fiable.

Tests:
- Test E2E du build production avec ?api=https://example.invalid et vérification qu'aucune requête ne part.
- Test de migration supprimant la clé locale historique.

<a id="finding-3"></a>

### [3] Des commandes anonymes non vérifiées peuvent saturer le flux cuisine

| Field | Value |
| --- | --- |
| Severity | high |
| Confidence | high |
| Confidence rationale | Le schéma public, la condition pickup, la création new et la publication immédiate sont explicites. |
| Category | business-logic-abuse |
| CWE | CWE-799 |
| Affected lines | packages/contracts/src/index.ts:342-355, apps/api/src/modules/orders/orders.controller.ts:146-181, apps/api/src/modules/orders/orders.service.ts:296-330 |

#### Summary

La route publique accepte des types sans créneau obligatoire, crée immédiatement une commande new et publie order.created avant confirmation de paiement. Des UUID uniques permettent d'injecter jusqu'à vingt tickets par minute et par adresse apparente dans la cuisine.

#### Root Cause

Le contrat interne général est réutilisé comme contrat public et la visibilité cuisine n'est pas conditionnée par une étape de vérification.

#### Validation

Validation outcomes are recorded below.

Validation method: Trace statique et analyse d'abus métier.

- **Status:** confirmed

Assertions:
- Une commande publique sans créneau ou non vérifiée ne rejoint pas le KDS.
- Un dépassement distribué déclenche un quota tenant ou global.

Counterevidence and remaining uncertainty:
- Un throttle de vingt requêtes par minute et par IP existe.
- Les prix sont recalculés côté serveur et clientId est idempotent, mais des UUID uniques contournent ce frein.

#### Dataflow

The canonical finding records the affected path at packages/contracts/src/index.ts:342-355, apps/api/src/modules/orders/orders.controller.ts:146-181, apps/api/src/modules/orders/orders.service.ts:296-330, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**High** — L'abus peut interrompre un service réel, polluer les métriques et consommer stockage et numéros de commande.

Le risque baisse si les commandes non vérifiées restent hors KDS et si des quotas tenant/globaux partagés sont appliqués.

#### Remediation

Créer un schéma de commande publique dédié, forcer le type supporté et un créneau valide, conserver les commandes non vérifiées hors du KDS jusqu'au paiement ou à un contrôle équivalent, puis ajouter des quotas partagés par tenant, origine et global ainsi que des contrôles anti-bot adaptés au paiement comptoir.

Tests:
- Test d'abus de commandes impayées et sans pickup.
- Test concurrent multi-IP simulant le quota par tenant.

<a id="finding-4"></a>

### [4] Les interfaces d'administration peuvent être intégrées dans un site malveillant

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | L'absence applicative et les mutations en un clic sont prouvées; les en-têtes de l'hébergeur n'ont pas été vérifiés comme garantie. |
| Category | clickjacking |
| CWE | CWE-1021 |
| Affected lines | apps/web/next.config.ts:3-5, apps/web/src/proxy.ts:477-515, apps/web/src/app/admin/menu/page.tsx:703-745 |

#### Summary

La configuration Next ne définit pas d'en-têtes globaux et le proxy ne limite frame-ancestors que pour certains embeds. Les pages /admin et /sm restent frameables et lisent leur JWT localStorage dans le frame, permettant des clics trompeurs sur des mutations en un geste.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue de configuration et du flux navigateur.

- **Status:** confirmed-with-hosting-caveat

Assertions:
- Un domaine tiers ne peut pas afficher /admin ni /sm dans un iframe.
- Les routes embed autorisées continuent de fonctionner avec leur allowlist.

Counterevidence and remaining uncertainty:
- Certaines actions destructives ont déjà confirmation ou PIN, mais pas toutes les mutations.

Limitations:
- En-têtes éventuels injectés par l'hébergement non prouvés.

#### Dataflow

The canonical finding records the affected path at apps/web/next.config.ts:3-5, apps/web/src/proxy.ts:477-515, apps/web/src/app/admin/menu/page.tsx:703-745, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Un propriétaire authentifié peut être amené à modifier disponibilité, stock ou autre configuration via superposition d'interface.

Un en-tête frame-ancestors déjà imposé par l'hébergeur réduirait le risque, mais aucune preuve n'est présente dans le dépôt.

#### Remediation

Définir CSP frame-ancestors 'none' ou 'self' et X-Frame-Options DENY/SAMEORIGIN sur toutes les pages hors embed. Garder une exception explicite et étroite pour /embed/\* et tester les en-têtes de /admin, /sm et des widgets.

Tests:
- Test automatisé des en-têtes et tentative d'iframe cross-origin.

<a id="finding-5"></a>

### [5] Les limites publiques utilisent une adresse X-Forwarded-For falsifiable

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Le parsing vulnérable est certain; le comportement exact du proxy de production est hors dépôt. |
| Category | rate-limit-bypass |
| CWE | CWE-400 |
| Affected lines | apps/api/src/modules/ops/public-errors.controller.ts:23-61, apps/api/src/modules/ops/report-throttle.ts:15-39, apps/web/src/app/api/contact/route.ts:109-113 |

#### Summary

La télémétrie API et le formulaire de contact prennent directement la première valeur de X-Forwarded-For. Si l'edge ajoute au lieu de remplacer l'en-tête, un attaquant peut faire tourner cette valeur et obtenir un nouveau bucket à chaque requête.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue source et hypothèse d'ingress explicite.

- **Status:** confirmed-with-runtime-prerequisite

Assertions:
- Changer le X-Forwarded-For fourni par le client ne change pas son identité de quota.
- Les quotas globaux bornent l'abus même distribué.

Counterevidence and remaining uncertainty:
- Les corps sont bornés et les maps ont une limite de clés.
- Les FunnelEvent expirent après 90 jours, mais ErrorEvent n'a pas de TTL.

Limitations:
- Configuration réelle du proxy non disponible.

#### Dataflow

The canonical finding records the affected path at apps/api/src/modules/ops/public-errors.controller.ts:23-61, apps/api/src/modules/ops/report-throttle.ts:15-39, apps/web/src/app/api/contact/route.ts:109-113, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — L'abus peut remplir MongoDB et les logs, consommer les quotas Sentry/alerte, polluer le funnel et spammer les leads.

Une preuve que l'ingress supprime et reconstruit systématiquement X-Forwarded-For réduirait l'exploitabilité.

#### Remediation

Faire confiance uniquement à req.ip après configuration des CIDR proxy exacts, imposer la reconstruction de l'en-tête à l'edge, déplacer les limites dans Redis ou à l'edge et ajouter des quotas globaux et par route. Authentifier la télémétrie appareil quand possible et expirer/capper les ErrorEvent.

Tests:
- Test d'intégration derrière le proxy réel avec un X-Forwarded-For forgé.

<a id="finding-6"></a>

### [6] Une URL mal encodée peut arrêter les serveurs web POS et KDS

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Le script start exécute ces serveurs et l'exception synchrone n'est pas interceptée. |
| Category | denial-of-service |
| CWE | CWE-248 |
| Affected lines | apps/pos/server.js:29-56, apps/kds/server.js:29-56 |

#### Summary

Les serveurs de production POS et KDS appellent decodeURIComponent sur le chemin brut sans try/catch. Une requête comme /% ou /%ZZ lève URIError hors gestionnaire et termine le processus Node.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue statique du chemin de requête.

- **Status:** confirmed

Assertions:
- Les chemins percent-encodés invalides renvoient 400 et le processus reste vivant.

Counterevidence and remaining uncertainty:
- Un superviseur peut redémarrer le processus, sans empêcher la répétition de l'attaque.

#### Dataflow

The canonical finding records the affected path at apps/pos/server.js:29-56, apps/kds/server.js:29-56, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Une requête anonyme suffit à rendre une surface indisponible; les redémarrages peuvent être répétés pendant le service.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Intercepter URIError et renvoyer 400 avant tout accès fichier, protéger l'ensemble du handler, gérer les erreurs de stream et ajouter des tests de régression sur les encodages invalides.

Tests:
- Tests HTTP /%, /%ZZ et séquences UTF-8 invalides sur les deux serveurs.

<a id="finding-7"></a>

### [7] Le fallback du formulaire de contact écrit les coordonnées prospects dans les logs

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Le fallback et l'absence de contrôleur correspondant sont explicites dans le source inspecté. |
| Category | sensitive-data-exposure |
| CWE | CWE-532 |
| Affected lines | apps/web/src/app/api/contact/route.ts:48-64, apps/web/src/app/api/contact/route.ts:136-174 |

#### Summary

Le handler collecte nom, restaurant, téléphone, email et créneau. Comme /public/leads n'existe pas dans l'API inspectée, les erreurs et 404 sérialisent ces champs dans console.warn; seul le corps libre du message est masqué.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue statique de la route et recherche de l'endpoint cible.

- **Status:** confirmed

Assertions:
- Aucun téléphone, email ou nom n'apparaît dans les logs de succès ou d'échec.

Counterevidence and remaining uncertainty:
- Le message libre n'est déjà pas journalisé en clair.

#### Dataflow

The canonical finding records the affected path at apps/web/src/app/api/contact/route.ts:48-64, apps/web/src/app/api/contact/route.ts:136-174, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Les coordonnées sont copiées dans un système de logs aux accès et durées distincts du futur CRM.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Créer un stockage de leads avec accès, chiffrement et rétention définis. Ne journaliser qu'un identifiant de corrélation, une catégorie de résultat et des métriques non sensibles; purger les logs historiques selon la politique de confidentialité.

Tests:
- Test de logs sur succès, 404, 500, timeout et erreur réseau avec marqueurs PII.

<a id="finding-8"></a>

### [8] La désactivation d'un salarié ou appareil ne révoque pas les JWT déjà émis

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Le payload JWT, le guard et les mutations active/role/device ont été suivis directement. |
| Category | session-management |
| CWE | CWE-613 |
| Affected lines | apps/api/src/modules/devices/device-pin-login.usecase.ts:57-80, apps/api/src/common/auth.ts:103-130, apps/api/src/modules/staff/staff.service.ts:91-118 |

#### Summary

Le login PIN vérifie salarié et appareil uniquement lors de l'émission d'un JWT de douze heures. Le guard HTTP ne recharge ensuite ni Staff ni Device et le token ne contient pas d'identifiant de session ou de version de révocation.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue du cycle de vie du token.

- **Status:** confirmed

Assertions:
- Désactiver un salarié, changer son rôle ou révoquer l'appareil invalide immédiatement les requêtes existantes.

Counterevidence and remaining uncertainty:
- Les nouveaux logins PIN refusent déjà un salarié ou appareil inactif.
- Le client officiel efface sa session après un 401 appareil, mais un bearer copié reste utilisable directement.

#### Dataflow

The canonical finding records the affected path at apps/api/src/modules/devices/device-pin-login.usecase.ts:57-80, apps/api/src/common/auth.ts:103-130, apps/api/src/modules/staff/staff.service.ts:91-118, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — Un ex-salarié, un manager rétrogradé ou le voleur d'une tablette peut conserver ses droits jusqu'à douze heures.

Une courte durée de token limite la fenêtre mais ne remplace pas la révocation immédiate attendue.

#### Remediation

Lier les JWT staff à une session/appareil et à une version de token. Vérifier via cache serveur que le salarié est actif, que son rôle courant correspond et que la session/appareil n'est pas révoqué. Incrémenter la version et déconnecter lors des changements, avec access tokens courts et refresh rotatif.

Tests:
- Test d'intégration login puis deactivation/role-change/device-revoke avec ancien bearer.

<a id="finding-9"></a>

### [9] Un nom client peut devenir une formule lors de l'export Excel

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | high |
| Confidence rationale | Le champ public atteint directement le sérialiseur CSV ciblant Excel. |
| Category | csv-injection |
| CWE | CWE-1236 |
| Affected lines | packages/contracts/src/index.ts:342-355, apps/api/src/modules/stats/stats.service.ts:83-87, apps/api/src/modules/stats/stats.service.ts:437-501 |

#### Summary

customerName est accepté publiquement puis exporté dans commandes.csv. Le helper CSV échappe séparateurs et guillemets mais ne neutralise pas les cellules commençant par =, +, -, @ ou un caractère de contrôle.

#### Validation

Validation outcomes are recorded below.

Validation method: Trace de donnée statique.

- **Status:** confirmed

Assertions:
- Les préfixes de formule restent inertes dans Excel et LibreOffice.

Counterevidence and remaining uncertainty:
- L'export est authentifié owner/gerant, mais la donnée vient d'une commande anonyme.
- Mettre une cellule entre guillemets ne neutralise pas une formule.

#### Dataflow

The canonical finding records the affected path at packages/contracts/src/index.ts:342-355, apps/api/src/modules/stats/stats.service.ts:83-87, apps/api/src/modules/stats/stats.service.ts:437-501, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Medium** — L'ouverture par un gérant peut exécuter une formule, déclencher une requête externe ou présenter un lien trompeur.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Centraliser un sérialiseur CSV compatible tableurs et neutraliser toute cellule non fiable commençant par =, +, -, @, tabulation, retour chariot ou saut de ligne, avec politique documentée et limites de longueur.

Tests:
- Test unitaire de chaque préfixe dangereux et ouverture manuelle du fichier généré.

<a id="finding-10"></a>

### [10] Le temps de réponse du login révèle probablement l'existence d'un compte

| Field | Value |
| --- | --- |
| Severity | low |
| Confidence | high |
| Confidence rationale | Le court-circuit JavaScript évite explicitement Argon2 pour l'utilisateur absent. |
| Category | account-enumeration |
| CWE | CWE-208 |
| Affected lines | apps/api/src/modules/auth/auth.service.ts:22-36 |

#### Summary

AuthService court-circuite quand l'email est inconnu, alors qu'un email valide avec mauvais mot de passe exécute Argon2. Le message est identique, mais la différence de calcul crée un oracle temporel.

#### Validation

Validation outcomes are recorded below.

Validation method: Revue statique du court-circuit d'authentification.

- **Status:** confirmed

Assertions:
- Les distributions de temps email inconnu et mot de passe faux ne sont pas distinguables de façon exploitable.

Counterevidence and remaining uncertainty:
- Le message est déjà générique et le login limité à dix tentatives par minute et par adresse.

#### Dataflow

The canonical finding records the affected path at apps/api/src/modules/auth/auth.service.ts:22-36, but no expanded source-to-sink narrative was recorded.

#### Reachability

Reachability was not recorded beyond the canonical finding summary and affected locations.

#### Severity

**Low** — L'énumération facilite phishing et credential stuffing, avec impact indirect et throttle existant.

Additional runtime or deployment evidence could raise or lower this severity.

#### Remediation

Conserver un hash Argon2 factice valide et vérifier le mot de passe contre lui lorsque l'utilisateur est absent. Garder réponse et throttling identiques et surveiller les sondages distribués.

Tests:
- Benchmark statistique des deux chemins en CI dédiée.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Clients POS/KDS, appairage, stockage local et cibles API | credential-routing-and-device-sessions | Reported | Override KDS, révocation et serveurs statiques examinés. |
| Commande publique, paiement et publication cuisine | abuse-and-order-integrity | Reported | No additional canonical notes were recorded. |
| Authentification, rôles et isolation tenant | authentication-and-authorization | Reported | Aucun IDOR tenant reportable trouvé; révocation de sessions incomplète. |
| Rooms WebSocket et événements temps réel | authorization-lifecycle | Reported | No additional canonical notes were recorded. |
| Exports CSV et documents | output-injection | Reported | No additional canonical notes were recorded. |
| Télémétrie, funnel et formulaire de contact | resource-abuse-and-privacy | Reported | No additional canonical notes were recorded. |
| En-têtes web, framing et stockage de session | browser-security | Reported | No additional canonical notes were recorded. |
| Stripe, webhooks et routage du paiement | payment-integrity | No issue found | Signatures raw-body, secrets séparés et routage Connect examinés; aucun contournement reportable trouvé. |
| Upload de logos et import menu | file-and-parser-security | No issue found | Signatures d'images et parsing XML côté navigateur examinés. |
| Sauvegardes, restauration et workflows de déploiement | operational-security | Needs follow-up | Architecture examinée, mais la configuration et les historiques cloud effectifs manquent. |

## Open Questions And Follow Up

- Les bundles staging POS/KDS publiés pointent-ils réellement vers l'API de production comme le prévoit le source actuel?
- Les sauvegardes R2 sont-elles chiffrées, restaurables et testées avec un RPO/RTO accepté?
- Quelles protections de branche, approbations d'environnement et allowlists réseau sont actives hors dépôt?
- Vérifier les variables Railway, protections GitHub, scopes Cloudflare, endpoints Stripe, ACL DB/Redis et règles Sentry avec accès opérateur.
  - Follow-up prompt: Review deferred unit deferred_live_cloud_config and close its stated proof gap. Surfaces: surface_backups_deploy.
- Effectuer un pentest authentifié et des tests d'abus distribués avant extension du parc.
  - Follow-up prompt: Review deferred unit deferred_external_pentest and close its stated proof gap. Surfaces: surface_public_orders, surface_auth_tenancy, surface_websockets.
- Le workflow actuel vérifie la lisibilité mais ne réimporte pas MongoDB/PostgreSQL; un exercice complet reste à réaliser.
  - Follow-up prompt: Review deferred unit deferred_restore_drill and close its stated proof gap. Surfaces: surface_backups_deploy.
