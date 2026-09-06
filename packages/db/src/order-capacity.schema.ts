import { Schema, type InferSchemaType } from 'mongoose';

const integer = { validator: Number.isInteger, message: 'Une capacité doit être entière.' };
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

const CapacitySlotSchema = new Schema({
  at: { type: Date, required: true },
  kitchenCapacity: { type: Number, required: true, min: 1, max: 100, validate: integer },
  deliveryCapacity: { type: Number, required: true, min: 1, max: 50, validate: integer },
}, { _id: false });

/**
 * Préparation C15, NON activée par le runtime. Une journée ne peut devenir
 * ready qu'après reprise de TOUS ses tickets historiques et de leurs sièges.
 * Aucun endpoint n'expose ce modèle ; le bootstrap et le gel BO restent à livrer.
 * Les bornes/grilles deviennent immuables dès la création, pas au premier achat.
 */
export const OrderCapacityDaySchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, immutable: true,
    validate: (day: string) => {
      const date = new Date(`${day}T12:00:00.000Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
    },
  },
  state: { type: String, enum: [...CAPACITY_STATES], default: 'seeding', required: true },
  slots: {
    type: [CapacitySlotSchema], required: true, immutable: true, default: undefined,
    validate: {
      validator: (slots: { at: Date }[]) => Array.isArray(slots) && slots.length > 0 && slots.length <= 1_000
        && slots.every((slot, index) => Number.isFinite(slot.at?.getTime())
          && (index === 0 || slot.at.getTime() > slots[index - 1]!.at.getTime())),
      message: 'La grille doit contenir de 1 à 1000 créneaux uniques et ordonnés.',
    },
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
