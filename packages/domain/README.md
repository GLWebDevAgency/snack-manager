# @sm/domain — le cœur métier

Couche **domaine** au sens de l'architecture hexagonale (ports & adaptateurs) et du DDD.

## La règle unique

Ce paquet ne dépend de **rien** : ni NestJS, ni Mongoose, ni Drizzle, ni React, ni `fetch`, ni horloge système implicite. Il n'importe aucun autre paquet du monorepo. S'il faut parler au monde extérieur, on déclare un **port** (une interface) ici, et l'infrastructure fournit l'**adaptateur** ailleurs.

Le test qui tranche : *ce fichier compilerait-il tel quel dans un navigateur, un worker, un test unitaire, sans mock ?* Si non, il ne va pas ici.

## Pourquoi

Le métier de Snack Manager a des règles qui coûtent cher quand elles sont fausses : un prix mal calculé, une commande encaissée deux fois, un créneau surbooké, une remise sans traçabilité. Ces règles doivent vivre à un seul endroit, testables en millisecondes, indépendamment de la base de données et du framework du moment.

À l'inverse, un CRUD de catégories n'a aucune règle : il reste dans le module applicatif. **On n'hexagonalise pas ce qui n'a pas de métier.**

## Organisation

```
src/
├─ shared/         briques transverses : Money, Result, Clock, Identifier
├─ menu/           produits, variantes, groupes d'options, règles de configuration
├─ ordering/       commande (entité racine), lignes, statuts, créneaux
├─ supply/         coût matière, allergènes, seuils de réassort
├─ tenancy/        restaurant, marque grise, domaines publics
└─ ports/          interfaces vers l'extérieur (registrar, paiement, impression, événements)
```

## Conventions

- **Value objects** immuables, validés à la construction (`Money.fromCents`, `TenantSlug.create`). Un objet construit est forcément valide — pas de vérification défensive en aval.
- **Erreurs métier explicites** (`DomainError` et ses sous-types), jamais de `throw new Error('...')` anonyme.
- **`Result<T>`** pour les opérations dont l'échec est un cas nominal (configuration produit invalide), exceptions pour les violations d'invariant (état impossible).
- **Aucune primitive nue** pour un concept métier : pas de `number` pour un montant, pas de `string` pour un slug.
- **Le temps est une dépendance** : on injecte une `Clock`, on n'appelle jamais `Date.now()` dans le domaine (sinon les tests deviennent instables).
