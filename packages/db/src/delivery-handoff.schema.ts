import { Schema, type InferSchemaType } from 'mongoose';
import { DELIVERY_HANDOFF_INCIDENT_CODES, DELIVERY_HANDOFF_MAX_FAILURES, DELIVERY_HANDOFF_MAX_OPERATIONS, DELIVERY_HANDOFF_REFUSAL_CODES } from '@sm/contracts';

const integer = { type: Number, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger, required: true };
const uuid = { type: String, match: /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, required: true };
const actor = {
  actorKind: { type: String, enum: ['user', 'staff', 'delivery'], required: true },
  actorId: { type: String, required: true, maxlength: 100 },
};
const hash = { type: String, match: /^[a-f0-9]{64}$/, required: true };

/** Secret chiffré et preuves de remise acquittés avec Order ; aucun TTL ni troncature. */
export const DeliveryHandoffSchema = new Schema({
  version: { type: Number, enum: [1], required: true },
  revision: integer,
  proof: { type: new Schema({
    id: uuid,
    sealed: { type: String, required: true, maxlength: 512 },
    createdAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    failedAttempts: { ...integer, max: DELIVERY_HANDOFF_MAX_FAILURES },
    assignmentId: { ...uuid, required: false, default: null },
  }, { _id: false }), default: null },
  incident: { type: new Schema({
    code: { type: String, enum: DELIVERY_HANDOFF_INCIDENT_CODES, required: true },
    reportedAt: { type: Date, required: true }, ...actor,
  }, { _id: false }), default: null },
  completed: { type: new Schema({
    at: { type: Date, required: true },
    method: { type: String, enum: ['pin', 'qr', 'override'], required: true },
    operationId: uuid, ...actor,
  }, { _id: false }), default: null },
  operations: { type: [new Schema({
    operationId: uuid,
    intentFingerprint: hash,
    fingerprint: { ...hash, required: false, default: null },
    action: { type: String, enum: ['handoff', 'incident', 'override', 'rotate'], required: true },
    outcome: { type: String, enum: ['applied', 'rejected', 'abandoned'], required: true },
    refusalCode: { type: String, enum: [...DELIVERY_HANDOFF_REFUSAL_CODES, null], default: null },
    revision: integer, expectedRevision: integer, expectedMissionRevision: integer,
    at: { type: Date, required: true }, ...actor,
    actorRole: { type: String, default: null, maxlength: 40 },
    actorName: { type: String, default: null, maxlength: 160 },
    reason: { type: String, default: null, maxlength: 300 },
  }, { _id: false })], default: [],
  validate: { validator: (rows: unknown[]) => rows.length <= DELIVERY_HANDOFF_MAX_OPERATIONS,
    message: 'Le journal de remise est complet : vérification du responsable nécessaire.' } },
}, { _id: false });

export type DeliveryHandoffRecord = InferSchemaType<typeof DeliveryHandoffSchema>;
