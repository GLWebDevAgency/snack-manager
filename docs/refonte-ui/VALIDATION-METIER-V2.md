# Validation élargie — métier et contrats

Branche : `refactor/ui-handoff-fidelity`. Exécution locale du 12 septembre 2026, après le raccordement des tickets imprimables Salle et le correctif de clôture des tickets déjà remis puis remboursés. Aucun test n’a été supprimé ni modifié pour assouplir une attente.

## Suites complètes exécutées

Les scripts `test` des quatre packages lancent `vitest run`. Tous leurs fichiers découverts ont été pris en compte, avec deux workers maximum et un worker minimum. Les compteurs ci-dessous proviennent des résumés finaux des logs ; les passages précédents ne sont pas additionnés.

| Package | Tests réussis | Tests ignorés | Fichiers réussis / ignorés | Preuve |
| --- | ---: | ---: | --- | --- |
| `@sm/api` | 3 686 | 803 | 217 / 7 | [API finale](preuves/service-table-api-full-final.log) |
| `@sm/db` | 556 | 10 | 31 / 0 | [DB](preuves/service-table-db-full.log) |
| `@sm/contracts` | 678 | 0 | 43 / 0 | [Contrats](preuves/service-table-contracts-full.log) |
| `@sm/client-core` | 131 | 0 | 11 / 0 | [Client core](preuves/service-table-client-core-full.log) |

La suite API finale contient les **33 tests Salle**, les **26 tests du pricing Salle**, les **31 tests notifications**, ainsi que les **3 tests de projection/impression des tickets Salle**. Ces sous-totaux sont déjà inclus dans les 3 686 tests. Le dernier passage API a duré 70,59 secondes.

Le typecheck API, le typecheck client core, le lint du dernier correctif Salle et le build API ont réussi : [types API](preuves/service-table-api-typecheck-final.log), [types client](preuves/service-table-client-core-typecheck.log), [lint](preuves/service-table-api-lint-final.log), [build](preuves/service-table-api-build-final.log). Le build final contient le `TicketService` imprimant la table ainsi que la règle terminale de clôture. Les builds contrats et DB avaient déjà réussi après l’ajout de leurs schémas.

## Infrastructure et hypothèses

Chaque commande a été exécutée avec `env -i`, un `PATH` limité à Node 24.20.0 et aux outils système, `TMPDIR=/tmp` et `NODE_ENV=test`. Aucune variable applicative, adresse PostgreSQL, URL Redis ou clé de fournisseur n’a été héritée. Les fichiers `.env` racine et API sont absents dans ce worktree ; les tests qui importent `AppModule` ne peuvent donc pas y récupérer une configuration métier.

Seules les variables `DINING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_test_local` et `DINING_PRICING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local` ont été fournies à l’API. Chaque harnais vérifie la cible locale, dérive une base possédée suffixée par un UUID et nettoie uniquement cette base.

Le harnais notifications a utilisé le binaire réel `/opt/homebrew/bin/mongod` : port aléatoire sur `127.0.0.1`, répertoire temporaire possédé, base de recette unique, arrêt du processus et nettoyage bornés. Son fournisseur push est simulé. Aucun PostgreSQL réel, fournisseur de paiement, service SMS ou base distante n’a été configuré pour ce passage. Les tests HTTP démarrent leurs propres serveurs loopback ; ils ne ciblent pas un compte ou une API déployée.

Les logs [premier passage](preuves/service-table-api-full.log) et [passage avec notifications avant le dernier correctif](preuves/service-table-api-full-local.log) sont conservés pour traçabilité. Le premier avait désactivé le démarrage implicite de Mongo notifications par une variable de binaire absent. La suite complète a ensuite été réexécutée avec le binaire local actif, puis réexécutée après le correctif de clôture ; seul le log final ci-dessus fait foi pour l’état livré.

## Cas non exécutés dans ces commandes

Les suites d’intégration préexistantes nécessitant leurs variables dédiées restent ignorées. Un fichier marqué réussi peut contenir des gardes pures exécutées et une partie d’intégration ignorée. Les 803 cas API ignorés se répartissent ainsi ; chaque fichier et son compteur figurent dans le log final.

| Famille API | Cas ignorés | Configuration absente |
| --- | ---: | --- |
| Capacité et créneaux | 279 | URLs Mongo dédiées capacité, calendrier, bootstrap, index et créneaux ; failpoints non activés |
| Paiements et remboursements | 152 | `ORDER_PAYMENT_TEST_MONGO_URL` |
| Identité et commandes clients | 126 | `CUSTOMER_TEST_DATABASE_URL`, `CUSTOMER_ORDERS_TEST_MONGO_URL`, `LOYALTY_ATTACHMENT_TEST_REDIS_URL` |
| Livraison | 114 | URLs Mongo dédiées livreurs, accès, missions et remise HTTP/navigateur |
| Fidélité | 52 | `LOYALTY_TEST_DATABASE_URL`, `LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL` et Mongo client associé |
| Admission staff | 33 | `STAFF_ORDER_ATTEMPT_TEST_MONGO_URL` |
| Admission publique | 18 | `ORDER_RECOVERY_TEST_MONGO_URL` |
| Facturation CRM | 13 | `BILLING_TEST_MONGO_URL` |
| Promotions Engage | 10 | `ENGAGE_TEST_MONGO_URL` |
| Domaines de paiement | 6 | `PAYMENT_DOMAINS_TEST_MONGO_URL`, `PAYMENT_DOMAINS_TEST_REDIS_URL` |

Les 10 cas DB ignorés appartiennent à `src/order-capacity-immutability.test.ts`, sans `ORDER_CAPACITY_TEST_MONGO_URL`. Les suites contrats et client core n’ont aucun cas ignoré. Les recettes navigateur POS/KDS/BO et les essais de livraison exécutés séparément restent décrits dans leurs preuves propres ; ce document ne transforme pas leurs tests ignorés ici en tests réussis.

## Reproduction

```sh
task_test_path=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test \
  DINING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_test_local \
  DINING_PRICING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local \
  pnpm --filter @sm/api test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/db test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/contracts test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/client-core test --maxWorkers=2 --minWorkers=1
```

La reproduction suppose le Mongo local de recette disponible sur le port indiqué et le binaire local du harnais notifications. Aucune action sur staging, aucun push, aucune fusion ni aucun déploiement n’a été réalisé par cette validation.
