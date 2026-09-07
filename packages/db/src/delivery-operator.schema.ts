import { Schema, type InferSchemaType } from 'mongoose';

const hash = { type: String, match: /^[a-f0-9]{64}$/, required: true };
const InviteSchema = new Schema({ hash, expiresAt: { type: Date, required: true } }, { _id: false });
const SessionSchema = new Schema({
  hash,
  version: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  inviteHash: hash,
  nonceHash: hash,
  retryUntil: { type: Date, required: true },
}, { _id: false });

/** Mutation et preuve sont écrites dans le même document, sans transaction
 * multi-collection ni journal affirmant un changement qui aurait échoué. */
const AccessEventSchema = new Schema({
  at: { type: Date, required: true },
  action: { type: String, enum: ['created', 'enabled', 'revoked', 'invited', 'connected', 'logout'], required: true },
  actorId: { type: String, required: true },
  actorKind: { type: String, enum: ['user', 'staff', 'delivery'], required: true },
  revision: { type: Number, required: true },
}, { _id: false });

/** Droit opérationnel propre à la livraison. Aucun PIN ni privilège RH/caisse. */
export const DeliveryOperatorSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, immutable: true },
  staffId: { type: Schema.Types.ObjectId, ref: 'Staff', default: null, immutable: true },
  name: { type: String, required: true, maxlength: 160 },
  active: { type: Boolean, default: true, required: true },
  revision: { type: Number, default: 0, required: true, min: 0, validate: Number.isSafeInteger },
  /** Empreinte du membre lors de l'habilitation : désactiver puis réactiver un
   * Staff ne ressuscite pas ses anciennes autorisations de livraison. */
  staffSessionVersion: { type: String, default: null, select: false },
  sessionVersion: { type: String, required: true, select: false },
  creationHash: { ...hash, select: false, immutable: true },
  invite: { type: InviteSchema, default: null, select: false },
  session: { type: SessionSchema, default: null, select: false },
  history: { type: [AccessEventSchema], default: [], select: false },
}, { timestamps: true, strict: 'throw' });

DeliveryOperatorSchema.index({ tenantId: 1, createdAt: 1, _id: 1 });
DeliveryOperatorSchema.index({ tenantId: 1, _id: 1 });
DeliveryOperatorSchema.index({ tenantId: 1, staffId: 1 }, {
  unique: true, partialFilterExpression: { staffId: { $type: 'objectId' } },
});
DeliveryOperatorSchema.index({ 'invite.hash': 1 }, { sparse: true });
DeliveryOperatorSchema.index({ 'session.hash': 1 }, { sparse: true });
DeliveryOperatorSchema.index({ 'session.inviteHash': 1 }, { sparse: true });
export type DeliveryOperator = InferSchemaType<typeof DeliveryOperatorSchema>;
