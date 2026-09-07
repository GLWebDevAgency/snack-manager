# C15 — commande opérateur de bootstrap

Cette commande est un outil de maintenance explicite. Elle ne démarre ni Nest,
ni serveur HTTP, ni workers métier. Aucune exécution sur une base métier n'est
attestée par ce document. La procédure de release et le SHA réellement servi
restent suivis dans [CAPACITE-DURABLE.md](CAPACITE-DURABLE.md).

## Contrat et prérequis

- Node **24.12.0 minimum** ; compilation habituelle de l'API et de ses paquets
  workspace. L'entrée compilée est
  `apps/api/dist/maintenance/order-capacity-bootstrap.cli.js` depuis la racine
  du dépôt, ou `dist/maintenance/order-capacity-bootstrap.cli.js` depuis
  `apps/api`. Aucun package ou service supplémentaire n'est requis.
- `MONGO_URL` injectée par le contexte serveur choisi, jamais passée en argument
  ni affichée. Aucun chargement automatique d'un `.env`. La base doit être
  nommée ; les bases administratives et la base implicite `test` sont refusées.
- Sans `--apply`, lecture native Mongo uniquement : aucun modèle applicateur,
  index, collection, admission ou connexion Redis créé par la commande.
- `--apply` exige `RAILWAY_ENVIRONMENT_NAME=staging` (casse/espaces normalisés),
  `REDIS_URL`, un UUID v4, un SHA complet de 40 caractères hexadécimaux minuscules
  et l'attestation `--writers-stopped`. Production, environnement absent ou
  inconnu : refus **avant connexion**. Pas de drapeau de contournement.
- `REDIS_URL` accepte `redis://` ou `rediss://`, avec authentification et index
  de base facultatifs, sans fragment ni paramètres de requête qui pourraient
  remplacer les options de connexion bornées de la commande.
- Les modes de logs bruts `DEBUG`, `NODE_DEBUG`, `NODE_DEBUG_NATIVE` doivent être
  absents ou vides. Le logging structuré natif Mongo est désactivé explicitement.

Le nom d'environnement est une **attestation du contexte injecté**, pas une
preuve cryptographique de la destination Mongo. Ne jamais recopier une URI de
production sous un nom staging. Avant application, l'opérateur doit vérifier
le projet et l'environnement sélectionnés, la référence Mongo/Redis correspondante,
le SHA servi par les nouveaux writers et l'arrêt effectif des anciens.
La commande ne vérifie pas le déploiement Railway et retourne
`rolloutVerifiedByCli:false`.

L'arrêt inclut les anciens binaires, jobs, outils natifs d'écriture et files
hors ligne susceptibles de rejouer une réservation. Ne pas purger des tickets
ou encaissements incertains pour satisfaire ce prérequis. `--writers-stopped`
n'est pas un verrou distribué ; la fenêtre de maintenance est à organiser
avant de l'attester.

## Analyse sans écriture

Avec les variables déjà injectées et sans afficher leurs valeurs :

```sh
node apps/api/dist/maintenance/order-capacity-bootstrap.cli.js --help
node apps/api/dist/maintenance/order-capacity-bootstrap.cli.js \
  --tenant 507f1f77bcf86cd799439011 \
  --from-day 2030-05-02
```

L'identifiant et la date ci-dessus sont **fictifs** : sélectionner explicitement
le tenant réel lors de la release. `--tenant` accepte un ObjectId hexadécimal,
pas un slug, un numéro de téléphone ou une liste globale.

`--from-day` est le début inclusif du jour civil **Europe/Paris**, converti en
instant UTC en respectant été/hiver. Le lecteur scanne cependant les preuves
de **tout le tenant** pour détecter les liens incohérents ; toutes les commandes
à créneau depuis cette journée sont rapprochées, même au-delà de l'horizon de
commande public. Il n'existe **pas de `--to-day` tronquant**.

Les bornes facultatives ferment le scan si elles sont dépassées ; elles
n'autorisent jamais à ignorer la fin de l'historique :

| Option | Défaut | Maximum |
| --- | ---: | ---: |
| `--max-documents` | 10 000 | 100 000 |
| `--max-bytes` | 8 388 608 | 67 108 864 |
| `--max-days` | 90 | 366 |
| `--max-duration-ms` | 30 000 | 120 000 |

Entiers positifs stricts ; doublons, options inconnues, valeurs fractionnaires
et notation exponentielle sont refusés avant connexion. `max-days` borne le
nombre de journées observées, pas une date de fin. Le budget d'analyse n'est
pas un délai global de transaction du bootstrap : plusieurs lectures bornées
sont nécessaires, puis des écritures reprenables. Les snapshots complets lus
pour matérialisation ont aussi une borne BSON.

La sortie JSON ne contient pas les coordonnées client, les lignes/prix, le
tracking token, les empreintes de reprise, les snapshots ni les URI. Elle
résume les compteurs, journées, codes de conflit et au plus 100 références
d'erreurs normalisées. `issuesTruncated:true` concerne seulement l'affichage,
jamais le contrôle : le store vérifie tous les conflits. `canActivate:false`
et `requiresExclusiveRescan:true` restent présents même si `status=reviewed`.
Une analyse non atomique favorable ne vaut pas validation de bascule.

## Application staging explicite et reprise

Après la vérification opérateur et l'analyse, choisir **une seule fois** un UUID
v4 et conserver avec lui le tenant, le jour de bascule et le SHA du writer.
La commande n'engendre pas un nouvel identifiant à chaque reprise.

```sh
node apps/api/dist/maintenance/order-capacity-bootstrap.cli.js \
  --tenant 507f1f77bcf86cd799439011 \
  --from-day 2030-05-02 \
  --apply \
  --bootstrap-id 11111111-1111-4111-8111-111111111111 \
  --writer-revision aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --writers-stopped
```

Ces identifiants sont encore fictifs. Ne pas utiliser un alias de branche à la
place du SHA complet. Les mêmes options de limites restent disponibles.

Le store rescane sous exclusion opératoire, prend une génération `seeding`,
rapproche les preuves existantes, importe les sièges et relit l'ensemble avant
`active`. Il ne crée pas de Tenant. Un restaurant nouvellement provisionné,
même sans aucune commande, passe par cette **même application explicite** :
aucun `GET`, démarrage API ou formulaire BO ne l'active implicitement.

Les insertions historiques ne créent pas une preuve publique artificielle.
Les anciennes commandes protégées conservent leurs empreintes, numéro, prix
et jeton. Surbooking, hors-grille et ambiguïtés restent bloquants. Aucune vente
n'est supprimée ou modifiée financièrement pour permettre l'activation.

Après timeout, signal, perte de connexion ou reçu manquant, une écriture peut
déjà avoir réussi. **Rejouer la même commande avec le même UUID/jour/tenant/SHA** ;
ne jamais réinitialiser le contrôle, supprimer des sièges, changer d'UUID ou
revenir à un writer legacy. `already_active` est un reçu idempotent, pas une
seconde importation. Une erreur peut laisser `seeding` jusqu'à reprise.

Redis est connecté avant les écritures d'application. La matérialisation peut
publier des mises à jour d'écran ; la commande attend les publications engagées
avant de fermer Redis et rapporte `notificationsBestEffort.attempted/failed`.
Cela ne garantit ni abonnement actif ni réception sur tablette. Après activation,
recharger les écrans opérationnels et vérifier leurs commandes. Une panne de
publication n'annule pas un bootstrap déjà durable ; aucun SMS, e-mail ou
paiement Stripe n'est envoyé par cette commande.

| Code de sortie | Sens |
| --- | --- |
| `0` | Analyse complète sans conflit, ou reçu `active`/`already_active`. |
| `1` | Erreur technique ; après entrée dans `apply`, issue potentiellement déjà écrite. |
| `2` | Arguments, moteur Node ou configuration refusés. |
| `3` | Scan incomplet, conflit historique ou bootstrap bloqué. |

`operationMayHaveApplied:true` exige la reprise de la même opération. Un problème
de fermeture après reçu `active` conserve ce reçu et ajoute `cleanupWarning:true` ;
il ne transforme pas une réussite durable en faux « rien n'a été fait ».

La production est volontairement refusée par cet exécutable. Son ouverture
exigera une procédure distincte validée et le GO production, pas une variable
renommée pour contourner cette restriction.

## Preuves locales de cette commande

Tests unitaires : parsing strict, garde staging, absence de connexion lors
refus, engine Node, journée Paris/DST, bornes, erreurs filtrées et reçu après
fermeture défaillante. Tests d'intégration : Mongo standalone réel sur base
UUID loopback détenue par la suite ; **Redis est simulé**, aucun compte distant
ou service métier n'est utilisé. Les tests contrôlent notamment l'absence de
commande d'écriture en mode analyse et l'ordre `publish → quit`.

```sh
pnpm --filter @sm/api exec vitest run src/maintenance/order-capacity-bootstrap.cli.test.ts
ORDER_CAPACITY_CLI_TEST_MONGO_URL=mongodb://127.0.0.1:27037/snackmanager_capacity_cli_test_local \
  pnpm --filter @sm/api exec vitest run src/maintenance/order-capacity-bootstrap.cli.integration.test.ts
```

L'URI de recette est sans authentification et ne cible que le daemon local
préparé par l'opérateur de tests. La suite ajoute un suffixe UUID, vérifie sa
propriété avant nettoyage et ne démarre/arrête pas Mongo. Sans variable, les
tests Mongo sont ignorés ; les gardes de cible restent exécutées. La CI doit
donc fournir explicitement cette variable pour revendiquer la preuve réelle.
