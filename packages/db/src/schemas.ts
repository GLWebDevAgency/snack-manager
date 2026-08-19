import { Schema, type InferSchemaType } from 'mongoose';

// Conventions : prix en centimes (int), tenantId indexé en tête de chaque
// collection tenant-scoped, timestamps automatiques partout.

// ─────────────────────────────────────────────────────────────
// tenants
// ─────────────────────────────────────────────────────────────

const HoursSlot = new Schema(
  { open: { type: String, required: true }, close: { type: String, required: true } },
  { _id: false },
);

const DayHours = new Schema(
  {
    day: { type: Number, min: 1, max: 7, required: true }, // ISO : 1 = lundi … 7 = dimanche
    lunch: { type: HoursSlot, default: null },
    dinner: { type: HoursSlot, default: null },
  },
  { _id: false },
);

export const TenantSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    logoUrl: { type: String, default: null },
    brandColor: { type: String, default: '#c9a15a' },
    address: { type: String, default: '' },
    phones: { type: [String], default: [] },
    hours: { type: [DayHours], default: [] },
    closures: {
      type: [
        new Schema(
          { from: Date, to: Date, reason: String },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Domaines personnalisés rattachés à l'établissement (« commander.classfood.fr »).
    // Le sous-domaine automatique `<slug>.snackmanager.app` n'y figure PAS : il
    // est servi sans action du restaurateur, donc sans état à suivre. Ici on ne
    // stocke que ce qui dépend d'un tiers — la zone DNS du client et le
    // certificat de notre hébergeur — d'où `status`, `lastCheckedAt` et `detail`.
    domains: {
      type: [
        new Schema({
          hostname: { type: String, required: true, lowercase: true, trim: true },
          // Identifiant chez le fournisseur (Railway, Cloudflare…) : sans lui on
          // ne sait plus ni interroger l'état ni détacher le domaine.
          providerId: { type: String, required: true },
          status: {
            type: String,
            enum: ['pending_dns', 'issuing_certificate', 'active', 'failed'],
            default: 'pending_dns',
          },
          target: { type: String, required: true }, // valeur CNAME dictée au client
          isPrimary: { type: Boolean, default: false },
          addedAt: { type: Date, default: Date.now },
          lastCheckedAt: { type: Date, default: null },
          detail: { type: String, default: null }, // cause lisible d'un échec
        }),
      ],
      default: [],
    },
    plan: { type: String, enum: ['essentiel', 'complet', 'boost'], default: 'essentiel' },
    founderSeat: { type: Boolean, default: false },
    settings: {
      slotIntervalMin: { type: Number, default: 10 },
      slotCapacity: { type: Number, default: 4 },
      onlineOrderingPaused: { type: Boolean, default: false },
      pauseMessage: { type: String, default: 'Victimes de notre succès — la commande en ligne rouvre très vite !' },
      printTicketOn: { type: String, enum: ['accept', 'ready'], default: 'accept' },
      printStickerOn: { type: String, enum: ['accept', 'ready'], default: 'ready' },
    },
    stripe: {
      customerId: { type: String, default: null },
      subscriptionId: { type: String, default: null },
    },
  },
  { timestamps: true },
);
export type Tenant = InferSchemaType<typeof TenantSchema>;

// ─────────────────────────────────────────────────────────────
// users — comptes email + mot de passe (gérants, équipe SM)
// ─────────────────────────────────────────────────────────────

export const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'sm_admin'], required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null }, // null = équipe Snack Manager
    name: { type: String, default: '' },
  },
  { timestamps: true },
);
export type User = InferSchemaType<typeof UserSchema>;

// ─────────────────────────────────────────────────────────────
// staff — équipe du resto, connexion PIN sur tablette
// ─────────────────────────────────────────────────────────────

export const StaffSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    name: { type: String, required: true },
    role: { type: String, enum: ['gerant', 'caisse', 'cuisine'], required: true },
    pinHash: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type Staff = InferSchemaType<typeof StaffSchema>;

// ─────────────────────────────────────────────────────────────
// shifts — pointages (module RH)
// ─────────────────────────────────────────────────────────────

export const ShiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    clockIn: { type: Date, required: true },
    clockOut: { type: Date, default: null },
    source: { type: String, enum: ['kds', 'pos', 'backoffice'], default: 'kds' },
  },
  { timestamps: true },
);
ShiftSchema.index({ tenantId: 1, staffId: 1, clockIn: -1 });
export type Shift = InferSchemaType<typeof ShiftSchema>;

// ─────────────────────────────────────────────────────────────
// categories
// ─────────────────────────────────────────────────────────────

export const CategorySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
CategorySchema.index({ tenantId: 1, order: 1 });
export type Category = InferSchemaType<typeof CategorySchema>;

// ─────────────────────────────────────────────────────────────
// products — le cœur flexible du modèle
// ─────────────────────────────────────────────────────────────

const VariantSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true }, // centimes
  },
  { _id: false },
);

const OptionChoiceSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    priceDelta: { type: Number, default: 0 },
  },
  { _id: false },
);

const OptionGroupSub = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, enum: ['single', 'multi'], required: true },
    min: { type: Number, default: 0 },
    max: { type: Number, default: null },
    choices: { type: [OptionChoiceSub], default: [] },
    // Règles par variante : { M: { min: 1, max: 1, priceDelta: 150 } }
    perVariant: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

export const ProductSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    // null = « Non rattaché » (produit orphelin après suppression de catégorie)
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' }, // liste d'ingrédients affichée
    price: { type: Number, default: 0 }, // centimes — ignoré si variants non vide
    variants: { type: [VariantSub], default: [] },
    optionGroups: { type: [OptionGroupSub], default: [] },
    removables: { type: [String], default: [] }, // modificateurs express « sans X »
    tags: { type: [String], default: [] },
    isNew: { type: Boolean, default: false },
    outOfStock: { type: Boolean, default: false }, // rupture 1-tap
    // 'manual' = coupé à la main · 'ingredient' = cascade rupture ingrédient (contexte supply)
    outOfStockSource: { type: String, enum: ['manual', 'ingredient', null], default: null },
    photoUrl: { type: String, default: null },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, suppressReservedKeysWarning: true },
);
ProductSchema.index({ tenantId: 1, categoryId: 1, order: 1 });
export type Product = InferSchemaType<typeof ProductSchema>;

// ─────────────────────────────────────────────────────────────
// orders
// ─────────────────────────────────────────────────────────────

const OrderLineSub = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true }, // dénormalisé : le ticket survit aux edits du menu
    variantKey: { type: String, default: null },
    variantName: { type: String, default: null },
    options: {
      type: [
        new Schema(
          {
            groupKey: String,
            choiceKey: String,
            name: String,
            priceDelta: { type: Number, default: 0 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    removed: { type: [String], default: [] },
    note: { type: String, default: null },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true },
    lineTotal: { type: Number, required: true },
  },
  { _id: false },
);

export const OrderSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    number: { type: Number, required: true }, // séquence journalière par tenant
    clientId: { type: String, required: true }, // clé d'idempotence offline (uuid appareil)
    channel: { type: String, enum: ['online', 'pos', 'phone'], required: true },
    type: { type: String, enum: ['surplace', 'emporter', 'pickup'], required: true },
    lines: { type: [OrderLineSub], required: true },
    // Sous-schémas explicites + required : sans cela, Mongoose 8.24 infère les
    // objets imbriqués comme optionnels et tout accès devient nullable côté TS.
    totals: {
      type: new Schema(
        {
          subtotal: { type: Number, required: true },
          discount: {
            type: new Schema(
              { amount: Number, reason: String, staffId: Schema.Types.ObjectId },
              { _id: false },
            ),
            default: null,
          },
          total: { type: Number, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    payment: {
      type: new Schema(
        {
          // OÙ l'argent est encaissé.
          method: { type: String, enum: ['online', 'counter'], required: true },
          // AVEC QUOI le client a payé. `null` = rien n'a encore été perçu.
          // Sans ce champ, une carte passée à la caisse est indiscernable d'un
          // « à encaisser au retrait » et la clôture de caisse (Z) est fausse.
          tender: { type: String, enum: ['cash', 'card', 'online', null], default: null },
          status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
          // Rendu monnaie, en CENTIMES. Calculés par le serveur à la création :
          // changeGiven = cashReceived − totals.total.
          cashReceived: { type: Number, default: null },
          changeGiven: { type: Number, default: null },
          stripePaymentIntentId: { type: String, default: null },
        },
        { _id: false },
      ),
      required: true,
    },
    status: {
      type: String,
      enum: ['new', 'preparing', 'ready', 'delivered', 'cancelled'],
      default: 'new',
      index: true,
    },
    statusHistory: {
      type: [
        new Schema(
          { status: String, at: Date, by: { type: String, default: 'system' } },
          { _id: false },
        ),
      ],
      default: [],
    },
    pickup: {
      type: new Schema(
        { slot: Date, customerName: String, customerPhone: { type: String, default: null } },
        { _id: false },
      ),
      default: null,
    },
    note: { type: String, default: null },
    /**
     * Jeton de suivi public — 32 caractères URL-safe tirés de `crypto`.
     *
     * L'ObjectId seul ne peut pas garder un secret : son préfixe est un
     * horodatage et son suffixe un compteur, donc partiellement devinable.
     * Les routes `/public/orders/:id…` exigent ce jeton avant d'exposer le
     * nom et le téléphone du client (RGPD).
     *
     * NON `required` volontairement : les commandes antérieures à ce champ
     * doivent rester enregistrables (`order.save()` sur un changement de
     * statut) plutôt que d'échouer en validation en plein service.
     */
    trackingToken: { type: String, default: null },
    virtualBrandId: { type: Schema.Types.ObjectId, default: null }, // marques virtuelles T4
    // Métadonnées techniques (ex. { note: 'seed-history' } pour purger un jeu de démo)
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
OrderSchema.index({ tenantId: 1, clientId: 1 }, { unique: true }); // rejeu offline idempotent
// Non unique : les commandes créées avant le champ portent toutes `null`, et
// un index unique les ferait entrer en collision. La collision de deux jetons
// de 192 bits tirés au hasard, elle, n'arrive pas.
OrderSchema.index({ trackingToken: 1 });
export type Order = InferSchemaType<typeof OrderSchema>;

// ─────────────────────────────────────────────────────────────
// counters — numérotation journalière atomique
// ─────────────────────────────────────────────────────────────

export const CounterSchema = new Schema(
  {
    _id: { type: String, required: true }, // `<tenantId>:<yyyymmdd>`
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
export type Counter = InferSchemaType<typeof CounterSchema>;

// ─────────────────────────────────────────────────────────────
// auditLog — append-only, socle NF525
// ─────────────────────────────────────────────────────────────

export const AuditLogSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, default: null },
    action: { type: String, required: true }, // order.cancel | order.discount | order.refund | price.change | …
    targetId: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: null },
    pinVerifiedAt: { type: Date, default: null },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
AuditLogSchema.index({ tenantId: 1, at: -1 });
export type AuditLog = InferSchemaType<typeof AuditLogSchema>;

// ─────────────────────────────────────────────────────────────
// leads — CRM Snack Manager
// ─────────────────────────────────────────────────────────────

export const LeadSchema = new Schema(
  {
    restaurantName: { type: String, required: true },
    contact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      email: { type: String, default: '' },
    },
    stage: {
      type: String,
      enum: ['nouveau', 'contacte', 'demo', 'proposition', 'signe', 'perdu'],
      default: 'nouveau',
    },
    sequence: { type: String, enum: ['A', 'B', 'C', null], default: null },
    touches: {
      type: [new Schema({ at: Date, type: String, note: String }, { _id: false })],
      default: [],
    },
    founderSeatReserved: { type: Boolean, default: false },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
);
export type Lead = InferSchemaType<typeof LeadSchema>;

// ─────────────────────────────────────────────────────────────
// reviews — avis clients
// ─────────────────────────────────────────────────────────────

export const ReviewSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    author: { type: String, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, default: '' },
    source: { type: String, enum: ['online', 'google', 'manual'], default: 'online' },
    reply: {
      type: new Schema({ text: String, at: Date, by: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);
ReviewSchema.index({ tenantId: 1, createdAt: -1 });
export type Review = InferSchemaType<typeof ReviewSchema>;

// ─────────────────────────────────────────────────────────────
// promotions
// ─────────────────────────────────────────────────────────────

export const PromotionSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    kind: { type: String, enum: ['percent', 'amount', 'offered_item'], required: true },
    value: { type: Number, default: 0 }, // % ou centimes selon kind
    code: { type: String, default: null },
    channels: { type: [String], default: ['online', 'pos'] },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    usageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
export type Promotion = InferSchemaType<typeof PromotionSchema>;

// ─────────────────────────────────────────────────────────────
// screens — Menu Board : les écrans TV accrochés en salle
// ─────────────────────────────────────────────────────────────

/**
 * Une scène de la playlist. Aucun contenu n'est recopié ici : une scène
 * DÉSIGNE (une catégorie, des produits) et le contenu est résolu à l'affichage.
 * Sans ça, changer un prix obligerait à repasser sur chaque écran.
 */
const SceneSub = new Schema(
  {
    kind: { type: String, enum: ['category', 'promo', 'featured', 'custom'], required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    productIds: { type: [Schema.Types.ObjectId], default: [] },
    title: { type: String, default: null },
    durationMs: { type: Number, default: 10000 },
  },
  { _id: false },
);

export const ScreenSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true }, // « Écran comptoir gauche »
    // Code d'appairage à 6 caractères non ambigus (ni I, ni O, ni 0, ni 1) :
    // le gérant le lit sur le téléviseur et le recopie sur son téléphone.
    // `null` une fois l'écran appairé — un code qui traîne est un secret exposé.
    pairingCode: { type: String, default: null },
    pairingCodeExpiresAt: { type: Date, default: null },
    paired: { type: Boolean, default: false },
    // Secret long remis À L'APPAIRAGE et jamais renvoyé ensuite : c'est la seule
    // identité de l'écran, qui n'a ni compte ni mot de passe.
    deviceToken: { type: String, default: null },
    orientation: { type: String, enum: ['landscape', 'portrait'], default: 'landscape' },
    playlist: { type: [SceneSub], default: [] },
    theme: { type: String, enum: ['brand', 'dark', 'light'], default: 'brand' },
    // Dernier battement de cœur — source du « hors ligne depuis 20 min ».
    lastSeenAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
ScreenSchema.index({ tenantId: 1, createdAt: -1 });
/**
 * Index PARTIEL, et non `sparse`.
 *
 * `sparse` n'exclut que les documents où le champ est ABSENT — or le défaut
 * écrit explicitement `null`. Deux écrans non appairés portaient donc tous
 * deux `deviceToken: null` et entraient en collision : impossible de créer un
 * second écran. Le filtre partiel n'indexe que les jetons réellement émis.
 */
ScreenSchema.index(
  { deviceToken: 1 },
  { unique: true, partialFilterExpression: { deviceToken: { $type: 'string' } } },
);
ScreenSchema.index({ pairingCode: 1 }, { sparse: true });
export type Screen = InferSchemaType<typeof ScreenSchema>;

// ─────────────────────────────────────────────────────────────
// Registre des modèles (consommé par l'API Nest et le seed)
// ─────────────────────────────────────────────────────────────

export const MODELS = {
  Tenant: { name: 'Tenant', schema: TenantSchema, collection: 'tenants' },
  User: { name: 'User', schema: UserSchema, collection: 'users' },
  Staff: { name: 'Staff', schema: StaffSchema, collection: 'staff' },
  Shift: { name: 'Shift', schema: ShiftSchema, collection: 'shifts' },
  Category: { name: 'Category', schema: CategorySchema, collection: 'categories' },
  Product: { name: 'Product', schema: ProductSchema, collection: 'products' },
  Order: { name: 'Order', schema: OrderSchema, collection: 'orders' },
  Counter: { name: 'Counter', schema: CounterSchema, collection: 'counters' },
  AuditLog: { name: 'AuditLog', schema: AuditLogSchema, collection: 'auditlogs' },
  Lead: { name: 'Lead', schema: LeadSchema, collection: 'leads' },
  Review: { name: 'Review', schema: ReviewSchema, collection: 'reviews' },
  Promotion: { name: 'Promotion', schema: PromotionSchema, collection: 'promotions' },
  Screen: { name: 'Screen', schema: ScreenSchema, collection: 'screens' },
} as const;
