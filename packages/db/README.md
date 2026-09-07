# Outils Mongo de développement et de maintenance

## Seeds et copies : bases jetables uniquement

`seed`, `seed:orders`, ainsi que `copy-database.ts copy/purge --go` sont des
outils destructifs de développement. Ils refusent les bases servies, staging
et production, avant connexion à la cible. Aucun `--force` ou drapeau
d’environnement ne lève ce refus.

La cible doit être une URI `mongodb://` vers `127.0.0.1`, `localhost` ou `[::1]`,
avec une base **explicitement** nommée `snackmanager_disposable_<suffixe>`.
Le suffixe compte 8 à 32 caractères minuscules, chiffres ou `_`. Les identifiants,
paramètres URI, fragments, hôtes multiples et redirections de réplica set sont
exclus. Les connexions écrivantes imposent `directConnection: true`.

Exemple, avec un Mongo local déjà installé et démarré :

```bash
export MONGO_URL=mongodb://127.0.0.1:27017/snackmanager_disposable_classfood_local
pnpm --filter @sm/db seed
pnpm --filter @sm/db seed:orders
```

L’API de développement doit utiliser la même URI pour voir ces fixtures. Ne
renommez jamais une base métier pour franchir cette garde et ne servez jamais
une base `snackmanager_disposable_*` comme environnement client.

Toute présence de `Tenant.capacityControl`, même `null` ou corrompu, ou d’une
admission durable C01/C15 ou d’un calendrier interdit également l’opération.
Ces lectures sont des diagnostics, **pas un verrou contre les courses** : aucun
writer applicatif ni bootstrap ne doit tourner sur la cible pendant ces outils.
La protection des bases servies vient de leur exclusion, pas d’une relecture
entre deux écritures.

## Copie, sauvegarde et restauration ne sont pas équivalentes

`copy` peut lire une source distante autorisée, mais écrit seulement vers la
cible locale jetable. Une source portant des preuves durables est refusée ;
son état `active` n’est jamais transporté comme une activation valable. Le batch
effectivement lu est aussi vérifié avant écriture. Les comptes de connexion de
la source ne sont pas transportés.

Les aperçus `copy/purge` sans `--go` et `dump` restent des lectures Mongo.
`dump` écrit des fichiers locaux sensibles : conservez-les dans un dossier
privé et ne les commitez pas. Son format JSON historique et la copie successive
des collections ne sont pas une procédure de restauration cohérente.

Une restauration réelle exige une procédure distincte : arrêt des writers,
vérification des types BSON et des index, rapprochement des commandes,
admissions et calendriers, puis rescan exclusif avant réouverture. Ces scripts
ne fournissent ni cette procédure ni l’autorisation de reprendre les ventes.
Une copie interrompue reste partielle et ne doit jamais être mise en service.

## Reprises ciblées sur Railway

`scripts/reprise-mongo.sh` accepte uniquement `backfill:founder`,
`backfill:contact`, `backfill:brand`, `backfill:medias` et `backfill:tracking`.
Seeds, CLI arbitraires, copies et purges sont refusés **avant** l’appel Railway.

Les quatre premières reprises gardent leur aperçu sans `--appliquer`, puis
l’écriture explicite suivie du contrôle `--exiger-zero`. Le script direct
`backfill:tracking` n’a pas de mode lecture et écrit immédiatement ; son
lanceur Railway exige donc désormais :

```bash
scripts/reprise-mongo.sh staging backfill:tracking --appliquer
```

Le lanceur ne réexécute pas automatiquement ce writer sous couvert de contrôle.
La confirmation de production reste requise. Aucun de ces backfills ne crée
de place de capacité ni n’active C15.
