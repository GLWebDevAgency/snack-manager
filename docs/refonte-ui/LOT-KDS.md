# Lot KDS — présentation locale

12 septembre 2026, worktree `SnackManager-refonte-ui`, branche `refactor/apple-ui-integration`, base `aefdf974`.

## Implémentation

- `apps/kds/src/visual-palette.ts` raccorde surfaces, encres et scrim aux tokens `@sm/design-tokens`. Les aplats `red`, `amber`, `green`, l'accent historique `gold` et `onAmber` restent ceux de client-core. L'adaptateur ne mute pas les palettes partagées.
- `apps/kds/src/ui.ts` conserve les exports existants et le cache par thème ; rayons contrôles 12, cartes 20 et feuilles 28 viennent des tokens. Ombres légères et encres d'alerte adaptées aux surfaces claires/sombres.
- `components/StatusColumn.tsx` remplace le large bandeau de statut par un titre sobre, un repère et un compteur conservant les couleurs fonctionnelles fixes.
- `components/OrderCard.tsx` conserve le contenu et les états métier, utilise une carte opaque à rayon 20 et des actions internes à rayon 12. L'alerte de retard reste statique (bordure/badge/texte) ; le liseré décoratif pulsant a été retiré. L'animation ponctuelle d'entrée et la réduction de mouvement sont conservées.
- `components/AllDayPanel.tsx` hiérarchise le titre et sépare les lignes du cumul. `components/Toolbar.tsx` allège les contrôles et les compteurs sans retirer de filtre ni commande.
- `components/primitives.tsx` raccorde rayons et focus clavier visible 3 px, réduit l'enfoncement à 0,985 et garde les gestionnaires clavier/modal existants. `components/SettingsSheet.tsx` reçoit ces formes et surfaces.
- `Board.tsx` modifie uniquement le rendu des onglets compacts : fond teinté, titre lisible et compteurs de statut fixes. Aucun changement de groupement, tri, filtre, callback ou cycle de vie.

Références effectivement ouvertes : `_handoff/snackmanager-ui/references/RestoPilot-KDS.png` et `design/refonte-swiftui/maquettes/captures/kds-board.png`. Prompts `05-KDS.md` et briefs générés `kds-board.md` / `kds-settings.md` consultés. Le kit représente la direction visuelle ; le tableau réel conserve son panneau À lancer latéral ou compact et ses fonctions actuelles.

## Invariants relus dans les diffs

`STATUS_TONE`, `ADVANCE_LABEL`, `EMPTY_COPY`, les labels canaux/types, `timerColor`, `TIMER_THRESHOLDS`, `elapsedSeconds`, `kitchenNextStatus` et les handlers de `Board` restent inchangés. Une commande prête reste une `View` passive avec le libellé opérationnel existant. `pendingIds`, interdiction d'avancer une livraison en attente, tri d'arrivée, agrégation À lancer, filtres canal, son, offline et préférences demeurent branchés sur les mêmes sources. Aucun backend, contrat, client, journal ou file n'a été modifié.

## Vérifications exécutées par le lot

Le shell initial utilisait Node 24.5.0 ; les deux premières tentatives tests/typecheck ont été bloquées avant exécution par `ERR_PNPM_UNSUPPORTED_ENGINE` (attendu `>=24.12.0`). Aucun contournement du contrôle moteur.

Avec `PATH=/Users/limameghassene/.nvm/versions/node/v24.20.0/bin:$PATH` :

- `pnpm --filter @sm/kds exec vitest run src/visual-palette.test.ts` : **4 tests réussis**. Ils vérifient la correspondance des aplats avec les seuils de minuterie, la non-mutation du thème partagé et le contraste texte/notes/minuteurs ≥ 4,5:1 sur les surfaces opaques.
- `pnpm --filter @sm/kds typecheck` : **réussi**.
- `git diff --check` : **réussi**.

La validation complète KDS, le build Expo et les captures après intégration sont coordonnés par l'agent principal et consignés dans `REPRISE.md`. Les résultats du kit ne prouvent pas les interactions KDS. La recette iOS/Android, le clavier logiciel, les zones sûres et les appareils de cuisine restent distincts de la recette navigateur locale.

Aucun commit, push, fusion ou déploiement effectué par ce lot.
