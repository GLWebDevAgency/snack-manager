# KDS — reprise de fidélité aux références

Branche `refactor/ui-handoff-fidelity`, base `develop` `a01f857`. Ce lot reprend la présentation déjà intégrée dans le dépôt. Captures avant de l’export existant enregistrées avant sa reconstruction, puis comparaison avec `_handoff/snackmanager-ui/references/RestoPilot-KDS.png` et `design/refonte-swiftui/maquettes/kds-desktop.png`.

## Écarts corrigés

La version avant regroupait toute la toolbar sur une ligne, enfermait le numéro dans une tuile, colorait en or chaque action et employait des rails latéraux forts. La référence donne davantage d’espace au titre et aux filtres, libère le numéro, réserve les couleurs aux états et emploie des actions plus discrètes.

Le KDS affiche maintenant un titre Cuisine plus net, une seconde ligne pour les canaux et la bascule À lancer, des compteurs lisibles sur lavis du kit et des cartes à fin repère supérieur. Le numéro et le minuteur restent à l’échelle de lecture distante. Le bouton Accepter devient neutre ; Marquer prête porte l’ambre de préparation. Les états Payé et En retard gardent leur texte, sur les lavis du kit. Les retraits d’ingrédients et notes restent contrastés. Les vrais pictogrammes partagés (horloge, table, menu, réglages, cloche) sont utilisés.

Le cumul À lancer reste visible selon la préférence et les règles de largeur existantes. Il n’est pas présent dans la capture RestoPilot ; il constitue une fonction existante à conserver. Les filtres restent les canaux réellement disponibles, sans inventer de postes de cuisson. Les seuils restent 10/15 minutes et les couleurs de minuterie sont celles du noyau. Aucune remise de commande n’est ajoutée au KDS : Prêt reste une attente de confirmation par la caisse ou le livreur.

## Préférences et table

- Premier lancement clair ; un thème sombre enregistré reste sombre. Les préférences anciennes sont migrées champ par champ, sans effacer son, cumul, densité ou splash.
- Réduire les mouvements utilise le même stockage du poste et s’ajoute au choix système, qui reste prioritaire. Les animations de cartes, pressions et fenêtres suivent ce choix ; minuteurs et synchronisation continuent.
- Réduire la transparence remplace le voile derrière les fenêtres par un fond opaque et désactive le reflet décoratif. Les cartes sont déjà opaques.
- Lorsqu’une commande porte `Order.dining`, son `tableLabel` est affiché avec le pictogramme table. Aucune table n’est déduite d’un nom client ou d’un type de commande. Le champ vient du contrat ajouté par la lane table. La carte ne modifie ni session, ni affectation, ni statut.

## Parité et fichiers

Les hooks session/sync/son, les écritures de commande, la file offline, les seuils et le tri n’ont pas changé. Le panneau de réglages utilise ses callbacks et son mécanisme de focus/fermeture existants. La géométrie responsive, les minimums tactiles, les onglets compacts et le cumul nom + variante sont inchangés.

Modifiés : `apps/kds/App.tsx`, `src/prefs.ts`, `prefs.test.ts`, `theme.tsx`, `ui.ts`, `components/{OrderCard,StatusColumn,Toolbar,SettingsSheet,primitives}.tsx`. Nouveau `src/status-colors.test.ts`. Harnais existant `e2e/local/refonte-kds-visual.mjs` étendu pour une table locale et les deux nouvelles préférences.

## Vérification

- Suite KDS : **86 tests / 10 fichiers PASS**, y compris politique de livraison, retour démo, limites d’appairage, options, serveur statique, préférences, géométrie et nouveaux contrastes AA. `preuves/kds-v2-tests.log`.
- Typecheck : **PASS**. `preuves/kds-v2-typecheck.log`.
- Avant : **10 scénarios navigateur PASS**, 38 captures dans `captures/kds-fidelite-v2-avant`, inspectées en desktop clair et téléphone sombre. `preuves/kds-v2-visuel-avant.log`.
- Build Expo web local : **PASS**, bundle `index-70254fdb6a5b2d38d7d73ce43447f795.js`. `preuves/kds-v2-build.log`.
- Après : **10 scénarios navigateur PASS**, 40 captures dans `captures/kds-fidelite-v2-apres`. Table présente uniquement sur la commande liée et conservée après les deux transitions ; préférences relues après rechargement ; voile réellement opaque ; filtres/vide/retour, réglages Escape et retour focus, prêt passif, données anciennes distinctes du vide, zéro débordement horizontal et erreur JavaScript. `preuves/kds-v2-visuel-apres.log`.
- Captures après inspectées : desktop 1440 clair, tablette 1024 sombre, téléphone 390 clair et réglages sombres avec réduction de transparence.

La validation navigateur utilise l’export réel Expo, des données de démonstration anonymisées et des réponses HTTP locales interceptées. Seules les transitions fictives preparing/ready sont acceptées. Origines externes bloquées, service workers bloqués, websockets fermés. Aucun compte réel, serveur métier, paiement ou base de production. Aucun essai sur matériel cuisine ni appareil iOS/Android pour ce lot.


## Complément salle autorisé pendant la reprise

Le contrat salle ajoute `dining.servedAt`. Le filtre existant `isKitchenEligible` écarte maintenant uniquement une commande `surplace`, `ready`, portant cette confirmation serveur. Son statut et son paiement ne sont pas modifiés ; le service physique peut précéder l’encaissement. Les commandes non-table et les autres types gardent leurs règles. `reconcileKitchenRows` écarte aussi un doublon ancien non servi lorsque le même lot contient la confirmation de service.

Fichiers supplémentaires : `src/delivery-policy.ts` et son test. Deux tests de parité ajoutés. La dernière recette, **10/10 PASS et 42 captures** dans `captures/kds-fidelite-v2-final`, vérifie aussi une table déjà servie au chargement et une table nouvellement servie à la relecture suivante, toujours `ready` et `payment.pending`. Preuve : `preuves/kds-v2-visuel-final.log`. Aucun appel de paiement/service réel n’est émis par le harnais.

Typecheck KDS final après `servedAt` : **PASS**, `preuves/kds-v2-typecheck-final.log`.


## Revalidation après PR 178

Sur la base combinée `80f2eac` + V2 : typecheck **PASS**, **86/86 tests PASS**, export web **PASS**, **10/10 parcours navigateur PASS**, puis exports Hermes **iOS et Android PASS**. Aucune source KDS supplémentaire n'a changé pendant le rebase. Les preuves finales sont `preuves/pr178-kds-{typecheck,tests,build,visuel,native}.log`, les captures `captures/kds-fidelite-v2-final` et les empreintes de source `preuves/pr178-terrain-source-freeze.json`. Aucun appareil physique ou imprimante testé.
