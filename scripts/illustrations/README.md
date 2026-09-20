# Bibliothèque SVG publique

Les 41 illustrations alimentaires et les 78 icônes de Snack Manager sont publiées dans `apps/web/public/illustrations/`. Les quatre modules de `source/` sont repris sans modification du kit existant, au commit `56699753884136daee4b5db1bb532ac2aa69fee4`, sous `design/refonte-swiftui/packages/{assets,icons}/`.

La documentation d’origine `design/refonte-swiftui/docs/ASSETS.md` indique que les dessins reprennent les vecteurs de l’aperçu RestoPilot fourni au projet et les complètent avec des ajouts internes. Ce ne sont ni des SF Symbols ni des photos provenant d’une banque d’images. Aucune nouvelle licence externe n’est revendiquée. Les formes sont génériques : elles ne certifient pas une recette, des ingrédients ou une conformité halal.

La landing utilise explicitement `food/smash-burger.svg` pour le burger et `food/bowl.svg` pour la salade illustrative. Aucun catalogue restaurant ni média client n’est modifié. Les icônes conservent leur `currentColor` pour les usages SVG intégrés ; un SVG chargé comme image est isolé du CSS de la page.

```sh
node scripts/generate-illustrations.mjs
node scripts/generate-illustrations.mjs --check
```

Le générateur ne dépend ni de Git, ni du réseau, ni du studio de démonstration. Les sorties sont versionnées : elles sont présentes dans le répertoire `public` au moment du build Next.js et donc servies directement en production, sans optimiseur raster ni fournisseur externe. Le manifeste contient les SHA-256 des modules sources et de chaque SVG, leurs dimensions, leurs tailles et le mapping explicite de la landing.

`--check` est une vérification en lecture seule : export absent ou modifié, fichier supplémentaire, code actif, source externe, identifiant dupliqué ou gradient manquant font échouer la commande. Après une évolution volontaire des sources, regénérer et relire les SVG avant de versionner sources, manifeste et exports ensemble.
