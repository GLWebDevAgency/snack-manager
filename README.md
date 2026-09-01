# Snack Manager

Suite SaaS multi-tenant (marque grise) pour fast-foods indépendants : caisse (POS), écran cuisine (KDS), commande en ligne, back-offices, site vitrine. Pilote : **Class'Food** (Perriers-sur-Andelle).

Architecture complète : [ARCHITECTURE.md](ARCHITECTURE.md) · Specs UI par surface : [docs/specs/](docs/specs/) · Handoff design : [design_handoff_snack_manager/](design_handoff_snack_manager/)

## Monorepo

| Espace | Contenu |
|---|---|
| `apps/api` | API NestJS — REST + WebSocket, MongoDB (Mongoose), PostgreSQL (Drizzle), Redis pub/sub, audit NF525 |
| `apps/web` | Next.js 16 App Router — back-office resto (`/admin`), puis commande en ligne, CRM, vitrine |
| `packages/contracts` | Schémas zod partagés (DTO, énumérations, événements WS) |
| `packages/db` | Modèles Mongoose — contexte **commerce** + seeds (carte Class'Food, historique de commandes) |
| `packages/supply` | Schéma Drizzle — contexte **supply** (ingrédients, allergènes, recettes, fournisseurs, stocks) |
| `packages/loyalty` | Schéma Drizzle — contexte **fidélité** (programmes, membres, consentements, portefeuille et ledger append-only) |

## Persistance polyglotte

| Contexte | Moteur | Pourquoi |
|---|---|---|
| Commerce (menus, commandes, équipe, avis) | **MongoDB** | documents flexibles (chaque resto a sa carte), écriture offline idempotente |
| Supply (ingrédients, recettes, fournisseurs, factures) | **PostgreSQL** | relationnel profond, intégrité référentielle, historiques financiers |
| Fidélité (membres, consentements, points/tampons, récompenses) | **PostgreSQL** | transactions atomiques, idempotence, isolation multi-tenant et audit append-only |

Ponts : cascade de rupture ingrédient → produits · coût matière & marge par produit/variante · rollup d'allergènes (INCO UE 1169/2011).

## Infra — tout sur Railway (projet `snack-manager`)

- **MongoDB 8** + **PostgreSQL** + **Redis** (région UE `europe-west4`), accès local via proxys TCP (voir `.env`)
- **api** : https://api-production-8949.up.railway.app (healthcheck `/health`)
- **web** : https://web-production-99b58c.up.railway.app
- Variables : `MONGO_URL` / `DATABASE_URL` / `REDIS_URL` référencent les services internes, `JWT_SECRET` propre à la prod

## Démarrage

Prérequis : **Node.js 24.3 ou supérieur**. La version de référence du dépôt
est fixée dans `.nvmrc` et `.node-version` ; pnpm suit la version déclarée par
`packageManager`.

```bash
pnpm install
cp .env.example .env              # URLs des bases (railway variables) + JWT_SECRET
pnpm migrate:postgres             # schémas PostgreSQL supply + fidélité
pnpm seed                         # carte Class'Food (22 catégories, 109 produits)
pnpm --filter @sm/supply seed     # ingrédients, recettes, fournisseurs
pnpm --filter @sm/db seed:orders  # 30 jours d'historique de commandes
pnpm --filter @sm/api dev
pnpm --filter @sm/web dev
```

Back-office : http://localhost:3000/admin — comptes de dev affichés en fin de seed.

## Règles maison

- **Fiabilité du vendredi soir avant tout** : POS/KDS offline-first, commande jamais perdue (idempotence `clientId`).
- Prix **toujours en centimes**, résolus côté serveur.
- `tenantId` vient du JWT, jamais du body.
- Couleurs fonctionnelles fixes : vert = prêt, rouge = alerte, orange = prépa. Seul l'accent de marque change par tenant.
- Jamais de déploiement jeudi → dimanche.
- NF525 : actions sensibles (annulation, remise) signées PIN + journal `auditLog` append-only.
