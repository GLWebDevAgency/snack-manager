import { Schema } from 'mongoose';
import { DELIVERY_MISSION_MAX_OPERATIONS, DELIVERY_MISSION_REFUSAL_CODES } from '@sm/contracts';

const integer = { type: Number, min: 0, max: Number.MAX_SAFE_INTEGER, validate: Number.isSafeInteger, required: true };
const uuid = { type: String, match: /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i, required: true };

/** Un seul document Order = affectation et preuve acquittées ensemble, sans transaction multi-documents. */
export const DeliveryMissionSchema = new Schema({
  version: { type: Number, enum: [1], required: true },
  revision: integer,
  assignment: {
    type: new Schema({
      operatorId: { type: Schema.Types.ObjectId, required: true },
      assignmentId: uuid,
      operatorName: { type: String, required: true, maxlength: 160 },
      assignedAt: { type: Date, required: true },
      assignedBy: { type: String, required: true, maxlength: 100 },
    }, { _id: false }), default: null,
  },
  operations: {
    type: [new Schema({
      operationId: uuid,
      fingerprint: { type: String, match: /^[a-f0-9]{64}$/, required: true },
      action: { type: String, enum: ['assign', 'unassign', 'dispatch'], required: true },
      outcome: { type: String, enum: ['applied', 'rejected'], required: true },
      refusalCode: { type: String, enum: [...DELIVERY_MISSION_REFUSAL_CODES, null], default: null },
      reason: { type: String, default: null, maxlength: 200 },
      revision: integer,
      at: { type: Date, required: true },
      actorKind: { type: String, enum: ['user', 'staff', 'delivery'], required: true },
      actorId: { type: String, required: true, maxlength: 100 },
      actorRole: { type: String, default: null, maxlength: 40 },
      actorName: { type: String, default: null, maxlength: 160 },
      previousOperatorId: { type: Schema.Types.ObjectId, default: null },
      operatorId: { type: Schema.Types.ObjectId, default: null },
    }, { _id: false })],
    default: [],
    validate: { validator: (rows: unknown[]) => rows.length <= DELIVERY_MISSION_MAX_OPERATIONS,
      message: 'Limite du journal de mission atteinte : vérification du responsable nécessaire.' },
  },
}, { _id: false });
