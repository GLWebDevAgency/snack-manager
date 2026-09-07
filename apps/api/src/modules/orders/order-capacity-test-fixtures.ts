import { randomUUID } from 'node:crypto';
import { MODELS } from '@sm/db';
import { Types, type Connection } from 'mongoose';
import { addDays, formatDay, parisWallToUtc, parisYmd } from '../ordering/paris-time';

/** Synthetic fixture only. Never a bootstrap API: caller owns an isolated test DB. */
export function capacityModels(db: Connection) {
  return {
    tenants: db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection),
    days: db.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection),
  };
}

export async function seedCapacityFixture(db: Connection, tenantId: string, slot: string, kitchenCapacity = 10) {
  if (!/^snackmanager_(recovery|slot|runtime)_test_[a-z0-9_]+$/i.test(db.name)) throw new Error('Isolated capacity fixture DB required');
  const models = capacityModels(db);
  const day = parisYmd(new Date(slot));
  await models.days.init();
  await models.tenants.collection.updateOne({ _id: new Types.ObjectId(tenantId) }, { $set: {
    name: 'Restaurant de test', slug: 'isolated-capacity',
    settings: { slotIntervalMin: 30, slotCapacity: kitchenCapacity },
    capacityControl: { version: 1, state: 'active', bootstrapId: randomUUID(), cutoverAt: parisWallToUtc(day), configRevision: 0, dayIntent: null },
  } }, { upsert: true });
  await models.days.collection.deleteMany({ tenantId: new Types.ObjectId(tenantId) });
  await models.days.create({ tenantId, day: formatDay(day), sourceRevision: 0, state: 'ready', closedReason: null,
    slots: [{ at: new Date(slot), kitchenCapacity, deliveryCapacity: kitchenCapacity <= 50 ? kitchenCapacity : 50 }] });
  return { ...models, dayEnd: parisWallToUtc(addDays(day, 1)) };
}
