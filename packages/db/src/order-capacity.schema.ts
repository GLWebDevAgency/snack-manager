import { Schema, Types, type InferSchemaType } from 'mongoose';

const integer = { validator: Number.isInteger, message: 'Une capacité doit être entière.' };
const safeInteger = { validator: Number.isSafeInteger, message: 'Une révision doit être un entier sûr.' };
const CLOSED_REASONS = ['no_service', 'exceptional_closure'] as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CAPACITY_STATES = ['seeding', 'ready', 'blocked'] as const;
const parisDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
});
export const ORDER_CAPACITY_DAY_INDEX = 'order_capacity_day_unique';

/** Pas de version dans la clé d'un créneau : changer de version ne libère aucune place. */
export const OrderCapacityClaimSchema = new Schema({
  slot: { type: Date, required: true },
  kitchenSeat: { type: Number, min: 0, max: 99, validate: integer },
  deliverySeat: { type: Number, min: 0, max: 49, validate: integer },
  releasedAt: { type: Date },
}, { _id: false });

/** Provenance d'un import d'Order existante, jamais une preuve de requête/reprise. */
export const HistoricalOrderAdmissionImportSchema = new Schema({
  version: { type: Number, enum: [1], required: true, immutable: true },
  bootstrapId: { type: String, required: true, match: UUID, immutable: true },
  importedAt: { type: Date, required: true, immutable: true },
}, { _id: false, strict: 'throw' });
export type HistoricalOrderAdmissionImport = InferSchemaType<typeof HistoricalOrderAdmissionImportSchema>;

/** Validation locale d'un import terminal. L'existence/annulation de l'Order,
 * le type livraison et les bornes du calendrier sont vérifiés par le store.
 * Le ODM caste ses Date/ObjectId ; un lecteur de données BSON persistées doit
 * donc encore refuser explicitement les types bruts corrompus avant construction.
 */
export function validHistoricalOrderAdmission(value: unknown): boolean {
  if (!record(value) || value.kind !== 'historical' || value.version !== 1 || value.state !== 'created'
    || typeof value._id !== 'string' || !/^[a-f0-9]{64}$/.test(value._id)
    || !(value.tenantId instanceof Types.ObjectId) || !(value.orderId instanceof Types.ObjectId)
    || typeof value.clientId !== 'string' || value.clientId.trim().length === 0
    || !['online', 'pos', 'phone'].includes(value.channel as string)
    || !(value.slot instanceof Date) || !Number.isFinite(value.slot.getTime())
    || ['proofHash', 'payloadHash', 'validationOwner', 'snapshot', 'rejection'].some((key) => value[key] !== undefined)) return false;
  const provenance = value.historicalImport;
  if (!record(provenance) || provenance.version !== 1 || typeof provenance.bootstrapId !== 'string'
    || !UUID.test(provenance.bootstrapId) || !(provenance.importedAt instanceof Date)
    || !Number.isFinite(provenance.importedAt.getTime())) return false;
  const claim = value.capacity;
  if (!record(claim) || !(claim.slot instanceof Date) || claim.slot.getTime() !== value.slot.getTime()) return false;
  if (claim.releasedAt !== undefined) {
    return claim.releasedAt instanceof Date && Number.isFinite(claim.releasedAt.getTime())
      && claim.kitchenSeat === undefined && claim.deliverySeat === undefined;
  }
  return typeof claim.kitchenSeat === 'number' && Number.isInteger(claim.kitchenSeat)
    && claim.kitchenSeat >= 0 && claim.kitchenSeat <= 99
    && (claim.deliverySeat === undefined || (typeof claim.deliverySeat === 'number'
      && Number.isInteger(claim.deliverySeat) && claim.deliverySeat >= 0 && claim.deliverySeat <= 49));
}

const CapacitySlotSchema = new Schema({
  at: { type: Date, required: true },
  kitchenCapacity: { type: Number, required: true, min: 1, max: 100, validate: integer },
  deliveryCapacity: { type: Number, required: true, min: 1, max: 50, validate: integer },
}, { _id: false });

function civilDay(day: unknown): day is string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

function validGrid(day: unknown, slots: unknown, closedReason: unknown): boolean {
  if (!civilDay(day) || !Array.isArray(slots) || slots.length > 1_000) return false;
  if (slots.length === 0) return CLOSED_REASONS.some((reason) => reason === closedReason);
  if (closedReason !== null) return false;
  return slots.every((slot: { at?: Date }, index) => slot?.at instanceof Date && Number.isFinite(slot.at.getTime())
    && parisDay.format(slot.at) === day && (index === 0 || slot.at.getTime() > slots[index - 1].at.getTime()));
}

const gridValidator = {
  validator: function (this: { day?: unknown; closedReason?: unknown }, slots: unknown) {
    return validGrid(this.day, slots, this.closedReason);
  },
  message: 'La grille doit contenir au plus 1000 créneaux ordonnés du jour Paris ; une grille vide exige une raison de fermeture, sinon la raison doit être null.',
};

/** Un seul plan borné, sans commandes/clients ; le CAS d'activation appartient au store. */
export const OrderCapacityDayIntentSchema = new Schema({
  operationId: { type: String, required: true, match: UUID },
  day: { type: String, required: true, validate: civilDay },
  sourceRevision: { type: Number, required: true, min: 0, validate: safeInteger },
  planHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  slots: { type: [CapacitySlotSchema.clone().set('strict', 'throw')], required: true, default: undefined, validate: gridValidator },
  closedReason: { type: String, enum: [...CLOSED_REASONS, null], default: null },
}, { _id: false, strict: 'throw' });
export type OrderCapacityDayIntent = InferSchemaType<typeof OrderCapacityDayIntentSchema>;

/** Aucun champ ne crée un contrôle actif implicitement sur un ancien tenant. */
export const OrderCapacityControlSchema = new Schema({
  version: { type: Number, enum: [1], required: true },
  state: { type: String, enum: ['seeding', 'active', 'blocked'], required: true },
  configRevision: { type: Number, required: true, min: 0, validate: safeInteger },
  bootstrapId: { type: String, required: true, match: UUID },
  cutoverAt: { type: Date, required: true },
  dayIntent: { type: OrderCapacityDayIntentSchema, default: null },
}, { _id: false, strict: 'throw' });
export type OrderCapacityControl = InferSchemaType<typeof OrderCapacityControlSchema>;

/**
 * Préparation C15, NON activée par le runtime. Une journée ne peut devenir
 * ready qu'après reprise de TOUS ses tickets historiques et de leurs sièges.
 * Aucun endpoint n'expose ce modèle ; le bootstrap et le gel BO restent à livrer.
 * Les bornes/grilles deviennent immuables dès la création, pas au premier achat.
 */
export const OrderCapacityDaySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  day: { type: String, required: true, validate: civilDay, immutable: true },
  state: { type: String, enum: [...CAPACITY_STATES], default: 'seeding', required: true },
  closedReason: { type: String, enum: [...CLOSED_REASONS, null], default: null, immutable: true },
  sourceRevision: { type: Number, min: 0, validate: safeInteger, immutable: true },
  slots: {
    type: [CapacitySlotSchema], required: true, immutable: true, default: undefined,
    validate: gridValidator,
  },
}, { timestamps: true });

function immutableCalendar(): Error {
  return new Error('Le calendrier de capacité est immuable : seul son état peut être modifié.');
}

function assertPersistentDocument(document: {
  isNew: boolean; state: unknown; modifiedPaths(): string[];
}): void {
  if (document.isNew) return;
  // immutable:true sur l'ARRAY n'interdit pas une modification de ses enfants.
  // Le second hook save ferme aussi validateBeforeSave:false / bulkSave.
  if (document.modifiedPaths().some((path) => !['state', 'updatedAt', '__v'].includes(path))
    || !CAPACITY_STATES.some((state) => state === document.state)) throw immutableCalendar();
}

OrderCapacityDaySchema.pre('validate', function () {
  assertPersistentDocument(this);
  if (this.slots?.some((slot) => Number.isFinite(slot.at?.getTime()) && parisDay.format(slot.at) !== this.day)) {
    this.invalidate('slots', 'Tous les créneaux doivent appartenir à la journée du restaurant (Europe/Paris).');
  }
});
OrderCapacityDaySchema.pre('save', function () { assertPersistentDocument(this); });

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Liste positive : aucune expression, pipeline, opération tableau ou upsert. */
function assertStateUpdate(update: unknown, options: { upsert?: boolean; overwrite?: boolean } = {}): void {
  if (!record(update) || options.upsert || options.overwrite) throw immutableCalendar();
  const state = (value: unknown) => {
    if (!CAPACITY_STATES.some((allowed) => value === allowed)) throw immutableCalendar();
  };
  for (const [operator, fields] of Object.entries(update)) {
    if (operator === 'state') { state(fields); continue; }
    if (!['$set', '$setOnInsert'].includes(operator) || !record(fields)) throw immutableCalendar();
    for (const [path, value] of Object.entries(fields)) {
      if (operator === '$set' && path === 'state') { state(value); continue; }
      // Timestamps ajoutés par Mongoose. $setOnInsert ne s'applique jamais,
      // puisque les upserts sont interdits ; il ne peut porter que createdAt.
      const timestamp = operator === '$set' ? path === 'updatedAt' : path === 'createdAt';
      if (!timestamp || !(value instanceof Date) || !Number.isFinite(value.getTime())) throw immutableCalendar();
    }
  }
}

OrderCapacityDaySchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function () {
  assertStateUpdate(this.getUpdate(), this.getOptions());
});
OrderCapacityDaySchema.pre(['replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
  throw immutableCalendar();
});
OrderCapacityDaySchema.pre('deleteOne', { document: true, query: false }, function () { throw immutableCalendar(); });

// Mongoose8.24 déclenche réellement ce middleware AVANT le cast et l'envoi
// du lot (Model.bulkWrite). Valider le lot entier évite une écriture partielle.
OrderCapacityDaySchema.pre('bulkWrite', function (next, operations) {
  for (const operation of operations) {
    const keys = Object.keys(operation);
    if (keys.length !== 1 || !['updateOne', 'updateMany'].includes(keys[0]!)) throw immutableCalendar();
    const entry = (operation as Record<string, unknown>)[keys[0]!];
    if (!record(entry)) throw immutableCalendar();
    assertStateUpdate(entry.update, entry);
  }
  next();
});
OrderCapacityDaySchema.pre('insertMany', function () { throw immutableCalendar(); });

function containsAggregateWrite(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAggregateWrite);
  return record(value) && Object.entries(value).some(([key, nested]) =>
    key === '$out' || key === '$merge' || containsAggregateWrite(nested));
}
OrderCapacityDaySchema.pre('aggregate', function () {
  if (containsAggregateWrite(this.pipeline())) throw immutableCalendar();
});

/**
 * Frontière ODM, pas ACL Mongo : collection/db/driver natifs, commandes admin
 * et retrait de middleware restent hors garantie. Le bootstrap doit créer une
 * journée par new Model().save()/Model.create() et garder son index unique.
 * Une correction de calendrier nécessite un protocole dédié, jamais delete puis
 * recréation. Aucun bypass de maintenance n'est exposé par ce schéma.
 */
OrderCapacityDaySchema.index({ tenantId: 1, day: 1 }, { name: ORDER_CAPACITY_DAY_INDEX, unique: true });
export type OrderCapacityDay = InferSchemaType<typeof OrderCapacityDaySchema>;

/** L'index couvre aussi les admissions created, jusqu'à libération explicite. */
export const ORDER_CAPACITY_INDEXES = [
  { name: 'order_capacity_kitchen_seat_unique', field: 'kitchenSeat' },
  { name: 'order_capacity_delivery_seat_unique', field: 'deliverySeat' },
] as const;
