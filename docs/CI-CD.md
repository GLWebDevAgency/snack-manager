# Pipeline de qualité — comment on livre Snack Manager

Ce document s'adresse à celui qui reprend le projet et doit livrer sans casser
Class'Food un vendredi soir. Il décrit ce qui tourne automatiquement, ce qui
bloque une fusion, et comment revenir en arrière.

**Règle de livraison confirmée le 6 septembre 2026 : aucun push direct sur
`develop` ou `main`.** Chaque changement passe par une branche dédiée, une PR,
une revue et les contrôles verts sur sa dernière révision. La fusion vers
`develop` déclenche staging ; celle vers `main` exige d'abord la recette staging
et un GO explicite du fondateur pour le périmètre de la PR production. Une
synchronisation de `origin/develop` dans une branche de travail n'est pas une
livraison. L'absence éventuelle de protection GitHub ne dispense pas de ce flow.

---

## 1 · Pourquoi ce pipeline existe

Snack Manager est en production et sert un vrai commerce. Avant ce pipeline,
rien n'empêchait de pousser du code qui ne compile même pas vers un restaurant
en service, et deux mots de passe — dont celui de `sm_admin`, le compte qui voit
le chiffre d'affaires de tout le parc et peut suspendre un client — avaient déjà
été écrits en dur puis committés.

Le pipeline répond à ces deux risques, et à rien d'autre :

1. **Rien ne fusionne dans `main` sans avoir compilé, typé, été analysé et
   testé** sur l'ensemble du monorepo.
2. **Rien ne fusionne dans `main` avec un mot de passe, une URL de connexion ou
   une clé dans le diff.**

Puis un troisième risque s'est matérialisé, et il a fallu l'ajouter :

3. **Rien ne part en ligne à la main.** Les mises en ligne se faisaient depuis
   un poste (`railway up`). Le 19 août, l'API de staging est restée **deux
   heures en retard sur la production** — un correctif déployé d'un côté,
   oublié de l'autre, et personne pour le voir. Depuis, `develop` et `main`
   se déploient toutes seules (§ 10).

---

## 2 · Ce qui tourne, et quand

| Fichier | Contrôle affiché | Déclenché sur | Ce qu'il fait |
|---|---|---|---|
| `.github/workflows/ci.yml` | **Vérification du monorepo** | pull request · **appel** par `deploy.yml` | `typecheck`, `lint`, `test`, `build` sur tout le monorepo via Turborepo |
| `.github/workflows/secrets.yml` | **Balayage des secrets** | pull request · **appel** par `deploy.yml` | gitleaks sur les commits apportés, puis sur l'arbre complet |
| `.github/workflows/deploy.yml` | **Déploiement** | push sur `develop` · push sur `main` | appelle les deux ci-dessus, puis met en ligne les quatre services sur Railway, puis contrôle la santé (§ 10) |
| `.github/workflows/e2e.yml` | **Bout en bout** | fin verte d'un **Déploiement** (`workflow_run`) | joue les parcours critiques (commande, cuisine, suspension) dans un vrai navigateur sur les surfaces déployées — ne bloque pas le déploiement (§ 9) |
| `.github/workflows/sonde.yml` | **Sonde** | cron, deux fois par heure | `scripts/smoke.mjs` sur la production ; alerte sur le webhook d'équipe si `SM_ALERT_WEBHOOK` est posé en secret, sinon le rouge se lit dans l'onglet Actions |
| `.github/workflows/sauvegarde.yml` | **Sauvegarde** | cron, chaque nuit | tire l'export `GET /ops/export` de la production et le dépose sur Cloudflare R2 (artefact GitHub 90 j en repli) ; sans secrets posés, s'arrête proprement sans rien faire |

Les deux premiers tournent en parallèle. Sur une pull request, la précédente
exécution est annulée à chaque nouveau push (`concurrency`) ; appelés par
`deploy.yml`, jamais — couper une vérification en route déclarerait en échec un
déploiement qui n'a rien fait de mal.

### Une seule définition, appelée deux fois

`ci.yml` et `secrets.yml` déclarent `on: workflow_call`. `deploy.yml` ne les
recopie pas, il les **appelle** :

```yaml
  verification:
    needs: cible
    permissions: { contents: read }
    uses: ./.github/workflows/ci.yml       # ← pas d'étapes : c'est LE fichier de la CI
```

C'est la réponse à la dette la plus dangereuse qu'ait portée ce pipeline : tant
que `deploy.yml` recopiait les étapes, une modification faite dans `ci.yml` et
oubliée là-bas passait **inaperçue** — pas d'erreur, pas d'avertissement, juste
deux fichiers qui ne disent plus la même chose, et un déploiement qu'on croit
vérifié. Aujourd'hui, modifier `ci.yml` modifie ce que le déploiement exige, à
la ligne près, `timeout-minutes` et versions d'actions comprises.

Deux propriétés à connaître :

- **Aucun secret n'est passé aux workflows appelés.** Un workflow appelé
  n'hérite de rien (hormis `GITHUB_TOKEN`) tant qu'on ne l'a pas écrit, et on ne
  l'a pas écrit. La vérification et le balayage n'ont donc, structurellement,
  aucun accès aux jetons Railway.
- **`permissions:` se déclare chez l'appelant**, parce qu'il plafonne ce que
  l'appelé pourra obtenir. D'où `pull-requests: read` sur le job `secrets` de
  `deploy.yml` : sans lui, `gitleaks-action` reçoit un `403` en interrogeant
  l'API pour délimiter la plage à balayer, et tombe avant d'avoir balayé.

> ⚠️ **`ci.yml` et `secrets.yml` ne se déclenchent pas d'eux-mêmes sur un push.**
> Leurs déclencheurs sont `pull_request` et `workflow_call`. Sur `develop`
> comme sur `main`, c'est `deploy.yml` qui les fait tourner, dans SON exécution.
> Conséquence à ne pas perdre de vue : **si `deploy.yml` disparaissait de
> `main`, un push sur `main` ne vérifierait plus rien.** Les trois fichiers
> voyagent ensemble (§ 13).

### Vérification du monorepo

Quatre étapes distinctes, pour que l'échec se lise d'un coup d'œil dans
l'interface GitHub :

```
Typage             → turbo run typecheck        bloquant
Analyse statique   → turbo run lint             bloquant (depuis le 22/08/2026, § 9)
Tests              → turbo run test             bloquant
Compilation        → turbo run build            bloquant
```

Points à connaître :

- **Node 24.** `.nvmrc` fixe la version exacte commune aux postes et à tous les
  workflows ; `.node-version` garde les autres gestionnaires alignés. Le
  `package.json` racine annonce `engines.node: >=24.12.0`, borne compatible avec
  les binaires Linux optionnels de Rollup et supérieure à celle imposée par
  React Native 0.86. Railway/Railpack lit d'abord cette borne et la résout
  sur le dernier Node 24 disponible ; `.nvmrc` vient ensuite dans son ordre de
  résolution. Après une mise à niveau, vérifier la version exacte réellement
  servie sur staging avant la production. Voir la
  [résolution Node officielle de Railpack](https://railpack.com/languages/node/).
- **pnpm n'est pas versionné dans le workflow.** `pnpm/action-setup` lit le
  champ `packageManager` du `package.json` racine. Une seule source de vérité.
- **`pnpm install --frozen-lockfile`.** Si `pnpm-lock.yaml` ne correspond plus
  aux `package.json`, la CI s'arrête là. C'est voulu : sinon la CI résoudrait
  en douce d'autres versions que celles du poste de développement.
- **Les paquets sans script ne cassent rien.** Turborepo ignore silencieusement
  les tâches absentes : elles sont simplement sautées, la CI peut rester verte.
  Vérifier la liste effective pour le commit courant avec
  `pnpm exec turbo run test --dry=json` ; une tâche portant
  `"command": "<NONEXISTENT>"` ne constitue pas un test exécuté.

Les contrôles PostgreSQL réels sont des étapes dédiées après la suite générale :
bootstrap, fidélité, puis identité client. Pour `@sm/customer`,
`pnpm --filter @sm/customer test:integration` exige
`CUSTOMER_TEST_DATABASE_URL` et exécute le repository et l'orchestrateur contre
une base locale temporaire, avec rôles ordinaires et RLS. La connexion initiale
vise la base déjà créée par le service CI ; la fixture dérive sa propre base
`snackmanager_customer_test_<uuid>`. Des tests ignorés faute d'environnement
dans la suite générale ne remplacent pas cette étape. Le fournisseur Verify
reste simulé : ces tests n'envoient aucun OTP et ne prouvent aucune allocation
gratuite réelle. Les entrées Turbo explicites couvrent les SQL des trois
contextes et les sources API importées par les tests inter-paquets.

### Cache Turborepo

Le **cache distant est explicitement coupé** (`--cache=local:rw,remote:`) :
aucun artefact ne sort du dépôt, aucun jeton Vercel n'est nécessaire. Le
**cache local** (`.turbo/cache`) est en revanche conservé d'une exécution à
l'autre par `actions/cache`.

La clé est unique par commit avec un repli sur la précédente :

```
key:          turbo-Linux-node-<empreinte .nvmrc>-<sha>
restore-keys: turbo-Linux-node-<empreinte .nvmrc>-
```

La clé unique est nécessaire : `actions/cache` n'écrase jamais une entrée
existante, donc une clé fixe ne serait sauvegardée qu'une seule fois puis
figée pour toujours.

Les caches d'une pull request sont isolés mais peuvent **lire** ceux de `main`.
Il faut donc que quelque chose tourne sur `main` pour réchauffer ce cache :
c'est l'appel de `ci.yml` depuis `deploy.yml`, qui s'exécute sur la référence
`main` et écrit donc dans la même portée de cache qu'avant. Le déclencheur
`push: branches: [main]` de `ci.yml` a été retiré (il aurait fait tourner la
vérification deux fois par commit) sans rien coûter à ce réchauffage.

**Purger le cache** si vous soupçonnez un artefact corrompu :
`gh cache delete --all` (ou `gh cache list` pour regarder d'abord).

### Balayage des secrets

Deux passes, parce qu'elles ne répondent pas à la même question :

1. **Les commits apportés** (`gitleaks/gitleaks-action@v3`) — empêche un secret
   d'ENTRER. Échoue sur le commit fautif, avant la fusion.
2. **L'arbre courant** (`gitleaks dir .`) — répond à « y a-t-il un secret dans
   le dépôt aujourd'hui ? », y compris entré avant la mise en place de cette
   CI. Cette passe est la seule qui protège rétroactivement.

Les **deux** tournent aussi sur le chemin de déploiement. Ce n'était pas le cas
avant : la copie qui vivait dans `deploy.yml` ne balayait que l'arbre. Unifier
les définitions a donc ajouté la passe sur le diff avant chaque mise en ligne —
c'est plus, jamais moins, et cette différence-là ne peut plus réapparaître.

Les règles sont dans **`.github/gitleaks.toml`** : les règles fournies par
gitleaks (clés AWS, jetons GitHub, clés Stripe, clés privées PEM…) plus trois
règles maison —

| Règle | Ce qu'elle attrape |
|---|---|
| `uri-connexion-avec-identifiants` | `MONGO_URL`, `DATABASE_URL`, `REDIS_URL` avec identifiants |
| `secret-en-dur` | une affectation littérale de mot de passe, clé ou jeton |
| `fichier-env-versionne` | un fichier `.env` entré dans git, sauf `.env.example` |

Les gabarits de `.env.example` (`change-me`, `…user:password@host:port`) sont
explicitement autorisés par la liste d'exclusion globale. **Ne recopiez pas ces
gabarits ailleurs en croyant être couvert** : l'exclusion vise la forme exacte
du gabarit, pas le fichier entier.

La version de gitleaks est figée (`VERSION_GITLEAKS` dans `secrets.yml`). Un
balayage dont les règles changent toutes seules n'est pas un garde-fou, c'est
une surprise. Relevez-la volontairement.

> Le dépôt appartient à un **compte personnel**, donc `gitleaks-action` ne
> réclame pas de licence. Si le dépôt migre un jour vers un compte
> d'organisation, il faudra ajouter le secret `GITLEAKS_LICENSE` (gratuite, à
> demander sur gitleaks.io) sans quoi l'action refusera de s'exécuter.

---

## 3 · Ce qui bloque une fusion

> ### ⛔ À lire en premier : `main` n'est PAS protégée aujourd'hui
>
> Le dépôt est **privé sur un compte personnel sans abonnement**. GitHub
> réserve la protection de branche aux comptes Pro (ou aux dépôts publics), et
> répond `403` sur **toute** l'API concernée — règles modernes comme protection
> classique, en écriture comme en lecture :
>
> ```
> $ gh api -X POST repos/GLWebDevAgency/snack-manager/rulesets --input .github/protection-main.json
> Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)
> ```
>
> **Conséquence concrète : rien n'empêche techniquement un `git push` direct
> sur `main` en contournant la CI.** Les deux contrôles s'exécutent bien sur
> chaque push, mais ils constatent après coup au lieu de bloquer avant.
>
> Ce n'est pas un oubli de configuration : c'est le plan du compte, et cela ne
> se règle pas dans le code.

### L'activer

La configuration est écrite, versionnée et prête. Dès que le compte passe en
**GitHub Pro** — une seule commande :

```bash
gh api -X POST repos/GLWebDevAgency/snack-manager/rulesets \
  --input .github/protection-main.json
```

Vérifier ensuite :

```bash
gh api repos/GLWebDevAgency/snack-manager/rulesets --jq '.[] | {name, enforcement}'
```

Les deux autres voies, si l'abonnement n'est pas envisagé : transférer le dépôt
vers une organisation GitHub sur un plan qui inclut les règles, ou le rendre
public — ce dernier est exclu, le code est propriétaire.

### Ce que la protection imposera

- **Pas de push direct sur `main`** — pull request obligatoire, y compris pour
  le propriétaire du dépôt (`bypass_actors` est volontairement vide : sinon la
  protection ne protège de rien).
- **Les deux contrôles verts** avant que la fusion s'active :
  `Vérification du monorepo` et `Balayage des secrets`. Les quatre étapes du
  premier bloquent, « Analyse statique » comprise depuis le 22 août 2026
  (§ 9) : un contrôle vert signifie désormais qu'ESLint est passé, ce qui
  n'était pas vrai avant cette date.
- **La branche à jour** avec `main` avant fusion
  (`strict_required_status_checks_policy`).
- **Ni force-push ni suppression** de `main`.
- **Aucune relecture par un tiers.** L'auteur est seul sur le dépôt : exiger
  une approbation le bloquerait complètement. Le jour où une deuxième personne
  rejoint le projet, passer `required_approving_review_count` à `1` dans
  `.github/protection-main.json` et rejouer la commande.

> Si un job de workflow est renommé, renommer aussi son `context` dans
> `.github/protection-main.json`. Sinon GitHub attend un contrôle qui n'arrivera
> jamais, et plus rien ne peut fusionner.

### En attendant : un garde-fou local

`.github/hooks/pre-push` refuse un push direct vers `main`. À activer une fois
par copie de travail :

```bash
git config core.hooksPath .github/hooks
```

Il est **local et contournable** (`git push --no-verify`). Il rattrape la faute
d'inattention, pas la décision délibérée — ce n'est pas un remplacement de la
protection côté serveur.

---

### Les reprises de données Mongo, à lancer À LA MAIN après déploiement

Le job GitHub Actions `Migrations PostgreSQL privilégiées` migre les schémas
**PostgreSQL** (supply, puis fidélité, puis identité client `customer`), et eux
seuls. L'identité DDL reste dans GitHub Secrets et n'est jamais injectée au
conteneur API. Mongoose n'a pas de migration de schéma : un champ ajouté apparaît avec
son défaut, et les documents existants gardent leur forme d'avant. Ce sont les
scripts `backfill:*` qui les reprennent, et ils ne partent pas tout seuls —
délibérément : une reprise de données se relit avant d'être appliquée.

```bash
# 1. LIRE d'abord — sans --appliquer, rien n'est écrit.
scripts/reprise-mongo.sh staging backfill:founder
scripts/reprise-mongo.sh staging backfill:contact
scripts/reprise-mongo.sh staging backfill:brand

# 2. Appliquer. Le script relance ensuite la tâche avec --exiger-zero :
#    elle ne doit plus rien trouver, et sort en code 3 si elle trouve
#    quelque chose — le script s'arrête là plutôt que de finir vert.
scripts/reprise-mongo.sh staging backfill:founder --appliquer
scripts/reprise-mongo.sh staging backfill:contact --appliquer
scripts/reprise-mongo.sh staging backfill:brand --appliquer

# 3. backfill:tracking n'a PAS de mode lecture : son script écrit
#    immédiatement. Le lanceur Railway exige donc --appliquer et ne relance
#    pas automatiquement ce writer sous couvert d'un contrôle en lecture.
scripts/reprise-mongo.sh staging backfill:tracking --appliquer
```

Le lanceur refuse les tâches autres que `backfill:founder`, `backfill:contact`,
`backfill:brand`, `backfill:medias` et `backfill:tracking` avant tout accès Railway.
Les seeds, copies et purges ne sont pas des reprises de données autorisées sur
une base servie ; [leur cible est exclusivement locale et jetable](../packages/db/README.md).

| Script | Ce qu'il répare | Ce qu'on voit sans lui |
|---|---|---|
| `backfill:founder` | pose `founderUntil` et `founderDiscountCents` | le fondateur lit « moitié prix » à côté d'un montant plein tarif |
| `backfill:contact` | reprend le téléphone du gérant depuis son lead | le bouton « Appeler » reste masqué sur la fiche client |
| `backfill:brand` | pose le masque d'identité (direction Nuit, accent et logo du tenant) sur les tenants d'avant le 01/09/2026, et NOMME ceux dont le masque stocké ne satisfait plus le contrat | rien ne casse sans lui — le résolveur dérive le même masque à la lecture ; avec lui, l'éditeur (plan B) a un objet à modifier. Un masque stocké INVALIDE, lui, ne se voit nulle part : chaque lecture retombe en repli Nuit en silence |
| `backfill:tracking` | pose le jeton de suivi des commandes créées avant qu'il existe | les liens de suivi et les tickets déjà en circulation répondent 404 |

**Pourquoi un script et pas une suite de commandes à recopier.** Trois pièges,
tous rencontrés en déroulant la procédure à la main le 28 août 2026, et tous
fermés par `scripts/reprise-mongo.sh` :

1. **`railway run` n'irait pas.** Il injecte les variables mais exécute en
   local, où `mongodb.railway.internal` ne se résout pas. Il faut passer par le
   proxy TCP public du service MongoDB.
2. **L'URL du proxy ne porte aucun nom de base.** Sans lui, le script se
   connecte à la base `test` et annonce sereinement « 0 client à reprendre ».
   C'est le plus coûteux des trois : il ne lève pas, il rassure.
3. **La CLI reste sur le dernier environnement utilisé.** Une commande lancée
   sans vérifier vise la production sans le dire — c'est exactement ainsi qu'un
   `railway redeploy` a redéployé la production au lieu de staging. Le script
   POSE l'environnement, et fait taper « production » à la main quand c'est elle.

Les quatre reprises sont **idempotentes** : un document déjà traité n'est
jamais recalculé. Chaque écriture de `backfill:brand` porte en plus son
invariant dans son filtre — elle ne s'applique que si le tenant n'a pas changé
entre la lecture et l'écriture, et elle compte les écritures RÉELLEMENT
appliquées, jamais la taille du lot.

Deux tâches montrent ce qu'elles ne savent pas décider, plutôt que de trancher
à votre place : `backfill:contact` refuse les rapprochements ambigus — un
mauvais numéro sur une fiche client est pire que pas de numéro ; et
`backfill:brand` liste les masques stockés INVALIDES avec le chemin fautif
(`palette.accent`, `shape`, une clé inconnue…) sans jamais les écraser. Les
remplacer par le repli demande un drapeau explicite :

```bash
scripts/reprise-mongo.sh staging backfill:brand --appliquer --reparer
```

**Les deux codes de sortie à connaître.** `2` = mauvais usage du script
(environnement ou tâche inconnus). `3` = la relance de contrôle a encore trouvé
du travail : soit des écritures ont été ignorées parce que le document avait
changé entre-temps — relancer la tâche suffit —, soit des documents ne sont pas
reprenables en l'état et la tâche dit lesquels.

## 4 · Livrer un changement

```bash
# 1. Inspecter les worktrees/PR concurrents, puis récupérer les références
git status --short --branch
git worktree list
gh pr list --state open
git fetch origin

# 2. Une branche par changement
git switch -c fix/nom-du-changement origin/develop

# 3. Travailler, puis vérifier AVANT de pousser (§ 5)
pnpm verify

# 4. Committer — jamais `git add .` si d'autres travaux sont en cours
git add <chemins précis>
git commit

# 5. Ouvrir la pull request : le gabarit se remplit tout seul
git push -u origin fix/nom-du-changement
gh pr create --base develop --fill

# 6. Regarder la CI, vraiment
gh pr checks --watch

# 7. Après revue, vérifier la tête de PR puis fusionner CE SHA vers develop
gh pr view --json headRefOid,baseRefName,mergeStateStatus,statusCheckRollup
gh pr merge --squash --match-head-commit <sha-verifie>
```

Le gabarit de pull request (`.github/pull_request_template.md`) pose trois
questions : ce que ça change, comment ça a été vérifié, ce que ça peut casser.
La troisième est celle qu'on est tenté de sauter, et c'est celle qui sert le
jour du retour arrière.

### Avant une mise en production qui touche à l'argent

```bash
pnpm verifier:argent
```

Casse volontairement, une par une, les six règles du produit qui décident d'un
montant — plafond de remise par rôle, remise fondateur figée, borne du
sous-total, quota de promotion, MRR normalisé — et vérifie qu'un test tombe à
chaque fois.

**Une suite verte prouve que le code passe les tests ; elle ne prouve pas que
les tests attraperaient une régression.** Un test qui ne vérifie rien reste vert
quoi qu'il arrive, et c'est précisément ce qu'on ne voit jamais : deux tests
écrits le 28/08/2026 étaient dans ce cas, trouvés en relisant plutôt qu'en
exécutant. Une mutation qui passe inaperçue est une protection qui n'existe pas.

Le harnais est lent — il reconstruit `@sm/contracts` et `@sm/domain` entre
chaque mutation, parce qu'ils sont consommés depuis leur `dist/`. Il n'a donc
pas sa place en CI : on le lance avant de fusionner vers `main`, et après tout
remaniement de la facturation, des promotions ou des remises.

**Une CI verte prouve que ça compile et que les tests passent. Elle ne prouve
pas que ça marche.** Depuis le 20 août 2026, le workflow **Bout en bout**
(`e2e.yml`) joue les parcours qui coûtent de l'argent — commande, cuisine,
suspension — dans un vrai navigateur, après chaque déploiement. Sur `main`, il
ne joue automatiquement que les quatre démonstrations sans secret ni écriture ;
les parcours qui mutent un restaurant restent limités à staging. Mais il tourne
*après* la mise en ligne et ne bloque rien (§ 9) : la vérification à la main sur
staging avant `main` reste la règle.

Ce paragraphe décrit le trajet jusqu'à `develop`. **La suite — staging puis
production par PR distincte après GO — est au § 10.** Ne pas supprimer une
branche utilisée dans un worktree partagé pour terminer une commande de fusion.

---

## 5 · Reproduire la CI en local

```bash
pnpm verify
```

Ce script (`package.json` racine) lance exactement les quatre mêmes tâches que
la CI, avec le même réglage de cache :

```
turbo run typecheck lint test build --cache=local:rw,remote:
```

Il ne remplace pas les étapes d'intégration dédiées MongoDB/PostgreSQL de la
CI. En particulier, la suite réelle `@sm/customer test:integration` exige sa
cible PostgreSQL locale sûre (§ 2) ; ses cas ignorés dans une suite sans cette
variable ne prouvent pas les transactions ni les quotas durables.

Tâche par tâche, comme la CI les affiche :

```bash
pnpm exec turbo run typecheck
pnpm exec turbo run lint
pnpm exec turbo run test
pnpm exec turbo run build
```

Le balayage des secrets se rejoue en local si gitleaks est installé :

```bash
gitleaks dir . --config .github/gitleaks.toml --redact
```

Le drapeau `--redact` masque la valeur trouvée dans la sortie. Gardez-le : un
secret recopié dans un journal de terminal ou un rapport est un secret fuité
une deuxième fois.

---

## 6 · Un secret a été détecté — que faire

**Retirer la ligne ne suffit pas.** Si le commit a été poussé, considérez le
secret comme compromis, même sur un dépôt privé.

1. **Faire tourner le secret d'abord** — nouvelle valeur dans Railway
   (`railway variables`), redéploiement du service concerné. Tant que ce n'est
   pas fait, tout le reste est cosmétique.
2. **Sortir la valeur du code** : elle vient de l'environnement, jamais d'un
   littéral. Voir `packages/db/src/seed.ts`, qui tire un mot de passe aléatoire
   à défaut de variable — une amorce pénible finit contournée, et c'est comme
   ça qu'un secret revient en dur.
3. **Réécrire l'historique** seulement si le commit n'a pas encore été poussé,
   ou en dernier recours avec `git filter-repo`. Sur une branche déjà partagée,
   la réécriture ne récupère rien : la valeur est déjà sortie.
4. **Documenter la variable** dans `.env.example`, avec un gabarit sans valeur
   réelle.

Faux positif avéré ? Ajoutez une exclusion **étroite et commentée** dans
`.github/gitleaks.toml` — une exclusion de chemin large finit par tout couvrir,
et le garde-fou ne sert plus à rien.

---

## 7 · Mise en ligne

**Le déploiement est automatique depuis le 19 août 2026.** Tout est décrit aux
§§ 10 à 13 : le chemin d'un changement (§ 10), le contrôle de santé (§ 11), le
retour arrière (§ 12), les limites (§ 13).

**Règle maison, plus forte que toute automatisation : jamais de déploiement du
jeudi au dimanche.** Les restaurants vivent le week-end. La machine ne connaît
pas cette règle — c'est vous qui décidez du moment où vous poussez.

---

## 8 · Entretien

| Élément | Où | Quand le relever |
|---|---|---|
| Version de Node | `.nvmrc`, `.node-version`, puis `package.json` → `engines.node` | relever volontairement les trois lors d'un changement de version supportée |
| Version de pnpm | `package.json` → `packageManager` | la CI suit automatiquement |
| Versions des actions | `ci.yml`, `secrets.yml` | GitHub retire les anciens moteurs Node ; toutes les actions sont épinglées sur des versions à moteur Node 24 |
| Version de gitleaks | `secrets.yml` → `VERSION_GITLEAKS` | de temps en temps, pour bénéficier des nouvelles règles |
| Budget de temps | `ci.yml` → `timeout-minutes: 20` | si la CI approche les dix minutes, découper le job avant qu'elle devienne un obstacle |

> **Une modification de `ci.yml` ou de `secrets.yml` change aussi ce que le
> déploiement exige** — `deploy.yml` les appelle (§ 2). C'est le but : il n'y a
> plus qu'un endroit à modifier. Il n'y a plus non plus d'endroit où oublier.

---

## 9 · Limites connues

- **`main` n'est pas protégée** (§ 3), et c'est la limite la plus lourde de
  tout ce document : la CI constate, elle ne barre pas la route. Un push direct
  reste techniquement possible. Débloqué par un abonnement GitHub Pro, pas par
  du code.

- ~~Le déploiement reste manuel.~~ **Réglé le 19 août 2026** — voir §§ 10 à 13.
  Les limites propres au déploiement sont au § 13.
- ~~Pas de tests de bout en bout.~~ **Réglé le 20 août 2026.** Le workflow
  **Bout en bout** (`.github/workflows/e2e.yml`, documenté en tête du fichier
  et dans `e2e/README.md`) joue les cinq parcours dont la panne coûte de
  l'argent à un commerçant, dans un vrai navigateur, sur les surfaces
  réellement déployées : il se déclenche par `workflow_run` dès que
  « Déploiement » finit en vert, sur `develop` comme sur `main`.

  **La limite qui reste :** il tourne *après* la mise en ligne et **ne fait pas
  échouer le déploiement**. Un rouge se lit dans l'onglet Actions, il ne barre
  pas la route — le rendre bloquant tient en trois lignes dans `deploy.yml`,
  écrites en commentaire de `e2e.yml`, volontairement laissées à qui décidera
  d'accepter le délai supplémentaire avant chaque mise en ligne.
- ~~L'étape « Analyse statique » ne bloque pas la fusion.~~ **Réglé le 22 août
  2026.** L'étape barre désormais la route comme le typage et les tests.

  Ce qu'il a fallu solder : `lint` est un `echo ok` dans presque tous les
  paquets ; seul `@sm/web` lance réellement ESLint, et il sortait **45 erreurs
  préexistantes**, essentiellement `react-hooks/set-state-in-effect` — une
  règle que `eslint-config-next` érige en erreur depuis Next 16, sur du code
  écrit avant qu'aucune CI ne le regarde.

  **Comment elles ont été soldées, et pourquoi le compte importe.** Douze
  écritures d'état ont été sorties des effets pour être *calculées au rendu* :
  ce sont de vraies corrections, et l'une d'elles supprimait un défaut réel —
  le tableau de bord affichait un objectif de repli le temps que `tenant.data`
  arrive, et un clic dans cette fenêtre enregistrait une valeur fausse.

  Les **33 autres sont des `eslint-disable-next-line` motivés**, pas des
  réécritures, et il faut le savoir en lisant une CI verte. Ce sont les cas où
  la règle a tort : drapeau d'hydratation dont la valeur *doit* différer entre
  serveur et client, chargement réseau qu'aucun rendu ne peut produire,
  relecture du panier persisté après montage. Chacun porte en commentaire la
  raison **et ce qui casserait** si on « corrigeait » — c'est la seule forme de
  suppression acceptée ici. Une suppression nue, sans motif, doit être refusée
  en revue : elle rendrait à nouveau l'étape muette.

  Le critère de bascule était :

  ```bash
  pnpm exec turbo run lint   # doit sortir en 0
  ```
- **Angle mort assumé du balayage : un mot de passe générique en dur dans un
  fichier de test.** Les deux règles *génériques* — `secret-en-dur` et la règle
  gitleaks `generic-api-key`, celles qui raisonnent par forme et par entropie —
  sont désactivées sur les fichiers `*.test.ts` / `*.spec.ts`, parce que
  `apps/api/src/modules/ordering/stripe-webhook.test.ts` fabrique un secret de
  signature Stripe — une valeur inventée qui a, volontairement, la forme d'un
  secret. Sans cette exemption le balayage serait rouge en permanence, donc
  ignoré, donc inutile.

  Ce qui continue de couvrir les fichiers de test : toutes les règles gitleaks
  **spécifiques** (clés Stripe `sk_live_`, AWS, jetons GitHub, clés privées
  PEM…), `uri-connexion-avec-identifiants` et `fichier-env-versionne`. Seul un
  mot de passe **sans forme reconnaissable** passerait entre les mailles.

  L'exemption est portée par un `[[allowlists]]` global à `targetRules`
  explicite, pas par une exclusion de chemin : elle nomme les deux règles
  qu'elle relâche, et rien d'autre ne bouge.

  Le vrai correctif est en amont : que ce test compose sa valeur au lieu de la
  porter en dur. `apps/api` n'est pas du ressort de ce pipeline ; l'exemption
  est étroite, commentée dans `.github/gitleaks.toml`, et à retirer le jour où
  le test change.

- **Pas de balayage périodique de l'historique complet.** Les deux passes
  couvrent le diff et l'arbre courant, pas les 28 commits antérieurs.

---

## 10 · De la branche au restaurant en service

C'est la section à lire un vendredi soir. Elle décrit ce qui se passe tout
seul, et ce qui reste à votre charge.

```
   votre branche
        │  git push + gh pr create
        ▼
   pull request ───► CI + Balayage des secrets      (ci.yml, secrets.yml)
        │            ces deux contrôles verts = fusion possible
        │
        ├─ fusion dans develop ──► Déploiement ──► STAGING     (deploy.yml)
        │
        └─ fusion dans main ─────► Déploiement ──► PRODUCTION  (deploy.yml)
```

**Une seule règle à retenir : ce qui arrive dans `develop` part sur staging,
ce qui arrive dans `main` part en production.** Il n'y a rien d'autre à faire,
et surtout plus rien à lancer à la main.

### Le chemin recommandé

```bash
# 1. Vérifier les autres travaux, puis partir de develop à jour
git status --short --branch
git worktree list
gh pr list --state open
git fetch origin

# 2. Une branche par changement
git switch -c fix/nom-du-changement origin/develop

# 3. Vérifier AVANT de pousser (§ 5)
pnpm verify

# 4. Committer des chemins précis, pousser UNIQUEMENT la branche et ouvrir sa PR
git push -u origin fix/nom-du-changement
gh pr create --base develop --head fix/nom-du-changement --fill
gh pr checks --watch
# Après revue, vérifier l'absence de nouveau commit/PR concurrent et les SHA.
gh pr view --json headRefOid,baseRefOid,mergeStateStatus,statusCheckRollup
gh pr merge --squash --match-head-commit <sha-verifie>
# ↑ fusion par PR : déclenche le déploiement staging, aucun push direct develop

# 5. Regarder le déploiement, vraiment
gh run list --workflow deploy.yml --branch develop
gh run watch <run-staging-du-sha-fusionne> --exit-status

# 6. Essayer sur staging à la main : la caisse, l'écran cuisine, une commande
#    en ligne. Le contrôle de santé (§ 11) dit que ça répond, pas que ça marche.

# 7. Après recette et GO écrit sur le lot exact : PR de promotion distincte
gh pr create --base main --head develop --title "release: lot valide sur staging"
gh pr checks <numero-pr-production> --watch
# Relire TOUT le diff de promotion : develop peut contenir d'autres lots.
# Si le périmètre dépasse le GO, ne pas fusionner ; faire valider le périmètre.
gh pr merge <numero-pr-production> --merge --match-head-commit <sha-valide>
# ↑ conserve l'ascendance develop/main ; déclenche la production après sa CI
```

> **`develop` doit rester à jour avec `main`.** Le 19 août, `develop` avait
> sept commits de retard : staging aurait servi du code plus ancien que la
> production, et un essai sur staging n'aurait rien prouvé. À vérifier d'un
> coup d'œil :
> ```bash
> git log --oneline origin/develop..origin/main   # doit être vide
> ```

### Ce que fait `deploy.yml`, dans l'ordre

| # | Job | Ce qu'il fait | Ce qui se passe s'il échoue |
|---|---|---|---|
| 1 | **Cible du déploiement** | traduit la branche en environnement (`main`→production, `develop`→staging) | une référence inconnue arrête tout, immédiatement |
| 2 | `verification` | **appelle `ci.yml`** : `typecheck`, `lint`, `test`, `build` sur **ce commit** | rien ne part |
| 3 | `secrets` | **appelle `secrets.yml`** : gitleaks sur le diff puis sur l'arbre qui allait être téléversé | rien ne part |
| 4 | **Préflight Railway sans mutation** | impose l'environnement explicite, les quatre services et `pnpm verify:postgres:built` sur `api` | aucune migration ne part |
| 5 | **Migrations PostgreSQL privilégiées** | vérifie le bootstrap en lecture seule, applique supply, fidélité puis identité client depuis le runner avec un credential DDL injecté uniquement dans ce runner, puis revérifie le bootstrap | aucun conteneur ne part ; une migration déjà commencée peut avoir modifié le schéma ; le smoke contrôle l'ancien service |
| 6 | **Mise en ligne** | publie uniquement les secrets runtime, pose `SM_REVISION`, déploie `api`, puis `web`, `pos`, `kds` | les suivants ne partent pas ; l'ancienne version continue de servir |
| 7 | **Santé après déploiement** | `scripts/smoke.mjs` sur les surfaces publiques, **révision servie comprise** (§ 11) | l'exécution est déclarée **EN ÉCHEC**, mais le code peut être **EN LIGNE** (§ 12) |

Les jobs 2 et 3 n'ont **aucune étape** : ce sont des appels. Dans l'interface
GitHub ils apparaissent sous le nom du fichier appelé — `verification /
Vérification du monorepo` et `secrets / Balayage des secrets`.

Le job 7 tourne **aussi quand les migrations ou le job 6 ont échoué**
(`always()`). Un vendredi
soir, la première question n'est pas « le déploiement est-il passé ? » mais
« le restaurant peut-il encaisser ? ». Quand Railway refuse une mise en
service, l'ancienne version continue de servir — et il faut le *savoir*, pas
le supposer. Dans ce cas le job affiche un avertissement en tête : vert
signifie alors « l'environnement répond », pas « le déploiement a réussi ».
Si le préflight ou la vérification a échoué, rien n'a été touché et le job 7 ne
tourne pas.

Les jobs 4 à 6 forment une chaîne stricte après les jobs 2 et 3. Ce n'est pas
une politesse : un job dont un `needs` échoue **ne démarre pas**. Seul le smoke
du job 7 utilise `always()` après qu'une migration a pu commencer.

> **Tout push déploie, même un changement de documentation.** Il n'y a
> volontairement aucun `paths-ignore` : le jour où une exclusion existe, la
> tête de `develop` peut différer de ce qui tourne sur staging, et on retombe
> exactement dans le décalage que ce pipeline supprime. Un déploiement coûte
> une poignée de minutes ; un décalage invisible a coûté deux heures.

> **Deux poussées coup sur coup font la queue** (`concurrency`, sans
> annulation). On n'interrompt jamais un déploiement en vol : annuler le job
> GitHub n'annulerait de toute façon pas le déploiement Railway déjà lancé, et
> une migration peut être en cours.

### Pourquoi les migrations partent avant `api`, puis `api` seule

**Clé de remise livraison (L2.3).** Le préflight impose désormais une clé dédiée
`SM_DELIVERY_HANDOFF_KEY_STAGING` / `SM_DELIVERY_HANDOFF_KEY_PRODUCTION`
(32 octets aléatoires, base64url canonique de 43 caractères), avant toute
migration. La publication runtime vérifie aussi son indépendance des clés
fidélité/relais et la transmet uniquement à `api` comme `DELIVERY_HANDOFF_KEY`.
Ne pas la régénérer au déploiement : elle protège les preuves et les reçus
existants. La clé production n'est pas provisionnée par le lot staging ; une
promotion exige son provisionnement contrôlé et un GO distinct. En cas de clé
absente, le déploiement doit rester bloqué, jamais utiliser la clé staging ou JWT.
Voir [protocole et restrictions de rotation/rollback](strategie-commerce-2026-09/REMISE-LIVREUR.md#clé-et-exploitation).

Après la CI et le balayage des secrets, `deploy.yml` exécute d'abord un
préflight Railway **sans mutation** : le jeton doit accéder aux quatre services
dans l'environnement explicitement dérivé de la branche et le service `api`
doit porter ce `preDeployCommand` en lecture seule :

```
pnpm verify:postgres:built
```

Le job `Migrations PostgreSQL privilégiées` compile d'abord le bootstrap et les
trois migrateurs (`@sm/supply`, `@sm/loyalty`, `@sm/customer`). Il exécute ensuite
`pnpm postgres:bootstrap:check:built` **avant tout DDL**, puis
`pnpm migrate:postgres:built` depuis un runner GitHub, et rejoue le contrôle
bootstrap après les migrations. La commande source `pnpm migrate:postgres`
couvre les mêmes trois contextes dans le même ordre ; elle ne doit pas être
confondue avec la vérification en lecture seule du conteneur.
Le préflight bootstrap ouvre une transaction en lecture seule et vérifie
l'identité des deux rôles,
leurs privilèges, le `search_path`, les propriétaires exacts des objets gérés et
l'état des trois journaux Drizzle : `__drizzle_migrations`,
`__drizzle_loyalty_migrations` et `__drizzle_customer_migrations`, tous dans
`drizzle`. Le manifeste L3a.6b.1 énumère **77 objets** : les 55 objets historiques,
les 14 objets `customer` initiaux (schéma, neuf tables, deux fonctions, journal
et sa séquence), puis la table de budget payant et trois fonctions de garde
de la migration additive `0001`, et la table de continuité navigateur avec sa
fonction de garde `0002`, puis la table de préparation navigateur et sa fonction
de garde `0003`. Chaque ajout est lié à sa migration : une
base à 75 objets reste recevable avant `0003`, pas après son journal
d'application. Ce nombre décrit le code cible, pas une preuve de migration déjà
appliquée. Une base saine aux deux anciens contextes passe le préflight avant
l'ajout de `customer` ; une migration déclarée appliquée avec un objet manquant
est refusée. Toute dérive **couverte par ce manifeste**
bloque le job avant la première migration et avant le déploiement ; elle n'est
jamais réparée automatiquement.
Le rôle runtime reste sans DDL **persistant** : PostgreSQL conserve le privilège
`TEMP` et son schéma temporaire propre à la session, volontairement hors du
périmètre de ce bootstrap.

Ce contrôle ne certifie pas la définition live des tables, contraintes,
triggers, policies RLS ni le corps des fonctions. Les tests PostgreSQL réels de
la CI prouvent ces invariants sur une base reconstruite ; ils ne détectent pas
une altération manuelle ultérieure de la base déployée. Un fingerprint live
versionné de ces définitions reste donc un garde-fou distinct à livrer avant le
premier restaurant réel en production.

**Continuité des sessions L3a.6a :** déployer `0002_customer_browser_continuity`
avec le pilote compte toujours fermé. Les anciennes lignes restent conservées,
mais sans liaison navigateur inventée : elles ne sont pas reconnues par la
nouvelle authentification. Une ancienne API ne vérifie pas encore cette
liaison ; ne pas rouvrir le pilote tant que toutes ses instances et le web ne
servent pas le nouveau lot. En cas de retour applicatif, garder les comptes
fermés, conserver la migration additive et privilégier un correctif en avant.
Le parcours invité, les QR de présentation fidélité et les commandes ne sont
ni migrés ni réattribués par ce changement.

**Préparation navigateur L3a.6b.1 :** `0003_customer_browser_preparation` ajoute
les références de préparation sans compléter les anciennes lignes : les
sessions/challenges sans référence restent inertes. Garder le pilote fermé
pendant toute la livraison API/Web. Vérifier le journal customer et le succès
du contrôle de migrations du conteneur API ; le seul message « 77 objets » du
bootstrap décrit le manifeste cible, pas l'application de `0003`. Pas de down
migration, purge de préparations ni remise à zéro des budgets en cas de retour
applicatif. L'inscription OTP reste un lot distinct non ouvert.

L'étape de préparation reçoit `SM_DATABASE_MIGRATION_URL_STAGING` ou
`..._PRODUCTION` et la CA épinglée `SM_DATABASE_ROOT_CA_*`. Les variables
brutes URL/CA ne sont exposées qu'à cette étape ; elle écrit la CA dans un
fichier temporaire du runner et transmet l'URL authentifiée reconstruite aux
étapes de préflight et de migration via `GITHUB_ENV`. Le workflow refuse les
paramètres d'URL fournis par le secret, ajoute lui-même `verify-ca`, puis les
migrateurs et le bootstrap prouvent TLS 1.2+ avant toute inspection ou DDL. Le
compte DDL est un rôle dédié, non-SUPERUSER et sans rôle hérité ; les migrateurs
vérifient aussi que `DATABASE_RUNTIME_ROLE` existe, qu'il est distinct, sans
contournement RLS ni DDL persistant, puis lui accordent seulement `CONNECT`,
`USAGE`, le CRUD et la lecture des journaux.

#### Réparer exceptionnellement une dérive de bootstrap

La réparation est une opération de maintenance manuelle, jamais une étape de
CI. Faire une sauvegarde, choisir une fenêtre sans migration concurrente, puis
injecter depuis le gestionnaire de secrets une URL administrateur temporaire
authentifiée par TLS. L'URL doit cibler exactement la base `railway`, utiliser
un superuser direct distinct des rôles applicatif et migrateur, et porter soit
`sslmode=verify-full`, soit `verify-ca` avec un chemin `sslrootcert` absolu.
Renseigner l'hôte et le port attendus depuis la configuration Railway/GitHub
approuvée, indépendamment de l'URL à contrôler : ne jamais les recopier en les
déduisant de cette même URL.

```bash
DATABASE_BOOTSTRAP_ADMIN_URL="$URL_ADMIN_POSTGRES_SECURISEE" \
DATABASE_BOOTSTRAP_EXPECTED_HOST="$HOTE_POSTGRES_ATTENDU" \
DATABASE_BOOTSTRAP_EXPECTED_PORT="$PORT_POSTGRES_ATTENDU" \
  pnpm postgres:bootstrap:repair --environment staging --apply
unset URL_ADMIN_POSTGRES_SECURISEE HOTE_POSTGRES_ATTENDU PORT_POSTGRES_ATTENDU
```

Remplacer `staging` par `production` exige le GO production habituel. La
commande refuse de démarrer sans `--environment` et `--apply`, prend un verrou
transactionnel et vérifie avant toute connexion que l'URL correspond exactement
à l'hôte, au port et à la base attendus. Elle ne modifie que la liste versionnée
d'objets, de privilèges et de réglages de rôles, puis rejoue le préflight sous
l'identité migrateur avant le commit. Elle ne fait ni `REASSIGN OWNED`, ni
suppression, ni mutation d'un objet inattendu. Une seconde exécution saine doit
annoncer zéro changement : c'est le contrôle d'idempotence.

Ne jamais enregistrer `DATABASE_BOOTSTRAP_ADMIN_URL` dans GitHub Actions,
Railway, un fichier `.env`, un ticket ou la documentation. La supprimer du
shell immédiatement après l'opération, puis relancer le préflight normal avec
l'URL migrateur sécurisée avant de livrer.

Railway ne reçoit que `DATABASE_URL` du rôle applicatif. Son preDeploy compare
alors, avec cette identité limitée, les hash et horodatages attendus des trois
journaux Drizzle. Le démarrage API répète les contrôles de rôle puis de readiness
supply → fidélité → identité client ; un rôle runtime propriétaire d'objets ou
capable de `CREATE` dans `customer` est aussi refusé.
**Une base absente, en retard ou différente bloque la mise en
service.** Une migration future additive reste acceptée afin qu'un rollback de
code demeure possible. Cette tolérance concerne les journaux : le manifeste
d'ownership du bootstrap, lui, reste strict. Une migration déjà appliquée et
son entrée de manifeste ne doivent donc jamais être supprimées de l'historique.

L'ajout du schéma `customer` et de cette readiness n'active aucun contrôleur de
compte client ni appel Verify. L'ouverture runtime et la recette OTP réelle
restent soumises aux conditions distinctes de
[L3a — identité client](strategie-commerce-2026-09/IDENTITE-CLIENT-VERIFY.md).

> **Garde de livraison PostgreSQL.** Avant le premier push, configurer sur
> **staging uniquement** `pnpm verify:postgres:built`, sans déclencher un ancien
> déploiement. La production ne doit être armée qu'après un GO écrit : ses
> secrets DB, clés et variables `SM_DATABASE_MIGRATION_HOST_PRODUCTION` /
> `_PORT_` sont alors créés sans déclencher de déploiement. Ne jamais copier une
> clé entre environnements.

> **Garde des surfaces publiques.** Le même préflight refuse désormais le
> déploiement si le jeton serveur du formulaire ou la paire Turnstile de la
> cible manque. Chaque environnement possède son propre
> `SM_CONTACT_INGEST_TOKEN_*`, son propre `SM_TURNSTILE_SECRET_KEY_*`, ainsi que
> les variables publiques `SM_TURNSTILE_SITE_KEY_*` et
> `SM_TURNSTILE_ALLOWED_HOSTNAMES_*`. Les clés de test Cloudflare sont refusées
> sur Railway et, dès que les deux site keys existent, leur réutilisation entre
> staging et production est refusée. Après validation, le pipeline publie le
> jeton contact sur `api` et `web`, le secret et l'allowlist Turnstile sur `api`,
> puis la site key au build de `web`, sans journaliser aucune valeur.

C'est aussi la raison de l'ordre : `web`, `pos` et `kds` ne partent qu'une fois
l'`api` **en service**, pas seulement construite.

> **Ce que le déploiement automatique a trouvé le premier jour.** Le tsconfig de
> `@sm/supply` excluait `src/migrate.ts` de la compilation : `dist/migrate.js`
> n'était donc jamais produit à partir de l'arbre versionné. Les deux
> environnements tournaient quand même, parce que les `railway up` partaient
> d'un poste dont la copie de travail portait un correctif **non committé**.
> Première exécution automatique, premier échec, message net :
> `Cannot find module '/app/packages/supply/dist/migrate.js'`. C'est
> exactement ce qu'on attend d'une machine qui ne déploie que le dépôt.

### Pourquoi `push` et pas `workflow_run`

« Quand la CI a fini, déploie » (`workflow_run`) est le montage qu'on essaie en
premier. Il a été écarté, et le raisonnement complet est en tête de
`.github/workflows/deploy.yml`. En bref :

1. **Rédhibitoire** — `ci.yml` ne se déclenche pas de lui-même sur un push (§ 2).
   Il n'y a donc aucune exécution à laquelle s'accrocher : **staging ne serait
   jamais déployé**. Vérifiable : après un push sur `develop`, `gh run list
   --branch develop` ne montre que `Déploiement`.
2. `workflow_run` se déclenche pour les exécutions de **n'importe quelle
   branche**, branches de pull request comprises. Sans filtre explicite sur
   `head_branch` **et** sur `event`, du code non relu part en production. Le
   défaut est silencieux : rien ne signale qu'on déploie la mauvaise branche.
3. Dans un `workflow_run`, `github.sha` et `github.ref` désignent la **branche
   par défaut**, pas le commit vérifié — un `actions/checkout` sans argument y
   récupère `main`. On déploierait autre chose que ce qui a été testé.
4. `workflow_run` n'existe que dans la version du fichier présente sur la
   branche par défaut : impossible à mettre au point depuis `develop`.

Le montage retenu — **vérifier et déployer dans la même exécution, déclenchée
par le push** — n'a aucun de ces défauts. `github.sha` *est* le commit poussé,
par construction.

### Ce qui interdit de déployer depuis une branche quelconque

Quatre verrous, et il faut les franchir tous les quatre :

1. `on.push.branches: [main, develop]` — une autre branche **ne crée même pas
   d'exécution**. Vérifié : un push sur `essai/branche-quelconque` n'a produit
   aucune exécution.
2. `if: github.repository == 'GLWebDevAgency/snack-manager'` sur le job
   `cible` — un fork n'essaie pas.
3. Le job `cible` traduit la référence par un `case` **fermé** : tout ce qui
   n'est ni `refs/heads/main` ni `refs/heads/develop` fait `exit 1`, et comme
   tous les autres jobs en dépendent (`needs: cible`), plus rien ne démarre.
4. **Le jeton est la frontière.** `RAILWAY_TOKEN` est choisi sur la même ligne
   que la garde qui le protège :

   ```yaml
   RAILWAY_TOKEN: >-
     ${{ github.ref == 'refs/heads/main' && secrets.RAILWAY_TOKEN_PRODUCTION
     || github.ref == 'refs/heads/develop' && secrets.RAILWAY_TOKEN_STAGING
     || '' }}
   ```

   Une référence inattendue donne la **chaîne vide**, et le job s'arrête avant
   d'appeler Railway. Surtout : chaque jeton de projet Railway est cloisonné sur
   **son** environnement. Même si cette correspondance était fausse, un jeton de
   staging ne peut rien déployer en production. Chaque commande passe en plus
   `--environment "$ENVIRONNEMENT"` : le jeton et la cible explicite doivent donc
   tous les deux correspondre avant que Railway accepte l'opération.

### Ce qui a été vérifié, et comment

Une chaîne de déploiement qu'on n'a pas vue tourner n'en est pas une.

| Vérification | Résultat |
|---|---|
| Push sur une branche quelconque (`essai/branche-quelconque`) | **aucune exécution créée** — `gh run list --branch essai/branche-quelconque` est vide |
| Push sur `develop` | une seule exécution, `Déploiement` — confirme que `ci.yml` ne se déclenche pas sur `develop` |
| **Balayage des secrets rouge** | exécution `32304064809` (fausse alerte sur ce document même, § 11) : `Mise en ligne` et `Santé` **jamais démarrés**, alors que la vérification du monorepo était verte. Le déploiement ne part pas. |
| Un job de mise en ligne en échec | exécution `32302822785` : `api` en échec, **`Santé après déploiement` non démarré** — le `needs:` bloque bien l'aval |
| Une mise en ligne en échec n'interrompt pas le service | l'ancien déploiement `api` a continué de servir ; contrôle de santé vert pendant toute la panne |
| Déploiement complet | exécution `32303150404` : quatre services en 3 min 44, santé verte en 7 s |
| Ordre `api` d'abord | `api` `SUCCESS` à 21:21:38, `web`/`pos`/`kds` lancés à 21:21:39 |
| Migrations en pré-déploiement (ancienne chaîne, historique) | `✓ Migrations supply appliquées` dans le journal du déploiement `660dd9d7` |
| Retour arrière | § 12 — mesuré dans les deux sens, 29 s et 24 s |

**Bascule vers les workflows appelés — 20 août 2026**, pull request d'essai
`#8`, ouverte puis fermée sans fusion. `deploy.yml` ne se déclenchant que sur
un push, ses deux `uses:` ont été reproduits à l'identique (`permissions`
comprises) dans un workflow jetable déclenché sur `pull_request` : même
mécanisme, mêmes fichiers.

| Vérification | Résultat |
|---|---|
| `ci.yml` se déclenche toujours sur une pull request | exécution `32359203463` — `CI` verte en **1 min 56** |
| `secrets.yml` aussi | exécution `32359203352` — `Secrets` verte en **12 s** |
| Les deux `uses:` résolvent et tournent | exécution `32359203629` — verte en **1 min 55**, jobs `verification / Vérification du monorepo` (1 min 51) et `secrets / Balayage des secrets` (13 s) |
| L'appel exécute bien TOUTES les étapes du fichier appelé | les onze étapes de `ci.yml` — jusqu'à `Compilation` — apparaissent dans le job imbriqué, et les deux passes de `secrets.yml` (`Balayer les commits apportés`, `Balayer l'arbre courant`) |
| `pull-requests: read` déclarée chez l'appelant suffit à `gitleaks-action` | l'étape `Balayer les commits apportés` passe dans le job appelé — c'est elle qui aurait rendu 403 sans la permission |
| Les groupes `concurrency` ne se marchent pas dessus | `CI` directe et l'appel imbriqué ont tourné **en parallèle sans s'annuler** — le `github` context d'un workflow appelé étant celui de l'APPELANT, `github.workflow` diffère, donc le groupe aussi |
| `--skip-deploys` ne déclenche pas de déploiement | mesuré sur le service `api` de staging : déploiement en tête `bbe5e37a` **identique avant et après** la pose d'une variable. C'était le vrai danger — un déploiement surnuméraire serait reparti de l'ancien code, et l'attente de `deploy.yml` l'aurait pris pour le sien |
| `GET /health` sans aucune variable | 200, `revision: null` — vérifié sur la route réelle, pas seulement en test unitaire |
| `GET /health` avec `SM_REVISION` | 200, `revision` et `revisionCourte` renseignées |
| Variable présente mais VIDE (le cas Railway) | 200, `revision: null` — pas de chaîne vide qui se comparerait avec succès |
| `smoke.mjs` affirme la bonne révision | contrôle vert quand le SHA correspond |
| `smoke.mjs` refuse la mauvaise | `✗ révision servie … ≠ attendue …`, **code de sortie 1** |
| `smoke.mjs` sans expectation | contrôle `IGNORÉ`, révision servie tout de même affichée ; les cinq autres contrôles restent verts sur staging |

**Ce qui n'avait pas pu être vérifié en pull request :** `deploy.yml` lui-même,
qui ne se déclenche que sur un push vers `develop` ou `main` — donc la pose
réelle de `SM_REVISION` par le job de mise en ligne, avec le jeton de projet
Railway (et non la session utilisateur). **Vérifié depuis** : les poussées sur
`develop` déploient staging et le job `Santé après déploiement` affirme la
révision servie à chaque passage.

> ### ✅ Le chemin production est ARMÉ depuis le 23 août 2026
>
> Longtemps, ce document portait ici un avertissement : pour un événement
> `push`, GitHub exécute les workflows **tels qu'ils sont sur la branche
> poussée**, et `deploy.yml` n'était pas encore dans `main` — un push sur
> `main` ne déployait donc rien. C'est ce qui a permis de mettre le pipeline
> au point sur `develop` sans jamais risquer la production.
>
> La fusion `develop` → `main` du 23 août 2026 a emporté les trois fichiers
> ensemble et armé le chemin : depuis, **chaque fusion vers `main` déploie en
> production**, et plusieurs déploiements ont fini verts le jour même —
> vérification, balayage, mise en ligne Railway et contrôle de santé compris
> (onglet Actions, exécutions « Déploiement » n° 45 et suivantes sur `main`).
>
> Ce qui ne change pas : la promotion se fait par pull request `develop` →
> `main` (§ 4), un jour où quelqu'un peut regarder le job `Santé après
> déploiement` jusqu'au bout — car la fusion, elle, n'attend personne.

---

## 11 · Le contrôle de santé — `scripts/smoke.mjs`

« C'est en ligne » et « ça marche » sont deux affirmations différentes. Le
job **Santé après déploiement** ne répond qu'à la seconde.

```bash
node scripts/smoke.mjs staging
node scripts/smoke.mjs production
```

Aucune dépendance à installer (la cible du dépôt, Node ≥ 24.3, suffit), et il tourne aussi bien
depuis un poste que dans la CI.

| Contrôle | Ce qu'il prouve |
|---|---|
| `GET /health` | l'API répond, et c'est bien **notre** API (`service: snack-manager-api`) |
| `GET /health` → **révision** | c'est bien **la révision qu'on vient de pousser** qui sert, pas celle d'avant |
| `GET /public/tenants/<slug>/menu` | la lecture traverse Mongo de bout en bout et le multi-établissement résout |
| `GET /public/tenants/<slug>/loyalty` | le programme fidélité actif et ses récompenses sont publiés avec un contrat valide |
| `GET /r/<slug>/fidelite` | la vraie PWA fidélité est rendue ; son écran de repli HTTP 200 est explicitement refusé |
| `GET /` sur `web`, `pos`, `kds` | chaque interface sert **sa** page — le titre attendu est vérifié |

**Un 200 ne suffit pas.** Une page d'erreur d'infrastructure en renvoie un
aussi. C'est pourquoi chaque interface est reconnue à son titre : si `kds`
servait la page de `web`, le contrôle serait rouge.

### La révision servie — le seul contrôle qui parle du DÉPLOIEMENT

Tous les autres contrôles décrivent l'**environnement** : ils seraient verts
avec la version d'avant en ligne. C'est précisément le cas le plus fréquent
chez Railway, et le plus trompeur — une mise en service refusée laisse
l'ancien conteneur servir, et tout répond.

`GET /health` publie désormais son SHA :

```json
{
  "ok": true,
  "service": "snack-manager-api",
  "revision": "e4eb6b7b26baebe8ee4066f9ee33d7dd1d533608",
  "revisionCourte": "e4eb6b7",
  "environnement": "staging",
  "deploiement": "bbe5e37a-5dc5-4702-a0d1-71d607a306e3",
  "demarreLe": "2026-08-20T10:20:35.565Z"
}
```

`ok` et `service` n'ont pas bougé : un ancien script qui les lit continue de
fonctionner. Le reste s'ajoute.

**D'où vient le SHA — la variable a été cherchée, pas devinée.** Le réflexe est
de lire `RAILWAY_GIT_COMMIT_SHA`. Sur ce projet elle **n'existe pas**. Relevé
dans le conteneur `api` de staging le 20 août 2026 :

```bash
$ railway ssh --service api --environment staging "printenv" | grep -E 'RAILWAY_(GIT|DEPLOYMENT)'
RAILWAY_DEPLOYMENT_ID=bbe5e37a-5dc5-4702-a0d1-71d607a306e3
RAILWAY_GIT_REPO_OWNER=            # ← présente, et VIDE. Aucune RAILWAY_GIT_COMMIT_SHA.
```

La famille `RAILWAY_GIT_*` n'est renseignée que pour un service **branché sur un
dépôt GitHub**. Ici les mises en ligne partent de `railway up` : Railway ne
connaît aucun commit. Une route qui aurait lu cette variable seule aurait
répondu « inconnue » pour toujours, sans que rien ne le signale.

C'est donc `deploy.yml` qui pose la valeur, juste **avant** le téléversement :

```yaml
railway variables --service api --skip-deploys --set "SM_REVISION=$SHA"
```

`--skip-deploys` est indispensable : sans lui, poser la variable déclenche un
déploiement supplémentaire — qui repartirait de l'**ancien** code, et que
l'attente de `deploy.yml` prendrait pour le nôtre. La sortie de la commande est
**intégralement écartée**, y compris en cas d'échec : `railway variables`
réaffiche toutes les variables du service, mots de passe compris.

`apps/api/src/modules/health/revision.ts` lit, dans l'ordre :

1. `SM_REVISION` — celle qu'on pose ;
2. `RAILWAY_GIT_COMMIT_SHA` — si le service est un jour rebranché sur GitHub,
   elle prendra le relais toute seule ;
3. rien — `revision` vaut `null` et **la route répond quand même 200**. Un
   contrôle de santé qui tombe parce qu'on travaille sur son poste n'est pas un
   contrôle de santé. Une valeur *vide* compte comme absente : c'est le cas réel
   de `RAILWAY_GIT_REPO_OWNER=` ci-dessus.

**Côté contrôle**, `SM_REVISION_ATTENDUE` porte le SHA exigé :

```bash
SM_REVISION_ATTENDUE=$(git rev-parse HEAD) node scripts/smoke.mjs staging
```

`deploy.yml` la renseigne à `github.sha`, **et seulement si la mise en ligne a
réussi**. Quand elle a échoué, l'ancienne version sert forcément : rougir
là-dessus masquerait la seule question qui compte ce soir-là — « le restaurant
peut-il encaisser ? ». Le contrôle s'annonce alors `IGNORÉ`, et la révision
réellement servie **reste affichée** par le contrôle précédent. Sans expectation,
le script observe ; avec, il affirme.

| Ce que le script affiche | Ce que ça veut dire |
|---|---|
| `✓ … — e4eb6b7 — c'est bien la révision poussée` | le déploiement a pris |
| `✗ … — révision servie 3e48d02 ≠ attendue e4eb6b7` | **c'est une autre version qui sert** — § 12 |
| `✗ … — l'API ne publie aucune révision` | `SM_REVISION` n'est pas posée, ou le conteneur est antérieur à cette route |
| `◌ … — IGNORÉ : aucune révision attendue` | on observe, on n'affirme rien |

> **Les trois interfaces ne publient pas leur révision**, seule l'API le fait.
> Pour `web`, `pos` et `kds`, l'empreinte du corps servi (plus bas) reste le
> seul indice. C'est une lacune connue, notée au § 13.

Le script **ne reçoit aucun secret** — le job qui l'exécute n'en déclare aucun.
C'est volontaire et c'est structurel : s'il avait besoin d'un jeton, il
échouerait. Il ne tape que des surfaces qu'un client peut ouvrir dans son
navigateur.

Réglages facultatifs — que des adresses publiques et des durées, rien de
confidentiel :

- `SM_URL_API`, `SM_URL_WEB`, `SM_URL_POS`, `SM_URL_KDS` — viser d'autres
  adresses, un domaine personnalisé par exemple ;
- `SM_SLUG_CARTE` — l'établissement dont on vérifie la carte ;
- `SM_SLUG_CARTE_PRODUCTION` — variable GitHub publique utilisée uniquement
  pour la production quand `SM_SLUG_CARTE` n'est pas fourni ;
- `SM_REVISION_ATTENDUE` — le SHA que l'API doit servir ; vide, le contrôle de
  révision s'annonce `IGNORÉ` ;
- `SM_TENTATIVES`, `SM_ATTENTE_MS`, `SM_DELAI_REQUETE_MS` — la patience du
  script face à une interface qui vient de redémarrer.

> **Anecdote utile pour la suite.** La première rédaction de ce paragraphe
> disait « aucun secret : \`SM_URL_API\`… ». Le balayage l'a pris pour une
> affectation de secret en dur (règle `secret-en-dur`, qui cherche
> `secret` suivi de `:` puis d'une valeur entre guillemets) et **a bloqué le
> déploiement** — exécution `32304064809`. Le garde-fou a fonctionné, sur une
> fausse alerte. Le bon réflexe est celui appliqué ici : **reformuler**. On
> n'ajoute une exclusion dans `.github/gitleaks.toml` que si la forme est
> inévitable, et alors étroite et commentée (§ 6).

> **Les trois surfaces du restaurant sont « IGNORÉES » en production, et ce n'est pas un
> oubli.** La base de production a été remise à blanc (commit `7b1c6dc`) : il
> n'y a aujourd'hui aucun établissement, donc ni carte, ni catalogue fidélité,
> ni PWA à servir. Les contrôles s'annoncent alors `IGNORÉ` — bruyamment, avec
> une annotation — plutôt que rouges pour une raison qui n'est pas une panne.
> **Le jour où le premier restaurant est en ligne**, créer la variable GitHub
> `SM_SLUG_CARTE_PRODUCTION` avec son slug. Le déploiement et la sonde quotidienne
> arment alors les trois contrôles sans changement de code. Un contrôle qui ne
> peut pas tourner n'est pas un contrôle qui passe.

Chaque interface est aussi accompagnée d'une **empreinte** (12 caractères de
SHA-256 du corps servi). Elle ne sert à rien au quotidien, et à tout le jour où
l'on se demande « est-ce que staging sert bien ma modification ? » : comparez
l'empreinte avant et après.

---

## 12 · Revenir en arrière

**À lire avant d'en avoir besoin.** Le déploiement automatique met en ligne
plus vite ; il ne défait rien tout seul.

### La règle qui compte : les migrations ne se défont pas

Un retour arrière **remet le code d'avant. Il ne remet pas le schéma
d'avant.** Le job GitHub `pnpm migrate:postgres:built` applique les migrations
supply, fidélité et identité client en avant ; il n'a pas d'inverse, et Railway
ne rejoue rien à l'envers. Le preDeploy Railway ne fait qu'en vérifier l'état avec le rôle
runtime.

Conséquence, en clair : après un retour arrière, **l'ancien code parle à la
nouvelle base**. Ça se passe bien quand la migration était additive (une
colonne en plus, une table en plus : l'ancien code l'ignore). Ça se passe mal
quand elle était destructive (colonne renommée ou supprimée : l'ancien code la
cherche et ne la trouve plus).

C'est pour cela que le champ « ce que ça peut casser » du gabarit de pull
request existe, et qu'une migration doit être **additive par défaut** :
ajouter, déployer, migrer les données, et seulement au déploiement suivant
retirer l'ancienne colonne. Une migration destructive et son déploiement ne
doivent jamais voyager ensemble.

### Trois voies, de la plus rapide à la plus propre

**1 · Revenir au déploiement précédent (30 secondes, mesuré)**

C'est le geste d'urgence. Il ne touche pas au dépôt, et il repart d'une image
déjà construite — donc pas de reconstruction.

Depuis l'interface : service → onglet **Deployments** → le dernier déploiement
`SUCCESS` d'avant → **Rollback**.

Depuis un terminal, exactement la même chose :

```bash
# 1. Trouver l'identifiant du dernier bon déploiement
railway deployment list --service api --environment production --limit 5 --json \
  | jq -r '.[] | "\(.createdAt)  \(.status)  \(.id)"'

# 2. Y revenir  (JETON_RAILWAY : jeton de projet Railway, jamais écrit dans un fichier)
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Project-Access-Token: $JETON_RAILWAY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation($id:String!){deploymentRollback(id:$id)}","variables":{"id":"<ID-DU-BON-DÉPLOIEMENT>"}}'

# 3. Vérifier que le restaurant peut travailler
node scripts/smoke.mjs production
```

**Mesuré sur `api` en staging, le 19 août 2026** — l'essai a été fait dans les
deux sens :

| Sens | Déploiement obtenu | Durée |
|---|---|---|
| retour arrière `660dd9d7` → image de `3e48d02a` | `a98fd8ec` `SUCCESS` | **29 s** |
| retour en avant → image de `660dd9d7` | `b7413695` `SUCCESS` | **24 s** |

Contrôle de santé vert après chacun des deux. Ces mesures datent de l'ancienne
chaîne, où le pré-déploiement rejouait les migrations. Désormais un redéploiement
Railway vérifie seulement les journaux ; une fusion via GitHub Actions applique
d'abord les migrations, puis lance la même vérification.

Notez ce que la mutation fait : elle **crée un nouveau déploiement** à partir
de l'image visée. On ne « remonte » pas dans l'historique, on ajoute un
déploiement de plus — l'historique reste lisible, et on peut repartir en avant
par la même commande, avec l'identifiant de la version qu'on vient de quitter.

À refaire service par service si plusieurs sont en cause — commencer par `api`.

> `railway redeploy` ne fait **pas** ça : il rejoue le déploiement *le plus
> récent*, c'est-à-dire celui qui pose problème. La CLI 4.16 n'a pas de
> commande de retour arrière ; c'est pour cela que l'on passe par l'API.

**2 · Annuler le commit (≈ 10 à 15 minutes)**

C'est la voie propre, celle qui laisse le dépôt et la production d'accord.

Le `git revert` direct ci-dessous ne convient qu'à un commit **sans migration
déjà appliquée ni nouvelle entrée dans le manifeste PostgreSQL**. Sinon, créer
un commit de compatibilité qui annule le comportement applicatif mais conserve
les fichiers `drizzle/`, leurs journaux et les entrées déjà livrées de
`POSTGRES_MANAGED_OBJECTS`. Le schéma avance toujours ; retirer son historique
ferait refuser le préflight bootstrap avant le redéploiement.

```bash
git switch main && git pull
git revert <sha>          # ou : git revert -m 1 <sha-de-fusion> pour une fusion
git push                  # ← redéclenche tout le pipeline, vérifications comprises
gh run watch
```

Le prix est le temps : vérification (~1 à 6 min) + construction et mise en
service des quatre services (~5 à 10 min). **En pleine panne, faites d'abord la
voie 1, puis la voie 2 à froid** — sinon le prochain déploiement remettra en
ligne le code que vous venez de retirer.

**3 · Restauration de données**

Ni GitHub ni Railway ne restaurent des données. Le nécessaire est dans
`@sm/db` (outil de sauvegarde/copie/purge). Une migration destructive doit
être accompagnée d'une procédure manuelle de restauration ou de compensation,
écrite **avant** le déploiement et distincte du pipeline. Cela n'ajoute aucun
inverse automatique aux migrateurs PostgreSQL.

### Après tout retour arrière

```bash
node scripts/smoke.mjs production     # ou staging
```

Et prévenir le restaurant si le service a été interrompu : ils le sauront
avant vous.

---

## 13 · Limites du déploiement automatique

- ~~**La vérification tourne deux fois sur `main`**, et `deploy.yml` recopie
  `ci.yml` et `secrets.yml`.~~ **Réglé le 20 août 2026.** Les deux fichiers
  déclarent `on: workflow_call` et `deploy.yml` les appelle (§ 2). Une seule
  définition : la dérive silencieuse n'est plus possible, et la vérification ne
  tourne plus qu'une fois par commit de `main`.

  **Ce que ça impose désormais.** `ci.yml` et `secrets.yml` ne se déclenchent
  plus sur un push : sur `main` comme sur `develop`, c'est `deploy.yml` qui les
  fait tourner. Les trois fichiers forment donc **un tout** —

  > ⚠️ **Ne fusionnez jamais `ci.yml` dans `main` sans `deploy.yml`.** Pour un
  > événement `push`, GitHub exécute les workflows tels qu'ils sont **sur la
  > branche poussée** : un `main` qui aurait le nouveau `ci.yml` mais pas
  > `deploy.yml` ne vérifierait plus rien du tout. Les trois fichiers sont sur
  > `main` ensemble depuis le 23 août 2026 (§ 10) ; la règle vaut pour chaque
  > retouche future de l'un d'eux. À contrôler avant de fusionner :
  > ```bash
  > git diff --name-only origin/main...HEAD -- .github/workflows/
  > # doit lister ci.yml, secrets.yml ET deploy.yml, ou aucun des trois
  > ```

  Vérification de non-régression après la bascule : `gh run list --branch main
  --limit 5` ne doit plus montrer qu'une exécution `Déploiement` par commit, là
  où l'on voyait `CI` + `Secrets` + `Déploiement`.

- **`main` n'est toujours pas protégée** (§ 3). Un `git push` direct sur `main`
  déclenche maintenant un **déploiement en production**. Le garde-fou local
  (`.github/hooks/pre-push`) prend donc une importance qu'il n'avait pas :
  ```bash
  git config core.hooksPath .github/hooks
  ```
  À faire sur chaque copie de travail, tout de suite.

- **Aucun environnement GitHub, donc aucune approbation manuelle avant la
  production.** Les *environments* et leurs règles de protection sont réservés
  aux dépôts publics ou aux comptes Pro ; ce dépôt est privé sur un compte
  gratuit. Le jour où le compte passe en Pro, ajouter `environment: production`
  au job de mise en ligne et exiger un relecteur : c'est deux lignes.

- **Le déploiement ne s'arrête pas au premier restaurant mécontent.** Rien ne
  déploie par vagues, ni ne revient en arrière tout seul si la santé est
  rouge. Le retour arrière est **humain** (§ 12), et volontairement : un
  retour automatique après une migration additive peut faire plus de mal que
  la panne.

- **Le contrôle de santé ne dit pas que ça marche.** Il dit que ça répond. Le
  workflow **Bout en bout** (§ 9) joue les parcours critiques dans un vrai
  navigateur après chaque déploiement — mais il ne bloque rien : un rouge se
  lit dans l'onglet Actions, après coup. La vérification à la main sur staging
  avant `main` reste donc de rigueur pour tout changement qui touche la prise
  de commande.

- ~~**Aucune surface ne publie sa révision.**~~ **Réglé pour l'API le 20 août
  2026** : `GET /health` renvoie le SHA servi, et le contrôle de santé
  **affirme** que c'est celui qu'on vient de pousser (§ 11).

  **Ce qui reste.** `web`, `pos` et `kds` ne publient toujours rien : pour eux,
  l'empreinte du corps servi reste le seul indice, et elle ne dit pas *quel*
  commit, seulement *un autre* commit. Trois façons de solder ça, par ordre de
  coût : exposer `SM_REVISION` dans une balise `<meta>` du gabarit Next, servir
  un `/version.json`, ou brancher les services Railway sur le dépôt GitHub —
  auquel cas `RAILWAY_GIT_COMMIT_SHA` apparaîtrait partout toute seule, et
  `revision.ts` la lirait sans modification (elle est déjà la seconde source).

  **Angle mort assumé du contrôle actuel :** `SM_REVISION` est posée sur le
  service `api` seul. Un déploiement où `api` réussit et où `pos` échoue passe
  donc le contrôle de révision — c'est le job `Mise en ligne` qui échoue alors,
  et lui seul, ce qui suffit à rendre l'exécution rouge.

- **`main` déclenche bien le chemin production, sans approbation serveur.** Il
  reste volontairement fermé tant que ses secrets fidélité/DB/contact, sa paire
  Turnstile et les variables d'hôte attendues ne sont pas créés après un GO
  écrit. Une fusion prématurée échoue fermée, mais reste interdite : la première
  mise en production fidélité exige la recette staging et ne se fait jamais du
  jeudi au dimanche.
