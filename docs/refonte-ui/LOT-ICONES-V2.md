# Reprise de fidélité — icônes du kit

Branche `refactor/ui-handoff-fidelity`, base `develop` `a01f857`. Lot local, sans push, fusion, déploiement ni changement de framework. Les 78 tracés de `design/refonte-swiftui/packages/icons/index.mjs` sont conservés à l’identique.

## Diagnostic vérifié

La présence d’un registre de 78 icônes ne garantissait pas leur emploi : les anciens noms restaient dans les appelants et rendaient encore des tracés historiques. Exemple : `gear`, `drink`, `receipt`, `kds-flame`. Les familles POS regroupaient de nombreux aliments sous une flamme ou un burger par recherche de sous-chaîne. Les navigations employaient un téléviseur pour les réseaux de restaurants et un panier pour le site web.

| Registre historique | Avant : kit / hors kit | Après alias : kit / hors kit |
| --- | --- | --- |
| Natif, 53 clés | 29 / 24 | 42 / 11 |
| Web, 41 clés | 30 / 11 | 33 / 8 |

Ces nombres décrivent les anciennes clés disponibles, pas un décompte artificiel d’icônes qu’il faudrait toutes placer dans les écrans. Chaque application peut maintenant appeler directement les 78 clés.

## Intégration

- Nouveau `packages/icons/aliases.mjs` partagé : 14 synonymes explicites (`gear → settings`, `drink → cup`, `salad → bowl`, `receipt/ticket/list → orders`, `chev/chevron-right → chevron`, `kds-list → menu`, `kds-bell → bell`, `kds-flame/flame/fire → spicy`, `alert → warning`). La flamme fournie s’appelle `spicy` ; l’alias conserve ici le symbole du feu, sans qualifier une recette.
- Les deux renderers résolvent ce registre, conservent taille, couleur, épaisseur, style, contrat de props et caractère décoratif. Le natif n’utilise plus une étoile comme remplacement d’un nom inconnu : il retourne `null`.
- `CategoryTabs.tsx` délègue à `category-icons.ts` : libellés complets connus, normalisation des accents et de la casse, symboles dédiés tacos/wrap/panini/bowl/cup/dessert/etc. Libellé inconnu = `menu`, sans déduire recette ni photo d’un fragment de nom. API d’import de `categoryIcon` préservée.
- Navigation restaurant : carte `menu`, équipe `users`, planning `calendar`, site `globe`, ingrédients `box`. Navigation Snack Manager : clients `store`, réseaux `globe`, pipeline `users`, tableau de bord `chart`. Routes, droits et sections inchangés.
- Commande `Glyph` conserve ses noms publics et utilise le kit pour `pin`, `bag` et `fire`.

## Absences réelles conservées

Natif : `bellOff`, `sandwich`, `dog`, `chicken`, `heart`, `cart`, `trash`, `home`, `euro`, `pause`, `bolt`. Web : `navigation`, `message`, `home`, `play`, `pause`, `euro`, `cart`, `trash`. Le kit ne fournit pas leurs tracés exacts. Par exemple, une cloche barrée ne devient pas une cloche active, une corbeille ne devient pas une croix de fermeture, une icône euro ne devient pas un sac.

Les signes locaux de commande `spark` et `sliders` restent également, car ni l’étincelle ni les curseurs ne sont fournis. Les SVG de logos, QR codes, matières de carte de fidélité, graphiques, étoiles fractionnaires de note et le splash de marque ne sont pas des pictogrammes de navigation à remplacer. Le registre marketing conserve son périmètre distinct des sept applications opérationnelles de ce lot.

## Fichiers et preuves

Sources : registre/déclarations/build du kit ; `packages/ui-native/src/Icon.tsx` et son test ; `apps/web/src/components/ui/icons.tsx` et test ; `apps/pos/src/CategoryTabs.tsx`, `category-icons.ts` et test ; les deux fichiers de navigation web et leurs tests ; `apps/web/src/components/order/primitives.tsx` et `glyphs.test.tsx`.

Exécuté :

- 37 tests web (icônes et deux navigations), 5 tests Glyph de commande, 23 tests natifs/catégories : PASS.
- Vérification kit : 44 tests PASS, build de 57 écrans / 41 aliments / 78 icônes PASS.
- Typecheck `ui-native`, POS, KDS : PASS au gel des icônes. Typecheck web initial : erreur dans une fixture média concurrente, corrigée par son propriétaire ; nouvelle exécution PASS.
- `e2e/local/refonte-icons.mjs` : 92 clés × 2 thèmes, comparaison DOM des vrais renderers React et `react-native-svg` pour le web avec le vecteur source : PASS. Taille 28, trait 2,25, couleur et géométrie vérifiées ; zéro requête externe autorisée.
- `git diff --check` : PASS.

Preuves : `docs/refonte-ui/preuves/icones-v2-*.log`. Planches inspectées : `captures/icones-v2/planche-kit-clair.png`, `planche-kit-sombre.png`, `renderers-clair.png`, `renderers-sombre.png` et `resultats.json`. Références POS/KDS du kit et capture RestoPilot KDS inspectées directement.

Limite : comparaison de rendu exécutée dans Chromium avec React Native Web. Les props et chemins de rendu natifs iOS/Android sont testés, mais aucun simulateur ou appareil iOS/Android n’a été utilisé pour ce lot. Les captures des applications exportées seront rejouées après gel des changements POS/KDS concurrents ; cette planche seule ne prouve pas tous les parcours métier.
