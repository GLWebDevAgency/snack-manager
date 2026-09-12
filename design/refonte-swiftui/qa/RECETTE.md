# Protocole de recette

## Kit autonome

`npm run test` : tokens, contrats de présentation, vecteurs, déterminisme, manifeste et isolation.
`npm run build` : studio, 57 HTML, SVG, exports, prompts. Le build n’exécute pas le TSX.

Matrice navigateur : 57 vues × 4 tailles (390×844, 768×1024, 1024×768, 1440×1000) × 2 thèmes. À chaque vue : titre exact, contenu non vide, absence d’exception JS, absence de débordement horizontal de page ; vérifier visibilité de l’action POS et navigation mobile pertinente. Les tableaux peuvent défiler à l’intérieur de leur conteneur.

Interactions : recherche, configuration, ajout fixture, ticket compact, changement de thème, paiement incertain bloqué, progression KDS fixture et état prêt passif, navigation fidélité/scanner, confirmation explicite livreur, réduction des animations, fermeture Escape et retour focus, note locale conservée. Aucune API réelle.

## Intégration future

Monter les vrais composants React et RN avec les dépendances du dépôt, exécuter typecheck/lint et tests existants, puis flows de l’application sur jeux de données contrôlés. Tester clavier/lecteur d’écran/zoom, pannes, gestes/rotation et densités. Comparer aux vraies captures de l’existant et au studio. Documenter chaque différence. Un résultat du kit ne se reporte pas automatiquement dans la colonne « application validée ».
