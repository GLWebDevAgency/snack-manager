# ADR 0001 — Architecture hexagonale et DDD, appliqués là où ça paie

| | |
|---|---|
| **Statut** | Acceptée |
| **Date** | 2026-08-19 |
| **Portée** | `packages/domain`, `apps/api/src/modules`, `packages/client-core` |
| **Remplace** | — |
| **Documents liés** | [ARCHITECTURE.md](../../ARCHITECTURE.md) (infrastructure), [ARCHITECTURE-LOGICIELLE.md](../ARCHITECTURE-LOGICIELLE.md) (carte du code) |

---

## 1 · Contexte

Snack Manager sert quatre surfaces (`apps/web`, `apps/pos`, `apps/kds`, plus la commande
en ligne publique) à partir d'une seule API. Trois d'entre elles calculent, affichent ou
encaissent **le même prix**. Aujourd'hui, ce prix est calculé à trois endroits distincts :

| Où | Fichier | Ce qu'il calcule |
|---|---|---|
| Serveur | `apps/api/src/modules/orders/orders.service.ts` (`create`, ~l. 60-130) | prix unitaire, dérogation `perVariant`, bornes min/max des groupes |
| Client terrain | `packages/client-core/src/pricing.ts` (`ruleFor`, `unitPrice`) | la même chose, pour l'affichage hors ligne |
| Domaine | `packages/domain/src/menu/rules.ts` (`resolveRule`, `validateSelection`, `priceOf`) | la même chose, testée |

Trois implémentations de la même règle, c'est mécaniquement trois comportements le jour
où l'une des trois est corrigée sans les autres. Le cas concret déjà rencontré : le
gratiné vaut 1,50 € en M/L et 2,00 € en XL/XXL (`perVariant.priceDelta`). Une divergence
sur cette seule ligne, ce sont 50 centimes d'écart sur chaque tacos XXL jusqu'à ce que
quelqu'un compte la caisse.

Le métier n'est pas non plus uniformément riche. À côté de la tarification, du cycle de
vie des commandes, des créneaux et du coût matière, il y a du CRUD sans règle : créer une
catégorie, réordonner une liste, publier un avis. Y appliquer la même machinerie
coûterait plus cher que ça ne rapporte.

Enfin, l'extérieur bouge : le fournisseur de domaines (Railway aujourd'hui, cf.
[ADR 0004](./0004-fournisseur-de-domaines-interchangeable.md)), le paiement (Stripe,
chargé dynamiquement et **optionnel** dans `payments.service.ts`), l'impression (ESC/POS
maison dans `ordering/escpos.ts`), le bus d'événements (Redis pub/sub, appelé directement
depuis trois services). Ces dépendances-là seront remplacées avant le métier lui-même.

---

## 2 · Décision

**On applique l'architecture hexagonale (ports & adaptateurs) et le DDD tactique là où le
métier est riche ou l'extérieur volatile. Ailleurs, on garde des modules applicatifs
NestJS simples.**

Concrètement :

### 2.1 · Ce qui vit dans `packages/domain`

Un fichier va dans le domaine s'il répond **oui aux trois questions** :

1. **Une erreur ici coûte-t-elle de l'argent, une amende, ou un client ?**
   (prix faux, double encaissement, créneau surbooké, allergène non déclaré, remise
   sans traçabilité NF525)
2. **La règle a-t-elle au moins deux appelants**, présents ou certains ?
   (serveur + POS + KDS + commande en ligne)
3. **Saurais-je écrire le test sans base de données, sans NestJS, sans horloge système ?**

Ce qui est déjà là, avec ce qui le justifie :

| Module | Fichier de référence | La règle qui justifie l'hexagone |
|---|---|---|
| **Prix** | `menu/rules.ts` | `resolveRule` : la dérogation de variante prime **champ par champ** (`??` et non `||`, pour qu'un `{min:0,max:0}` du Class Bowl Veggi interdise bien la viande) |
| **Prix** | `shared/money.ts` | centimes entiers, jamais de flottant ; chaque opération d'arrondi (`percent`, `ratioOf`) est explicite et testée, au lieu d'être laissée au hasard d'un `toFixed` |
| **Commande** | `ordering/order.ts` | `discountAmount` plafonné au sous-total — 5 € de geste sur un ticket dont on annule ensuite le tacos à 18 € ne doit pas rendre la caisse débitrice |
| **Commande** | `ordering/order-status.ts` | `mostAdvanced` : le statut le plus avancé gagne, l'annulation bat les étapes en cours **mais pas** `delivered` (cf. [ADR 0003](./0003-offline-first-et-idempotence.md)) |
| **Créneaux** | `tenancy/pickup-slot.ts` | `SlotPolicy(10 min, 4 commandes, 20 min de délai)` ; `occupancyOf` rattache une commande « au plus tôt » au créneau ouvert précédent |
| **Horaires** | `tenancy/wall-clock.ts` | heure **murale** convertie en deux passes pour absorber le changement d'heure ; sinon le service du soir ouvre avec une heure de retard fin octobre |
| **Coût matière** | `supply/food-cost.ts`, `supply/recipe.ts` | les options **imposées** entrent dans le prix de revient : sans elles, le tacos M affiche 91 % de marge au lieu de 62 % |
| **Coût matière** | `supply/units.ts` | conversion systématique vers l'unité d'achat — multiplier 150 (g) par un prix au kilo donne un tacos à 1 900 € |
| **Marque** | `tenancy/brand-theme.ts` | les couleurs fonctionnelles (vert = prêt, rouge = urgent) sont **verrouillées** : règle produit, donc exprimée dans le domaine et pas dans un CSS où un `!important` l'effacerait |

Le paquet ne dépend de **rien** (cf. `packages/domain/package.json` : aucune dépendance
de production, `vitest` en dev). Une quarantaine de fichiers, ~4 400 lignes de code métier
hors tests et jeux d'essai, et **227 tests qui passent en 812 ms**.

### 2.2 · Ce qui reste un module applicatif NestJS

Le CRUD sans règle reste où il est, dans un service qui parle directement à Mongoose ou
Drizzle :

- **Catégories** — `apps/api/src/modules/menu/menu.service.ts`. Création, renommage,
  réordonnancement par drag & drop (`reorderCategories` : un `bulkWrite` de six lignes).
  La seule vraie règle — la suppression protégée qui renvoie un 409 avec le nombre de
  produits rattachés, et détache au lieu de supprimer si `force` — tient en huit lignes
  et n'a **qu'un seul appelant**. Un agrégat `Category`, un port `CategoryRepository` et
  un mapper pour ça, c'est trois fichiers de cérémonie pour zéro invariant gagné.
- **Avis et promotions** — `apps/api/src/modules/engage/engage.service.ts`.
- **Réglages du tenant** — `apps/api/src/modules/tenants/tenants.service.ts`
  (`updateSettings` protégé par une liste blanche de clés).
- **Statistiques** — `apps/api/src/modules/stats/`, qui sont des lectures agrégées, pas
  des décisions.

### 2.3 · Les ports

Un port est déclaré dans le domaine **quand une dépendance externe est volatile et que le
métier n'a pas à connaître sa forme**.

| Port (`packages/domain/src/ports/`) | Adaptateur(s) (`apps/api/src/infrastructure/`) | Consommé par le métier ? |
|---|---|---|
| `domain-registrar.ts` | `railway-`, `cloudflare-`, `disabled-domain-registrar.ts` + fabrique | **oui** — `modules/site/*.usecase.ts` |
| `payment-gateway.ts` | `stripe-`, `null-payment-gateway.ts` + fabrique | pas encore — `ordering/payments.service.ts` reste en place |
| `event-publisher.ts` | `events/redis-event-publisher.ts` | pas encore — trois services appellent toujours `redis.publish` en direct |
| `secret-hasher.ts` | `security/argon2-secret-hasher.ts` | pas encore |
| `ticket-printer.ts` | — (l'encodeur `ordering/escpos.ts` n'est pas encore un adaptateur) | pas encore |
| `notifier.ts` | — | pas encore |

`domain-registrar.ts` reste l'exemplaire de référence : le domaine sait qu'un restaurant a
une adresse publique, il ignore totalement qui l'héberge — et il existe déjà **trois**
implémentations, choisies par une variable d'environnement
([ADR 0004](./0004-fournisseur-de-domaines-interchangeable.md)).

Deux conventions se sont dégagées en écrivant ces ports, et elles méritent d'être tenues :

- **`ports/index.ts` n'exporte que des types** (`export type * from …`). Ce n'est pas un
  détail de compilation : un adaptateur ne peut alors structurellement pas dépendre du
  cœur métier **à l'exécution**. La flèche des dépendances devient vérifiable par le
  compilateur au lieu d'être une promesse en revue de code.
- **Un port ne lève pas pour une indisponibilité.** `PaymentGateway` répond
  `available: false`, la fabrique de registrar retombe sur `DisabledDomainRegistrar`
  plutôt que d'empêcher l'API de démarrer. Une clé Stripe expirée ne doit pas tuer une
  caisse un vendredi soir.

Enfin, tous les ports ne vivent pas dans `ports/` : `SlotOccupancy` est déclaré au plus
près de son usage, dans `tenancy/pickup-slot.ts`, parce qu'une interface d'une méthode
utilisée par un seul agrégat n'a pas besoin d'un fichier à elle.

---

## 3 · Pourquoi on refuse l'hexagonalisation dogmatique

C'est la partie de cette décision qui compte le plus, parce que c'est celle qu'une équipe
qui grandit va spontanément enfreindre — par zèle, pas par négligence.

**Le coût réel d'un hexagone appliqué partout, sur ce projet :**

1. **Quatre représentations de la même donnée, au lieu de trois.** Un produit existe déjà
   en schéma zod (`packages/contracts/src/index.ts`), en schéma Mongoose
   (`packages/db/src/schemas.ts`) et en value objects (`packages/domain/src/menu/`).
   Ajouter un `ProductRepository` avec son mapper dédié pour un CRUD de catégories, c'est
   une quatrième forme à maintenir pour un objet qui n'a aucune règle.
2. **Des ports à une seule implémentation, pour toujours.** Une interface dont il
   n'existera jamais qu'un adaptateur n'est pas une abstraction, c'est une indirection.
   `CategoryRepository` ne sera jamais implémenté deux fois : les catégories vivront dans
   Mongo aussi longtemps que les menus.
3. **Des tests qui testent le mapper.** Le piège classique : la couverture monte, la
   confiance aussi, et pourtant aucun de ces tests n'aurait attrapé le gratiné à 1,50 €
   sur un XXL. Les tests qui comptent sont ceux de `menu/rules.test.ts`, pas ceux d'un
   `toDomain()`.
4. **Un onboarding qui double.** Un développeur qui arrive lundi doit pouvoir livrer un
   écran « Avis » le mercredi. S'il doit d'abord écrire une entité, un port, un
   adaptateur, un mapper et un cas d'usage pour afficher une note sur cinq, on a payé
   trois jours pour zéro invariant.
5. **Une fausse sécurité.** « C'est hexagonal donc c'est robuste » est faux. Le bug du
   coût matière (`supply/food-cost.ts`) ne venait pas d'un défaut de couche : il venait
   d'une règle métier mal comprise. Aucune architecture ne remplace le fait d'aller
   regarder comment on fabrique réellement un tacos.

**La règle de tranchage, à afficher au-dessus du clavier :**

> On n'hexagonalise pas ce qui n'a pas de métier.
> On n'abstrait pas ce qu'on ne remplacera jamais.
> Mais on ne recopie **jamais** une règle qui existe déjà dans le domaine.

Ce dernier point est le seul absolu. Le reste est un curseur ; celui-là est une ligne.

---

## 4 · Options écartées

### 4.1 · Tout laisser dans les modules NestJS (statu quo)

**Pourquoi c'était tentant** : le back-office fonctionne, l'API tient en 5 200 lignes, la
livraison est rapide.

**Pourquoi non** : la triple duplication du prix décrite au §1 existe *déjà*. On sait
donc, sans spéculer, où mène cette voie. Ajoutez que les règles vivent dans des services
qui ont besoin de Mongoose, de Redis et de `ConfigService` pour démarrer : le test
« un tacos XXL avec quatre viandes coûte 16,50 € » exige aujourd'hui une base MongoDB.

### 4.2 · Hexagone intégral d'emblée, sur tous les modules

**Pourquoi c'était tentant** : cohérence, pas de zone grise, pas de discussion à chaque
revue de code.

**Pourquoi non** : le §3 en entier. Et un argument de calendrier : la réécriture complète
de neuf modules bloque la livraison produit pendant des semaines, sur un projet dont le
pilote Class'Food tourne en production.

### 4.3 · Clean Architecture stricte (un objet `UseCase` par cas d'usage)

**Pourquoi c'était tentant** : chaque intention métier devient un fichier nommé, ce qui
se documente tout seul.

**Pourquoi non** : sur une équipe de 1 à 5 personnes, `CreateOrderUseCase.execute()`
n'apporte rien de plus que `buildOrder()` — qui est déjà une fonction pure, nommée, et
testée (`packages/domain/src/ordering/build-order.ts`). On garde des **services de
domaine sous forme de fonctions pures** plutôt que des classes à une méthode.

### 4.4 · Event sourcing / CQRS pour la commande

**Pourquoi c'était tentant** : NF525 exige une trace append-only de qui a fait quoi et
quand. Un journal d'événements *est* cette trace.

**Pourquoi non** : le besoin légal est déjà couvert par `statusHistory` (dans le document
commande) et par la collection `auditLog` append-only. Un event store impose des
projections, une gestion de versions d'événements et un rejeu — pour une charge de
quelques centaines de commandes par jour et par restaurant. À reconsidérer si la
certification NF525 exige une chaîne signée ; pas avant.

### 4.5 · Règles métier dans les schémas Mongoose (validators, hooks `pre('save')`)

**Pourquoi c'était tentant** : c'est gratuit, c'est au plus près de la donnée.

**Pourquoi non** : une règle dans un hook Mongoose est intestable sans base, invisible à
la lecture du service, et ne s'exécute pas sur les chemins `updateMany` / `bulkWrite` —
que `menu.service.ts` et `supply.service.ts` utilisent tous les deux. Une règle qui
s'applique « la plupart du temps » est pire qu'une règle absente.

---

## 5 · État réel du chantier (à lire avant de conclure quoi que ce soit)

**L'adoption est réelle mais partielle, et elle avance par module, pas par couche.**

Ce qui est **fait** : `apps/api` dépend de `@sm/domain`, et le module
`apps/api/src/modules/site/` est le premier construit selon cette ADR de bout en bout —
un cas d'usage par classe (`add-custom-domain.usecase.ts`,
`check-domain-status.usecase.ts`…), branchés sur le port `DomainRegistrar`, avec les
adaptateurs Railway/Cloudflare/désactivé isolés dans `apps/api/src/infrastructure/` et
choisis par une fabrique. Ce module est la référence à copier.

Ce qui **ne l'est pas** : les modules antérieurs (`orders`, `menu`, `supply`, `ordering`)
n'ont pas encore basculé. **Le prix affiché au comptoir sort toujours de
`orders.service.ts`, pas de `menu/rules.ts`.** Il faut le dire clairement, sinon quelqu'un
lira ce document et corrigera une règle au mauvais endroit.

C'est une adoption incrémentale assumée : on n'arrête pas un pilote en production pour
recâbler neuf modules d'un coup.

**Ordre de bascule retenu**, du plus rentable au moins urgent :

1. **`Money` partout** où des centimes circulent — `ticket.service.ts`, `stats.service.ts`,
   `supply.service.ts`. Gain immédiat, risque quasi nul, aucun changement de contrat API.
2. **`buildOrder` / `validateSelection` dans `OrdersService.create`** — supprime la
   duplication serveur, la plus coûteuse des trois.
3. **`mostAdvanced`** dans `OrdersService.updateStatus` et dans
   `client-core/src/hooks.ts::mergeOrder`, qui implémentent aujourd'hui la même règle avec
   deux tables de rangs distinctes (`ORDER_STATUS_RANK` côté contracts, `PROGRESS` côté
   domaine — et elles ne classent pas `cancelled` pareil).
4. **`EventPublisher`** dans `orders`, `menu` et `supply` : le port et l'adaptateur Redis
   existent et sont enregistrés, mais les trois services appellent encore
   `redis.publish(...)` en direct. C'est la bascule la moins risquée des quatre restantes.
5. **`generateSlots`** dans `SlotsService` (331 lignes qui refont `pickup-slot.ts` +
   `wall-clock.ts`).

**Deux règles applicables dès aujourd'hui, sans attendre la bascule.** En revue de code,
ce sont les deux seuls points non négociables :

1. Aucune nouvelle règle métier n'est écrite dans un service NestJS si elle existe déjà
   dans `packages/domain`, ou si elle aura un deuxième appelant.
2. Un port dont l'adaptateur est déjà enregistré ne se contourne pas. Écrire un nouvel
   appel à `redis.publish` alors que `EVENT_PUBLISHER` est injectable est une régression,
   pas un raccourci.

---

## 6 · Conséquences

**Positives**

- Les règles qui coûtent cher sont testables en millisecondes, sans base ni framework :
  227 tests en 812 ms, exécutables par n'importe qui, hors ligne, y compris dans un train.
- Le vocabulaire du code est celui du comptoir : `Variant`, `OptionGroup`,
  `StaffAuthorization`, `PickupSlot`, `Closure`, `Margin`. Une conversation avec le gérant
  de Class'Food se transpose sans traduction.
- Changer de base, de framework ou de fournisseur n'oblige pas à retoucher le métier.
- Les erreurs métier sont explicites et typées (`DomainError` + `Result`), distinctes des
  bugs (`InvariantViolation`) : l'interface sait quoi afficher, la supervision sait quoi
  alerter.

**Négatives, assumées**

- **Une frontière grise.** « Est-ce que ça va dans le domaine ? » n'a pas de réponse
  mécanique. On accepte de trancher au cas par cas, avec les trois questions du §2.1 et,
  en cas de doute persistant, en laissant la règle dans le module applicatif jusqu'à ce
  qu'un deuxième appelant apparaisse.
- **Une duplication temporaire assumée**, tant que la bascule du §5 n'est pas terminée.
  Elle est documentée ici précisément pour qu'elle reste temporaire et visible.
- **Un paquet de plus** à builder et typechecker dans le pipeline Turborepo.
- **Le domaine ne sait pas persister.** Toute lecture-écriture reste la responsabilité de
  la couche application, qui doit charger l'agrégat complet avant de décider. C'est un
  coût réel sur les chemins où l'on ne veut charger qu'un champ.

**Neutres**

- Le domaine est en TypeScript pur, mais il est désormais **transpilé** pour l'exécution :
  `main` pointe sur `./dist/index.js` (build CommonJS via `tsconfig.build.json`) tandis que
  `types` continue de pointer sur les sources. Conséquence pratique : un `typecheck` reste
  possible sans build, mais démarrer l'API exige un `pnpm build` préalable.
- `packages/domain/src/index.ts` n'exporte aujourd'hui qu'un sous-ensemble (`shared`,
  `tenancy/public-domain`, `ports`). Les sous-domaines s'exportent au fur et à mesure
  qu'ils sont consommés — voir la procédure dans
  [ARCHITECTURE-LOGICIELLE.md](../ARCHITECTURE-LOGICIELLE.md).

---

## 7 · Comment on saura qu'on s'est trompé

À rouvrir cette décision si l'un de ces signaux apparaît :

- **Trop d'hexagone** : plus de la moitié des fichiers d'un module sont des mappers, des
  ports ou des DTO ; ou bien un port existe depuis six mois avec une seule implémentation
  et aucune seconde en vue. → réintégrer la logique dans le module applicatif.
- **Pas assez** : un bug de prix, de statut ou de coût matière se reproduit une deuxième
  fois parce qu'une règle a été corrigée à un seul des endroits où elle existe.
  → accélérer la bascule du §5, en priorité sur la règle concernée.
- **Le domaine dérive** : un `import` de NestJS, de Mongoose, de `fetch` ou un appel à
  `Date.now()` apparaît dans `packages/domain`. → c'est le signal que la frontière n'est
  plus comprise ; la règle du README du paquet doit redevenir un test de CI.
