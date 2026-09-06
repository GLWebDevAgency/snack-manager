import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderCapacityDaySchema, ORDER_CAPACITY_INDEXES } from './order-capacity.schema';
import { PublicOrderAdmissionSchema } from './schemas';

const db = new Mongoose();
const Day = db.model('CapacityDaySchemaTest', OrderCapacityDaySchema);
const Admission = db.model('CapacityAdmissionSchemaTest', PublicOrderAdmissionSchema);
const tenantId = '507f1f77bcf86cd799439011';
const slot = new Date('2030-05-02T16:00:00.000Z');
const makeDay = (changes: Record<string, unknown> = {}) => new Day({ tenantId, day: '2030-05-02', slots: [{ at: slot, kitchenCapacity: 2, deliveryCapacity: 1 }], ...changes });

describe('schéma de capacité préparatoire, sans connexion Mongo', () => {
  it('une nouvelle journée est seeding et sa grille ne porte aucun droit runtime implicite', () => {
    const document = makeDay();
    expect(document.validateSync()).toBeUndefined();
    expect(document.state).toBe('seeding');
    expect(OrderCapacityDaySchema.path('slots').options.immutable).toBe(true);
    expect(OrderCapacityDaySchema.path('day').options.immutable).toBe(true);
    expect(OrderCapacityDaySchema.path('tenantId').options.immutable).toBe(true);
  });

  it.each(['not-a-day', '2030-13-02', '2030-02-30'])('refuse une date calendaire invalide %s', (day) => {
    expect(makeDay({ day }).validateSync()).toBeDefined();
  });

  it.each([0, -1, 1.5, 101, NaN, Infinity])('refuse une capacité cuisine invalide %s', (kitchenCapacity) => {
    expect(makeDay({ slots: [{ at: slot, kitchenCapacity, deliveryCapacity: 1 }] }).validateSync()).toBeDefined();
  });

  it.each([0, -1, 1.5, 51, NaN, Infinity])('refuse une capacité livraison invalide %s', (deliveryCapacity) => {
    expect(makeDay({ slots: [{ at: slot, kitchenCapacity: 2, deliveryCapacity }] }).validateSync()).toBeDefined();
  });

  it('refuse une grille vide, dupliquée, désordonnée ou sur une autre date Paris', async () => {
    const same = { at: slot, kitchenCapacity: 2, deliveryCapacity: 1 };
    const later = { ...same, at: new Date(slot.getTime() + 30 * 60_000) };
    for (const slots of [[], [same, same], [later, same], [{ ...same, at: new Date('2030-05-02T22:30:00.000Z') }]]) {
      await expect(makeDay({ slots }).validate()).rejects.toThrow();
    }
  });

  it('ne fabrique aucune place pour une ancienne admission C01', () => {
    expect(new Admission().get('capacity')).toBeUndefined();
    expect(PublicOrderAdmissionSchema.path('capacity').options.select).toBe(false);
  });

  it('origine privée immuable, séparée de la clé unique et rétrocompatible C01', () => {
    expect(new Admission().get('kind')).toBe('public');
    expect(PublicOrderAdmissionSchema.path('kind').options).toMatchObject({ select: false, immutable: true });
    expect(PublicOrderAdmissionSchema.path('channel').options).toMatchObject({ select: false, immutable: true });
    expect(new Admission().get('channel')).toBeUndefined();
    for (const kind of ['public', 'legacy', 'staff']) {
      const row = new Admission({ kind, channel: kind === 'staff' ? 'phone' : 'online' });
      expect(row.get('kind')).toBe(kind);
      expect(row.toObject()).not.toHaveProperty('kind');
      expect(row.toJSON()).not.toHaveProperty('kind');
      expect(row.toJSON()).not.toHaveProperty('channel');
    }
    expect(new Admission({ kind: 'historical_unknown' }).validateSync()?.errors.kind).toBeDefined();
    expect(PublicOrderAdmissionSchema.indexes().some(([keys, options]) => options.unique && 'kind' in keys)).toBe(false);
  });

  it('cache capacity dans les réponses JSON et objet, y compris juste après une écriture', () => {
    const document = new Admission({ capacity: { slot, kitchenSeat: 0, deliverySeat: 0 } });
    expect(document.get('capacity.kitchenSeat')).toBe(0);
    expect(document.toObject()).not.toHaveProperty('capacity');
    expect(document.toJSON()).not.toHaveProperty('capacity');
    expect(JSON.stringify(document)).not.toContain('kitchenSeat');
  });

  it.each(ORDER_CAPACITY_INDEXES)('index $name couvre les admissions engagées et créées sans filtrage de statut', ({ name, field }) => {
    const definition = PublicOrderAdmissionSchema.indexes().find(([, options]) => options.name === name);
    expect(definition?.[0]).toEqual({ tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 });
    expect(definition?.[1]).toMatchObject({ unique: true, partialFilterExpression: { [`capacity.${field}`]: { $type: 'number' } } });
    expect(definition?.[1]).not.toHaveProperty('expireAfterSeconds');
  });
});
