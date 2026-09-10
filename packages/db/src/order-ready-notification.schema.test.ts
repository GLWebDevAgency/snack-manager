import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderReadyNotificationSchema } from './order-ready-notification.schema';
const Notice = mongoose.model('OrderPushSchemaTest', OrderReadyNotificationSchema);
const row = (index = 0) => ({ endpointHash: index.toString(16).padStart(64, '0'), generation: 'generation', state: 'active', encrypted: 'v1.encrypted', expiresAt: new Date(), nextAttemptAt: new Date() });
const base = () => ({ tenantId: new mongoose.Types.ObjectId(), orderId: new mongoose.Types.ObjectId(), slug: 'restaurant', expiresAt: new Date() });
describe('stockage durable des alertes de commande', () => {
  it('borne et déduplique les abonnements, conserve une révision et masque les clés', () => {
    const doc = new Notice({ ...base(), subscriptions: [row()] });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.revision).toBe(0); expect(doc.leaseOwner).toBeNull(); expect(doc.nextAttemptAt).toBeNull();
    expect(OrderReadyNotificationSchema.path('subscriptions').schema!.path('encrypted').options.select).toBe(false);
    expect(new Notice({ ...base(), subscriptions: [row(), row()] }).validateSync()).toBeDefined();
    expect(new Notice({ ...base(), subscriptions: Array.from({ length: 6 }, (_, i) => row(i)) }).validateSync()).toBeDefined();
  });
  it('déclare unicité tenant/commande, recherche du travail et TTL serveur', () => {
    const indexes = OrderReadyNotificationSchema.indexes();
    expect(indexes).toContainEqual([{ tenantId: 1, orderId: 1 }, expect.objectContaining({ unique: true })]);
    expect(indexes).toContainEqual([{ nextAttemptAt: 1, leaseUntil: 1 }, expect.any(Object)]);
    expect(indexes).toContainEqual([{ expiresAt: 1 }, expect.objectContaining({ expireAfterSeconds: 0 })]);
  });
});
