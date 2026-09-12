# Compatibilité PR178 — validation métier

Branche : `refactor/ui-handoff-fidelity`. Arbre combiné validé le 12 septembre 2026 : **`53aba2b750a28062d31ba07ed2d16f7c55e83f23`**, après rebase sur le squash PR178 **`80f2eac593863dfcfc1f9e5962c09db38fe6db24`**. Cette validation remplace les compteurs pré-PR178 pour les quatre packages ci-dessous. Aucun correctif de source backend, DB, contrats ou client core n’a été nécessaire ; leur diff par rapport à ce HEAD est resté vide pendant la passe.

## Résultats exécutés sur l’arbre combiné

| Package | Tests réussis | Tests ignorés | Fichiers réussis / ignorés | Log |
| --- | ---: | ---: | --- | --- |
| `@sm/api` | 3 695 | 803 | 217 / 7 | [API complète](preuves/pr178-metier-api-full.log) |
| `@sm/db` | 556 | 10 | 31 / 0 | [DB complète](preuves/pr178-metier-db-full.log) |
| `@sm/contracts` | 688 | 0 | 43 / 0 | [Contrats complets](preuves/pr178-metier-contracts-full.log) |
| `@sm/client-core` | 133 | 0 | 12 / 0 | [Client core complet](preuves/pr178-metier-client-core-full.log) |

Les quatre scripts `test` (`vitest run`) ont été exécutés sans filtre de fichiers, avec `--maxWorkers=2 --minWorkers=1`. La passe API complète a duré 65 secondes. Les sous-suites suivantes sont incluses dans les totaux, sans les additionner une seconde fois :

- Salle Mongo/HTTP : **33/33** ; pricing Salle : **26/26** ; tickets imprimables Salle : **3/3**.
- Notifications durables avec vrai Mongo local isolé : **31/31**.
- Fidélité publique API : **25/25** ; runtime du compte client : **96/96**.
- Contrats fidélité publique : **19/19** ; contrats Salle : **6/6** ; navigation client commune : **2/2**.

Les [contrats](preuves/pr178-metier-contracts-build.log) ont été reconstruits avant [client core](preuves/pr178-metier-client-core-build.log) et [DB](preuves/pr178-metier-db-build.log). Tous ces builds ont réussi ; l’agent web a été prévenu lorsque les packages partagés étaient prêts. Le [typecheck API](preuves/pr178-metier-api-typecheck.log), le [typecheck client core](preuves/pr178-metier-client-core-typecheck.log) et le [build API](preuves/pr178-metier-api-build.log) ont également réussi sur cet arbre.

## Compatibilité vérifiée

PR178 ne change ni les commandes, paiements, remises, schémas Mongo, workflows CI/deploy, dépendances ni lockfile. Le service à table conserve son occupation, ses admissions, son pricing idempotent, le service avant paiement, les refus durables et la clôture des tickets terminaux. Les fichiers de persistance Salle et le bootstrap additif des index sont conservés.

Le changement métier partagé de PR178 est la fermeture de `publicLoyaltyAvailable` pour un restaurant `churned`, en maintenant l’accès public pour `trial`, `active` et le repli historique absent. Cette règle est conservée et ses nouvelles contrepreuves passent. Elle ne modifie pas `isAccessBlocked` ni les droits POS/Salle ; le runtime du compte client exigeait déjà `trial` ou `active`. Aucune signature REST ou DTO de commande, de paiement ou de Salle n’est remplacée.

Les nouveaux exports `customer-app-navigation` de client core coexistent avec `Order.dining`. Le passage combiné vérifie la reconstruction des contrats avant leurs consommateurs, afin de ne pas tester les anciens fichiers `dist` de fidélité publique. La CI conserve les étapes Mongo Salle et pricing avec leurs deux URLs temporaires dédiées.

## Hypothèses et cas non exécutés

Les commandes utilisent `env -i`, Node **24.20.0**, les outils système, `TMPDIR=/tmp` et `NODE_ENV=test`. Les fichiers `.env` racine et API ont été revérifiés absents. Aucune variable métier, URL PostgreSQL, URL Redis ou clé de fournisseur n’a été héritée.

Seules les deux URLs de recette Salle ont été fournies : `mongodb://127.0.0.1:27048/snackmanager_dining_test_local` et `mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local`. Les harnais valident leur cible, dérivent chacun une base suffixée UUID et nettoient uniquement leur base possédée. Le harnais notifications démarre le vrai `/opt/homebrew/bin/mongod` sur un port loopback aléatoire, avec répertoire et base temporaires propres, puis les nettoie. Son fournisseur push reste simulé.

Lors de la passe complète, **803 cas API ont été ignorés** faute de configuration dédiée : capacité/créneaux (279), paiements/remboursements (152), identité/commandes clients (126), livraison (114), fidélité (52), admission staff (33), admission publique (18), facturation CRM (13), Engage (10) et domaines paiement (6). Le complément décrit ci-dessous exécute ensuite les 152 intégrations paiements/remboursements ; **651 autres intégrations API restent non exécutées** dans cette validation. Les **10 cas DB ignorés** sont ceux de capacité sans `ORDER_CAPACITY_TEST_MONGO_URL`. Les fichiers et compteurs figurent dans les logs ; les variables requises sont détaillées dans [la validation métier précédente](VALIDATION-METIER-V2.md#cas-non-ex%C3%A9cut%C3%A9s-dans-ces-commandes). Les suites contrats et client core n’ont aucun cas ignoré.

Cette passe n’a utilisé aucun PostgreSQL réel, paiement externe, SMS, compte de production ou API déployée. Les recettes web/POS/KDS sont conduites séparément et ne sont pas déduites des tests backend. Aucun commit, push, fusion ou déploiement n’a été lancé par cette validation.

## Complément — vraies intégrations Mongo des reprises financières

Après lecture des harnais, les deux fichiers existants ont été exécutés séquentiellement sur le même arbre backend, avec un seul worker, sans modification de code ni de tests :

| Fichier | Résultat |
| --- | --- |
| `order-payment-lifecycle.integration.test.ts` | **121/121**, aucun ignoré |
| `order-refunds.integration.test.ts` | **51/51**, aucun ignoré |

La [preuve dédiée](preuves/pr178-metier-payment-refunds-mongo.log) relève **172 tests réussis, zéro ignoré**, en 6,88 secondes. Ce total comprend **152 intégrations Mongo** précédemment ignorées et **20 gardes pures** déjà exécutées dans la suite complète ; les 20 gardes ne doivent pas être additionnées une seconde fois aux résultats précédents. La suite complète n’a pas été relancée pour ce complément.

`ORDER_PAYMENT_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_payment_test_pr178` a été fourni dans un environnement vide. Chaque fichier refuse les hôtes externes, identifiants et options de connexion, ajoute son suffixe UUID au nom de base, vérifie un Mongo standalone et une base initialement vide, puis inscrit sa preuve `_test_run`. Le nettoyage contrôle le nom exact et cette preuve avant de supprimer sa seule base ; les deux connexions du scénario sont ensuite fermées.

`TestOrderPaymentProvider` et `RefundProvider` sont des registres mémoire simulant les effets et les réponses perdues, sans SDK Stripe ni appel réseau. La publication Redis est simulée. Les cas exercés couvrent notamment concurrence encaissement/annulation, bascule comptoir, réponses Mongo ou fournisseur perdues, reprise avec même identité, reçus/audits et isolation des comptes. Cette preuve renforce les services financiers utilisés par la Salle ; elle ne constitue pas une transaction bancaire ou une recette TPE réelle.

## Commandes de reproduction

```sh
task_test_path=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:/usr/bin:/bin:/usr/sbin:/sbin
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/contracts build
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/client-core build
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/db build
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test \
  DINING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_test_local \
  DINING_PRICING_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_dining_pricing_test_local \
  pnpm --filter @sm/api test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/db test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/contracts test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/client-core test --maxWorkers=2 --minWorkers=1
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/api typecheck
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/client-core typecheck
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test pnpm --filter @sm/api build
env -i PATH="$task_test_path" TMPDIR=/tmp NODE_ENV=test \
  ORDER_PAYMENT_TEST_MONGO_URL=mongodb://127.0.0.1:27048/snackmanager_payment_test_pr178 \
  pnpm --filter @sm/api exec vitest run \
  src/modules/ordering/order-payment-lifecycle.integration.test.ts \
  src/modules/ordering/order-refunds.integration.test.ts --maxWorkers=1 --no-file-parallelism
```

La reproduction suppose le Mongo de recette local disponible au port indiqué et le binaire local du harnais notifications. Les preuves précédentes sont conservées, mais leurs compteurs ne certifient pas cet arbre combiné.
