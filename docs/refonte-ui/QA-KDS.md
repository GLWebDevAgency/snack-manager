# Recette visuelle KDS — état initial

Application : export Expo réel de `apps/kds`, serveur statique existant sur `http://127.0.0.1:8093`. Node 24.20.0 / pnpm 10.14.0 / Playwright Chromium 1.62.1 existants. Aucun framework mis à jour ni dépendance installée. Le plugin Browser et son skill ne sont pas disponibles ; Playwright standard est utilisé.

Scripts et manifeste KDS, `scripts/verifier-build-terrain.mjs`, prompt `05-KDS.md` et briefs générés `kds-board`, `kds-settings`, `kds-pin` lus avant exécution. Sources et parité : `PARITE-KDS.md`.

## Isolement

Le harnais `e2e/local/refonte-kds-visual.mjs` utilise l'instantané anonymisé existant `packages/client-core/src/demo/snapshot.ts`. Les sept commandes et leurs produits/variantes/options sont hydratés localement. Les tokens de poste et de personnel sont factices. Chaque scénario utilise un contexte navigateur jetable, sans service worker. Tous les WebSockets sont interceptés et fermés ; les appels API sont interceptés avec des réponses locales et toutes les autres origines HTTP sont bloquées. Aucun serveur API, base ou compte n'est utilisé.

Les deux avancements de commande exécutés passent par les handlers et la file du KDS réel, puis des PATCH interceptés localement. Le harnais refuse toute transition autre que preparing/ready et vérifie l'absence de POST de nouvelle commande.

## Commandes et résultats avant modification KDS

Les variables ci-dessous sont fournies explicitement à chaque test/build :

```sh
PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_ALLOW_LOCAL_API=1
EXPO_PUBLIC_SITE_URL=http://localhost:3000
```

| Commande exécutée | Résultat | Journal |
| --- | --- | --- |
| `pnpm --filter @sm/kds test` | 77 tests / 8 fichiers passent | `preuves/kds-tests-avant.log` |
| `pnpm --filter @sm/kds typecheck` | Réussite | `preuves/kds-typecheck-avant.log` |
| `pnpm --filter @sm/kds build` | Build local verrouillé ; export terminé | `preuves/kds-build-avant.log` |
| `REFONTE_PHASE=avant node e2e/local/refonte-kds-visual.mjs` | 10 scénarios passent, 38 captures | `captures/kds-avant/resultats.json` |

Le serveur local est lancé avec `node -e "require('./apps/kds/server').createStaticServer().listen(8093,'127.0.0.1')"` ; le port est exclusivement loopback. Le premier essai du harnais a corrigé un sélecteur de filtre (les filtres existants sont des boutons, les statuts compacts sont des onglets) ; aucun code produit n'a été modifié pour cette correction.

## Contrôles réellement exécutés

| Contrôle | Preuve |
| --- | --- |
| Identité URL/titre, page significative, pas d'erreur runtime | 10/10 ; tableaux réellement capturés |
| 1440×1000, 1024×768, 768×1024, 390×844 en clair et sombre | Tableau, filtre vide et paramètres capturés |
| États compacts | Onglet Prêt informatif et À lancer capturés à 390/768 |
| Filtre canal | Téléphone affiche le vide attendu, Tous restaure les commandes |
| Paramètres clavier/focus | Escape ferme le dialogue et rend le focus au bouton déclencheur dans les 8 contextes nominaux |
| Densité | Choix Dense persisté via UI en desktop clair/sombre |
| Préparation | Commande 5 passe new→preparing→ready via UI en desktop clair/sombre ; deux PATCH exacts par contexte |
| Prêt | Aucun bouton Servir/Remettre ; information de remise à confirmer par la caisse conservée |
| Ancienne donnée vs vide | Cache local complet + réponses API 503 : les tickets restent visibles avec le bandeau d'erreur, dans les deux thèmes |
| Réduction des animations | `reducedMotion: reduce` dans tous les contextes |
| Géométrie | Aucun débordement horizontal de page aux quatre tailles |
| Console | Aucun avertissement/erreur en nominal ; 3 erreurs de ressource HTTP 503 attendues dans chacun des deux scénarios de panne ; aucune exception JS |

Référence RestoPilot KDS regardée réellement. Captures initiales regardées avec l'outil image : `1440-light-tableau`, `1440-dark-tableau`, `390-light-tableau`, `768-dark-pretes`, `1440-light-parametres`, `donnees-anciennes-light-donnees-anciennes-erreur` dans `captures/kds-avant/`.

## Écarts visuels avant intégration

- RestoPilot : colonnes légères, surfaces claires chaudes, cartes arrondies et détails contenus. KDS initial : larges aplats de statut, actions or pleines, surfaces grises/noires et hiérarchie plus lourde.
- Les repères éloignés (numéro/minuteur, retraits SANS, quantités) et les couleurs fonctionnelles du KDS doivent rester lisibles après allègement.
- La référence présente des postes de cuisine et une remise au client ; les filtres actuels sont des canaux et la remise demeure hors KDS. L'intégration ne doit pas inventer ces comportements.
- L'état hors connexion augmente la hauteur de la barre initiale pour garder ses commandes et son bandeau visibles ; conserver cet accès après refonte.

## Limites et suite

Le rendu natif iOS/Android, rotation sur appareil, clavier logiciel, safe areas, lecteur d'écran et son audible ne sont pas prouvés. Le PIN/appairage, refus de droits/suspension, livraison payée avec confirmation serveur, reconnexion réelle, rejouage durable, conflits interpostes et temps réel ne sont pas exécutés en navigateur dans cette recette. Les tests unitaires existants couvrent une partie de ces règles ; ils ne remplacent pas la recette opérationnelle.

Après intégration : rejouer tests/typecheck/build KDS puis le même harnais avec `REFONTE_PHASE=apres`, regarder les captures et consigner les écarts résiduels ici.

## Après intégration

Suite complète KDS : **9 fichiers / 81 tests**, typecheck et build web réussis (`preuves/kds-tests-apres.log`, `kds-typecheck-apres.log`, `kds-build-final.log`). Le premier build après raccordement d'icônes échouait sur la résolution `@sm/design-icons` : Metro désactive déjà la recherche hiérarchique. Les applications Expo déclarent désormais le lien workspace explicitement ; aucune configuration ni version Metro/Expo n'a changé.

`REFONTE_PHASE=apres node e2e/local/refonte-kds-visual.mjs` : **10/10 scénarios réussis**, captures dans `captures/kds-apres` et résultat structuré `resultats.json`. Root a regardé le tableau desktop clair, le tableau mobile sombre et l'avancement prêt desktop sombre : badge d'urgence, options/retraits et consigne de remise à confirmer par la caisse restent affichés. Les couleurs fonctionnelles de statut n'ont pas changé.

Export Expo Hermes iOS et Android également réussi : `preuves/kds-export-natif.log`, sortie locale `/tmp/snackmanager-refonte-kds-native`. Cela prouve la compilation des bundles natifs, pas l'installation d'un binaire ou la lisibilité depuis un poste de cuisson réel.
