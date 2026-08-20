# Pipeline de qualité — comment on livre Snack Manager

Ce document s'adresse à celui qui reprend le projet et doit livrer sans casser
Class'Food un vendredi soir. Il décrit ce qui tourne automatiquement, ce qui
bloque une fusion, et comment revenir en arrière.

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
Analyse statique   → turbo run lint             NON bloquant (§ 9)
Tests              → turbo run test             bloquant
Compilation        → turbo run build            bloquant
```

Points à connaître :

- **Node 22.** Le `package.json` racine déclare `engines.node: >=20`, qui est
  une borne et non une version. La CI fige 22 (LTS), qui satisfait la borne.
  Si un `.nvmrc` est ajouté un jour, c'est lui qui doit faire foi — pensez à
  aligner `ci.yml`.
- **pnpm n'est pas versionné dans le workflow.** `pnpm/action-setup` lit le
  champ `packageManager` du `package.json` racine. Une seule source de vérité.
- **`pnpm install --frozen-lockfile`.** Si `pnpm-lock.yaml` ne correspond plus
  aux `package.json`, la CI s'arrête là. C'est voulu : sinon la CI résoudrait
  en douce d'autres versions que celles du poste de développement.
- **Les paquets sans script ne cassent rien.** Turborepo ignore silencieusement
  les tâches absentes. `@sm/web`, `@sm/kds`, `@sm/db` et `@sm/supply` n'ont pas
  de script `test` : ces tâches sont simplement sautées, la CI reste verte.
  Vérifiable localement : `pnpm exec turbo run test --dry=json` liste ces
  tâches avec `"command": "<NONEXISTENT>"`.

### Cache Turborepo

Le **cache distant est explicitement coupé** (`--cache=local:rw,remote:`) :
aucun artefact ne sort du dépôt, aucun jeton Vercel n'est nécessaire. Le
**cache local** (`.turbo/cache`) est en revanche conservé d'une exécution à
l'autre par `actions/cache`.

La clé est unique par commit avec un repli sur la précédente :

```
key:          turbo-Linux-node22-<sha>
restore-keys: turbo-Linux-node22-
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
  `Vérification du monorepo` et `Balayage des secrets`. Attention : au sein du
  premier, l'étape « Analyse statique » ne bloque pas (§ 9) — le contrôle peut
  être vert avec ESLint en échec, signalé par une annotation jaune.
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

## 4 · Livrer un changement

```bash
# 1. Partir de main à jour
git switch main && git pull

# 2. Une branche par changement
git switch -c fix/nom-du-changement

# 3. Travailler, puis vérifier AVANT de pousser (§ 5)
pnpm verify

# 4. Committer — jamais `git add .` si d'autres travaux sont en cours
git add <chemins précis>
git commit

# 5. Ouvrir la pull request : le gabarit se remplit tout seul
git push -u origin fix/nom-du-changement
gh pr create --fill

# 6. Regarder la CI, vraiment
gh pr checks --watch

# 7. Fusionner une fois les deux contrôles verts
gh pr merge --squash --delete-branch
```

Le gabarit de pull request (`.github/pull_request_template.md`) pose trois
questions : ce que ça change, comment ça a été vérifié, ce que ça peut casser.
La troisième est celle qu'on est tenté de sauter, et c'est celle qui sert le
jour du retour arrière.

**Une CI verte prouve que ça compile et que les tests passent. Elle ne prouve
pas que ça marche.** Le monorepo n'a pas de tests de bout en bout sur les
surfaces terrain : la caisse et l'écran cuisine se vérifient à la main.

Ce paragraphe décrit le trajet jusqu'à `main`. **La suite — de `main` jusqu'au
restaurant en service — est au § 10**, et elle est automatique : la fusion
déclenche le déploiement en production.

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
| Version de Node | `ci.yml` → `node-version` | passage d'une LTS à la suivante, ou ajout d'un `.nvmrc` |
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
- **Pas de tests de bout en bout.** `playwright` est présent à la racine mais
  aucun scénario n'est joué en CI. La caisse, l'écran cuisine et la commande en
  ligne se vérifient à la main.
- **L'étape « Analyse statique » ne bloque pas la fusion.** C'est le
  compromis le plus important de ce pipeline, et il est temporaire.

  `lint` est un `echo ok` dans presque tous les paquets ; seul `@sm/web` lance
  réellement ESLint, et il sort **42 erreurs préexistantes**, essentiellement
  `react-hooks/set-state-in-effect` — une règle que `eslint-config-next` érige
  en erreur depuis Next 16, sur du code écrit avant qu'aucune CI ne le
  regarde (`Checkout.tsx`, `cart.ts`, `primitives.tsx`…).

  Rendre l'étape bloquante le jour de sa mise en place aurait interdit *toute*
  fusion, y compris un correctif de production un vendredi soir. L'étape tourne
  donc, échoue **visiblement** — annotation jaune sur l'exécution et encart
  dans le résumé — mais laisse passer.

  **Pour la rendre bloquante** (c'est l'objectif) : solder les 42 erreurs, puis
  retirer de `.github/workflows/ci.yml` le `continue-on-error: true` de l'étape
  « Analyse statique » ainsi que l'étape « Signaler la dette d'analyse
  statique ». Le critère est net :

  ```bash
  pnpm exec turbo run lint   # doit sortir en 0
  ```

  Tant que ce n'est pas fait, **une CI verte ne dit rien de l'analyse
  statique** : allez lire l'annotation.
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
# 1. Partir de main à jour
git switch main && git pull

# 2. Une branche par changement
git switch -c fix/nom-du-changement

# 3. Vérifier AVANT de pousser (§ 5)
pnpm verify

# 4. Répéter sur staging d'abord — c'est là que ça doit casser
git switch develop && git pull && git merge fix/nom-du-changement
git push origin develop            # ← déclenche le déploiement staging

# 5. Regarder le déploiement, vraiment
gh run watch

# 6. Essayer sur staging à la main : la caisse, l'écran cuisine, une commande
#    en ligne. Le contrôle de santé (§ 11) dit que ça répond, pas que ça marche.

# 7. Alors seulement, la production, par pull request (§ 4)
gh pr create --base main --fill
gh pr checks --watch
gh pr merge --squash --delete-branch   # ← déclenche le déploiement production
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
| 4 | **Mise en ligne** | pose `SM_REVISION` sur `api`, puis déploie `api` seul (migrations), puis `web`, `pos`, `kds` ensemble | les suivants ne partent pas ; l'ancienne version continue de servir |
| 5 | **Santé après déploiement** | `scripts/smoke.mjs` sur les surfaces publiques, **révision servie comprise** (§ 11) | le déploiement est déclaré **EN ÉCHEC**, mais le code est **EN LIGNE** (§ 12) |

Les jobs 2 et 3 n'ont **aucune étape** : ce sont des appels. Dans l'interface
GitHub ils apparaissent sous le nom du fichier appelé — `verification /
Vérification du monorepo` et `secrets / Balayage des secrets`.

Le job 5 tourne **aussi quand le job 4 a échoué** (`always()`). Un vendredi
soir, la première question n'est pas « le déploiement est-il passé ? » mais
« le restaurant peut-il encaisser ? ». Quand Railway refuse une mise en
service, l'ancienne version continue de servir — et il faut le *savoir*, pas
le supposer. Dans ce cas le job affiche un avertissement en tête : vert
signifie alors « l'environnement répond », pas « le déploiement a réussi ».
Si c'est la vérification qui a échoué, rien n'a été touché et le job 5 ne
tourne pas.

Les jobs 4 et 5 sont branchés par `needs:` sur les jobs 2 et 3. Ce n'est pas
une politesse : un job dont un `needs` échoue **ne démarre pas**. Le
déploiement n'est pas « sauté », il est inatteignable.

> **Tout push déploie, même un changement de documentation.** Il n'y a
> volontairement aucun `paths-ignore` : le jour où une exclusion existe, la
> tête de `develop` peut différer de ce qui tourne sur staging, et on retombe
> exactement dans le décalage que ce pipeline supprime. Un déploiement coûte
> une poignée de minutes ; un décalage invisible a coûté deux heures.

> **Deux poussées coup sur coup font la queue** (`concurrency`, sans
> annulation). On n'interrompt jamais un déploiement en vol : annuler le job
> GitHub n'annulerait de toute façon pas le déploiement Railway déjà lancé, et
> une migration peut être en cours.

### Pourquoi `api` part seule, et en premier

Le service `api` porte un `preDeployCommand` **posé côté Railway** (pas dans
GitHub Actions, et il ne faut pas l'y déplacer) :

```
node packages/supply/dist/migrate.js
```

Il s'exécute dans le conteneur Railway, où `DATABASE_URL` est déjà présente, et
**il bloque la mise en service si la migration échoue**. Le schéma PostgreSQL
est donc à jour avant que la nouvelle version serve la moindre requête, et
avant que les trois interfaces se remettent à appeler l'API.

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
   staging ne peut rien déployer en production. C'est pour cela qu'aucune
   commande ne passe `--environment` : le jeton, et lui seul, désigne la cible.

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
| Migrations en pré-déploiement | `✓ Migrations supply appliquées` dans le journal du déploiement `660dd9d7` |
| Retour arrière | § 12 — mesuré dans les deux sens, 29 s et 24 s |

**Le déploiement vers `main` n'a volontairement pas été déclenché.** Le chemin
est le même à deux valeurs près (le jeton et le nom d'environnement), tous deux
choisis par la garde plus haut.

> ### ⚠️ Le chemin production n'est pas encore ARMÉ
>
> Pour un événement `push`, GitHub exécute les workflows **tels qu'ils sont sur
> la branche poussée**. C'est ce qui a permis de mettre `deploy.yml` au point
> sur `develop` sans jamais risquer la production — et c'est aussi ce qui fait
> qu'aujourd'hui :
>
> ```bash
> $ git ls-tree -r --name-only origin/main -- .github/workflows/
> .github/workflows/ci.yml
> .github/workflows/secrets.yml      # ← pas de deploy.yml
> ```
>
> **Tant que `deploy.yml` n'est pas dans `main`, un push sur `main` ne déploie
> rien.** Le chemin production existe, il est écrit et conditionné, mais il ne
> s'armera qu'à la fusion :
>
> ```bash
> gh pr create --base main --head develop --fill
> gh pr checks --watch
> gh pr merge --squash        # ← cette fusion déploie EN PRODUCTION
> ```
>
> Cette fusion emporte aussi le correctif `@sm/supply` décrit plus haut. Elle
> se fait un jour de semaine, en début de journée, et on regarde le contrôle de
> santé jusqu'au bout.

---

## 11 · Le contrôle de santé — `scripts/smoke.mjs`

« C'est en ligne » et « ça marche » sont deux affirmations différentes. Le
job **Santé après déploiement** ne répond qu'à la seconde.

```bash
node scripts/smoke.mjs staging
node scripts/smoke.mjs production
```

Aucune dépendance à installer (Node ≥ 20 suffit), et il tourne aussi bien
depuis un poste que dans la CI.

| Contrôle | Ce qu'il prouve |
|---|---|
| `GET /health` | l'API répond, et c'est bien **notre** API (`service: snack-manager-api`) |
| `GET /health` → **révision** | c'est bien **la révision qu'on vient de pousser** qui sert, pas celle d'avant |
| `GET /public/tenants/<slug>/menu` | la lecture traverse Mongo de bout en bout et le multi-établissement résout |
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

> **La carte publique est « IGNORÉE » en production, et ce n'est pas un
> oubli.** La base de production a été remise à blanc (commit `7b1c6dc`) : il
> n'y a aujourd'hui aucun établissement, donc aucune carte à servir. Le
> contrôle s'annonce alors `IGNORÉ` — bruyamment, avec une annotation — plutôt
> que rouge pour une raison qui n'est pas une panne. **Le jour où le premier
> restaurant est en ligne**, renseigner son slug dans `scripts/smoke.mjs`
> (`CIBLES.production.slugCarte`) et le contrôle redevient réel. Un contrôle
> qui ne peut pas tourner n'est pas un contrôle qui passe.

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
d'avant.** `packages/supply/dist/migrate.js` applique les migrations en avant,
il n'a pas d'inverse, et Railway ne rejoue rien à l'envers.

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

Contrôle de santé vert après chacun des deux. Le pré-déploiement rejoue les
migrations à chaque fois (`✓ Migrations supply appliquées` dans le journal) :
elles sont idempotentes, les rejouer ne coûte rien.

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
être accompagnée de son inverse, écrit **avant** le déploiement.

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
  > `deploy.yml` ne vérifierait plus rien du tout. Aujourd'hui `deploy.yml`
  > n'est pas encore sur `main` (§ 10) : la fusion qui l'y emmènera doit
  > emporter les trois fichiers ensemble. À contrôler avant de fusionner :
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

- **Le contrôle de santé ne dit pas que ça marche.** Il dit que ça répond. La
  caisse, l'écran cuisine et une commande en ligne complète se vérifient à la
  main, sur staging, avant `main`. Il n'y a toujours pas de test de bout en
  bout (§ 9).

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

- **Le déploiement de `main` n'a jamais été exécuté, et n'est pas encore
  armé** — `deploy.yml` n'est pas sur `main` (§ 10). Le chemin est identique à
  celui de `develop`, au jeton et au nom d'environnement près, et il a été
  vérifié sur staging. La première mise en production réelle reste à faire, et
  elle ne se fait pas un vendredi soir.
