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
    /**
     * État du compte côté Snack Manager — le seul champ qui décide de l'ACCÈS.
     *
     * Suspendre coupe l'accès, jamais les données : le menu, les commandes et
     * l'historique d'un restaurant suspendu restent intacts, prêts à rouvrir le
     * jour où la facture est réglée. Rien ici n'est destructif.
     *
     * Le sous-schéma est explicite (et non un objet imbriqué implicite) pour
     * que Mongoose infère des champs NON nullables côté TypeScript — même
     * raison que pour `totals` et `payment` sur les commandes.
     *
     * ATTENTION : les tenants créés avant ce champ n'ont pas d'`account` en
     * base, et `.lean()` ne matérialise pas les défauts. Toute lecture doit
     * traiter l'absence comme « pas de blocage » (`DEFAULT_TENANT_ACCOUNT_STATUS`
     * vaut `trial`) — un champ manquant ne doit jamais fermer un restaurant.
     */
    account: {
      type: new Schema(
        {
          status: {
            type: String,
            enum: ['trial', 'active', 'suspended', 'churned'],
            default: 'trial',
            required: true,
          },
          /** Début du statut COURANT, réécrit à chaque changement. */
          since: { type: Date, default: Date.now, required: true },
          /** Motif du dernier changement, saisi par l'équipe SM. */
          reason: { type: String, default: '' },
          /** Horodatage de la suspension en cours — `null` dès la réactivation. */
          suspendedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: () => ({ status: 'trial', since: new Date(), reason: '', suspendedAt: null }),
    },
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
    /**
     * Coût horaire employeur, en CENTIMES — sans lui aucune projection de masse
     * salariale n'est possible.
     *
     * DONNÉE PERSONNELLE. Une rémunération ne doit jamais transiter vers une
     * session ouverte au PIN sur la tablette du comptoir : un équipier lirait
     * le salaire de son collègue en tapotant l'écran. La lecture est réservée
     * au compte propriétaire (cf. `canReadPayroll`, module planning) — au même
     * titre que `pinHash`, ce champ ne part JAMAIS dans une réponse par défaut.
     *
     * `null` = non renseigné, à distinguer de `0` : une projection qui compte
     * un salarié non tarifé comme gratuit est un chiffre faux, pas un chiffre
     * prudent. Le module planning remonte explicitement les manquants.
     */
    hourlyCostCents: { type: Number, default: null, min: 0 },
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
// plannedshifts — services PRÉVUS (planning du gérant)
// ─────────────────────────────────────────────────────────────

/**
 * Un service prévu, à ne pas confondre avec le pointage (`Shift`) : celui-ci
 * dit ce que le gérant a DÉCIDÉ, celui-là ce qui s'est RÉELLEMENT passé. Les
 * confronter est tout l'intérêt du module.
 *
 * POURQUOI DES CHAÎNES ET NON DES `Date`. « Samedi, 18:00 → 23:30 » est une
 * heure MURALE : c'est l'heure de la pendule du snack, pas un instant. Stocké
 * en `Date`, un planning posé en août se décalerait d'une heure au passage à
 * l'heure d'hiver — l'équipe recevrait un planning faux deux fois par an. Le
 * jour reste donc `AAAA-MM-JJ` et les heures `HH:MM` ; la conversion en
 * instants n'a lieu qu'au moment de croiser avec les pointages.
 *
 * `end` peut être INFÉRIEUR à `start` : un snack qui ferme à 00:30 saisit
 * « 18:00 → 00:30 ». La durée se calcule en ajoutant 24 h dans ce cas.
 */
export const PlannedShiftSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    staffId: { type: Schema.Types.ObjectId, ref: 'Staff', required: true },
    /** Jour calendaire parisien, `AAAA-MM-JJ`. */
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** Heure murale de début, `HH:MM`. */
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    /** Heure murale de fin, `HH:MM` — peut précéder `start` (service de nuit). */
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    position: {
      type: String,
      enum: ['caisse', 'cuisine', 'polyvalent'],
      default: 'polyvalent',
      required: true,
    },
    note: { type: String, default: '' },
    /**
     * Un gérant construit son planning en plusieurs fois, entre deux services.
     * Le BROUILLON est ce qui rend l'outil utilisable : tant qu'il n'a pas
     * publié, son équipe ne doit voir aucun jet intermédiaire.
     */
    status: { type: String, enum: ['brouillon', 'publie'], default: 'brouillon', required: true },
    /** Horodatage de la publication — `null` tant que le service est brouillon. */
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
/** Lecture d'une semaine : le tri chronologique sort directement de l'index. */
PlannedShiftSchema.index({ tenantId: 1, date: 1, start: 1 });
/** Totaux par personne sur une période (projection de coût, confrontation). */
PlannedShiftSchema.index({ tenantId: 1, staffId: 1, date: 1 });
export type PlannedShift = InferSchemaType<typeof PlannedShiftSchema>;

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
    // Dernière révocation prononcée depuis le back-office interne (clé HDMI
    // volée, écran remplacé). Le détail « qui, quand, pourquoi » vit dans
    // `adminLogs` ; ces deux champs ne sont là que pour l'afficher sur la
    // fiche de l'écran sans relire tout le journal.
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['perte', 'vol', 'panne', 'remplacement', null],
      default: null,
    },
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
// devices — les appareils de terrain : caisses et écrans cuisine
// ─────────────────────────────────────────────────────────────

/**
 * Une tablette de comptoir ou de piano.
 *
 * Elle n'a ni compte, ni mot de passe : son `deviceToken` EST son identité, et
 * c'est lui qui porte l'établissement. Sans cette collection, la caisse
 * embarquait le slug du restaurant en dur dans son code — un seul client
 * possible par binaire.
 *
 * Structure volontairement CALQUÉE sur `screens` : mêmes noms de champs,
 * mêmes index, même cycle de vie du code d'appairage. Deux mécanismes
 * d'appairage divergents dans un même produit, c'est deux fois plus de support
 * au téléphone.
 */
export const DeviceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true }, // « Caisse comptoir », « Écran cuisine »
    kind: { type: String, enum: ['pos', 'kds'], required: true },
    // Code à 6 caractères non ambigus (ni I, ni O, ni 0, ni 1), lu dans le
    // back-office et recopié sur la tablette. `null` une fois appairé.
    pairingCode: { type: String, default: null },
    pairingCodeExpiresAt: { type: Date, default: null },
    paired: { type: Boolean, default: false },
    // Secret long remis À L'APPAIRAGE et jamais renvoyé ensuite.
    deviceToken: { type: String, default: null },
    // Dernier battement de cœur — source du « hors ligne depuis 12 min ».
    lastSeenAt: { type: Date, default: null },
    active: { type: Boolean, default: true },
    // Dernière révocation prononcée depuis le back-office interne (tablette
    // perdue ou volée). Le détail « qui, quand, pourquoi » vit dans
    // `adminLogs` ; ces deux champs ne sont là que pour l'afficher sur la
    // fiche de l'appareil sans relire tout le journal.
    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['perte', 'vol', 'panne', 'remplacement', null],
      default: null,
    },
  },
  { timestamps: true },
);
DeviceSchema.index({ tenantId: 1, createdAt: -1 });
/**
 * Index PARTIEL, et non `sparse` — même piège que sur les écrans : le défaut
 * écrit explicitement `null`, si bien que deux appareils non appairés
 * entreraient en collision sur un index unique classique.
 */
DeviceSchema.index(
  { deviceToken: 1 },
  { unique: true, partialFilterExpression: { deviceToken: { $type: 'string' } } },
);
DeviceSchema.index({ pairingCode: 1 }, { sparse: true });
export type Device = InferSchemaType<typeof DeviceSchema>;

// ─────────────────────────────────────────────────────────────
// adminLogs — journal d'administration Snack Manager, append-only
// ─────────────────────────────────────────────────────────────

/**
 * Ce que l'ÉQUIPE SM fait aux comptes de ses clients.
 *
 * À ne pas confondre avec `auditLogs`, qui trace ce que fait le PERSONNEL d'un
 * restaurant dans sa propre caisse (annulations, remises — socle NF525). Deux
 * publics, deux responsabilités, deux collections : mélanger les deux rendrait
 * le journal d'un restaurateur illisible et le nôtre incontrôlable.
 *
 * Nous agissons sur l'outil de travail d'un commerçant : suspendre son accès,
 * couper une tablette, changer sa formule. Chaque geste doit pouvoir être
 * reconstitué — qui, quoi, sur quel établissement, quand, pourquoi.
 *
 * `actorEmail` est DÉNORMALISÉ volontairement : un journal qui se relit à
 * travers une jointure change de contenu quand un compte d'équipe est renommé
 * ou supprimé. Ce qui est écrit reste écrit.
 */
export const AdminLogSchema = new Schema(
  {
    at: { type: Date, default: Date.now, required: true },
    /** L'humain de l'équipe SM (rôle `sm_admin`) — jamais « system ». */
    actorId: { type: Schema.Types.ObjectId, required: true },
    actorEmail: { type: String, default: '' },
    action: {
      type: String,
      // RECOPIE de `ADMIN_LOG_ACTIONS` (@sm/contracts) : toute action ajoutée
      // là-bas doit l'être ici, sinon l'écriture tombe en ValidationError APRÈS
      // la mutation qu'elle devait tracer. `admin.test.ts` épingle l'égalité
      // des deux listes.
      enum: [
        'tenant.suspend',
        'tenant.reactivate',
        'tenant.plan_change',
        'tenant.note',
        'tenant.detail_view',
        'device.revoke',
        'screen.revoke',
        'invoice.issue',
        'invoice.pay',
        'invoice.cancel',
      ],
      required: true,
    },
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** Cible secondaire : identifiant d'appareil ou d'écran. */
    targetId: { type: String, default: null },
    reason: { type: String, default: '' },
    /** Contexte : ancienne/nouvelle formule, motif de révocation, note… */
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: false },
);
AdminLogSchema.index({ tenantId: 1, at: -1 });
AdminLogSchema.index({ at: -1 });

/**
 * APPEND-ONLY, garanti par l'ODM et pas seulement par la discipline.
 *
 * Un journal qu'on peut réécrire ne prouve rien. Ces hooks refusent toute
 * mise à jour et toute suppression : la seule écriture possible est une
 * insertion. Une correction se fait donc en AJOUTANT une ligne, comme dans un
 * livre de comptes — jamais en effaçant la précédente.
 *
 * (Cela ne remplace pas des droits Mongo restrictifs en production ; cela
 * ferme la porte au code applicatif, qui est la voie réellement empruntée.)
 */
const APPEND_ONLY_BLOCKED = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;

for (const op of APPEND_ONLY_BLOCKED) {
  // `as never` : la signature de `pre` est une union de littéraux que TS ne
  // peut pas réduire depuis une variable de boucle. Le comportement, lui, est
  // celui d'un middleware de requête ordinaire.
  AdminLogSchema.pre(op as never, function blockMutation() {
    throw new Error(`adminLogs est append-only : « ${op} » est refusé.`);
  });
}

export type AdminLog = InferSchemaType<typeof AdminLogSchema>;

// ─────────────────────────────────────────────────────────────
// invoices — facturation de l'abonnement Snack Manager
// ─────────────────────────────────────────────────────────────

/**
 * CE QUE NOUS FACTURONS À NOS CLIENTS RESTAURATEURS.
 *
 * À ne confondre ni avec `orders` (ce qu'un restaurant encaisse auprès de ses
 * propres clients) ni avec `auditLogs` : ici, l'argent va du commerçant VERS
 * Snack Manager. C'est la pièce qui rend une suspension légitime — sans elle,
 * « impayé » n'est qu'une affirmation.
 *
 * TROIS PROPRIÉTÉS STRUCTURENT CE MODÈLE.
 *
 * 1. UNE PIÈCE COMPTABLE, PAS UNE LIGNE DE LOG. `number` vient d'une séquence
 *    continue tenue dans `counters` (`invoice:<année>`) et l'index unique
 *    ci-dessous interdit qu'un numéro serve deux fois. Une facture ne se
 *    supprime jamais : le statut passe à `annulee`, avec un motif, et le numéro
 *    reste consommé — un trou dans la numérotation est une question sans
 *    réponse le jour d'un contrôle.
 *
 * 2. `en_retard` FIGURE DANS L'ÉNUMÉRATION MAIS N'EST PAS ÉCRIT par l'API. Le
 *    retard est une fonction du temps : le figer en base le rendrait faux dès
 *    le lendemain matin sans une tâche de nuit pour le rafraîchir, et un impayé
 *    invisible est précisément ce qu'on cherche à supprimer. Il est recalculé à
 *    chaque lecture (`effectiveInvoiceStatus`, @sm/contracts). La valeur reste
 *    acceptée pour qu'une future relance automatique puisse la persister sans
 *    migration.
 *
 * 3. LA PÉRIODE EST UN MOIS CALENDAIRE EN UTC, bornes incluses des deux côtés :
 *    deux mois consécutifs ne se chevauchent pas et ne laissent pas de trou.
 *    Le sous-schéma est explicite (et non un objet imbriqué implicite) pour que
 *    Mongoose infère des champs NON nullables côté TypeScript — même raison que
 *    pour `totals` et `account`.
 */
export const InvoiceSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    /** `SM-2026-0004` — séquence annuelle, globale au parc, sans trou. */
    number: { type: String, required: true },
    kind: {
      type: String,
      enum: ['abonnement', 'mise_en_place', 'option', 'autre'],
      default: 'abonnement',
      required: true,
    },
    /** Libellé lisible : « Abonnement Complet — septembre 2026 ». */
    label: { type: String, default: '' },
    period: {
      type: new Schema(
        {
          start: { type: Date, required: true },
          end: { type: Date, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    /** Montant en CENTIMES, comme partout ailleurs. */
    amountCents: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['brouillon', 'envoyee', 'en_retard', 'payee', 'annulee'],
      default: 'brouillon',
      required: true,
    },
    /** Date d'envoi au client — `null` tant que la pièce est un brouillon. */
    issuedAt: { type: Date, default: null },
    dueAt: { type: Date, required: true },
    paidAt: { type: Date, default: null },
    /** Comment l'argent est arrivé — `null` tant que rien n'est encaissé. */
    method: {
      type: String,
      enum: ['prelevement', 'virement', 'carte', 'cheque', null],
      default: null,
    },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true },
);
/** Le numéro identifie la pièce : deux factures ne peuvent pas le partager. */
InvoiceSchema.index({ number: 1 }, { unique: true });
/** Fiche d'un client : son historique, échéance la plus récente en tête. */
InvoiceSchema.index({ tenantId: 1, dueAt: -1 });
/** File des impayés du parc : on balaie par statut, du plus ancien au plus récent. */
InvoiceSchema.index({ status: 1, dueAt: 1 });
/** Garde-fou anti-double-facturation : un abonnement par client et par période. */
InvoiceSchema.index({ tenantId: 1, kind: 1, 'period.start': 1 });
export type Invoice = InferSchemaType<typeof InvoiceSchema>;

// ─────────────────────────────────────────────────────────────
// Registre des modèles (consommé par l'API Nest et le seed)
// ─────────────────────────────────────────────────────────────

export const MODELS = {
  Tenant: { name: 'Tenant', schema: TenantSchema, collection: 'tenants' },
  User: { name: 'User', schema: UserSchema, collection: 'users' },
  Staff: { name: 'Staff', schema: StaffSchema, collection: 'staff' },
  Shift: { name: 'Shift', schema: ShiftSchema, collection: 'shifts' },
  PlannedShift: {
    name: 'PlannedShift',
    schema: PlannedShiftSchema,
    collection: 'plannedshifts',
  },
  Category: { name: 'Category', schema: CategorySchema, collection: 'categories' },
  Product: { name: 'Product', schema: ProductSchema, collection: 'products' },
  Order: { name: 'Order', schema: OrderSchema, collection: 'orders' },
  Counter: { name: 'Counter', schema: CounterSchema, collection: 'counters' },
  AuditLog: { name: 'AuditLog', schema: AuditLogSchema, collection: 'auditlogs' },
  AdminLog: { name: 'AdminLog', schema: AdminLogSchema, collection: 'adminlogs' },
  Invoice: { name: 'Invoice', schema: InvoiceSchema, collection: 'invoices' },
  Lead: { name: 'Lead', schema: LeadSchema, collection: 'leads' },
  Review: { name: 'Review', schema: ReviewSchema, collection: 'reviews' },
  Promotion: { name: 'Promotion', schema: PromotionSchema, collection: 'promotions' },
  Screen: { name: 'Screen', schema: ScreenSchema, collection: 'screens' },
  Device: { name: 'Device', schema: DeviceSchema, collection: 'devices' },
} as const;
