# Intégration incrémentale dans le dépôt

## Isolation du kit

Le dossier `design/refonte-swiftui` a son propre workspace. Le workspace racine n’est pas modifié : aucune application ne charge le nouveau CSS ou les nouveaux composants par accident. Les exports restent privés. L’installation de dépendances n’est pas nécessaire pour construire les maquettes.

Pour intégrer un lot après revue, choisir une seule stratégie : déplacer les packages retenus sous `packages/design-*` et ajouter leurs imports aux applications, ou étendre explicitement le workspace racine aux packages imbriqués. Ne pas cumuler les deux, ne pas recopier des primitives divergentes, conserver la résolution unique de React par application. Régénérer puis contrôler le lockfile avec le pnpm du dépôt. Les manifests de ce kit déclarent des peers compatibles avec les manifestes inspectés ; la compatibilité n’est pas une compilation native effectuée.

## Ordre proposé

1. **Contrats et références** : rebase non destructif sur la base actuelle, inventaire actions/champs/états/tests ; captures de l’existant. Lire les changements parallèles avant de migrer.
2. **Adaptateurs de thème** : garder les providers/préférences existants ; adapter leurs rôles aux tokens. Ne pas remplacer les timers par un nouveau helper visuel. Préserver l’accent tenant et les statuts fixes.
3. **Primitives** : Button, Field, Badge, Icon, Surface puis SheetFrame. Brancher d’abord une surface contrôlée. Réutiliser `useDialogLayer`, Overlay/Drawer, hooks media et safe-area existants.
4. **POS** : Catalog/CategoryTabs, TicketPanel, QuickConfig, ServicePanel, paiement/fidélité/réglages/PIN. Garder `PosScreen` comme orchestrateur, pas copie du studio.
5. **KDS** : toolbar, colonnes, ticket, À lancer et préférences ; conserver les transitions et états à la granularité existante. Aucun « Servir » nouveau.
6. **Commande/fidélité/livreur** : petits lots par contrôleur, BFF inchangé, aucune migration de session ou de stockage pour un thème.
7. **Back-offices** : primitives partagées, coques, tableaux, formulaires. Puis page par page selon manifeste, avec inventaire réel des champs/permissions.

## Exemple conceptuel d’adaptateur, pas patch prêt à fusionner

```tsx
<ProductTile
  product={{
    id: product._id,
    name: product.name,
    priceLabel: euros(basePrice(product)),
    available: !product.outOfStock,
  }}
  renderMedia={() => existingMediaRenderer(product)}
  onSelect={() => existingOnPick(product, categoryName)}
/>
```

Les noms `existingMediaRenderer` et `existingOnPick` représentent les fonctions déjà présentes à brancher ; ne pas ajouter de stub avec ces noms. Le support des variantes et des groupes est conservé dans le configurateur, pas réinventé par cette carte.

## Garde-fous de review

Les packages ne doivent jamais importer `apps/`, `@sm/db`, clients HTTP, secret/token ou fixture. Le CSS web reste sous `.sm-ui` et ne réinitialise pas globalement le produit. Les changements de route, DTO, seed, worker, base, paiement, droits, persistance et dépendances ne font pas partie de la PR de style.

Le nom SwiftUI est une référence visuelle ; ajouter @expo/ui ou expo-glass-effect est un chantier facultatif ultérieur, avec availability et repli opaque. Ce kit n’ajoute aucune dépendance native pour un effet décoratif.

## Recette dans le vrai monorepo

Utiliser les scripts actuels et lire leur périmètre avant lancement. Au minimum typecheck/tests des packages migrés et de l’application, build web Expo/Next si concerné, puis e2e locaux/démonstration pertinents, sans toucher une base ou terminal réel. Les tests du kit ne remplacent jamais les tests POS, KDS, paiement, menu, client, fidélité, livreur ou navigation existants.

Les commandes réellement executées dans cet environnement et celles restant à exécuter sont distinguées dans `qa/RESULTATS.md`. Aucun statut CI n’est inventé. Pas d’auto-merge ni déploiement de ce kit.
