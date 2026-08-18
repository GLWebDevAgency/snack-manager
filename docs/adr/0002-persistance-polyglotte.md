# ADR 0002 — Persistance polyglotte : MongoDB pour le commerce, PostgreSQL pour le supply

| | |
|---|---|
| **Statut** | Acceptée |
| **Date** | 2026-08-19 (décision prise le 2026-08-18) |
| **Portée** | `packages/db` (MongoDB), `packages/supply` (PostgreSQL), `apps/api/src/modules/supply` |
| **Documents liés** | [ARCHITECTURE.md §4 et §9](../../ARCHITECTURE.md), [ADR 0001](./0001-architecture-hexagonale-et-ddd.md) |

---

## 1 · Contexte

Le produit couvre deux mondes qui n'ont ni la même forme de données, ni les mêmes
exigences d'intégrité, ni le même rythme d'écriture.

**Le commerce** — tenants, menus, commandes, équipe, avis, promotions. Sa donnée
caractéristique, c'est la fiche produit de `packages/db/src/schemas.ts` : un tacos porte
quatre variantes, quatre groupes d'options, une dérogation `perVariant` par format
(`{ M: {min:1,max:1}, XXL: {min:4,max:4} }`) et une liste de retraits. Le pilote
Class'Food, c'est 22 catégories et 109 produits, et **aucun restaurant suivant n'aura la
même structure de carte**. La commande, elle, est délibérément **dénormalisée** : la ligne
recopie le nom du produit, le libellé du format, les libellés d'options et le prix
unitaire figé, pour que le ticket de 20 h 14 reste lisible et vérifiable dix ans plus
tard, même si le gérant renomme un plat le lendemain.

**Le supply** — ingrédients, allergènes, marques, recettes par produit *et* par variante,
nomenclature des options, fournisseurs, historique de prix, mouvements de stock, bons de
commande, factures. Sa donnée caractéristique, c'est `supplier_items` : une table
d'association entre `suppliers` et `ingredients`, portant un conditionnement et un prix,
elle-même référencée par `purchase_order_lines` et historisée dans
`supplier_price_history`. Trois niveaux de clés étrangères, avec des politiques de
suppression différentes par relation (`cascade` sur les marques d'un ingrédient,
`restrict` sur un ingrédient référencé par une recette, `set null` sur le bon de commande
d'une facture).

Ce sont deux problèmes de modélisation opposés. Le premier veut de la souplesse de forme,
le second veut de l'intégrité.

---

## 2 · Décision

**Deux contextes, deux moteurs.**

| Contexte | Moteur | Accès | Contenu |
|---|---|---|---|
| **Commerce** | MongoDB 8 | Mongoose (`packages/db`) | `tenants`, `categories`, `products`, `orders`, `counters`, `users`, `staff`, `shifts`, `auditLog`, `reviews`, `promotions`, `leads` |
| **Supply** | PostgreSQL | Drizzle (`packages/supply`) | `ingredients`, `ingredient_brands`, `recipes`, `recipe_lines`, `option_ingredients`, `suppliers`, `supplier_items`, `supplier_price_history`, `stock_movements`, `purchase_orders`, `purchase_order_lines`, `invoices` |

Les deux sont hébergés sur Railway, région UE, avec Redis en pub/sub à côté.

### 2.1 · Les cinq critères de décision

Pour toute nouvelle donnée, la question « Mongo ou Postgres ? » se tranche avec cette
grille. Trois « oui » à gauche → Mongo ; trois « oui » à droite → Postgres.

| Question | MongoDB si… | PostgreSQL si… |
|---|---|---|
| **Forme** | la structure varie d'un tenant à l'autre, ou d'un enregistrement à l'autre | la structure est la même pour tout le monde |
| **Lecture** | on lit presque toujours l'objet entier, d'un coup | on joint, on agrège, on filtre sur des colonnes d'autres tables |
| **Intégrité** | une référence orpheline est rattrapable côté application | une référence orpheline fausse un montant ou une déclaration légale |
| **Historique** | l'objet est un instantané qu'on archive tel quel | on a besoin de la série (prix successifs, mouvements, écarts) |
| **Écriture** | écritures concurrentes depuis des appareils qui peuvent être hors ligne | écritures serveur, transactionnelles, jamais depuis une tablette |

**Application au réel :**

- `products` → Mongo. La carte est hétérogène par nature (critère 1), on lit toujours le
  produit complet pour l'afficher (2), un `categoryId` orphelin est déjà géré côté
  application (`menu.service.ts` fait passer les produits en « Non rattachés » plutôt que
  de les supprimer) (3).
- `orders` → Mongo. Objet-instantané dénormalisé (4), écrit depuis des tablettes hors
  ligne avec la clé d'idempotence `{tenantId, clientId}` en index unique (5).
- `supplier_price_history` → Postgres. Série temporelle jointe à `supplier_items`, elle
  n'a de sens qu'en relation (2, 4).
- `invoices` → Postgres. `total_ht_cents`, `tva_cents`, `total_ttc_cents` avec un index
  unique `(supplier_id, number)` : un doublon de facture, c'est un litige comptable (3).
- `allergens` → Postgres, en `pgEnum` à 14 valeurs figées par le règlement UE 1169/2011.
  Une valeur hors liste ne doit pas pouvoir *exister*, pas seulement être rejetée par
  l'API : c'est un affichage réglementaire.

### 2.2 · Les ponts entre contextes

Le supply référence le commerce par des **identifiants texte**, jamais par des clés
étrangères : `tenant_ref` et `product_ref` sont les `ObjectId` MongoDB stockés en `text`
(cf. l'en-tête de `packages/supply/src/schema.ts`). Aucune base ne peut donc garantir ces
références — c'est une conséquence directe du choix, et elle est assumée.

Quatre ponts existent, tous traversés par la couche service de l'API :

1. **Cascade de rupture** — `SupplyService.setIngredientOut` : un ingrédient passe
   `is_out` en PostgreSQL, puis tous les produits Mongo dont une recette ou une
   nomenclature d'option l'exige passent `outOfStock` avec `outOfStockSource:
   'ingredient'`. Le retour de l'ingrédient ne réactive que les produits dont **plus aucun**
   ingrédient requis n'est en rupture, et ne touche jamais une rupture posée à la main
   (`outOfStockSource: 'manual'`).
2. **Coût matière et marge** — recette (+ options imposées) × coût unitaire, affiché par
   produit dans le back-office.
3. **Rollup d'allergènes** — union recette ∪ options, affichée côté client.
4. **Déplétion théorique** — chaque vente écrit un `stock_movements` de type `sale`, dont
   le champ `ref` porte l'identifiant de commande Mongo. L'écart avec l'inventaire réel,
   c'est la démarque.

Chaque pont publie ensuite un événement Redis (`menu.updated`) pour que les quatre
surfaces se rafraîchissent.

---

## 3 · Options écartées

### 3.1 · Tout dans MongoDB

**Pourquoi c'était tentant** : un seul moteur, une seule connexion, un seul modèle mental,
un seul jeu de sauvegardes. Le supply *peut* se modéliser en documents.

**Pourquoi non** : le supply est un graphe, pas un arbre. « Le prix moyen pondéré du
cheddar chez mes trois fournisseurs sur les six derniers mois, par marque » est une
jointure à quatre tables (`supplier_price_history` → `supplier_items` → `ingredients` +
`ingredient_brands`). En documents, c'est un `$lookup` imbriqué, ou de la dénormalisation
avec sa cohérence à maintenir à la main. Surtout : rien n'empêcherait de supprimer un
ingrédient référencé par une recette. En PostgreSQL, `references(() => ingredients.id,
{ onDelete: 'restrict' })` rend le cas impossible — pas « signalé », impossible.

### 3.2 · Tout dans PostgreSQL, avec du JSONB pour les menus

**Pourquoi c'était tentant** : c'est l'option écartée la plus défendable. Le JSONB de
Postgres est indexable, requêtable, et couvrirait l'hétérogénéité des cartes. On aurait
un seul moteur, des transactions couvrant les deux contextes, et la cascade de rupture
deviendrait un simple `UPDATE ... FROM` atomique — c'est-à-dire que la faiblesse
principale de la décision retenue (§4.2) disparaîtrait.

**Pourquoi non, malgré cela** :

- Le contexte commerce **existe déjà en MongoDB**, avec un pilote en production, un seed
  de 109 produits, 30 jours d'historique de commandes et un modèle offline éprouvé bâti
  sur l'index unique `{tenantId, clientId}`. Migrer coûterait des semaines pour un gain
  de cohérence sur quatre ponts dont trois sont en lecture seule.
- Le document `orders`, dénormalisé et archivé dix ans pour NF525, est un objet
  naturellement documentaire. Le mettre en JSONB dans Postgres, c'est obtenir le pire des
  deux : ni la souplesse d'un vrai document store, ni les garanties d'un vrai modèle
  relationnel.

**À reconsidérer si** : le nombre de ponts inter-contextes dépasse cinq, ou si une
divergence de cascade est constatée en production (cf. §6).

### 3.3 · Deux bases avec transactions distribuées (2PC, saga transactionnelle)

**Pourquoi non** : ni MongoDB ni PostgreSQL n'offrent de coordinateur XA utilisable ici,
et une saga complète avec compensation coûterait plus cher que le problème qu'elle
résout. La fenêtre d'incohérence réelle est de quelques millisecondes, et son pire effet
est **un produit vendable alors que l'ingrédient est épuisé** — un cas que le comptoir
gère déjà tous les soirs, à la main, en une seconde.

### 3.4 · Une seule base + un ORM d'abstraction (Prisma, TypeORM) pour « changer plus tard »

**Pourquoi non** : le choix du moteur n'est pas un détail d'implémentation qu'on peut
masquer. Ce qui distingue les deux contextes ici, ce sont précisément les garanties du
moteur (contraintes FK, enums, transactions). Une couche qui les nivelle par le bas
annule le bénéfice recherché.

---

## 4 · Conséquences

### 4.1 · Deux transactions distinctes, qui ne se rencontrent jamais

C'est la conséquence structurante, celle qu'il faut connaître **avant** d'écrire du code
qui touche aux deux contextes.

- Côté supply, on dispose de vraies transactions : `this.db.transaction(async (tx) => …)`
  est utilisé dans `SupplyService` pour les opérations composées (mise à jour de prix +
  écriture d'historique, réception de bon de commande + mouvements de stock).
- Côté commerce, chaque opération Mongoose est atomique **au niveau du document**. Le
  compteur de numéro de commande s'appuie là-dessus (`findOneAndUpdate` avec `$inc` et
  `upsert` sur `_id: '<tenantId>:<yyyymmdd>'`).
- **Aucune transaction ne couvre les deux.** Une opération qui écrit dans PostgreSQL puis
  dans MongoDB peut échouer entre les deux.

**Règle d'écriture qui en découle** — toute opération inter-contextes doit être :

1. **Ordonnée** : la base qui porte la vérité écrit en premier. Pour la cascade de
   rupture, c'est PostgreSQL (`ingredients.is_out`) ; Mongo ne porte qu'une **projection**
   (`products.outOfStock`), reconstructible.
2. **Idempotente** : rejouer l'opération deux fois donne le même état.
   `setIngredientOut(false)` ne se contente pas d'inverser le dernier changement, il
   **recalcule** l'ensemble des produits bloqués à partir de tous les ingrédients encore
   en rupture. Il est donc rejouable sans risque.
3. **Réparable** : il doit exister un chemin qui recalcule la projection depuis la source
   de vérité, indépendamment de l'événement qui l'a déclenchée.

### 4.2 · La cohérence entre contextes est *eventual*, et c'est encore perfectible

Honnêtement : aujourd'hui, les ponts sont des **doubles écritures séquentielles dans un
même service**, pas encore un vrai bus d'événements. Dans `setIngredientOut`, si le
processus meurt entre l'`UPDATE` PostgreSQL et l'`updateMany` MongoDB, l'ingrédient est
en rupture et le produit reste vendable jusqu'à la prochaine action sur cet ingrédient.

Ce qui rend ce risque acceptable aujourd'hui :

- l'opération est idempotente et rejouable (point 2 ci-dessus) ;
- l'effet d'une divergence est visible et rattrapable au comptoir en une seconde
  (rupture 1-tap sur le produit) ;
- la fenêtre est de l'ordre de la milliseconde, sur une opération déclenchée quelques
  fois par service.

Ce qu'il faut pour fermer le trou, dans cet ordre :

1. **Faire passer les trois services par le port `EventPublisher`.** Le port
   (`packages/domain/src/ports/event-publisher.ts`) et son adaptateur
   (`apps/api/src/infrastructure/events/redis-event-publisher.ts`) **existent déjà** et
   sont enregistrés sous le jeton `EVENT_PUBLISHER` ; ce sont les appelants qui n'ont pas
   basculé — `orders`, `menu` et `supply` publient encore en direct. Le port déclare
   d'ailleurs déjà l'événement qui nous intéresse ici, `stock.ingredient_out`, avec la
   liste des produits impactés.
2. Une **file durable** (BullMQ sur le Redis existant) pour la projection Mongo, avec
   rejeu automatique.
3. Une **tâche de réconciliation** périodique qui recalcule `products.outOfStock` de
   source `'ingredient'` depuis PostgreSQL — le filet qui rend les deux premiers points
   non critiques.

### 4.3 · Autres conséquences

**Coûts**

- Deux systèmes de migration : `drizzle-kit generate` + `migrate.ts` versionné dans
  `packages/supply/drizzle/` d'un côté, schémas Mongoose implicites de l'autre. Un
  développeur doit connaître les deux.
- Deux jeux d'identifiants (`MONGO_URL`, `DATABASE_URL`), deux pools, deux modèles de
  sauvegarde et de restauration. Une restauration à un instant T doit restaurer **les
  deux** au même instant, sans quoi les ponts pointent dans le vide.
- Deux types d'identifiants qui circulent : `ObjectId` côté commerce, `uuid` côté supply.
  D'où les gardes explicites dans `SupplyService` (`assertUuid`) et les filtres
  `Types.ObjectId.isValid(...)` avant tout `$in` sur des `product_ref`.

**Bénéfices**

- Chaque contexte a le moteur qui correspond à sa nature, sans compromis.
- La frontière technique matérialise la frontière métier : impossible d'écrire par
  accident une jointure entre une commande et une facture fournisseur. Les contextes
  bornés du DDD sont ici garantis par l'infrastructure, pas par la discipline.
- Le registre canonique d'ingrédients (`tenant_ref IS NULL`) avec fork par restaurant via
  `canonical_id` permet une analytique cross-restaurants — impossible à modéliser
  proprement en documents dispersés par tenant.

---

## 5 · Ce qu'un développeur doit retenir

1. **Le prix et la commande vivent dans Mongo. L'ingrédient et la facture vivent dans
   Postgres.** En cas de doute, la grille du §2.1.
2. **Aucune transaction ne traverse les deux.** Si votre opération touche les deux bases,
   écrivez d'abord la source de vérité, rendez la seconde écriture idempotente, et
   assurez-vous qu'un recalcul complet existe.
3. **Les références inter-contextes sont du texte**, sans contrainte de base. Validez-les
   (`assertUuid`, `Types.ObjectId.isValid`) avant de les utiliser dans une requête.
4. **Une nouvelle table supply n'est pas une nouvelle collection Mongo.** Créez la
   migration Drizzle (`pnpm --filter @sm/supply generate`), relisez le SQL généré, puis
   `migrate`.

---

## 6 · Comment on saura qu'on s'est trompé

- **Trop de ponts** : plus de cinq ponts inter-contextes, ou un pont qui doit écrire dans
  les deux sens dans la même opération. → le découpage des contextes est mauvais ;
  déplacer la donnée d'un côté ou de l'autre, ou rouvrir §3.2.
- **Divergence observée** : une rupture d'ingrédient non propagée constatée en
  production. → construire immédiatement la tâche de réconciliation du §4.2, avant toute
  autre chose.
- **Un contexte migre vers l'autre** : si le supply finissait par être lu essentiellement
  document par document (fiche ingrédient complète, sans agrégat), ou si le commerce
  finissait par exiger des jointures profondes, la grille du §2.1 le dirait, et cette ADR
  serait à remplacer.
