import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';
import { randomUUID } from 'node:crypto';

const Order = new Mongoose().model('CounterSwitchOrder', OrderSchema);
function order(paymentFlow?: unknown) {
  return new Order({ tenantId: new Types.ObjectId(), number: 1, clientId: 'schema-test', channel: 'online', type: 'pickup',
    lines: [], totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' },
    ...(paymentFlow === undefined ? {} : { paymentFlow }),
  });
}
const close = { operationId: 'closure', reason: 'Client', requestedBy: 'customer-tracking', requestedAt: new Date() };

describe('preuve privée d’encaissement explicite', () => {
  const receipt = () => ({ operationId: randomUUID(), amountCents: 1250, tender: 'cash',
    cashReceivedCents: 2000, changeGivenCents: 750, collectedAt: new Date(),
    actor: { sub: 'cashier', role: 'caisse', kind: 'staff' } });
  it('ne fabrique aucune confirmation pour une commande historique', () => {
    expect(order().counterCollection).toBeNull();
  });
  it.each(['cash', 'card', 'meal_voucher'])('persiste la confirmation %s sans exposer l’opération ou son auteur', (tender) => {
    const doc = order();
    doc.set('counterCollection', { ...receipt(), tender, ...(tender !== 'cash' ? { cashReceivedCents: null, changeGivenCents: null } : {}) });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.counterCollection?.tender).toBe(tender);
    expect(OrderSchema.path('counterCollection').options.select).toBe(false);
    expect(doc.toObject()).not.toHaveProperty('counterCollection');
    expect(doc.toJSON()).not.toHaveProperty('counterCollection');
  });
  it.each([{ amountCents: 1.5 }, { cashReceivedCents: -1 }, { changeGivenCents: 0.1 }, { tender: 'online' },
    { actor: { sub: 'kitchen', role: 'cuisine', kind: 'staff' } }])('refuse une preuve invalide %j', (patch) => {
    const doc = order(); doc.set('counterCollection', { ...receipt(), ...patch });
    expect(doc.validateSync()).toBeDefined();
  });
});

describe('preuve privée de bascule du paiement au comptoir', () => {
  it('ne fabrique aucune preuve pour les anciennes commandes', () => {
    const doc = order();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.paymentFlow).toBeNull();
  });
  it('une fermeture historique sans destination reste une annulation', () => {
    const doc = order({ version: 1, origin: 'created_v1', phase: 'closing', close });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.paymentFlow?.close?.destination).toBe('cancel_order');
  });
  it('persiste counter_ready sans exposer la preuve aux consommateurs JSON/object', () => {
    const doc = order({ version: 1, origin: 'created_v1', phase: 'counter_ready',
      close: { ...close, destination: 'counter' }, providerStatus: 'not_started', providerCheckedAt: new Date() });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.paymentFlow?.phase).toBe('counter_ready');
    expect(doc.paymentFlow?.close?.destination).toBe('counter');
    expect(OrderSchema.path('paymentFlow').options.select).toBe(false);
    expect(doc.toObject()).not.toHaveProperty('paymentFlow');
    expect(doc.toJSON()).not.toHaveProperty('paymentFlow');
  });
  it('refuse toute autre destination de fermeture même hors HTTP', () => {
    const doc = order({ version: 1, origin: 'created_v1', phase: 'closing', close: { ...close, destination: 'reset_bank' } });
    expect(Object.keys(doc.validateSync()?.errors ?? {})).toContain('paymentFlow.close.destination');
  });
});
