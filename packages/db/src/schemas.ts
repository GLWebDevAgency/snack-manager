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
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true },
    description: { type: String, default: '' }, // liste d'ingrédients affichée
    price: { type: Number, default: 0 }, // centimes — ignoré si variants non vide
    variants: { type: [VariantSub], default: [] },
    optionGroups: { type: [OptionGroupSub], default: [] },
    removables: { type: [String], default: [] }, // modificateurs express « sans X »
    tags: { type: [String], default: [] },
    isNew: { type: Boolean, default: false },
    outOfStock: { type: Boolean, default: false }, // rupture 1-tap
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
    totals: {
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
    payment: {
      method: { type: String, enum: ['online', 'counter'], required: true },
      status: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
      stripePaymentIntentId: { type: String, default: null },
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
    virtualBrandId: { type: Schema.Types.ObjectId, default: null }, // marques virtuelles T4
  },
  { timestamps: true },
);
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
OrderSchema.index({ tenantId: 1, clientId: 1 }, { unique: true }); // rejeu offline idempotent
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
} as const;
