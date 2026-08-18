# Snack Manager — Architecture technique

> Proposition validable — schéma MongoDB + architecture des repos, exigée par le MASTER-PROMPT avant tout code.
> Décisions d'hébergement : **tout le back-end (API + bases de données) est hébergé sur Railway** (directive fondateur du 2026-08-18). Le front Next.js est aussi déployé sur Railway pour unifier l'infra.

## 1 · Vue d'ensemble

```
                    ┌─────────────────────────── Railway (projet snack-manager) ───────────────────────────┐
                    │                                                                                      │
  POS (Expo) ──────►│  ┌──────────────┐   pub/sub   ┌─────────┐        ┌─────────────┐   ┌─────────────┐  │
  KDS (Expo) ──────►│  │  apps/api    │◄───────────►│  Redis  │        │   MongoDB   │   │  apps/web   │  │
  Web client ──────►│  │  NestJS      │             └─────────┘        └─────────────┘   │  Next.js 15 │  │
  Back-offices ────►│  │  REST + WS   │◄────────────────────────────────────────────────►│  App Router │  │
                    │  └──────────────┘                    Mongoose                      └─────────────┘  │
                    └──────────────────────────────────────────────────────────────────────────────────────┘
                                       Stripe (Payment Intents + Billing) · T2/T3
```

- Chaque commande créée (POS, en ligne, téléphone) → `POST /orders` → événement `order.created` publié sur Redis → gateway WebSocket → KDS abonné par `tenantId`. Latence cible < 2 s.
- POS/KDS **offline-first** : file locale de mutations, resync idempotent (voir §6). Contrainte n°1 du projet : un service du vendredi soir complet sans internet, zéro commande perdue.

## 2 · Choix backend : NestJS (plutôt que tRPC)

| Critère | Pourquoi NestJS l'emporte |
|---|---|
| 3 clients hétérogènes (web Next.js, POS Expo, KDS Expo) | REST explicite + contrats zod partagés (`packages/contracts`) ; pas de couplage client/serveur tRPC |
| Offline-first | Une file de requêtes HTTP idempotentes (clé `clientId`) se rejoue trivialement ; un client tRPC offline est bien plus fragile |
| Temps réel | `@nestjs/websockets` (socket.io) + adapter Redis natif, rooms par tenant |
| Traçabilité / NF525 | Guards + interceptors : tenant-scoping, vérification PIN et journal d'audit transverses |
| Évolutions T2-T4 | File asynchrone (BullMQ sur le même Redis) pour l'import de carte IA, webhooks Stripe, impression |

La sécurité de types de bout en bout est conservée : tous les DTO et événements sont des schémas **zod** dans `packages/contracts`, consommés par l'API (validation runtime) et par les 3 fronts (types inférés).

## 3 · Monorepo (pnpm workspaces + Turborepo)

```
SnackManager/
├─ apps/
│  ├─ api/            NestJS 11 — REST + WebSocket, Mongoose, Redis, audit log
│  ├─ web/            Next.js 15 App Router — vitrine (/), commande en ligne (/r/[slug]),
│  │                  back-office resto (/admin), CRM SM (/sm)
│  ├─ pos/            Expo — caisse tactile (T1 ③)
│  └─ kds/            Expo — écran cuisine (T1 ④)
├─ packages/
│  ├─ contracts/      schémas zod : DTO API, événements WS, énumérations (statuts, canaux)
│  ├─ db/             modèles Mongoose + seed Class'Food (depuis menu-data.js)
│  └─ config/         tsconfig / eslint partagés
├─ docs/specs/        specs UI extraites des maquettes (générées, une par surface)
├─ design_handoff_snack_manager/   référence design (dans le repo)
└─ Menu Trivolet Redesign (1)/     export design complet (hors git — assets lourds)
```

Un seul déployable web : la vitrine, la commande en ligne et les deux back-offices partagent le design system et vivent dans `apps/web` (route groups). Les apps Expo arrivent aux étapes ③/④ du T1.

## 4 · Schéma MongoDB

Conventions : **`tenantId` sur chaque document** (index composé en tête), **prix en centimes (int)**, horodatages `createdAt`/`updatedAt` automatiques, `_id` ObjectId.

### `tenants`
```js
{
  slug: 'classfood',                    // unique, utilisé dans l'URL de commande
  name: "CLASS'FOOD",
  logoUrl, brandColor: '#c9a15a',       // marque grise : seul l'accent change
  address, phones: [String],
  hours: [{ day: 0-6, lunch: {open:'11:30', close:'14:30'} | null,
            dinner: {open:'18:00', close:'22:30'} | null }],
  closures: [{ from: Date, to: Date, reason }],
  plan: 'essentiel' | 'complet' | 'boost',
  founderSeat: Boolean,                 // offre fondateur (10 places, tarif gelé)
  settings: {
    slotIntervalMin: 10, slotCapacity: 4,        // créneaux click & collect
    onlineOrderingPaused: false, pauseMessage,   // pause « victime de notre succès »
    printTicketOn: 'accept', printStickerOn: 'ready',  // proposition brief, réglable
  },
  stripe: { customerId, subscriptionId },        // Billing T3
}
```

### `users` — comptes de connexion (email + mot de passe)
```js
{ email (unique), passwordHash (argon2), role: 'owner' | 'sm_admin',
  tenantId | null /* null = équipe Snack Manager */ }
```

### `staff` — équipe du resto, connexion par PIN (POS/KDS/pointage)
```js
{ tenantId, name, role: 'gerant' | 'caisse' | 'cuisine',
  pinHash, active: true }
// index unique { tenantId, pinHash } — le PIN identifie la personne sur la tablette
```

### `shifts` — pointages (module RH)
```js
{ tenantId, staffId, clockIn: Date, clockOut: Date | null, source: 'kds' | 'backoffice' }
```

### `categories`
```js
{ tenantId, name, order: Number /* drag & drop */, active: true }
// suppression protégée : refusée côté API si products.count({categoryId}) > 0 sans confirmation
```

### `products` — le cœur flexible (justification MongoDB)
```js
{
  tenantId, categoryId, name, description,      // description = liste d'ingrédients affichée
  price: 950,                                   // centimes ; ignoré si variants non vide
  variants: [{ key:'M', name:'M — 1 viande', price: 890 }],   // tacos M/L/XL/XXL, H1-H4…
  optionGroups: [{                              // sauces, viandes, suppléments
    key:'viandes', name:'Viandes', type:'multi', min:1, max:3,
    choices: [{ key:'kebab', name:'Kebab', priceDelta: 0 }],
    perVariant: { M:{min:1,max:1}, L:{min:2,max:2} },   // nb viandes lié à la taille
  }],
  removables: ['tomates','oignons','crudités'], // modificateurs express ST / SO
  tags: ['nouveau','mega-burger'], isNew: Boolean,
  outOfStock: false,                            // rupture 1-tap
  photoUrl, order, active,
}
```

### `orders`
```js
{
  tenantId,
  number: 42,                                   // séquence par jour et par tenant (collection counters)
  clientId: 'uuid-appareil',                    // clé d'idempotence offline — index unique {tenantId, clientId}
  channel: 'online' | 'pos' | 'phone',
  type: 'surplace' | 'emporter' | 'pickup',
  lines: [{
    productId, name,                            // dénormalisé : le ticket survit aux edits du menu
    variantKey, variantName,
    options: [{ groupKey, choiceKey, name, priceDelta }],
    removed: ['tomates'], note, qty, unitPrice, lineTotal,
  }],
  totals: { subtotal, discount: { amount, reason, staffId } | null, total },
  payment: { method: 'online' | 'counter', status: 'pending' | 'paid' | 'refunded',
             stripePaymentIntentId },
  status: 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled',
  statusHistory: [{ status, at: Date, by: staffId | 'system' }],   // ← minuteurs KDS
  pickup: { slot: Date, customerName, customerPhone } | null,      // en ligne + téléphone
  virtualBrandId: null,                         // marques virtuelles T4 — prévu, pas construit
}
// index : {tenantId, createdAt}, {tenantId, status}, unique {tenantId, clientId}
```

### `counters` — numéros de commande journaliers
```js
{ _id: '<tenantId>:<yyyymmdd>', seq: Number }   // findOneAndUpdate $inc atomique
```

### `auditLog` — traçabilité (socle NF525)
```js
{ tenantId, staffId, action: 'order.cancel' | 'order.discount' | 'order.refund' | 'price.change' | …,
  targetId, meta, pinVerifiedAt: Date, at: Date }
// append-only ; l'API refuse toute action sensible sans PIN re-validé
```

### `leads` — CRM Snack Manager (T3, modèle posé dès maintenant)
```js
{ restaurantName, contact: { name, phone, email },
  stage: 'nouveau' | 'contacté' | 'démo' | 'proposition' | 'signé' | 'perdu',
  sequence: 'A' | 'B' | 'C', touches: [{ at, type, note }],
  founderSeatReserved: Boolean, notes }
```

Prévu (collections T2+, non créées en T1) : `menuImports` (pipeline IA photo→carte), `reviews`, `promotions`, `subscriptions`.

## 5 · Auth multi-tenant

- **Gérant / équipe SM** : email + mot de passe → JWT `{ sub, tenantId, role }` (httpOnly cookie côté web).
- **POS / KDS** : la tablette est appairée au tenant (token d'appareil émis au setup), puis chaque personne se connecte par **PIN** → session staff `{ staffId, role }`. Le PIN est re-demandé pour toute action sensible (annulation, remise, remboursement) → écrit `auditLog`.
- Guards NestJS : toute route est tenant-scoped par défaut (le `tenantId` vient du JWT, jamais du body). Rôle `sm_admin` seul à voir cross-tenant (CRM).

## 6 · Offline-first POS/KDS (contrainte n°1)

1. Chaque mutation (création de commande, changement de statut) est écrite d'abord dans une file locale (SQLite/AsyncStorage) avec un `clientId` UUID.
2. Un worker rejoue la file vers l'API dès que le réseau revient ; `POST /orders` est un upsert sur `{tenantId, clientId}` → le rejeu est idempotent, jamais de doublon.
3. Le KDS garde son état local et réconcilie sur les événements WS (`order.created`, `order.updated`) ; en cas de conflit de statut, le plus avancé gagne (new < preparing < ready < delivered).
4. L'impression (ESC/POS) est locale à la tablette POS → fonctionne sans internet.

## 7 · Temps réel

- Canal Redis `tenant:{id}:orders` ; l'API publie `order.created` / `order.updated` / `menu.updated`.
- Gateway socket.io (adapter Redis) : rooms par `tenantId` ; le KDS et le back-office (commandes live) s'y abonnent.
- Repli SSE pour le suivi client en ligne (page de statut sans compte).

## 8 · Topologie Railway

| Service Railway | Contenu | Notes |
|---|---|---|
| `MongoDB` | base principale | plugin Railway, volume persistant |
| `Redis` | pub/sub + BullMQ (T2) | plugin Railway |
| `api` | `apps/api` NestJS | `MONGO_URL=${{MongoDB.MONGO_URL}}`, `REDIS_URL=${{Redis.REDIS_URL}}`, healthcheck `/health` |
| `web` | `apps/web` Next.js | `API_URL` interne Railway (réseau privé), domaine public |

Jamais de déploiement jeudi→dimanche (règle maison — les restos vivent le week-end).

## 9 · Contraintes légales

- **NF525 / loi anti-fraude TVA** : bloquant avant le premier client facturé qui encaisse via la caisse. Le socle est posé dès T1 (`auditLog` append-only, `statusHistory`, numérotation séquentielle) ; la certification/attestation elle-même est un chantier dédié avant mise en production de l'encaissement.
- **RGPD** : hébergement Railway région UE (`europe-west4`), minimisation (commande en ligne sans compte), export CSV complet par le gérant (« sans engagement veut dire sans otage »).
