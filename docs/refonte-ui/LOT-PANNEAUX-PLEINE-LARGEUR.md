# Panneaux du back-office sur toute la largeur

Le 13 septembre 2026, les captures utilisateur montrent les panneaux Établissement plafonnés à 720/1040 px et Livraison centrée dans 1120 px, même sur un grand écran. Le correctif utilise toute la zone de contenu, avec les marges communes de 16 px sur mobile et 26 px à partir de la tablette.

Branche dédiée `fix/admin-panels-full-width`, issue de `origin/develop` `8c7721ef05cec6057cd16fb4d8a67a19009c0b06` (PR #183 compte/fidélité et #184 navigation incluses). La branche locale `docs/admin-navigation-staging-receipt` conserve les preuves de la livraison précédente en `d31e2d4`. Le checkout principal et les autres worktrees sont préservés.

## Corrections

- Établissement : Enseigne, Mon compte et Journal sans plafond de largeur ; Salle et éditeur d’identité visuelle, chargement compris, suivent le panneau.
- Livraison : page et barre de sauvegarde alignées sur les autres rubriques. La grille des zones utilise `repeat(auto-fit,minmax(min(100%,420px),1fr))` : une zone remplit la largeur, plusieurs se répartissent selon l’espace disponible.
- Encaissement : suppression du plafond de 760 px et du centrage.
- Site web sans commande en ligne : suppression du plafond de 768 px dans les deux branches de rendu.

Les limites des paragraphes, aperçus, QR et dialogues restent adaptées à leur contenu. Les onglets et les autres pages ne nécessitent pas de nouvelle contrainte globale. Les six fichiers applicatifs ne changent que leurs attributs `className` : revue indépendante et comparaison AST TypeScript 6/6 identiques après retrait de ces attributs. Aucun handler, contrat, calcul, droit, média, brouillon ou arbre de composants n’est modifié.

## Validation exécutée

- Web : **198 fichiers / 3 086 tests réussis**, aucun ignoré, `pnpm --filter @sm/web test --maxWorkers=4` (114,29 s).
- Typecheck et ESLint des six fichiers réussis ; `git diff --check` réussi.
- Build Next réussi, identifiant **`2ugXm_7GX89t7a7B1qhfR`**, `NEXT_PUBLIC_API_URL=http://127.0.0.1:3094`, puis `next start` sur `127.0.0.1:3092`.
- Journaux : `preuves/admin-full-width-{tests,typecheck,lint,build}.log`. Empreintes des six sources : `preuves/admin-full-width-source-manifest.json`.

La recette navigateur finale réussit **22/22 contextes**, avec **82 captures et 197 mesures exactes de largeur, écart maximal de 0 px** par rapport aux marges attendues. Établissement et Livraison : 320/768/1440/1920/2560 px en clair, 390/1920 px en sombre ; Encaissement, Site avec/sans commande en ligne et Écrans : 320/1920 px. Les brouillons, Retour/Avant, les grilles Livraison de une à trois zones et la publication simulée restent opérationnels. Aucun débordement, exception applicative, origine externe ni route API inconnue. Les quatre erreurs initiales de sélecteur des comparateurs sont tracées séparément et corrigées dans le harnais sans retouche applicative.

Les réponses API et publications sont simulées en mémoire sur le vrai Next compilé. Résultats et captures : [synthèse QA](captures/admin-full-width/QA.md), `captures/admin-full-width/results.json` ; harnais exécuté : `preuves/admin-full-width-visual.mjs`. Le responsable de livraison a également inspecté Enseigne1920, Identité visuelle2560, Livraison mono-zone1920 et Enseigne320. Aucun compte, paiement, base ou serveur de production ; Chromium ne prouve pas l’exécution sur Safari ni sur un appareil physique.
