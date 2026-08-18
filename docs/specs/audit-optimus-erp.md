# Audit — Optimus SILA (optimus-halal-supply-chain-erp)

> Audit en lecture seule de `/Users/limameghassene/development/optimus-halal-supply-chain-erp`
> réalisé pour Snack Manager. Objectif : identifier ce qui est réutilisable (code, schémas,
> données, idées de domaine) dans notre monolithe modulaire NestJS + Next.js
> (MongoDB « commerce » + PostgreSQL/Drizzle « supply », schéma `packages/supply/src/schema.ts`).

---

## 0. Synthèse exécutive

Optimus SILA est un ERP supply-chain halal en **15 microservices Rust (tonic/gRPC + sqlx/PostgreSQL)**,
un **API gateway Fastify/TypeScript**, deux fronts **React 19 + Vite** (admin, client/marketplace)
et une app mobile React Native. Ambition très large (blockchain, IoT, IA, OPA, Factur-X, marketplace
de modules à la Stripe), avancement réel inégal : les **schémas SQL sont la partie la plus aboutie et
la plus précieuse** (~3 500 lignes de migrations soignées), le code Rust est volumineux mais
partiellement branché (l'API gateway n'était pas connecté aux services gRPC — cf. `CRITICAL_FIXES.md` P0),
et seuls 4 services sur 14 étaient déclarés fonctionnels (`STATUS.md`).

**Ce qu'on en retire pour Snack Manager :**

1. **Le modèle de conformité halal du compliance-service** (organismes certificateurs avec niveaux de
   confiance A+/A/B/C, certificats avec validité, annuaire d'entités certifiées AVS/ACHAHADA) —
   à transposer en Drizzle quasi tel quel.
2. **Les jeux de données réels dans `asset/`** : 212 entités certifiées scrapées (52 abattoirs AVS,
   119 fournisseurs AVS, 23 restaurants AVS, 9 boucheries + 9 marques ACHAHADA) et
   `certification-list.json` (13 organismes avec leurs critères : électronarcose, abattage mécanique,
   contrôleurs salariés…). **Réutilisables immédiatement comme données de seed.**
3. **Le modèle lots/DLC + réception** (inventory-service `batches`, workflow « inventory_receiving »,
   `fulfillment_items` avec lot/DLC) — bonne base conceptuelle, à re-modéliser proprement chez nous.
4. **Le schéma e-invoicing Factur-X 2026** — référence de très bonne qualité pour la future
   conformité facturation électronique française (statuts, profils, PDP/PPF, cycle de vie).
5. Le reste (workflows temps réel, blockchain, IoT, routes/véhicules, marketplace de modules,
   app mobile grand public) est **hors périmètre Snack Manager** : à écarter.

---

## 1. Inventaire des services et applications

Stack commune backend : Rust 2021, tonic 0.14 (gRPC), sqlx 0.8 (PostgreSQL), Redis, RabbitMQ/Kafka,
OpenTelemetry, RLS multi-tenant (`tenant_id UUID` + politique `app.current_tenant`). Une base
PostgreSQL par service, migrations SQL versionnées.

| Service | Rôle | Volume (src) | État / qualité | Intérêt SM |
|---|---|---|---|---|
| **compliance-service** | Cœur halal : certificats, organismes, annuaire d'entités certifiées, chaîne de possession, alertes de conformité, validation halal des factures | 22 fichiers, ~10 900 l. | Déclaré fonctionnel. Migrations excellentes ; `invoice_halal_validator.rs` (813 l.) bien conçu (niveaux de confiance, buffer d'expiration 30 j, traçabilité par lot) | ★★★ le joyau du projet |
| **inventory-service** | Produits, stocks par site, **lots avec DLC**, mouvements (avant/après), alertes (low stock, expiry), inventaires tournants + colonnes halal produit | 20 fichiers, ~4 000 l. | Schéma propre et simple ; 3 migrations halal soignées (enum 30+ organismes) | ★★★ |
| **supplychain-service** | Deux choses très différentes : (a) moteur de **workflows collaboratifs** (étapes, participants, sync offline, SLA) dont un template « inventory_receiving », (b) logistique : entrepôts, expéditions, relevés de température, routes/véhicules, transporteurs + **table suppliers très complète** | 23 fichiers, ~7 200 l. | Sur-ingénierie assumée (sync offline, GPS, IoT) ; la table `suppliers` (halal + SIRET + performance) est la meilleure partie | ★★ (table suppliers, idées réception) |
| **einvoicing-service** | Facturation électronique France 2026 : Factur-X/UBL/CII, profils, connexions PDP (Chorus Pro…), soumissions avec retry, événements de cycle de vie PPF, archivage légal | 42 fichiers, ~14 700 l. | Le service le plus gros et le plus sérieux ; schéma conforme EN 16931 (catégories TVA, codes unité UN/ECE) | ★★★ (référence 2026) |
| **document-service** | GED : dossiers, documents S3, versions, partages, **OCR (colonnes `ocr_text`, `ocr_confidence`, endpoint Tesseract configurable)**, templates PDF, signatures électroniques, archivage légal/retention/legal holds | 17 fichiers, ~7 200 l. | Schéma complet ; l'OCR est une intégration externe configurée, pas implémentée en dur | ★★ (champs OCR + intégrité SHA-256) |
| **order-service** | Commandes achat/vente/transfert, lignes, paiements, historique de suivi, **fulfillments (picking/packing avec lot/DLC/certificat halal par ligne)**, paniers B2B, commandes fournisseurs | 22 fichiers, ~7 600 l. | Schéma riche ; montants en cents (BIGINT) — même philosophie que nous | ★★ |
| **marketplace-service** | Deux volets : (a) place de marché B2B halal (catégories, marques, produits avec statut de certification halal, avis avec note halal), (b) marketplace de **modules SaaS** à activer par tenant (abonnements Stripe) | 22 fichiers, ~5 900 l. | Correct ; volet modules = notre logique de plans/features, déjà couverte côté SM | ★ / idées |
| **auth-service** | JWT + refresh, MFA, RBAC/ABAC (OPA), audit | 32 fichiers, ~9 200 l. | Fonctionnel ; redondant avec notre auth NestJS | ✗ |
| **tenant-service** | Multi-tenancy, sites, paramètres | 21 fichiers, ~6 400 l. | Fonctionnel ; couvert par notre modèle tenant Mongo | ✗ |
| **user-service** | Profils, préférences | 21 fichiers, ~6 500 l. | Redondant | ✗ |
| **notification-service** | Emails, push, in-app | 20 fichiers, ~5 200 l. | Générique | ✗ |
| **analytics-service** | Dashboards, rapports | 25 fichiers, ~7 200 l. | Déclaré fonctionnel ; couplé à leur modèle | ✗ |
| **integration-service** | API keys, webhooks, rate limits | 20 fichiers, ~8 200 l. | Générique | ✗ |
| **ai-orchestrator-service** | Orchestration Gemini/DeepSeek (analyse de certificats, prévision de demande) | 20 fichiers, ~5 000 l. | Surtout des promesses ; l'idée « analyse IA de certificat » est bonne (cf. §2.1 `ai_analysis`, `extracted_fields`) | idée |
| **mobile-service** | BFF de l'app mobile **grand public** (scan produits, favoris, fidélité, magic link, paniers) | 60 fichiers, ~27 700 l. | Gros mais hors sujet pour un SaaS restaurateurs | ✗ |

**Applications** : `apps/api-gateway` (Fastify + TS, REST→gRPC, non branché à l'époque de l'audit interne),
`apps/web-admin` et `apps/web-client` (React 19 + Vite + Tailwind), `apps/mobile` (React Native).
**Assets** : `asset/*.json` — données certifiées réelles (voir §2.1), **la partie la plus immédiatement monétisable de tout le repo**.

Qualité générale : conventions homogènes (UUID PK, `tenant_id`, triggers `updated_at`, index partiels,
RLS), commentaires sérieux, mais beaucoup de migrations « schema_alignment » tardives qui trahissent un
développement modèle-d'abord/code-ensuite, quasi aucun test (`tests_disabled/` dans einvoicing), et une
infra (14 Dockerfiles, Railway, docker-compose « enterprise ») disproportionnée pour l'avancement réel.

---

## 2. Modèles de domaine qui nous manquent (détail des champs)

### 2.1 Traçabilité halal (compliance-service) — CE QUI NOUS MANQUE LE PLUS

**a) `certification_authorities` — les organismes certificateurs** (avec seed de 13 organismes) :

- `id` (slug : `avs`, `achahada`, `hmc`, `jakim`…), `name`, `full_name`, `country`, `website`, `logo_url`
- **`trust_level`** enum `a_plus | a | b | c | rejected` — cœur du système : A+ = interdit
  strictement l'électronarcose (AVS, ACHAHADA, AL-TAKWA, HMC, JAKIM, MUIS, IFANCA, GIMDES),
  B = accepte certains étourdissements (HFA), C = « standards variables » (Grande Mosquée de Paris, Lyon, Évry)
- `prohibits_electronarcosis`, `halal_assessment` (booléens de critère), `is_active`, `is_recommended`
- Le fichier `asset/certification-list.json` va plus loin : `controllersAreEmployees`,
  `controllersPresentEachProduction`, `hasSalariedSlaughterers`, `acceptsMechanicalPoultrySlaughter`,
  `acceptsPoultryElectronarcosis`, `acceptsPoultryElectrocutionPostSlaughter`,
  `acceptsStunningForCattleCalvesLambs`, `creationYear` — la grille d'évaluation complète d'un organisme.

**b) `certificates` — les certificats halal eux-mêmes** :

- `tenant_id`, `supplier_id`, **`certificate_number` (unique)**, `issuing_authority` (enum),
  **`slaughter_method`** enum `manual_traditional | manual_mechanically_assisted | mechanical_supervised | electronarcosis | stunning | unknown`
- **`verification_status`** enum `pending | verified | rejected | suspended | revoked | expired`
- **`valid_from` / `valid_until`** (+ index sur `valid_until` pour les alertes d'expiration)
- `document_url`, `document_hash` (SHA-256), `verification_code`, `verified_by`, `verified_at`
- `is_electronarcosis_free`, `is_manual_slaughter`, `compliance_score`
- `ai_analysis`, `extracted_fields`, `warnings`, `compliance_issues` (JSONB) — champs prévus pour
  l'extraction automatique (OCR/LLM) des données du PDF de certificat
- (`blockchain_hash`, `blockchain_transaction_id` — gadget, à ignorer)

**c) `certified_entities` — l'annuaire des entités certifiées (abattoirs, fournisseurs…)** :

- `source` (`avs`, `achahada`, `hmc`, … `manual`) + `source_id` (unique par source),
  `entity_type` enum `abattoir | boucherie | supplier | restaurant | brand`
- Identité/adresse complète + `latitude`/`longitude`, `phone`, `email`, `website`, `contact_person`
- **`agreement_number`** (n° d'agrément UE « FR XX.XXX.XXX CE ») et **`veterinary_stamp`**
  (estampille vétérinaire des abattoirs) — champs réglementaires clés pour la traçabilité viande
- `halal_authority`, `trust_level`, `is_active`, `is_included_in_traceability`, `entry_date`, `release_date`
- Données réelles dans `asset/` : ex. abattoir AVS avec `agreementNumber: "1441-77-10-007"`,
  `veterinaryStamp: "FR 77 237 006 CE"`, géoloc, contact — 212 entités importables.

**d) `compliance_alerts` / `compliance_issues`** : alertes typées
(`certificate_expiring`, `certificate_expired`, `electronarcosis_detected`, `chain_break`,
`temperature_violation`, `fraud_suspected`, `document_invalid`), sévérité, acquittement (`acknowledged_by/at`).

**e) `chain_of_custody_records`** : maillons de chaîne de possession par certificat/lot
(`from_entity`/`to_entity` typés, `transaction_type` (transfer/delivery/receipt/consumption/production/return),
quantité, `temperature_celsius`, GPS, `previous_hash`/`current_hash` (chaînage type blockchain), photos).
Pensé pour distributeurs multi-échelons — surdimensionné pour un restaurant, mais le **concept
« chaque lot pointe vers son certificat et son origine »** est le bon.

**f) `invoice_halal_validator` (code Rust, 813 l.)** : avant émission d'une facture, vérifie pour chaque
ligne : certificat valide + non expiré (avec buffer 30 j), autorité de niveau ≥ A, méthode d'abattage
conforme, chaîne de possession présente si exigée, n° de lot traçable. Bonne spécification métier à
transposer en service NestJS (« un produit viande ne peut être vendu/facturé halal que si… »).

### 2.2 Lots & DLC/DDM (inventory-service)

- **`batches`** : `stock_id` (FK vers stock produit×site), `batch_number`, `quantity`,
  **`expiry_date`**, `received_date`, `supplier_id`. Minimaliste mais le principe FEFO y est ;
  il manque chez eux : distinction DLC/DDM, lien vers la ligne de réception, lien vers le certificat halal, statut du lot.
- **`stock`** : `quantity_on_hand`, `quantity_reserved`, `quantity_available` **colonne générée**
  (`GENERATED ALWAYS AS (on_hand - reserved) STORED`) — pattern à retenir.
- **`stock_movements`** : type (`purchase | sale | adjustment | transfer | return | waste | production`),
  **`quantity_before` / `quantity_after`** (audit d'inventaire bien plus robuste que notre simple qty signée),
  `reference_id`, `created_by`.
- **`stock_alerts`** : `low_stock | out_of_stock | expiry_warning | expiring_soon | expired | over_stock`
  avec seuil + acquittement. Nous n'avons ni alertes persistées ni alertes DLC.
- **`stock_counts` + `stock_count_lines`** : inventaires avec `expected_quantity`, `counted_quantity`,
  `variance`, `counted_by/at` — plus complet que notre mouvement `count` sec.
- **Colonnes halal produit** (migration 20241216) : `halal_authority` (enum ~30 valeurs),
  `halal_certificate_number`, `halal_expiry_date`, `is_aplus_certified` (auto-calculé par trigger selon
  l'autorité), `manual_slaughter_only`, `electronarcosis_free`, `halal_verified`, `halal_verified_at`.

### 2.3 Réception marchandise

Pas de table « goods receipt » dédiée chez Optimus, mais deux modèles utiles :

- Le **template de workflow « Inventory Receiving »** (supplychain-service, seed) décrit le processus
  cible : scan du BL → **contrôle du certificat halal** → inspection photo → **contrôle température
  (chaîne du froid)** → affectation d'emplacement → signature d'acceptation.
- Les **`fulfillment_items`** (order-service, sens expédition) montrent la granularité ligne :
  `quantity_ordered/picked/packed/shipped`, **`lot_number`, `batch_number`, `expiry_date`**,
  **`halal_certificate_id`, `halal_verified`**, `temperature_zone`, emplacement (zone/aisle/shelf/bin).

→ Chez nous la réception est aujourd'hui un simple statut `received` sur le PO + mouvement `purchase` :
aucune saisie des quantités réellement reçues, ni des DLC, ni des écarts, ni du n° de BL. C'est le
chaînon manquant entre PO, lots et factures (rapprochement 3 voies).

### 2.4 Factures, OCR, e-invoicing

- **document-service `documents`** : `storage_key` (S3), `checksum_sha256`, `mime_type`, `size_bytes`,
  **`ocr_text` + `ocr_confidence`** (+ index trigram et full-text sur l'OCR), `document_type`, `status`
  (PENDING/…), versions, `expires_at`, archivage légal (`retention_policies`, `legal_holds`,
  `last_integrity_check`). L'OCR est délégué à un endpoint Tesseract configurable (`OCR_ENDPOINT`).
- **einvoicing-service `einvoices`** (conformité France 2026, EN 16931) : `number` (unique/tenant),
  `type_code` (INVOICE/CREDIT_NOTE/…), statut cycle de vie complet
  (`DRAFT → VALIDATED → SUBMITTED → RECEIVED → ACKNOWLEDGED → ACCEPTED/REJECTED → PAID/DISPUTED`),
  **`seller_siret`/`buyer_siret`, TVA intracom**, `total_net/tax/gross` + contrainte
  `CHECK (total_gross = total_net + total_tax)`, `amount_due/paid`, format
  (`FACTUR_X`/`UBL`/`CII`) + profil (`MINIMUM → EXTENDED`), `transmission_flow` (B2B/B2G/B2C),
  `xml_content`/`pdf_content` (BYTEA), `pdp_reference`.
- **`einvoice_line_items`** : quantité `NUMERIC(15,4)`, **code unité UN/ECE (`C62`…)**, prix unitaire,
  montants net/brut, **catégorie TVA normalisée (`S/Z/E/AE/K/G/O/L/M`)** + taux + montant, `gtin`,
  et même **`is_halal_certified` + `halal_certification_body` + `halal_certificate_number` par ligne**.
- **`einvoice_tax_summaries`** : ventilation TVA par taux/catégorie (obligatoire Factur-X).
- **`pdp_connections` / `einvoice_submissions` / `einvoice_lifecycle_events`** : connexions aux
  Plateformes de Dématérialisation Partenaires (Chorus Pro…), credentials chiffrés AES-256-GCM,
  retries avec backoff, événements PPF horodatés. À garder en référence pour l'échéance sept. 2026
  (réception obligatoire pour tous) / 2027 (émission PME).

→ Chez nous : `invoices` = en-tête seul (pas de lignes !), statut 3 valeurs, `fileUrl` nu. Il manque :
lignes de facture, ventilation TVA, hash/OCR du document, SIRET, lien vers réceptions (rapprochement).

### 2.5 E-commerce B2B (marketplace + order)

- Catalogue : `categories` (hiérarchie + `requires_halal_certification`), `brands` (certification halal
  de la marque), `suppliers` (statut, vérification, **`halal_trust_score`**), `products` (prix/compare-at/coût,
  stock, **`halal_status` enum `certified | pending | expired | not_certified | suspended`**, certificat,
  expiration, SEO, stats, recherche full-text française).
- `reviews` avec **note halal séparée** (`halal_rating`, `halal_comment`), votes, modération.
- `carts`/`cart_items` B2B : **`require_halal_only`, `preferred_certifiers[]`** au panier ;
  par ligne `is_halal_certified`, `halal_certificate_expired`, `halal_certifier`, min/max quantité, MOQ.
- `supplier_orders` : éclatement d'une commande client en commandes par fournisseur.
- La **table `suppliers` du supplychain-service** est la plus complète : SIRET/SIREN/TVA,
  `payment_terms` (int, jours), `minimum_order_value`, bloc halal complet
  (`halal_certified/authority/certificate_number/certificate_expiry/certificate_url`, `electronarcosis_free`),
  performance (`on_time_delivery_rate`, `quality_score`, `rating_average`), `tier` (1/2/3), géoloc, tags.

→ Pour SM : pas de marketplace B2B à court terme, mais si un jour on connecte les restaurateurs aux
grossistes halal, ce schéma est le point de départ. À court terme on ne reprend que les **colonnes
fournisseur** (SIRET, conditions, bloc halal).

---

## 3. Verdict par brique

### REPRENDRE (schéma et/ou données portables quasi tels quels)

| Brique | Quoi reprendre | Pourquoi |
|---|---|---|
| `asset/*.json` (AVS, ACHAHADA, certification-list) | Les 6 fichiers de données | Données métier réelles, introuvables ailleurs sous forme structurée ; seed direct de nos futures tables `certifying_bodies` / `certified_entities`. Prévoir un rafraîchissement (données de déc. 2025). |
| compliance : `certification_authorities` | Schéma + seed SQL des 13 organismes + grille de critères | Modèle de référence du marché halal FR ; transposition Drizzle triviale (§4, P1). |
| compliance : `certificates` | Colonnes cœur (n°, autorité, méthode d'abattage, statut de vérif, validité, document+hash, champs d'extraction) | Exactement le certificat fournisseur/abattoir qui nous manque (§4, P1). |
| compliance : `certified_entities` | Schéma (dont `agreement_number`, `veterinary_stamp`) + import des JSON | Annuaire mutualisable au niveau plateforme SM (pas par tenant) — argument commercial fort. |
| inventory : enum `halal_authority` (30+ valeurs) et classification A+ | Liste des valeurs + règle « A+ = sans électronarcose » | Travail de recherche déjà fait, vérifié contre `certification-list.json`. |
| einvoicing : schéma complet | Comme **spécification** pour 2026 (statuts, profils, catégories TVA, tables de soumission/cycle de vie) | Qualité EN 16931 réelle ; on l'implémentera dans notre stack le moment venu, sans réinventer le modèle. |

### ADAPTER (bonne idée, à réécrire dans notre stack/notre périmètre)

| Brique | Idée à garder | Adaptation SM |
|---|---|---|
| inventory : `batches` + alertes expiry + FEFO | Lots avec DLC, alertes persistées, `quantity_before/after` sur mouvements | Re-modéliser en `lots` liés à la réception, avec distinction DLC/DDM et lien certificat halal (§4, P2) ; ajouter `lotId` aux mouvements plutôt que dupliquer leur modèle stock/site. |
| workflow « Inventory Receiving » + `fulfillment_items` | Le processus de réception (contrôle certificat, température, écarts) et la granularité ligne (lot, DLC, qty reçue vs commandée) | Pas de moteur de workflow : deux tables `receptions`/`reception_lines` + un écran guidé (§4, P3). |
| supplychain : table `suppliers` | SIRET/SIREN/TVA, bloc certification halal, conditions commerciales, indicateurs de performance | Colonnes à ajouter à notre table `suppliers` existante (§4, P1/P2) — pas une nouvelle table. |
| order : montants BIGINT cents, `payment_status`, `order_tracking_history` | Cohérent avec notre philosophie cents | Enrichir nos `invoices`/PO au besoin. |
| document : `checksum_sha256`, `ocr_text/confidence`, statut de traitement | Champs OCR + intégrité | À poser sur nos factures fournisseurs (§4, P4) ; OCR par API externe (comme eux : service dédié, pas de lib embarquée). |
| compliance : `invoice_halal_validator` | Règles métier de validation (trust level min, buffer 30 j, lot obligatoire pour viande) | Réécrire en service NestJS ; c'est une spec, pas du code portable (Rust). |
| marketplace : `halal_status` produit + filtres halal panier | Statut halal au niveau produit/ingrédient, préférences de certificateurs | Chez nous : statut halal sur `ingredients` (P1) ; filtres panier seulement si e-commerce B2B un jour. |

### ÉCARTER

| Brique | Raison |
|---|---|
| Toute l'architecture microservices (15 services Rust/gRPC, protos, gateway, 14 Dockerfiles, Railway) | Contraire à notre choix monolithe modulaire ; coût d'exploitation démesuré ; le code Rust n'est de toute façon pas portable en NestJS. |
| Moteur de workflows collaboratifs + sync offline (`workflows`, `workflow_steps`, `sync_states`…) | Sur-ingénierie (CRDT-like, participants temps réel, GPS) pour des besoins que SM couvre par des écrans simples. |
| Chaîne de possession GPS/température/hash chaîné + blockchain (`web3`, `ethers`) | Pensé pour distributeurs multi-échelons et marketing « blockchain » ; pour un restaurant, lot → certificat → fournisseur suffit. |
| Logistique transport (`shipments`, `routes`, `route_stops`, `vehicles`, `carriers`, IoT température) | Hors métier restaurateur (on reçoit, on n'expédie pas de tournées). |
| Marketplace de modules SaaS (modules, subscriptions Stripe, installations par tenant) | Notre gestion de plans/abonnements existe déjà côté commerce (Mongo) ; pas besoin d'un « app store ». |
| mobile-service + app mobile grand public (scan, fidélité, favoris) | Cible B2C consommateur, pas notre marché. |
| auth/tenant/user/notification/analytics/integration/ai-orchestrator services | Redondants avec l'existant SM ou prématurés. |
| RLS PostgreSQL par `current_setting('app.current_tenant')` | Incompatible avec notre accès Drizzle mono-rôle actuel ; notre isolation par `tenantRef` applicative suffit à ce stade (à réévaluer si multi-DB). |

---

## 4. Proposition concrète : extensions du schéma `packages/supply/src/schema.ts`

Priorisées P1 → P4. Conventions existantes respectées : `uuid` PK `defaultRandom()`, `tenantRef` en
`text` (ObjectId Mongo), montants en cents `integer`, quantités `numeric(12,3)`, timestamps `withTimezone`.

### P1 — Traçabilité halal : organismes, certificats, statut ingrédient

```ts
// ─── Halal : organismes certificateurs (référentiel plateforme, seedé) ───────

/** Niveau de confiance d'un organisme (grille Optimus/AVS) : a_plus = sans électronarcose. */
export const trustLevelEnum = pgEnum('trust_level', ['a_plus', 'a', 'b', 'c']);

/** Statut de vérification d'un certificat. */
export const certificateStatusEnum = pgEnum('certificate_status', [
  'pending', // déposé, non vérifié
  'verified', // contrôlé (manuellement ou OCR+revue)
  'rejected',
  'suspended',
  'expired', // recalculé par tâche planifiée sur validUntil
]);

/** Méthode d'abattage couverte par le certificat. */
export const slaughterMethodEnum = pgEnum('slaughter_method', [
  'manual_traditional',
  'manual_mechanically_assisted',
  'mechanical_supervised',
  'electronarcosis',
  'stunning',
  'unknown',
]);

/** Statut halal d'un ingrédient (au sens INCO on gère déjà les allergènes ; ici la dimension halal). */
export const halalStatusEnum = pgEnum('halal_status', [
  'certifie', // couvert par un certificat actif
  'declare', // déclaré halal par le fournisseur, sans certificat vérifié
  'non_halal',
  'non_concerne', // légumes, emballages…
]);

/**
 * Organismes certificateurs halal — table plateforme (pas de tenantRef),
 * seedée depuis asset/certification-list.json d'Optimus (13 organismes, critères détaillés).
 */
export const certifyingBodies = pgTable('certifying_bodies', {
  id: text('id').primaryKey(), // slug : 'avs', 'achahada', 'hmc', 'jakim'…
  name: text('name').notNull(),
  fullName: text('full_name'),
  country: text('country').notNull().default('France'),
  website: text('website'),
  trustLevel: trustLevelEnum('trust_level').notNull().default('c'),
  prohibitsElectronarcosis: boolean('prohibits_electronarcosis').notNull().default(false),
  /** Grille de critères détaillée (contrôleurs salariés, abattage mécanique volaille…). */
  criteria: jsonb('criteria').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  isRecommended: boolean('is_recommended').notNull().default(false),
});

/**
 * Certificats halal rattachés à un fournisseur du tenant (ou à un abattoir amont
 * via slaughterhouseName/agreementNumber quand le fournisseur est un grossiste).
 */
export const halalCertificates = pgTable(
  'halal_certificates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'cascade' }),
    certifyingBodyId: text('certifying_body_id')
      .notNull()
      .references(() => certifyingBodies.id, { onDelete: 'restrict' }),
    certificateNumber: text('certificate_number').notNull(),
    status: certificateStatusEnum('status').notNull().default('pending'),
    slaughterMethod: slaughterMethodEnum('slaughter_method').notNull().default('unknown'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    /** Abattoir amont : nom, n° d'agrément UE (FR XX.XXX.XXX CE), estampille vétérinaire. */
    slaughterhouseName: text('slaughterhouse_name'),
    agreementNumber: text('agreement_number'),
    veterinaryStamp: text('veterinary_stamp'),
    /** Document : URL de stockage + empreinte d'intégrité + extraction OCR/LLM éventuelle. */
    fileUrl: text('file_url'),
    fileSha256: text('file_sha256'),
    extractedFields: jsonb('extracted_fields'),
    verifiedBy: text('verified_by'), // id utilisateur Mongo
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('halal_certs_tenant_idx').on(t.tenantRef),
    index('halal_certs_supplier_idx').on(t.supplierId),
    index('halal_certs_expiry_idx').on(t.validUntil), // alertes « certificat expire dans 30 j »
    uniqueIndex('halal_certs_number_uq').on(t.supplierId, t.certificateNumber),
  ],
);
```

Colonnes à **ajouter aux tables existantes** (P1) :

```ts
// suppliers — bloc légal + halal (repris de supplychain.suppliers d'Optimus)
siret: text('siret'),
vatNumber: text('vat_number'),
halalCertified: boolean('halal_certified').notNull().default(false),
// dénormalisation du certificat actif « le mieux-disant » pour l'affichage liste :
halalTrustLevel: trustLevelEnum('halal_trust_level'),

// ingredients — statut halal + exigence
halalStatus: halalStatusEnum('halal_status').notNull().default('non_concerne'),
/** Si true, l'appro de cet ingrédient exige un fournisseur au certificat actif (bloque la réception sinon). */
requiresHalalCertificate: boolean('requires_halal_certificate').notNull().default(false),
```

### P2 — Lots & DLC/DDM

```ts
/** DLC = limite sanitaire stricte ; DDM = qualité (ex-DLUO). */
export const expiryTypeEnum = pgEnum('expiry_type', ['dlc', 'ddm']);

export const lotStatusEnum = pgEnum('lot_status', [
  'active',
  'epuise', // quantité restante = 0
  'expire',
  'retire', // rappel / non-conformité
]);

export const lots = pgTable(
  'lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
    /** N° de lot fournisseur (étiquette) — clé de tout rappel sanitaire. */
    lotNumber: text('lot_number').notNull(),
    expiryType: expiryTypeEnum('expiry_type').notNull().default('dlc'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Quantités en unité de base de l'ingrédient. */
    qtyReceived: numeric('qty_received', { precision: 12, scale: 3 }).notNull(),
    qtyRemaining: numeric('qty_remaining', { precision: 12, scale: 3 }).notNull(),
    status: lotStatusEnum('status').notNull().default('active'),
    /** Traçabilité halal : certificat couvrant ce lot au moment de la réception. */
    halalCertificateId: uuid('halal_certificate_id').references(() => halalCertificates.id, {
      onDelete: 'set null',
    }),
    receptionLineId: uuid('reception_line_id'), // FK ajoutée en P3 (référence circulaire évitée)
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lots_tenant_ing_idx').on(t.tenantRef, t.ingredientId, t.status),
    index('lots_expiry_idx').on(t.expiresAt), // FEFO + alertes DLC
    index('lots_number_idx').on(t.lotNumber), // recherche en cas de rappel
  ],
);

// stockMovements — colonnes à ajouter :
lotId: uuid('lot_id').references(() => lots.id, { onDelete: 'set null' }),
// audit façon Optimus (facultatif mais recommandé) :
qtyBefore: numeric('qty_before', { precision: 12, scale: 3 }),
qtyAfter: numeric('qty_after', { precision: 12, scale: 3 }),
```

Règles applicatives associées : consommation FEFO (`ORDER BY expires_at NULLS LAST`),
`ingredients.currentStock` reste la somme dénormalisée des `qtyRemaining`, tâche planifiée quotidienne
qui passe les lots en `expire` et alimente les alertes (« DLC J-3 », « certificat J-30 »).

### P3 — Réception marchandise (le chaînon PO → lots → facture)

```ts
export const receptionStatusEnum = pgEnum('reception_status', [
  'draft', // en cours de saisie à la livraison
  'complete', // conforme au PO
  'partielle', // reliquat attendu
  'litige', // écart/refus déclaré au fournisseur
]);

export const receptions = pgTable(
  'receptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantRef: text('tenant_ref').notNull(),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, {
      onDelete: 'set null',
    }), // NULL = réception directe sans PO
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    /** N° du bon de livraison fournisseur. */
    deliveryNoteNumber: text('delivery_note_number'),
    deliveryNoteFileUrl: text('delivery_note_file_url'),
    status: receptionStatusEnum('status').notNull().default('draft'),
    /** Contrôles à réception (inspirés du workflow « Inventory Receiving » d'Optimus). */
    temperatureOk: boolean('temperature_ok'),
    temperatureCelsius: numeric('temperature_celsius', { precision: 5, scale: 2 }),
    halalCheckOk: boolean('halal_check_ok'), // certificat fournisseur actif vérifié à réception
    receivedBy: text('received_by'), // id utilisateur Mongo
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('receptions_tenant_idx').on(t.tenantRef, t.status),
    index('receptions_po_idx').on(t.purchaseOrderId),
  ],
);

export const receptionLines = pgTable(
  'reception_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receptionId: uuid('reception_id')
      .notNull()
      .references(() => receptions.id, { onDelete: 'cascade' }),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLines.id, {
      onDelete: 'set null',
    }),
    supplierItemId: uuid('supplier_item_id')
      .notNull()
      .references(() => supplierItems.id, { onDelete: 'restrict' }),
    /** Colis commandés vs reçus vs refusés (même unité que purchaseOrderLines.qtyPacks). */
    qtyPacksOrdered: numeric('qty_packs_ordered', { precision: 12, scale: 3 }),
    qtyPacksReceived: numeric('qty_packs_received', { precision: 12, scale: 3 }).notNull(),
    qtyPacksRejected: numeric('qty_packs_rejected', { precision: 12, scale: 3 }).notNull().default('0'),
    rejectReason: text('reject_reason'),
    /** Saisie lot/DLC au fil de la réception → crée la ligne dans `lots`. */
    lotId: uuid('lot_id').references(() => lots.id, { onDelete: 'set null' }),
    /** Prix constaté sur le BL (détection de dérive vs supplierItems.packPriceCents). */
    packPriceCents: integer('pack_price_cents'),
  },
  (t) => [index('reception_lines_reception_idx').on(t.receptionId)],
);
```

Flux : réception validée → création des `lots` + `stockMovements` type `purchase` (avec `lotId`) →
mise à jour du statut PO (`received`/partiel) → la facture (P4) se rapproche des réceptions.

### P4 — Factures : lignes, document/OCR, rapprochement

```ts
export const invoiceOcrStatusEnum = pgEnum('invoice_ocr_status', [
  'none', // saisie manuelle
  'pending',
  'done',
  'failed',
  'confirmed', // extraction validée par l'utilisateur
]);

// invoices — colonnes à ajouter (inspiré document-service + einvoicing) :
fileSha256: text('file_sha256'),
ocrStatus: invoiceOcrStatusEnum('ocr_status').notNull().default('none'),
/** Sortie brute de l'extraction (lignes candidates, en-tête, confiance) avant validation humaine. */
ocrPayload: jsonb('ocr_payload'),
ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
supplierSiret: text('supplier_siret'), // pré-requis Factur-X 2026

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    /** Rapprochement : ligne de réception (3-way match PO ↔ BL ↔ facture). */
    receptionLineId: uuid('reception_line_id').references(() => receptionLines.id, {
      onDelete: 'set null',
    }),
    supplierItemId: uuid('supplier_item_id').references(() => supplierItems.id, {
      onDelete: 'set null',
    }),
    label: text('label').notNull(), // libellé tel que sur la facture
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    vatRatePct: numeric('vat_rate_pct', { precision: 5, scale: 2 }).notNull().default('5.50'),
    totalHtCents: integer('total_ht_cents').notNull(),
    /** Écart vs prix catalogue au moment du rapprochement (alerte dérive prix). */
    priceVarianceCents: integer('price_variance_cents'),
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)],
);
```

Plus tard (échéance réglementaire 2026/2027) : reprendre le modèle einvoicing d'Optimus comme spec
(statuts de cycle de vie, profils Factur-X, `einvoice_tax_summaries`, soumissions PDP) — ne rien
implémenter avant d'avoir choisi la PDP.

### Ordre de livraison conseillé

| Prio | Lot | Tables/colonnes | Valeur |
|---|---|---|---|
| **P1** | Halal socle | `certifyingBodies` (+ seed JSON Optimus), `halalCertificates`, colonnes `suppliers`/`ingredients` | Différenciant produit immédiat : registre des certificats + alertes d'expiration ; aucune dépendance. |
| **P2** | Lots & DLC | `lots`, colonnes `stockMovements` | Conformité sanitaire (HACCP/rappels) + FEFO ; dépend de P1 pour `halalCertificateId` (nullable, peut précéder). |
| **P3** | Réception | `receptions`, `receptionLines` (+ FK `lots.receptionLineId`) | Fiabilise le stock réel et alimente P2 ; débloque le rapprochement. |
| **P4** | Factures | `invoiceLines`, colonnes OCR/hash/SIRET sur `invoices` | Contrôle des coûts (3-way match, dérive prix) ; prépare 2026. |

---

## 5. Points de vigilance

- **Fraîcheur des données `asset/`** : scrapées ~déc. 2025 ; les listes AVS/ACHAHADA évoluent —
  prévoir une procédure de mise à jour (les endpoints sources se déduisent des champs `source_id`).
- **Licence/propriété** : code écrit par le fondateur (réutilisation confirmée) ; le `Cargo.toml`
  affiche `license = "Proprietary"` — sans impact puisqu'on ne porte que des schémas/données maison.
- Ne pas copier les enums d'autorités **en dur** dans un enum Postgres comme l'a fait inventory-service
  (3 migrations pour ajouter des valeurs) : notre choix `certifyingBodies.id` en `text` référencé évite
  ces migrations d'enum pénibles.
- Les statuts « 94 % complet » des docs internes d'Optimus sont très optimistes ; ne pas s'appuyer sur
  le code Rust comme preuve de faisabilité opérationnelle — s'appuyer sur les **schémas** et les **données**.
