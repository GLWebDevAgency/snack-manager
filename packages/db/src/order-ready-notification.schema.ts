import { Schema, type InferSchemaType } from 'mongoose';
import { ORDER_PUSH_MAX_SUBSCRIPTIONS } from '@sm/contracts';

const Subscription = new Schema({
  endpointHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  generation: { type: String, required: true },
  /** AES-256-GCM : URL d'abonnement et clés, jamais en clair dans Mongo. */
  encrypted: { type: String, default: null, select: false },
  state: { type: String, enum: ['active', 'sent', 'revoked', 'expired', 'failed'], required: true },
  expiresAt: { type: Date, required: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, required: true },
  sentAt: { type: Date, default: null },
}, { _id: false });

/** Un document arbitre la borne d'abonnements et le bail de tous les réplicas. */
export const OrderReadyNotificationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  orderId: { type: Schema.Types.ObjectId, required: true },
  slug: { type: String, required: true },
  subscriptions: { type: [Subscription], default: [], validate: {
    validator: (rows: { endpointHash: string }[]) => rows.length <= ORDER_PUSH_MAX_SUBSCRIPTIONS
      && new Set(rows.map((row) => row.endpointHash)).size === rows.length,
    message: 'Abonnements de commande invalides',
  } },
  expiresAt: { type: Date, required: true },
  nextAttemptAt: { type: Date, default: null },
  leaseOwner: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  revision: { type: Number, default: 0 },
}, { timestamps: true });
OrderReadyNotificationSchema.index({ tenantId: 1, orderId: 1 }, { unique: true });
OrderReadyNotificationSchema.index({ nextAttemptAt: 1, leaseUntil: 1 });
OrderReadyNotificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export type OrderReadyNotification = InferSchemaType<typeof OrderReadyNotificationSchema>;
