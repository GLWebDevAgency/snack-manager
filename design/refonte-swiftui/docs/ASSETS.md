# Illustrations et icônes

## Provenance et usage

Les dessins alimentaires reprennent les vecteurs de l’aperçu RestoPilot fourni dans cette conversation et les complètent avec boissons, tiramisus, accompagnements et desserts, puis les étend à une bibliothèque halal-first couvrant burgers, smash burgers, pizzeria, snack/grillé, kebab/shawarma et restaurant thaï. Les icônes sont des vecteurs de grille 24 ; elles ne proviennent pas de SF Symbols. Pas de police embarquée, logo commercial de boisson ou image distante. Les formes décrivent des familles de produits, pas les recettes ou certifications des restaurants.

La sortie `dist/assets/food/*.svg` contient 41 fichiers autonomes, `dist/assets/icons/*.svg` 78 fichiers. Ils sont générés depuis les registries versionnés. L’import TSX et l’export SVG utilisent la même source. Chaque instance d’une illustration exige un préfixe d’identifiant unique ; les gradients ne se contaminent pas entre vignettes. Les rendus n’acceptent que des clés connues.

## Mapping explicite

| Famille | Clés |
|---|---|
| Burgers | burger, double, black, chicken, smash-burger |
| Snack, sandwichs et kebab | wrap, tacos, kebab, shawarma-plate, panini, bowl |
| Pizzeria halal | pizza-margherita, pizza-chicken, pizza-vegetarian, pizza-slice, calzone |
| Croustillants et accompagnements | fries, loaded-fries, tenders, nuggets, croustille, nuggets-croustille, wings, samosa |
| Restaurant thaï | pad-thai, thai-noodles, thai-rice, thai-curry, spring-rolls |
| Boissons | cola, orange-can, iced-tea, lemonade, water, coffee |
| Desserts | tiramisu, tiramisu-pistachio, tiramisu-caramel, tiramisu-berry, cookie, brownie |

La clé `tacos` représente le format français grillé du projet ; l’icône de catégorie ne doit pas imposer une recette. Les noms sont techniques et ne remplacent pas les libellés catalogue.

## Politique de média

1. Une photo catalogue autorisée garde sa priorité et son cadrage existant.
2. Une illustration ne remplace pas silencieusement une photo retirée pour confidentialité ou mauvaise attribution.
3. Le remplacement doit être un choix de présentation explicite par produit/catégorie, sans modifier les prix, allergènes, disponibilité, origine ou composition.
4. À défaut de mapping, afficher le fallback actuel. Ne pas déduire le dessert, la viande ou une marque par fuzzy matching du nom.

`ProductTile.renderMedia` est le point d’extension recommandé pour réutiliser le rendu existant. Les illustrations décoratives sont cachées du lecteur d’écran ; les contrôles ont un libellé sémantique. La forme, pas la couleur seule, distingue les catégories.

Pour importer dans Figma, utiliser les SVG et les exports JSON/CSS comme matière ; aucun document Figma natif n’a été créé ou prétendu validé. Les maquettes HTML restent la référence interactive de ce lot.


## Politique halal du registre

Le registre illustratif est volontairement **halal-first** : pas de porc, bacon, jambon, pepperoni porcin, saucisson porcin, vin, bière, cocktail ou verre alcoolisé. Lorsqu’une famille de produits existe souvent avec des variantes non halal (pizza, hot food, sauces, restauration thaï), l’illustration reste générique ou décrit une variante neutre/halal (poulet, bœuf, végétarien). **Cela ne constitue pas une certification halal d’un produit réel** : seul le catalogue métier ou la fiche produit peuvent porter cette information si elle existe.
