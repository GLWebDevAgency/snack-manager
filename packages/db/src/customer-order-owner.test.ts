import { randomUUID } from 'node:crypto';
import { model, type Model } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema, PublicOrderAdmissionSchema } from './schemas';

const owner = { tenantRef: '507f1f77bcf86cd799439011', parentRef: `AC${'a'.repeat(32)}`, accountId: randomUUID() };
const Order = model('CustomerOwnerOrderFixture', OrderSchema);
const Admission = model('CustomerOwnerAdmissionFixture', PublicOrderAdmissionSchema);
const models = [Order, Admission] as unknown as Model<Record<string, unknown>>[];

describe('private immutable owner snapshots', () => {
  it.each(models)('retains only the internal raw snapshot, never normal serializers', (Model) => {
    const row = new Model({ customerOwner: owner });
    expect(row.toObject({ transform: false }).customerOwner).toEqual(owner);
    expect(Object.hasOwn(row.toObject(), 'customerOwner')).toBe(false);
    expect(Object.hasOwn(row.toJSON(), 'customerOwner')).toBe(false);
    expect(Model.schema.path('customerOwner').options.select).toBe(false);
    expect(Model.schema.path('customerOwner').options.immutable).toBe(true);
  });
  it.each(models)('does not infer ownership for an old guest', (Model) => {
    expect(new Model({}).toObject({ transform: false }).customerOwner).toBeNull();
  });
});
