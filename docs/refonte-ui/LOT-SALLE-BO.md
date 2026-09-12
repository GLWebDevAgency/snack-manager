# Réglages Salle — back-office restaurant

Branche `refactor/ui-handoff-fidelity`, worktree `/Users/limameghassene/development/SnackManager-refonte-ui`. Lot coordonné avec les contrats/REST de la lane service à table. Aucun push, fusion, déploiement, base ou compte de production.

## Livraison

Une section **Salle** ouvre désormais les réglages existants `/admin/settings` (`#salle`). Elle charge `GET /dining/room`, crée par `POST /dining/tables` et modifie par `PATCH /dining/tables/:id`. Les DTO sont validés avec les schémas du contrat ; la révision chargée accompagne chaque modification.

Le propriétaire, le gérant et le cogérant peuvent nommer une table, choisir 1 à 100 couverts et l’activer/désactiver. Caisse et cuisine consultent l’occupation ; le comptable n’ouvre pas cette section. La capacité est évaluée par `orderAccessScope`, comme côté API. L’identité vient de `GET /auth/me`, jamais d’un auteur inventé. Les gardes serveur restent l’autorité.

Les cartes montrent tables libres/occupées/inactives, convives, nombre de commandes, heure d’ouverture et admissions restant à vérifier en caisse. Désactiver une table occupée conserve sa tablée et l’explique dans le formulaire et sur la carte. Le formulaire précise aussi que les attributions déjà acceptées demeurent reprenables : l’acceptation est arbitrée côté API avant la désactivation, pas au retour de la réponse. Aucun bouton de suppression ou de clôture de tablée n’a été ajouté aux réglages.

Avant chaque mutation, l’intention complète et son UUID sont conservés en localStorage, sous une clé du restaurant, avec l’identité de l’auteur. Le verrou navigateur sérialise les onglets. Un autre auteur ne peut pas reprendre l’intention ; un changement de session impose le rechargement. Stockage refusé, illisible ou non conservé : aucun envoi. Le stockage ne contient aucun jeton.

Le délai, les erreurs réseau et les 409 génériques conservent l’intention. **Vérifier l’enregistrement** rejoue exactement le corps et l’UUID initiaux, y compris après rechargement. Seules une réponse de succès validée portant l’identifiant attendu ou la preuve serveur `DINING_OPERATION_REJECTED` portant ce même UUID autorisent le retrait de la référence. Aucun nouvel UUID ni passage par une file offline automatique pendant l’incertitude. Un navigateur sans Web Locks propose de reprendre dans un navigateur compatible plutôt que de perdre la protection entre onglets.

## Fichiers

- `apps/web/src/app/admin/settings/page.tsx` : montage de Salle avant l’identité existante.
- `apps/web/src/app/admin/settings/Salle.tsx` : affichage réel, formulaires, droits, transport et reprise.
- `apps/web/src/app/admin/settings/salle-operation.ts` : conservation, validation, isolation et retrait conditionnel des intentions.
- `apps/web/src/app/admin/settings/salle-operation.test.ts` : journal corrompu, intentions différentes, retrait limité et stockage non conservé.
- `apps/web/src/app/admin/settings/salle.browser.test.ts` : vraie page SettingsPage et vrai client HTTP rendus en Chromium.

`apps/web/AGENTS.md`, le handoff intégral et les guides Next locaux pertinents ont été lus. Les instructions existantes et les frameworks n’ont pas été modifiés.

## Preuves exécutées

Node 24.20.0 et pnpm 10.14.0 existants. Baseline réglages : **58/58** sur trois fichiers. Après intégration : **79/79** sur cinq fichiers, dont **17 tests navigateur**. Typecheck web et ESLint ciblé passent.

Le navigateur rend la véritable page des réglages, ses panneaux et le transport `api.ts`. Le serveur loopback de recette valide les DTO, conserve tables et reçus en mémoire et simule les réponses incertaines. Les cas couvrent création/rechargement, édition avec révision, désactivation occupée, timeout après écriture puis reprise identique, 409 non définitif, refus définitif, autre auteur, gérant/cogérant/caisse/cuisine/comptable, capacité absente, deux onglets, stockage illisible/plein, session remplacée et formulaire mobile accessible sans débordement.

Les requêtes distantes sont bloquées et signalées ; les journaux ne comportent aucune requête inconnue ni erreur JavaScript. Seul l’adaptateur `next/font` de compilation est remplacé par des polices locales dans le harnais ; aucun composant applicatif ni module API n’est remplacé.

Captures inspectées dans `docs/refonte-ui/captures/salle-v2/` : `salle-configuree.png`, `table-desactivee-occupee.png`, `salle-reprise.png`, `salle-mobile.png`, `salle-formulaire-mobile.png`. Les journaux JSON voisins portent les requêtes et l’état local final.

```sh
PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH \
REFONTE_SALLE_CAPTURES=/Users/limameghassene/development/SnackManager-refonte-ui/docs/refonte-ui/captures/salle-v2 \
pnpm --filter @sm/web exec vitest run src/app/admin/settings --no-file-parallelism
```

## Limites et suite

Ces preuves sont locales : pas de Nest/Mongo ni de compte réel dans le harnais. Les tests d’intégration API, la validation POS et le build Next sont coordonnés séparément ; ils ne sont pas revendiqués ici. L’occupation se rafraîchit à l’ouverture, après mutation et avec **Actualiser** ; ce panneau de réglages ne promet pas une surveillance temps réel.

La lane poursuit une revue indépendante du backend service à table (commandes matérialisées, promotions, conflits et preuves de rejet), sans modifier les fichiers API possédés par la lane correspondante. Les thèmes des deux back-offices sont pris en charge par une autre lane.
