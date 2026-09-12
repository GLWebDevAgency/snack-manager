import { Schema, type InferSchemaType } from 'mongoose';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const actor = new Schema({ sub: { type: String, required: true }, role: { type: String, required: true }, kind: { type: String, required: true } }, { _id: false });
const receipt = new Schema({
  id: { type: String, match: uuid, required: true }, hash: { type: String, required: true },
  kind: { type: String, enum: ['table.create', 'table.update', 'session.open', 'session.transfer', 'session.close', 'session.order'], required: true },
  outcome: { type: String, enum: ['applied', 'rejected'], default: 'applied', required: true },
  at: { type: Date, required: true }, actor: { type: actor, required: true }, meta: { type: Schema.Types.Mixed, required: true },
}, { _id: false });

export const DiningTableSchema = new Schema({
  _id: { type: String, required: true }, tenantId: { type: Schema.Types.ObjectId, required: true },
  publicId: { type: String, match: uuid, required: true }, label: { type: String, required: true, maxlength: 40 },
  labelKey: { type: String, required: true }, seats: { type: Number, required: true, min: 1, max: 100 },
  state: { type: String, enum: ['creating', 'created', 'rejected'], default: 'created', required: true },
  rejection: { type: String, default: null },
  position: { type: Number, min: 0, max: 199, default: null },
  active: { type: Boolean, required: true }, revision: { type: Number, required: true, min: 0 },
  operations: { type: [receipt], required: true, select: false },
  /** Pending accepted attributions only; removed after the session decision.
   * Acceptance shares this document's revision with configuration changes. */
  grants: { type: [new Schema({
    operationId: { type: String, required: true }, sessionId: { type: String, required: true }, payloadHash: { type: String, required: true },
    guestCount: { type: Number, required: true }, tableLabel: { type: String, required: true }, seats: { type: Number, required: true },
    acceptedAt: { type: Date, required: true },
  }, { _id: false })], default: [], select: false },
}, { timestamps: true });
export const DINING_TABLE_LABEL_INDEX = 'dining_table_label';
export const DINING_TABLE_POSITION_INDEX = 'dining_table_position';
DiningTableSchema.index({ tenantId: 1, labelKey: 1 }, { unique: true, name: DINING_TABLE_LABEL_INDEX, partialFilterExpression: { state: 'created' } });
DiningTableSchema.index({ tenantId: 1, position: 1 }, { unique: true, name: DINING_TABLE_POSITION_INDEX, partialFilterExpression: { state: 'created' } });
export type DiningTableRecord = InferSchemaType<typeof DiningTableSchema>;

/** One document owns a table occupancy and every committed kitchen admission.
 * No lease or TTL can release an uncertain service. Closed services retain their receipts. */
export const DiningSessionSchema = new Schema({
  _id: { type: String, required: true }, tenantId: { type: Schema.Types.ObjectId, required: true },
  publicId: { type: String, match: uuid, required: true }, tableId: { type: String, match: uuid, required: true },
  tableLabel: { type: String, required: true }, guestCount: { type: Number, required: true, min: 1, max: 100 },
  state: { type: String, enum: ['opening', 'open', 'closed', 'rejected'], required: true }, revision: { type: Number, required: true, min: 0 },
  rejection: { type: String, default: null },
  openedAt: { type: Date, required: true }, closedAt: { type: Date, default: null },
  operations: { type: [receipt], required: true, select: false },
  admissions: { type: [new Schema({
    clientId: { type: String, match: uuid, required: true }, hash: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, required: true }, state: { type: String, enum: ['committing', 'created'], required: true },
    snapshot: { type: Schema.Types.Mixed, default: null },
  }, { _id: false })], required: true, select: false },
}, { timestamps: true });
export const DINING_ACTIVE_TABLE_INDEX = 'dining_active_table';
export const DINING_ORDER_ADMISSION_INDEX = 'dining_order_admission';
DiningSessionSchema.index({ tenantId: 1, tableId: 1 }, { name: DINING_ACTIVE_TABLE_INDEX, unique: true, partialFilterExpression: { state: 'open' } });
DiningSessionSchema.index({ tenantId: 1, state: 1 });
DiningSessionSchema.index({ tenantId: 1, 'admissions.clientId': 1 }, { name: DINING_ORDER_ADMISSION_INDEX, unique: true, partialFilterExpression: { 'admissions.clientId': { $type: 'string' } } });
export type DiningSessionRecord = InferSchemaType<typeof DiningSessionSchema>;
