# Snack Manager

Suite SaaS multi-tenant (marque grise) pour fast-foods indépendants : caisse (POS), écran cuisine (KDS), commande en ligne, back-offices, site vitrine. Pilote : **Class'Food** (Perriers-sur-Andelle).

Architecture complète : [ARCHITECTURE.md](ARCHITECTURE.md) · Specs UI par surface : [docs/specs/](docs/specs/) · Handoff design : [design_handoff_snack_manager/](design_handoff_snack_manager/)

## Monorepo

| Espace | Contenu |
|---|---|
| `apps/api` | API NestJS — REST + WebSocket, MongoDB (Mongoose), Redis pub/sub, audit NF525 |
| `apps/web` | Next.js 16 App Router — back-office resto (`/admin`), puis commande en ligne, CRM, vitrine |
| `packages/contracts` | Schémas zod partagés (DTO, énumérations, événements WS) |
| `packages/db` | Modèles Mongoose + seed Class'Food (`pnpm seed`) |

## Infra — tout sur Railway (projet `snack-manager`)

- **MongoDB 8** + **Redis** (région UE `europe-west4`), accès local via proxy TCP (voir `.env`)
- **api** : https://api-production-8949.up.railway.app (healthcheck `/health`)
- Variables : `MONGO_URL` / `REDIS_URL` référencent les services internes, `JWT_SECRET` propre à la prod

## Démarrage

```bash
pnpm install
cp .env.example .env   # renseigner les URLs (railway variables) + JWT_SECRET
pnpm seed              # recharge la carte Class'Food (22 catégories, 109 produits)
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
