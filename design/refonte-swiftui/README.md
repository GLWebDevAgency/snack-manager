# Snack Manager — Système visuel & studio de refonte

Kit isolé de présentation inspiré du précédent aperçu RestoPilot et des conventions Apple. **Il ne remplace pas les applications, n’est pas un framework SwiftUI multiplateforme et n’est pas encore intégré aux parcours de production.** Les composants natifs sont en React Native ; les composants web sont en React. Aucun fichier métier, application existante, dépendance du monorepo, contrat API ou workflow de déploiement n’est modifié.

## Ouvrir et utiliser

Depuis ce dossier, avec Node ≥ 22.16 (le monorepo conserve sa propre exigence Node ≥ 24.12) :

```sh
npm run verify
npm run serve
# Puis http://127.0.0.1:4173
```

Aucune installation n’est requise pour les tests purs et la construction du studio. Le build fabrique `dist/index.html`, autonome et ouvrable directement dans un navigateur, 57 vues séparées dans `dist/screens`, 41 illustrations SVG halal-first, 78 icônes SVG, les exports de tokens et 57 prompts spécifiques aux vues. Dans l’archive de livraison, `dist` est déjà construit. Dans Git, il se reconstruit depuis les sources.

Le studio propose sélection d’écran, états asynchrones, thème clair/sombre, accent mandarine ou laiton, réduction des animations et de la transparence. Les interactions sont **des simulations locales éphémères**, sans compte, API, réseau restaurant, paiement, donnée client réelle, QR utilisable ou stockage persistant. Les tableaux/formulaires de référence ne sont pas des inventaires exhaustifs de chaque sous-dialogue métier.

## Livrables

| Dossier | Contenu |
|---|---|
| `packages/tokens` | Couleurs sémantiques, clair/sombre, contraste, espacements, rayons, typographie, densité et mouvement. |
| `packages/icons` | 78 icônes SVG originales, grille 24, couleur héritée, exports déterministes. |
| `packages/assets` | 41 illustrations alimentaires halal-first ; pas de remplacement automatique des photos validées du catalogue. |
| `packages/presentation` | Types de présentation et états d’actions ; aucun calcul métier. |
| `packages/ui-web` | Primitives et compositions React contrôlées, styles scoppés, table et feuilles. |
| `packages/ui-native` | Primitives et compositions React Native, SVG et mouvement réduit. |
| `studio` | 57 vues de référence, fixtures isolées et manifeste des sources à relire. |
| `docs` | Charte, architecture, audit, invariants, interactions, assets et stratégie d’intégration. |
| `prompts` | Prompts transverses et par chantier ; les 57 briefs de vue sont générés dans `dist/prompts`. |
| `tests`, `qa` | Tests purs reproductibles, protocole de recette et limites des preuves. |

## Point de départ Git

- Dépôt : `GLWebDevAgency/snack-manager`.
- Base auditée : `develop` / `2c879899adc0e7c3b98817ef76cf026ea5d22bf8`.
- Branche de livraison : `design/swiftui-visual-system`.
- Les branches visuelles antérieures divergent dans le graphe ; cela ne prouve pas que leurs changements n’ont pas été squash-intégrés. Voir `docs/AUDIT.md`. Aucun merge aveugle.

## Lire avant d’intégrer

Commencer par `docs/INVARIANTS.md`, puis `docs/INTEGRATION.md` et `prompts/00-MASTER.md`. Migrer une surface à la fois dans de petites PR : adaptateur de thème, primitives, puis compositions. Conserver le contrôleur, ses handlers, tests, gardes, modales, médias et états de reprise. Ne pas remplacer un écran fonctionnel par le code du studio.

## Limites de la validation

Les tests Node et les maquettes Chromium ont été exécutés ; leur rapport est dans `qa/RESULTATS.md`. Les composants React/React Native sont livrés en TSX avec analyse syntaxique, mais n’ont pas été compilés et montés avec les dépendances du monorepo dans cet environnement. Aucun appareil iOS/Android, simulateur Apple, terminal bancaire ou recette complète POS/KDS/Next.js n’a été exécuté. La fidélité visuelle n’est pas une certification de production.

Aucune police Apple ni fichier de police n’est redistribué. Les SVG de nourriture sont illustratifs ; ni leur recette, ni leurs allergènes, ni un produit commercial précis ne peuvent être déduits de l’image.


## Bibliothèque halal-first

La bibliothèque d’illustrations couvre désormais les familles burger, smash burger, pizzeria halal, snack/grillé, kebab/shawarma, accompagnements croustillants, desserts, boissons et restaurant thaï. Les éléments explicitement non halal (porc, alcool, charcuteries porcines, verres alcoolisés) sont exclus du registre illustratif ; cette exclusion ne vaut pas validation religieuse ou réglementaire d’un produit réel.
