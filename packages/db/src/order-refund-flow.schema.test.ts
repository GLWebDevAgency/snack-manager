import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

const odm = new Mongoose();
odm.set('autoCreate', false); odm.set('autoIndex', false);
const Order = odm.model('OrderRefundFlowFixture', OrderSchema.clone().set('bufferCommands', false));
const operationId = 'c7960d64-2528-4e7c-bde5-792472c69f57';
const preparedAt = new Date('2026-09-10T09:00:00.000Z');
const operation = () => ({ operationId, amountCents: 1250, reason: 'Demande du client', actorId: 'operator-fixture',
  environment: 'test', paymentIntentId: 'pi_refund_fixture', accountId: 'acct_refund_fixture',
  idempotencyKey: 'refund-fixture-private-key', preparedAt, requestStartedAt: null, state: 'prepared' });
const proof = () => ({ id: 're_refund_fixture', amount: 1250, currency: 'eur', payment_intent: 'pi_refund_fixture',
  status: 'succeeded', metadata: { operationId, tenantId: 'fixture-tenant' } });
function order(refundFlow?: unknown) {
  return new Order({ tenantId: new Types.ObjectId(), number: 1, clientId: 'refund-schema-fixture',
    channel: 'online', type: 'pickup', lines: [], totals: { subtotal: 1250, total: 1250 },
    payment: { method: 'online', status: 'paid' }, ...(refundFlow === undefined ? {} : { refundFlow }) });
}
function flow(patch: Record<string, unknown> = {}) { return { version: 1, operations: [{ ...operation(), ...patch }] }; }

describe('journal privé des intentions de remboursement — ODM natif sans serveur', () => {
  it('ne fabrique aucune intention pour une commande neuve ou historique sans journal', () => {
    const fresh = order();
    const historical = Order.hydrate(fresh.toObject({ transform: false }));
    for (const doc of [fresh, historical]) {
      expect(doc.validateSync()).toBeUndefined();
      expect(doc.get('refundFlow')).toBeNull();
    }
  });
  it('persiste une préparation exacte, sans preuve ni horloge ou identifiants générés', async () => {
    const doc = order(flow());
    expect(doc.validateSync()).toBeUndefined();
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.toObject({ transform: false })).toHaveProperty('refundFlow', flow());
    const value = doc.get('refundFlow.operations.0');
    expect(value.get('refund')).toBeUndefined();
    expect(value.get('providerCheckedAt')).toBeUndefined();
    expect(value.get('reviewReason')).toBeUndefined();
    expect(value.get('_id')).toBeUndefined();
  });
  it.each(['prepared', 'creating', 'known', 'review_required'])('accepte l’état explicite %s et ses dates réelles', state => {
    const doc = order(flow({ state, requestStartedAt: preparedAt, providerCheckedAt: preparedAt,
      refund: proof(), reviewReason: 'provider_read_required', accountId: null }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.toObject({ transform: false, flattenMaps: true })).toHaveProperty('refundFlow.operations.0.refund', proof());
    expect(doc.get('refundFlow.operations.0.requestStartedAt')).toEqual(preparedAt);
  });
  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])('accepte le statut fournisseur %s sans l’interpréter', status => {
    const doc = order(flow({ state: 'known', refund: { ...proof(), status } }));
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.get('refundFlow.operations.0.refund.status')).toBe(status);
  });
  it('masque la clé et ses valeurs privées dans les trois sérialisations publiques, même avant save', () => {
    const doc = order(flow({ refund: proof() }));
    expect(doc.get('refundFlow.operations.0.idempotencyKey')).toBe(operation().idempotencyKey);
    expect(Order.schema.path('refundFlow').options.select).toBe(false);
    for (const output of [doc.toObject(), doc.toJSON(), JSON.parse(JSON.stringify(doc))]) {
      expect(output).not.toHaveProperty('refundFlow');
      const text = JSON.stringify(output);
      for (const secret of [operationId, operation().idempotencyKey, operation().actorId, proof().id]) expect(text).not.toContain(secret);
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER, 100_000_001, '1250'])('refuse un montant invalide %s sans coercition', amountCents => {
    expect(order(flow({ amountCents })).validateSync()).toBeDefined();
  });
  it.each([1, 100_000_000])('accepte la borne monétaire %s', amountCents => {
    const doc = order(flow({ amountCents }));
    expect(doc.validateSync()).toBeUndefined(); expect(doc.get('refundFlow.operations.0.amountCents')).toBe(amountCents);
  });
  it.each([
    { operationId: undefined }, { operationId: 'invalid' }, { operationId: `${operationId}\n` },
    { reason: 'ab' }, { reason: 'a'.repeat(201) }, { reason: 123 },
    { actorId: '' }, { actorId: 123 }, { environment: 'sandbox' },
    { paymentIntentId: '' }, { idempotencyKey: '' }, { accountId: '' }, { accountId: 123 },
    { state: undefined }, { state: 'completed' },
    { preparedAt: undefined }, { preparedAt: new Date(NaN) }, { preparedAt: 'not-a-date' },
    { requestStartedAt: new Date(NaN) }, { providerCheckedAt: 'not-a-date' },
    { reviewReason: 123 }, { unknown: 'not-a-field' },
  ])('refuse les champs d’opération malformés %#', patch => {
    expect(order(flow(patch)).validateSync()).toBeDefined();
  });
  it.each([
    { id: '' }, { id: 123 }, { amount: 0 }, { amount: 0.5 }, { amount: 100_000_001 }, { amount: '1250' },
    { currency: 'usd' }, { status: 'unknown' }, { payment_intent: '' },
    { metadata: { amount: 1250 } }, { unknown: 'not-a-field' },
  ])('refuse une preuve fournisseur malformée %#', patch => {
    expect(order(flow({ refund: { ...proof(), ...patch } })).validateSync()).toBeDefined();
  });
  it.each([{ version: 2, operations: [] }, { version: '1', operations: [] }, { operations: [] },
    { version: 1 }, { version: 1, operations: {} }, { version: 1, operations: [], unknown: true }])('refuse un journal incomplet ou inconnu %#', value => {
    expect(order(value).validateSync()).toBeDefined();
  });
  it('borne le journal à 128 opérations, sans tronquer ni fabriquer une liste absente', () => {
    const operations = Array.from({ length: 128 }, (_, index) => ({ ...operation(), operationId: `c7960d64-2528-4e7c-bde5-${index.toString(16).padStart(12, '0')}` }));
    const doc = order({ version: 1, operations });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.get('refundFlow.operations')).toHaveLength(128);
    expect(order({ version: 1, operations: [...operations, operation()] }).validateSync()).toBeDefined();
    const empty = order({ version: 1, operations: [] });
    expect(empty.validateSync()).toBeUndefined(); expect(empty.get('refundFlow.operations')).toHaveLength(0);
  });
});
