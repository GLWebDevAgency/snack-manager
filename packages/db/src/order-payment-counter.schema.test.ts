import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

const Order = new Mongoose().model('CounterSwitchOrder', OrderSchema);
function order(paymentFlow?: unknown) {
  return new Order({ tenantId: new Types.ObjectId(), number: 1, clientId: 'schema-test', channel: 'online', type: 'pickup',
    lines: [], totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' },
    ...(paymentFlow === undefined ? {} : { paymentFlow }),
  });
}
const close = { operationId: 'closure', reason: 'Client', requestedBy: 'customer-tracking', requestedAt: new Date() };

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
