# Architecture logicielle — la carte du code

> **Pour qui** : le développeur qui rejoint l'équipe lundi matin.
> **Ce que ce document n'est pas** : [ARCHITECTURE.md](../ARCHITECTURE.md) décrit
> l'infrastructure (Railway, MongoDB, Redis, schémas de données, topologie de
> déploiement). Ce document-ci décrit **le code** : ses couches, ses règles, et où poser
> le fichier que vous êtes sur le point d'écrire.
> **Le pourquoi** est dans les décisions d'architecture : [docs/adr/](./adr/).

---

## 0 · Les cinq minutes qui comptent

Si vous ne lisez que ça aujourd'hui :

1. **Les montants sont TOUJOURS en centimes entiers.** Jamais un flottant, jamais un
   euro. La conversion en « 12,50 € » n'existe qu'à l'affichage.
2. **Le `tenantId` vient du JWT, jamais du corps de la requête.** C'est l'isolation
   multi-tenant, et c'est non négociable.
3. **Le prix qui compte est celui que le serveur recalcule.** Un panier envoyé par un
   client n'apporte que des clés, jamais des montants.
4. **Toute écriture depuis le POS ou le KDS passe par la file persistée**, et toute route
   qu'elle appelle doit être rejouable sans créer de doublon.
5. **On n'hexagonalise pas ce qui n'a pas de métier — mais on ne recopie jamais une règle
   qui existe déjà dans `packages/domain`.**

Le reste de ce document explique comment tenir ces cinq points sans y penser.

---

## 1 · Le schéma des couches

```
        ┌──────────────────────────────────────────────────────────────────────┐
        │  INTERFACES  (adaptateurs entrants — ce qui parle au monde)          │
        │                                                                      │
        │  apps/api/src/modules/*/​*.controller.ts    routes REST               │
        │  apps/api/src/modules/orders/orders.gateway.ts   WebSocket           │
        │  apps/web        Next.js — vitrine, commande en ligne, back-offices  │
        │  apps/pos        Expo — caisse tactile                               │
        │  apps/kds        Expo — écran cuisine                                │
        │  packages/client-core   noyau des surfaces terrain (file offline)    │
        └────────────────────────────────┬─────────────────────────────────────┘
                                         │  appelle
                                         ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │  APPLICATION  (orchestration — ce qui coordonne)                     │
        │                                                                      │
        │  apps/api/src/modules/*/​*.service.ts       modules historiques       │
        │  apps/api/src/modules/site/*.usecase.ts   ◄── le module de référence │
        │  · charge les données, appelle le domaine, persiste, publie          │
        │  · porte les transactions, le scoping tenant, le journal d'audit     │
        │  · traduit les erreurs métier en codes HTTP                          │
        └───────────┬──────────────────────────────────────┬───────────────────┘
                    │  appelle                             │  appelle
                    ▼                                      ▼
        ┌───────────────────────────────┐  ┌───────────────────────────────────┐
        │  DOMAINE      packages/domain │  │  INFRASTRUCTURE                   │
        │  ─────────────────────────────│  │  ─────────────────────────────────│
        │  shared/    Money, Result,    │  │  packages/db          Mongoose    │
        │             Clock, erreurs    │  │  packages/supply      Drizzle     │
        │  menu/      carte, prix,      │  │  apps/api/src/infrastructure/     │
        │             règles d'options  │  │    domains/   Railway·Cloudflare  │
        │  ordering/  commande, statuts │  │    payments/  Stripe·Null         │
        │  supply/    coût, allergènes  │  │    events/    Redis               │
        │  tenancy/   restaurant, marque│  │    security/  argon2              │
        │  ports/     interfaces vers   │  │  redis.module.ts · escpos.ts      │
        │             l'extérieur       │◄─┼── implémente les ports            │
        │                               │  │                                   │
        │  ► NE DÉPEND DE RIEN          │  │                                   │
        └───────────────────────────────┘  └───────────────────────────────────┘

        ┌──────────────────────────────────────────────────────────────────────┐
        │  CONTRATS   packages/contracts — transverse, pas une couche          │
        │  Schémas zod : DTO d'API, événements WebSocket, énumérations.        │
        │  Format de FIL. Ce n'est PAS le domaine (cf. §3.3).                  │
        └──────────────────────────────────────────────────────────────────────┘
```

### La règle de dépendance : les flèches pointent vers l'intérieur

| Couche | A le droit d'importer | N'a **jamais** le droit d'importer |
|---|---|---|
| **Domaine** | rien (que lui-même) | NestJS, Mongoose, Drizzle, React, `fetch`, `@sm/contracts`, `@sm/db` |
| **Application** | domaine, infrastructure, contrats | React, un composant d'écran |
| **Infrastructure** | domaine (pour implémenter ses ports), contrats | une autre infrastructure sans passer par l'application |
| **Interfaces** | application, contrats, domaine (types de lecture) | Mongoose, Drizzle, `pg`, `ioredis` directement |

**Le test qui tranche pour le domaine** (repris du README de `packages/domain`) :

> *Ce fichier compilerait-il tel quel dans un navigateur, un worker, un test unitaire,
> sans mock ?* Si non, il ne va pas là.

`packages/domain/package.json` n'a **aucune dépendance de production**. C'est vérifiable
en une ligne, et ça doit le rester.

L'exception qui confirme la règle : `tenancy/wall-clock.ts` utilise `Intl.DateTimeFormat`.
`Intl` est une brique standard du langage, disponible partout — le fichier tourne tel quel
dans un navigateur. La règle n'est pas « zéro import », c'est « zéro dépendance à un
environnement d'exécution particulier ».

---

## 2 · L'inversion de dépendance, concrètement

C'est le seul point théorique de ce document, et il tient en un exemple réel.

Le domaine sait qu'un restaurant peut avoir une adresse à lui. Il ne sait pas — et ne doit
pas savoir — qui l'héberge. Il déclare donc l'interface, et quelqu'un d'autre l'implémente :

```
packages/domain/src/ports/domain-registrar.ts
        ┌────────────────────────────────────────┐
        │  interface DomainRegistrar {           │  ← déclaré DANS le domaine
        │    register(domain): Promise<…>        │
        │    check(providerId): Promise<…>       │
        │    release(providerId): Promise<void>  │
        │  }                                     │
        └──────────────▲─────────────────────────┘
                       │ implémente
        ┌──────────────┴──────────────────────────────────────────┐
        │  apps/api/src/infrastructure/domains/                   │
        │    RailwayDomainRegistrar · CloudflareDomainRegistrar   │
        │    DisabledDomainRegistrar                              │
        │    domain-registrar.factory.ts  ← choisit selon          │
        │                                   DOMAIN_PROVIDER        │
        └─────────────────────────────────────────────────────────┘
```

La flèche d'implémentation remonte vers le domaine : c'est ça, l'inversion. Le fournisseur
change ([ADR 0004](./adr/0004-fournisseur-de-domaines-interchangeable.md)), le métier ne
bouge pas — concrètement, passer de Railway à Cloudflare est une variable d'environnement.

**Le compilateur garde la flèche.** `packages/domain/src/ports/index.ts` n'exporte que des
types (`export type * from …`). Un adaptateur ne peut donc pas importer une *valeur* du
domaine par ce chemin : les ports s'effacent à la compilation, et l'infrastructure ne peut
structurellement pas dépendre du cœur métier à l'exécution. Ce n'est pas une astuce, c'est
la règle de dépendance rendue vérifiable.

Deuxième exemple, plus petit et déjà en place : `SlotOccupancy` dans
`packages/domain/src/tenancy/pickup-slot.ts`. Une interface d'une seule méthode
(`takenAt(slotStart): number`). Le domaine sait qu'un créneau se remplit ; il ignore que
les commandes vivent dans Mongo.

**Où déclarer un port ?**

- Dans `ports/` s'il vise une **infrastructure lourde et remplaçable** : registrar,
  paiement, impression, bus d'événements.
- **Au plus près de son usage**, dans le sous-domaine, s'il s'agit d'une petite lecture
  dont un seul module a besoin (comme `SlotOccupancy`). Ne créez pas un fichier dans
  `ports/` pour une interface d'une ligne utilisée par un seul agrégat.

---

## 3 · Le monorepo : rôle de chaque espace

`pnpm workspaces` + Turborepo. `pnpm-workspace.yaml` déclare `apps/*` et `packages/*`.

### 3.1 · `packages/`

| Paquet | Rôle | Dépendances | Build |
|---|---|---|---|
| **`@sm/domain`** | Le cœur métier. Value objects, entités, services purs, ports. | **aucune** | `tsc -p tsconfig.build.json` → `dist/` |
| **`@sm/contracts`** | Schémas zod : DTO d'API, événements WS, énumérations. Le format de fil. | `zod` | `tsc` → `dist/` |
| **`@sm/db`** | Modèles Mongoose du contexte **commerce** + seeds (carte Class'Food, 30 j d'historique). | `mongoose`, `argon2`, `@sm/contracts` | `tsc` → `dist/` |
| **`@sm/supply`** | Schéma Drizzle du contexte **supply** (PostgreSQL) + migrations versionnées + seed. | `drizzle-orm`, `pg` | `tsc` → `dist/` |
| **`@sm/client-core`** | Noyau des surfaces terrain : file de synchronisation offline, stockage abstrait, client API, prix d'affichage, hooks React. | `@sm/contracts`, `react` (peer) | aucun (`main: ./src/index.ts`) |

> **Piège n° 1** : `@sm/client-core` s'exporte **en source** ; `@sm/contracts`, `@sm/db`,
> `@sm/supply` et `@sm/domain` s'exportent **compilés**. Si vous modifiez `@sm/contracts`
> et que l'API ne voit pas votre changement, c'est qu'il manque un `pnpm build` (ou un
> `pnpm --filter @sm/contracts dev` en mode watch).
>
> **Piège n° 2** : `@sm/domain` a un `main` (`./dist/index.js`, CommonJS pour Node) et des
> `types` (`./src/index.ts`, les sources). Un `typecheck` passe donc sans build, mais
> **démarrer l'API sans avoir buildé `@sm/domain` échoue à l'exécution** — Node ne sait pas
> charger des sources TypeScript.

### 3.2 · `apps/`

| App | Rôle |
|---|---|
| **`api`** | NestJS 11 — REST + WebSocket, MongoDB + PostgreSQL + Redis, guard d'authentification global, journal d'audit NF525. |
| **`web`** | Next.js 16 App Router — vitrine (`/`), commande en ligne (`/r/[slug]`), suivi client (`/t/[id]`), embed (`/embed/[slug]`), back-office (`/admin`). Le multi-tenant par domaine est résolu dans `src/proxy.ts`. |
| **`pos`** | Expo — caisse tactile. Offline-first. |
| **`kds`** | Expo — écran cuisine. Offline-first. |

### 3.3 · `@sm/contracts` n'est pas le domaine

C'est la confusion la plus fréquente, alors autant la traiter tout de suite.

| | `@sm/contracts` | `@sm/domain` |
|---|---|---|
| **Question à laquelle il répond** | « Quelle forme a la donnée qui transite sur le fil ? » | « Quelle est la règle ? » |
| **Nature** | schémas zod, types inférés | classes immuables, fonctions pures |
| **Validation** | syntaxique : « `price` est un entier ≥ 0 » | métier : « un tacos M impose exactement une viande » |
| **Consommé par** | API (runtime), les 4 fronts (types) | l'application, et à terme les fronts |
| **Change quand** | l'API change de forme | le métier change de règle |

Exemple concret : `OptionGroupSchema` (contracts) garantit que `min` est un entier positif.
`OptionGroup.create` (domaine) refuse en plus un groupe `single` qui accepterait deux
choix, une dérogation qui viserait un format inexistant, ou des bornes inversées. Les deux
sont nécessaires ; aucun ne remplace l'autre.

---

## 4 · Où mettre quoi — l'arbre de décision

À dérouler de haut en bas. La première réponse « oui » gagne.

```
J'écris du code. Où va-t-il ?

├─ Est-ce que ça touche HTTP, WebSocket, un écran, un composant React ?
│     → INTERFACES
│       apps/api/src/modules/<x>/<x>.controller.ts  ·  apps/web  ·  apps/pos  ·  apps/kds
│
├─ Est-ce que ça parle à Mongo, Postgres, Redis, Stripe, une imprimante, un DNS ?
│     → INFRASTRUCTURE
│       packages/db  ·  packages/supply  ·  *.module.ts  ·  un adaptateur de port
│
├─ Est-ce le format d'un échange entre client et serveur ?
│     → packages/contracts  (schéma zod + type inféré)
│
├─ Est-ce une RÈGLE MÉTIER ?  → les trois questions :
│     1. Une erreur ici coûte-t-elle de l'argent, une amende, ou un client ?
│     2. La règle a-t-elle (ou aura-t-elle certainement) deux appelants ?
│     3. Sauriez-vous écrire le test sans base, sans framework, sans horloge système ?
│
│     ├─ trois OUI  → DOMAINE  (packages/domain/src/<sous-domaine>/)
│     └─ sinon      → APPLICATION  (apps/api/src/modules/<x>/<x>.service.ts)
│
└─ Sinon → APPLICATION. Le doute profite au module applicatif : on remonte
           une règle dans le domaine quand un deuxième appelant apparaît,
           l'inverse est bien plus coûteux.
```

### Ce que ça donne sur des cas réels de ce dépôt

| Ce que vous écrivez | Où | Pourquoi |
|---|---|---|
| « Le gratiné coûte 2,00 € en XXL au lieu de 1,50 € » | `domain/menu/rules.ts` | argent + 3 surfaces + testable sans base |
| « Le statut le plus avancé gagne, sauf `delivered` » | `domain/ordering/order-status.ts` | argent + POS/KDS/API + pur |
| « Les options imposées entrent dans le coût matière » | `domain/supply/food-cost.ts` | le gérant fixe ses prix dessus |
| « Créer une catégorie » | `api/modules/menu/menu.service.ts` | aucune règle, un seul appelant |
| « Refuser de supprimer une catégorie qui a des produits » | `api/modules/menu/menu.service.ts` | 8 lignes, un seul appelant |
| « Publier `order.created` sur Redis » | infrastructure, derrière un futur port `EventPublisher` | technique, remplaçable |
| « Encoder un ticket en ESC/POS » | `api/modules/ordering/escpos.ts` (à déplacer en paquet partagé) | pur mais technique |
| « Valider qu'un `clientId` est bien un UUID » | `packages/contracts` | syntaxe de fil |
| « Une commande sans article n'existe pas » | `domain/ordering/order.ts` | invariant métier |

---

## 5 · Conventions de nommage

Toutes tirées du code existant. Suivez-les : la cohérence vaut mieux que la préférence
personnelle.

### 5.1 · Langue

- **Identifiants techniques en anglais** : `OrderLine`, `validateSelection`, `unitPrice`,
  `providerId`.
- **Valeurs métier dans la langue du métier**, c'est-à-dire en français quand le terme
  français est le terme du comptoir : rôles `'gerant' | 'caisse' | 'cuisine'`, types
  `'surplace' | 'emporter' | 'pickup'`, allergènes `'fruits_a_coque'`, statuts de facture
  `'a_payer' | 'payee' | 'litige'`.
- **Commentaires, messages d'erreur, libellés : toujours en français.** Les messages
  d'erreur métier sortent tels quels à l'écran du restaurateur ou du client.

### 5.2 · Domaine

| Élément | Convention | Exemples |
|---|---|---|
| Fichier | `kebab-case.ts`, un concept au singulier | `order-line.ts`, `pickup-slot.ts`, `wall-clock.ts` |
| Value object / entité | `PascalCase`, constructeur **privé** | `Money`, `OrderLine`, `PickupSlot`, `Closure` |
| Service de domaine | fonction pure `camelCase`, pas une classe | `validateSelection`, `resolveRule`, `costOf`, `generateSlots`, `mostAdvanced`, `buildOrder` |
| Fabrique validante | `create(...)` → `Result<T, E>` | `MenuItem.create`, `OptionGroup.create`, `Restaurant.create` |
| Fabrique depuis une donnée sûre | `fromXxx` / `of` / `from` | `Money.fromCents`, `Quantity.of`, `CalendarDay.from` |
| Fabrique depuis une saisie humaine | `parse(...)` → `Result` | `Money.parse('9,50')`, `WallTime.parse('18:00')` |
| Copie modifiée (immuabilité) | `withXxx(...)` | `withAvailability`, `withAccent`, `withQuantity`, `withStock` |
| Prédicat | `isXxx` / `canXxx` / `requiresXxx` | `isAvailable`, `isMandatory`, `isTerminal`, `canTransition`, `requiresVariant` |
| Constante métier | `SCREAMING_SNAKE`, `as const` | `ORDER_STATUSES`, `ALLERGENS`, `RESTAURANT_TIMEZONE`, `MAX_QUANTITY` |
| Erreur métier | `PascalCase extends DomainError` + `code` figé | `UnknownVariant` / `'menu.variant.unknown'` |

**Codes d'erreur** : `<sous-domaine>.<objet>.<problème>`, en minuscules, stables dans le
temps. Ils voyagent jusqu'aux clients et servent à brancher un traitement. Exemples réels :
`money.invalid`, `menu.variant.required`, `option.rule`, `order.transition`,
`order.discount.invalid`, `unit.incompatible`, `brand.locked`.

### 5.3 · Ports et adaptateurs

- **Le port porte le rôle, jamais la technologie** : `DomainRegistrar`, pas
  `RailwayClient`. `SlotOccupancy`, pas `OrderRepository`.
- **L'adaptateur porte la technologie + le rôle** : `RailwayDomainRegistrar`,
  `CloudflareDomainRegistrar`, `StripePaymentGateway`, `RedisEventPublisher`,
  `EscPosTicketPrinter`.
- **Le double de test porte `Fake` ou `InMemory`** : `FakeDomainRegistrar`,
  `InMemorySlotOccupancy`. Pas `Mock` — on n'utilise pas de bibliothèque de mocks dans le
  domaine.

### 5.4 · Application (NestJS)

Un module = un dossier `apps/api/src/modules/<nom>/`. Deux styles coexistent, et c'est
volontaire ([ADR 0001](./adr/0001-architecture-hexagonale-et-ddd.md)) :

```
# Module CRUD (menu, engage, tenants, stats) — un service qui parle à la base
<nom>.module.ts       déclaration NestJS
<nom>.controller.ts   routes (interfaces)
<nom>.service.ts      orchestration (application)
<nom>.dto.ts          schémas zod locaux, si non partagés
<nom>.gateway.ts      WebSocket, le cas échéant

# Module à métier riche (site) — un cas d'usage par classe
<nom>.module.ts       déclaration NestJS
<nom>.controller.ts   routes, sans logique
<verbe>-<objet>.usecase.ts   un cas d'usage = une classe = une méthode `execute`
<nom>.repository.ts   accès aux données, tenant-scopé
<nom>.tokens.ts       jetons d'injection + décorateurs d'injection du module
<nom>.view.ts         projection vers la forme rendue au client
<nom>.config.ts       configuration lue par le module
```

`apps/api/src/modules/site/` est le module de référence à copier :
`add-custom-domain.usecase.ts`, `check-domain-status.usecase.ts`,
`remove-custom-domain.usecase.ts`, `resolve-tenant-by-host.usecase.ts`. Aucun ne nomme
Railway ni Cloudflare — ils ne connaissent que le port `DomainRegistrar`.

Les adaptateurs vivent à part, dans `apps/api/src/infrastructure/`, groupés par port :

```
infrastructure/
  tokens.ts                    DOMAIN_REGISTRAR, PAYMENT_GATEWAY, EVENT_PUBLISHER, SECRET_HASHER
  infrastructure.module.ts     @Global — enregistre tous les adaptateurs
  domains/    railway- · cloudflare- · disabled-domain-registrar.ts + .factory.ts
  payments/   stripe- · null-payment-gateway.ts + .factory.ts
  events/     redis-event-publisher.ts
  security/   argon2-secret-hasher.ts
```

- Les jetons d'injection sont des constantes `SCREAMING_SNAKE` exportées :
  `DOMAIN_REGISTRAR`, `PAYMENT_GATEWAY`, `EVENT_PUBLISHER`, `SECRET_HASHER`,
  `REDIS_PUB`, `REDIS_SUB`, `SUPPLY_DB`, `SUPPLY_POOL`.
- **Une fabrique par port à plusieurs implémentations** (`<port>.factory.ts`), qui lit la
  configuration, journalise le choix retenu et **ne lève jamais** : une variable manquante
  dégrade la fonctionnalité, elle n'empêche pas l'API de démarrer.
- Les modules d'infrastructure transverses sont `@Global()` : `DatabaseModule`,
  `RedisModule`, `SupplyDbModule`, `AuditModule`, `AuthModule`.
- **Toute route est authentifiée par défaut** — `AuthGuard` est enregistré en `APP_GUARD`
  dans `AuthModule`. Une route publique s'annote explicitement `@Public()`, une route
  restreinte `@Roles('gerant')`.
- Le `tenantId` s'obtient par le décorateur `@TenantId()`, qui le lit dans le JWT et lève
  s'il est absent. **On ne le lit jamais dans le corps ni dans l'URL.**

### 5.5 · Argent et unités

- Un montant est un entier de **centimes**. Une variable qui porte un nombre brut se
  nomme `...Cents` : `costPerUnitCents`, `packPriceCents`, `totalTtcCents`,
  `dailyGoalCents`.
- Dans le domaine, on manipule `Money`, pas un `number`. `Money.fromCents(950)`,
  jamais `950` qui traverse trois fonctions.
- Les quantités physiques passent par `Quantity` (`domain/supply/units.ts`), qui refuse
  de convertir des grammes en litres — la densité dépend de l'ingrédient, et personne ne
  la saisit.

---

## 6 · Ajouter un port et son adaptateur — la procédure

Six étapes. Le chemin `DomainRegistrar` → `RailwayDomainRegistrar` les illustre toutes et
sert de modèle : lisez-le en parallèle.

**1 — Écrire le port dans le domaine.** Le rôle, pas la technologie. Décrivez ce dont le
métier a besoin, pas ce que l'API du fournisseur propose.

```ts
// packages/domain/src/ports/notifier.ts
export interface Notifier {
  notify(message: OutboundMessage): Promise<DeliveryOutcome>;
}
```

Deux règles de conception, tirées des ports existants :

- **Les états sont ceux du métier, pas ceux du fournisseur.** `DomainStatus` a quatre
  valeurs (`pending_dns`, `issuing_certificate`, `active`, `failed`) parce que ce sont les
  quatre choses qu'on doit dire au restaurateur — pas parce qu'un fournisseur les nomme
  ainsi. Ne recopiez jamais la dizaine d'états d'une API tierce.
- **Une indisponibilité est une réponse, pas une exception.** `PaymentGateway` répond
  `available: false` plutôt que de lever : un port qui jette oblige chaque appelant à
  savoir rattraper la panne pour ne pas perdre la commande.

**2 — L'exporter en type seul** dans `packages/domain/src/ports/index.ts` :

```ts
export type * from './notifier';
```

`export type *`, jamais `export *` — voir le §2 : c'est ce qui empêche l'infrastructure de
dépendre du domaine à l'exécution.

**3 — Écrire l'adaptateur** dans `apps/api/src/infrastructure/<famille>/`, avec un nom qui
dit la technologie **et** le rôle :

```ts
// apps/api/src/infrastructure/notifications/twilio-notifier.ts
import type { Notifier, OutboundMessage } from '@sm/domain/src/ports';

@Injectable()
export class TwilioNotifier implements Notifier { /* … */ }
```

Prévoyez tout de suite l'implémentation dégradée (`NullNotifier`, `DisabledNotifier`) :
elle est ce qui permet à l'étape 4 de ne jamais lever.

**4 — Écrire la fabrique** si le port a plusieurs implémentations
(`<famille>/notifier.factory.ts`), sur le modèle de `domain-registrar.factory.ts` : elle
lit la configuration, **journalise le choix retenu et les variables manquantes**, et
retombe sur l'implémentation dégradée plutôt que d'empêcher le démarrage.

**5 — Déclarer le jeton et l'enregistrer** dans `infrastructure/tokens.ts` et
`infrastructure.module.ts` (qui est `@Global`) :

```ts
export const NOTIFIER = 'NOTIFIER';
{ provide: NOTIFIER, useFactory: (…) => createNotifier(…) }
// à l'usage, dans un cas d'usage :
constructor(@Inject(NOTIFIER) private readonly notifier: Notifier) {}
```

Aucun module applicatif ne référence jamais `TwilioNotifier` — seulement `NOTIFIER` et le
type `Notifier`.

**6 — Écrire le double de test** : un tableau en mémoire suffit
(`FakeNotifier`, `InMemoryNotifier`). Puis vérifier la règle de dépendance : le port
n'importe rien d'externe, l'adaptateur importe le port et pas l'inverse.

### Ajouter un adaptateur à un port existant

C'est le cas Railway → Cloudflare, **déjà fait** : une seconde classe implémentant la même
interface, ajoutée au `switch` de la fabrique, et une variable d'environnement pour
choisir. Rien n'a bougé dans le domaine ni dans les cas d'usage.

Si vous devez **modifier le port** pour faire entrer le nouvel adaptateur, c'est le signal
que l'abstraction était mal dérivée — corrigez le port, ne tordez pas l'adaptateur.

---

## 7 · Ajouter une règle métier — la procédure

**1 — Passez l'arbre du §4.** Trois « oui » → domaine.

**2 — Trouvez le sous-domaine.** `menu` (carte, prix), `ordering` (commande, statuts,
remises), `supply` (coût, allergènes, stock), `tenancy` (restaurant, horaires, créneaux,
marque), `shared` (uniquement ce qui est cité par au moins deux sous-domaines).

**3 — Écrivez le test d'abord, avec les vrais chiffres du terrain.** Les jeux d'essai
existants sont les vraies données de Class'Food :

- `menu/fixtures.ts` — le tacos M/L/XL/XXL, ses quatre groupes, ses vrais prix
- `supply/tacos.fixture.ts` — la vraie recette (galette 0,45 € + frites 120 g + sauce
  40 ml + barquette = 1,02 €)
- `tenancy/classfood.fixture.ts` — les vrais horaires (7 j/7, midi sauf lundi et vendredi)

Un test dont on peut vérifier le total de tête contre l'ardoise du comptoir est un test
qui attrape les vrais bugs.

**4 — Choisissez `Result` ou exception.** C'est une décision, pas un réflexe :

| | `Result<T, E>` | exception (`invariant` / `InvariantViolation`) |
|---|---|---|
| **Quand** | l'échec est un cas **nominal** du métier | l'échec est un **bug de code** |
| **Exemple** | « le client a coché 2 viandes sur un tacos M » | « une commande livrée sans ligne » |
| **Qui le voit** | l'utilisateur, dans un message | la supervision, dans une alerte |

**5 — Nommez l'erreur et figez son code** (§5.2).

**6 — Vérifiez l'immuabilité.** Toute opération renvoie une **nouvelle** instance. Trois
surfaces temps réel partagent la même donnée en mémoire ; une mutation en place ferait
diverger celle qui n'a pas encore rafraîchi.

**7 — N'appelez jamais `Date.now()`.** Injectez une `Clock`. Les créneaux, les minuteurs
de cuisine et les services du soir dépendent tous de l'heure ; un test qui dépend de
l'horloge système est un test qui échouera un dimanche de changement d'heure.

---

## 8 · Comment tester chaque couche

### 8.1 · Domaine — c'est ici que se joue l'essentiel

**Outil** : `vitest`. **Emplacement** : à côté du fichier testé (`order.ts` →
`order.test.ts`). **Mocks** : aucun. **Horloge** : `FixedClock`.

```bash
pnpm --filter @sm/domain test          # 227 tests, ~800 ms
pnpm --filter @sm/domain test:watch
```

Ce qu'un bon test de domaine ressemble — on teste **la règle et sa raison**, pas la
plomberie :

```ts
it('un tacos XXL accepte deux fois la même viande', () => {
  // Cas courant du comptoir : « double kebab, steak, kefta ». Dédoublonner
  // servirait un XXL à deux viandes au prix de quatre.
  const config = validateSelection(tacos, 'XXL', [
    pick('viandes', 'kebab'), pick('viandes', 'kebab'),
    pick('viandes', 'steak'), pick('viandes', 'kefta'),
  ]);
  expect(config.ok).toBe(true);
});
```

Le commentaire n'est pas décoratif : il dit **pourquoi** la règle est ainsi, ce qu'aucun
nom de test ne peut porter. Quand quelqu'un voudra « corriger » ce comportement dans deux
ans, ce commentaire lui évitera de casser la caisse d'un samedi soir.

**Règle** : chaque erreur métier déclarée doit avoir au moins un test qui la déclenche et
vérifie son `code`. Une erreur sans test est une erreur que personne ne verra jamais.

### 8.2 · Application — orchestration, isolation, traduction

**Ce qu'on teste ici** : que le service charge les bonnes données, appelle le domaine,
persiste le résultat, publie l'événement, et traduit correctement une `DomainError` en
code HTTP. **Ce qu'on ne teste pas ici** : la règle métier elle-même — elle est déjà
couverte au §8.1, et la retester avec une base est lent et fragile.

Trois points à couvrir en priorité, parce qu'ils ne sont couverts nulle part ailleurs :

1. **L'isolation tenant** : une requête portant le JWT du tenant A ne doit jamais voir une
   donnée du tenant B. À tester sur chaque route de lecture.
2. **L'idempotence** : appeler deux fois `create` avec le même `clientId` renvoie la même
   commande et n'en crée pas deux.
3. **La traduction d'erreurs** : `ProductUnavailable` → 409, `OptionRuleViolated` → 400,
   `AuthorizationRequired` → 403.

**État réel** : `apps/api` a désormais `vitest` (`pnpm --filter @sm/api test`), mais un
seul fichier de test — `infrastructure/domains/railway-domain-registrar.test.ts`. Aucun
cas d'usage, aucun service, aucune route n'est couvert. C'est le manque le plus important
du dépôt.

Ce qu'il faut ajouter, dans cet ordre de rentabilité :

1. **Les cas d'usage de `modules/site/`** — ils sont déjà testables tels quels : leurs
   dépendances sont des ports (`DomainRegistrar`), une `Clock` injectée et un repository.
   Un `FakeDomainRegistrar` de vingt lignes couvre les quatre états du cycle de vie, `check`
   compris, sans réseau.
2. **Les trois points ci-dessus** (isolation, idempotence, traduction d'erreurs) sur
   `OrdersService`, avec un MongoDB éphémère (`mongodb-memory-server`).
3. **Les chemins supply transactionnels**, avec un PostgreSQL de conteneur.

### 8.3 · Infrastructure — contre le vrai moteur, ou pas du tout

Un test de repository contre un mock de Mongoose ne prouve rien : il vérifie que vous avez
appelé la méthode que vous venez d'écrire. Soit on teste contre un vrai moteur éphémère,
soit on ne teste pas cette couche et on met l'effort sur §8.2.

Ce qui mérite un test dédié :

- les **migrations Drizzle** (`packages/supply/drizzle/`), qu'on applique sur une base
  vierge pour vérifier qu'elles passent ;
- les **encodeurs purs** comme `escpos.ts` : `sanitize()` et la mise en page à 32/42/48
  colonnes sont des fonctions totales, testables sans imprimante — un accent mal
  translittéré décale toutes les colonnes du ticket ;
- les **index d'unicité** dont dépend une règle : `{tenantId, clientId}` sur `orders`
  porte l'idempotence, et une migration qui le supprimerait doit faire échouer un test.

### 8.4 · Interfaces — les gardes et le contrat

- **HTTP** : une route sans `@Public()` doit répondre 401 sans jeton. Une route
  `@Roles('gerant')` doit répondre 403 pour un rôle `caisse`. Un corps invalide doit
  répondre 400 avec les `issues` zod. Ces trois tests couvrent la quasi-totalité des
  régressions de sécurité.
- **Offline** — le plus important côté client : `SyncQueue` se teste avec un `Sender`
  factice et le `MemoryStore`, sans réseau ni React. Scénarios à couvrir :

  | Scénario | Attendu |
  |---|---|
  | envoi puis coupure réseau | l'entrée reste en file |
  | rejeu après retour du réseau | l'entrée part, la file se vide |
  | refus 4xx métier | l'entrée est retirée, la file n'est pas bloquée |
  | échec sur un sujet | les mutations suivantes **du même sujet** attendent, les autres passent |
  | fichier de file corrompu | on repart à vide, on ne plante pas |

- **Front** : pas de test unitaire de composant pour l'instant. L'effort va d'abord aux
  quatre points ci-dessus.

---

## 9 · Les pièges de ce dépôt

Un document d'onboarding qui décrit un système idéal fait perdre plus de temps qu'il n'en
fait gagner. Voici ce qui va vous surprendre.

### 9.1 · Le domaine n'est branché qu'à moitié

`apps/api` dépend bien de `@sm/domain`, et `modules/site/` le consomme de bout en bout.
Mais les modules antérieurs — `orders`, `menu`, `supply`, `ordering` — n'ont pas basculé.

**Le prix affiché au comptoir sort de `apps/api/src/modules/orders/orders.service.ts`, pas
de `domain/menu/rules.ts`.**

C'est une adoption incrémentale assumée, dont l'ordre de bascule et les raisons sont dans
l'[ADR 0001 §5](./adr/0001-architecture-hexagonale-et-ddd.md). **Conséquences pratiques** :

- si vous corrigez une règle de prix, vérifiez les **trois** emplacements
  (`orders.service.ts`, `client-core/src/pricing.ts`, `domain/menu/rules.ts`) — et
  profitez-en pour supprimer une des trois copies ;
- **certains ports ont un adaptateur enregistré que personne n'utilise encore.**
  `EVENT_PUBLISHER` est injectable, mais `orders`, `menu` et `supply` appellent toujours
  `redis.publish(...)` en direct. Si vous touchez à l'un de ces trois services, faites la
  bascule : c'est quelques lignes et ça retire une duplication.

### 9.2 · Deux `OptionGroup` et deux `OptionChoice`, qui ne sont pas la même chose

| Classe | Fichier | Ce qu'elle décrit |
|---|---|---|
| `OptionChoice` / `OptionGroup` | `domain/menu/option-choice.ts`, `option-group.ts` | ce que le **client** peut cocher, et ce que ça **coûte au client** (`priceDelta`, bornes, dérogations par variante) |
| `OptionChoice` / `OptionGroup` | `domain/supply/recipe.ts` | ce que le choix **consomme en matière première**, et ce que ça **coûte au restaurant** |

Même nom, deux contextes bornés distincts. C'est légitime en DDD, mais concrètement :
`packages/domain/src/index.ts` n'exporte aujourd'hui qu'un sous-ensemble
(`shared/*`, `tenancy/public-domain`, `ports/*`), et **ajouter naïvement
`export * from './menu'` puis `export * from './supply'` produirait une collision de
noms**.

**Procédure pour exposer un sous-domaine** :

```ts
// packages/domain/src/index.ts — export par espace de noms
export * as Menu from './menu';
export * as Supply from './supply';
// à l'usage : Menu.OptionGroup vs Supply.OptionGroup — plus d'ambiguïté
```

Alternative si la lecture y perd : renommer les classes de `supply` en
`RecipeOptionGroup` / `RecipeOptionChoice`. À trancher au premier besoin réel, pas avant.

### 9.3 · Deux modules se partagent la commande, et leurs noms se ressemblent

- `modules/orders/` — **création** de commande, statuts, annulation, remise, WebSocket.
- `modules/ordering/` — ce qui **entoure** la commande en ligne : créneaux de retrait,
  paiement Stripe, ticket JSON, encodage ESC/POS, agrégat de page publique.

La création de commande en ligne (`POST /public/tenants/:slug/orders`) vit dans
`OrdersController`, pas dans `OrderingController` — l'en-tête de ce dernier le signale.
Cherchez dans les deux avant de conclure qu'une route n'existe pas.

### 9.4 · Deux `CalendarDay`, deux calculs de fuseau

- `domain/tenancy/wall-clock.ts` — classe `CalendarDay` complète (validation, `plusDays`,
  `weekday`, conversion heure murale ↔ instant en deux passes pour absorber le changement
  d'heure).
- `api/modules/ordering/paris-time.ts` — interface `{ y, m, d }` et fonctions équivalentes.

Les deux résolvent le même problème. Le second disparaîtra quand `SlotsService` consommera
le domaine.

### 9.5 · Trois tables de rang de statut, qui ne classent pas `cancelled` pareil

`domain/ordering/order-status.ts` (`PROGRESS` + `mostAdvanced`),
`contracts/src/index.ts` (`ORDER_STATUS_RANK`) et `client-core/src/types.ts`
(`STATUS_RANK`). Détail et conséquence dans
l'[ADR 0003 §4.2](./adr/0003-offline-first-et-idempotence.md) — dont une divergence
d'affichage réelle côté client.

### 9.6 · Deux chemins d'import pour les ports

`packages/domain/src/index.ts` n'exporte que `ports/domain-registrar`. Les cinq autres
ports ne sont accessibles que par le chemin profond `@sm/domain/src/ports`. D'où deux
styles qui cohabitent dans le code :

```ts
import type { DomainRegistrar } from '@sm/domain';            // modules/site/*.usecase.ts
import type { PaymentGateway } from '@sm/domain/src/ports';   // infrastructure/payments/*
```

Le second traverse la frontière du paquet et contourne son `main`. À unifier — le plus
simple étant d'ajouter `export type * from './ports';` dans l'index racine, en vérifiant
d'abord les collisions du §9.2.

### 9.7 · `SiteService.publicMenu` duplique `MenuService.publicMenu`

Le commentaire du code le signale : `MenuService` n'est pas exporté par `MenuModule`, donc
la requête a été recopiée. La bonne correction est d'exporter le service, pas de garder
deux requêtes.

---

## 10 · Checklist de revue de code

À dérouler avant d'approuver une pull request. Les trois premières lignes sont
bloquantes.

- [ ] **Aucune règle métier existante n'a été recopiée.** Si elle est dans
      `packages/domain`, on l'appelle.
- [ ] **Le `tenantId` vient du JWT** (`@TenantId()`), jamais du corps ni de l'URL.
- [ ] **Les montants sont en centimes entiers**, sur toute la chaîne.
- [ ] `packages/domain` n'a acquis aucune dépendance externe, aucun `Date.now()`, aucun
      `import` de NestJS/Mongoose/React.
- [ ] **Aucun port n'est contourné.** Si un adaptateur est enregistré sous un jeton
      (`EVENT_PUBLISHER`, `PAYMENT_GATEWAY`, `DOMAIN_REGISTRAR`…), on l'injecte — on
      n'appelle pas la technologie en direct.
- [ ] Aucun module applicatif ne nomme une classe d'adaptateur concrète
      (`RedisEventPublisher`, `StripePaymentGateway`…) : seulement le jeton et le type.
- [ ] Toute nouvelle route de mutation appelée depuis le POS ou le KDS est **idempotente**.
- [ ] Toute route est authentifiée, ou explicitement `@Public()` avec une raison en
      commentaire.
- [ ] Toute action sensible (annulation, remise, remboursement, changement de prix)
      vérifie le PIN et écrit dans `auditLog`.
- [ ] Les nouvelles erreurs métier étendent `DomainError`, ont un `code` figé et un
      message lisible **en français par un restaurateur**.
- [ ] Les objets de domaine créés sont immuables (`withXxx`, pas de mutation en place).
- [ ] Une opération qui écrit dans les deux bases est ordonnée, idempotente et
      recalculable ([ADR 0002 §4.1](./adr/0002-persistance-polyglotte.md)).
- [ ] `pnpm typecheck` et `pnpm --filter @sm/domain test` passent.

---

## 11 · Commandes utiles

```bash
pnpm install

# Bases
pnpm --filter @sm/supply migrate        # schéma PostgreSQL
pnpm seed                               # carte Class'Food (22 catégories, 109 produits)
pnpm --filter @sm/supply seed           # ingrédients, recettes, fournisseurs
pnpm --filter @sm/db seed:orders        # 30 jours d'historique

# Développement
pnpm --filter @sm/api dev               # API sur :3001
pnpm --filter @sm/web dev               # Next.js sur :3000  (back-office /admin)
pnpm --filter @sm/pos dev               # Expo web sur :8082
pnpm --filter @sm/contracts dev         # tsc --watch : indispensable si vous touchez aux contrats

# Vérifications
pnpm --filter @sm/domain test           # le test qui doit toujours passer
pnpm --filter @sm/api test              # vitest côté API
pnpm typecheck                          # tout le monorepo
pnpm build                              # requis avant de démarrer l'API (cf. §3.1)

# Migration supply
pnpm --filter @sm/supply generate       # produit le SQL — À RELIRE avant de committer
pnpm --filter @sm/supply migrate
```

---

## 12 · Les règles maison, pour finir

Elles ne sont pas décoratives, elles viennent du terrain :

- **La fiabilité du vendredi soir passe avant tout le reste.** Une fonctionnalité qui
  fragilise le service ne se livre pas, quelle que soit sa valeur perçue.
- **Jamais de déploiement du jeudi au dimanche.** Les restaurants vivent le week-end.
- **Couleurs fonctionnelles fixes** : vert = prêt, rouge = urgent, ambre = en préparation,
  chez tous les clients. Seule la couleur d'accent appartient au restaurateur. La règle
  est codée dans `domain/tenancy/brand-theme.ts`, pas dans une feuille de style.
- **« Sans engagement veut dire sans otage »** : l'export CSV complet des données du
  restaurant est une fonctionnalité de premier ordre, pas une case à cocher RGPD.

---

## Pour aller plus loin

| Document | Contenu |
|---|---|
| [`packages/domain/README.md`](../packages/domain/README.md) | La règle unique du domaine, ses conventions, son organisation |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | Infrastructure : Railway, schémas MongoDB, temps réel, contraintes légales |
| [`docs/adr/0001`](./adr/0001-architecture-hexagonale-et-ddd.md) | Pourquoi l'hexagone ici et pas là-bas |
| [`docs/adr/0002`](./adr/0002-persistance-polyglotte.md) | MongoDB / PostgreSQL : critères et conséquences |
| [`docs/adr/0003`](./adr/0003-offline-first-et-idempotence.md) | La file, le `clientId`, la réconciliation |
| [`docs/adr/0004`](./adr/0004-fournisseur-de-domaines-interchangeable.md) | Le port `DomainRegistrar` et le seuil de bascule |
| [`docs/specs/`](./specs/) | Spécifications UI par surface |
