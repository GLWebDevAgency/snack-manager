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

Ce n'est pas un pipeline de déploiement : la mise en ligne sur Railway reste
manuelle (§ 7).

---

## 2 · Ce qui tourne, et quand

| Fichier | Contrôle affiché | Déclenché sur | Ce qu'il fait |
|---|---|---|---|
| `.github/workflows/ci.yml` | **Vérification du monorepo** | pull request · push sur `main` | `typecheck`, `lint`, `test`, `build` sur tout le monorepo via Turborepo |
| `.github/workflows/secrets.yml` | **Balayage des secrets** | pull request · push sur `main` | gitleaks sur les commits apportés, puis sur l'arbre complet |

Les deux tournent en parallèle. Sur une pull request, la précédente exécution
est annulée à chaque nouveau push (`concurrency`) ; sur `main`, jamais — chaque
commit livré mérite son verdict.

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
C'est pour cela que `ci.yml` tourne aussi sur `main` : chaque fusion réchauffe
le cache dont profiteront les pull requests suivantes.

**Purger le cache** si vous soupçonnez un artefact corrompu :
`gh cache delete --all` (ou `gh cache list` pour regarder d'abord).

### Balayage des secrets

Deux passes, parce qu'elles ne répondent pas à la même question :

1. **Les commits apportés** (`gitleaks/gitleaks-action@v3`) — empêche un secret
   d'ENTRER. Échoue sur le commit fautif, avant la fusion.
2. **L'arbre courant** (`gitleaks dir .`) — répond à « y a-t-il un secret dans
   le dépôt aujourd'hui ? », y compris entré avant la mise en place de cette
   CI. Cette passe est la seule qui protège rétroactivement.

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

`main` est protégée. Concrètement :

- **Pas de push direct sur `main`.** Le passage par une pull request est
  obligatoire, y compris pour l'auteur du dépôt.
- **Les deux contrôles doivent être verts** avant que le bouton de fusion
  s'active : `Vérification du monorepo` et `Balayage des secrets`. Attention :
  au sein du premier, l'étape « Analyse statique » ne bloque pas (§ 9) — le
  contrôle peut être vert avec ESLint en échec, signalé en annotation jaune.
- **La branche doit être à jour** avec `main` avant fusion.
- **Pas de force-push ni de suppression** de `main`.
- **Aucune relecture par un tiers n'est exigée.** L'auteur est seul sur le
  dépôt : exiger une approbation le bloquerait complètement. Le jour où une
  deuxième personne rejoint le projet, c'est le premier réglage à changer :
  ```bash
  gh api -X PATCH repos/GLWebDevAgency/snack-manager/branches/main/protection/required_pull_request_reviews \
    -F required_approving_review_count=1
  ```

Lire la protection en place à tout moment :

```bash
gh api repos/GLWebDevAgency/snack-manager/branches/main/protection
```

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

## 7 · Mise en ligne et retour arrière

⚠️ **Le déploiement n'est pas automatisé.** Aucun fichier de configuration
Railway n'est versionné ; la mise en ligne se fait depuis un poste de
développement ou depuis l'interface Railway (projet `snack-manager`, services
`api` et `web`). La CI verrouille ce qui entre dans `main` ; elle ne pousse
rien en production.

**Règle maison, plus forte que la CI : jamais de déploiement du jeudi au
dimanche.** Les restaurants vivent le week-end.

### Revenir en arrière

Par ordre de préférence :

1. **Redéployer la révision précédente depuis Railway** — c'est le retour
   arrière le plus rapide, et il ne touche pas au dépôt. Service `api` ou
   `web` → historique des déploiements → redéployer.
2. **Annuler la fusion dans `main`**, ce qui repasse par la CI :
   ```bash
   gh pr revert <numéro>          # ou : git revert -m 1 <sha-de-fusion>
   ```
   Puis redéployer. `revert` est préférable à un force-push : la protection de
   `main` interdit ce dernier, et à raison.
3. **Restauration de données** : ni la CI ni Railway ne rejouent une migration
   à l'envers. Une migration PostgreSQL (`@sm/supply`) ou un script de
   rétro-remplissage MongoDB doit être conçu réversible, ou accompagné de son
   inverse. Le champ « ce que ça peut casser » du gabarit de pull request
   existe pour que cette question soit posée avant, pas après.

### Vérifier après déploiement

```bash
curl -s https://api-production-8949.up.railway.app/health
```

---

## 8 · Entretien

| Élément | Où | Quand le relever |
|---|---|---|
| Version de Node | `ci.yml` → `node-version` | passage d'une LTS à la suivante, ou ajout d'un `.nvmrc` |
| Version de pnpm | `package.json` → `packageManager` | la CI suit automatiquement |
| Versions des actions | `ci.yml`, `secrets.yml` | GitHub retire les anciens moteurs Node ; toutes les actions sont épinglées sur des versions à moteur Node 24 |
| Version de gitleaks | `secrets.yml` → `VERSION_GITLEAKS` | de temps en temps, pour bénéficier des nouvelles règles |
| Budget de temps | `ci.yml` → `timeout-minutes: 20` | si la CI approche les dix minutes, découper le job avant qu'elle devienne un obstacle |

---

## 9 · Limites connues

- **Le déploiement reste manuel** (§ 7). L'étape suivante naturelle est de
  brancher Railway sur `main` : la CI qui garde la branche existe désormais,
  c'était le préalable.
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
  fichier de test.** La règle `secret-en-dur` est désactivée sur les fichiers
  `*.test.ts` / `*.spec.ts`, parce que
  `apps/api/src/modules/ordering/stripe-webhook.test.ts` fabrique un secret de
  signature Stripe — une valeur inventée qui a, volontairement, la forme d'un
  secret. Sans cette exemption le balayage serait rouge en permanence, donc
  ignoré, donc inutile.

  Ce qui continue de couvrir les fichiers de test : toutes les règles gitleaks
  par défaut (clés Stripe `sk_live_`, AWS, jetons GitHub, clés privées PEM…),
  `uri-connexion-avec-identifiants` et `fichier-env-versionne`. Seul un mot de
  passe **sans forme reconnaissable** passerait entre les mailles.

  Le vrai correctif est en amont : que ce test compose sa valeur au lieu de la
  porter en dur. `apps/api` n'est pas du ressort de ce pipeline ; l'exemption
  est étroite, commentée dans `.github/gitleaks.toml`, et à retirer le jour où
  le test change.

- **Pas de balayage périodique de l'historique complet.** Les deux passes
  couvrent le diff et l'arbre courant, pas les 28 commits antérieurs.
