# Illustrations et icônes

Lire `00-MASTER.md`, `docs/INVARIANTS.md` et les sources ACTUELLES.

Conserver logo SM et photos catalogue. Étendre et maintenir la bibliothèque SVG halal-first : burgers, smash, pizzeria halal, snack, kebab/shawarma, croustillants et restaurant thaï, en excluant les éléments explicitement non halal (porc, alcool, charcuterie porcine, verres alcoolisés). Utiliser seulement des clés explicites vers les SVG ; aucune déduction de recette/allergène. Vérifier ids de gradients uniques, tailles, contrastes, fallback réseau, aria-hidden décoratif et labels des boutons. Exporter les SVG sans script, image distante, police ou marque de boisson copiée.

## Livrables du lot

Diff limité à la présentation de ce périmètre, inventaire de parité, captures avant/après, tests exécutés et limites. Préserver les routes, signatures, données et tests existants. La maquette donne la direction ; le code existant donne le fonctionnel. Ne pas fusionner automatiquement.


Quand un nouveau besoin de carte apparaît, privilégier une clé neutre ou halal-compatible et documenter le mapping dans `docs/ASSETS.md` plutôt que de dessiner une variante ambiguë.
