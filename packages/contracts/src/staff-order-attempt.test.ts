import { describe, expect, it } from 'vitest';
import { StaffOrderAttemptResultSchema, StaffPhoneOrderAttemptRequestSchema } from './staff-order-attempt';

const identity = { tenantId: '507f1f77bcf86cd799439011', clientId: '9d0903d7-b011-47f1-b165-1e63f9e1a026', channel: 'phone' };
const order = { _id: '507f1f77bcf86cd799439012', ...identity, type: 'pickup', number: 12, status: 'new',
  pickup: { slot: '2030-05-02T09:00:00.000Z', customerName: 'Client de recette', customerPhone: null },
  lines: [{ productId: '507f1f77bcf86cd799439013', qty: 1, unitPrice: 1250, options: [], removed: [] }],
  totals: { total: 1250 }, payment: { method: 'counter', status: 'pending', tender: null }, trackingToken: 'fixture-token' };
const created = { ...identity, state: 'created', order };
const request = { clientId: identity.clientId, channel: 'phone', type: 'pickup',
  lines: [{ productId: '507f1f77bcf86cd799439013', qty: 1, options: [], removed: [] }], payment: { method: 'counter' },
  pickup: { slot: '2030-05-02T09:00:00.000Z', customerName: 'Client de recette', customerPhone: '0600000000' } };

describe('corps téléphone partagé et borné', () => {
  it('le corps normal est inchangé, sans transformer les champs participant à son empreinte', () => {
    expect(StaffPhoneOrderAttemptRequestSchema.parse(request)).toEqual(request);
  });
  it('les défauts options/retraits/quantité et tender null restent compatibles', () => {
    expect(StaffPhoneOrderAttemptRequestSchema.parse({ ...request, lines: [{ productId: request.lines[0]!.productId }],
      payment: { method: 'counter', tender: null } })).toEqual({ ...request, payment: { method: 'counter', tender: null } });
  });
  it('accepte les bornes exactes', () => {
    const line = { ...request.lines[0]!, qty: 50, variantKey: 'v'.repeat(120), note: 'n'.repeat(200),
      options: Array.from({ length: 30 }, () => ({ groupKey: 'g'.repeat(120), choiceKey: 'c'.repeat(120) })), removed: Array(20).fill('r'.repeat(60)) };
    expect(StaffPhoneOrderAttemptRequestSchema.safeParse({ ...request, lines: Array(50).fill(line),
      pickup: { ...request.pickup, customerName: 'n'.repeat(120), customerPhone: '1'.repeat(32) },
      note: 'n'.repeat(500), promoCode: 'p'.repeat(24) }).success).toBe(true);
  });
  it.each([
    ['51 lignes', { ...request, lines: Array(51).fill(request.lines[0]) }],
    ['31 options', { ...request, lines: [{ ...request.lines[0], options: Array(31).fill({ groupKey: 'g', choiceKey: 'c' }) }] }],
    ['clé groupe121', { ...request, lines: [{ ...request.lines[0], options: [{ groupKey: 'g'.repeat(121), choiceKey: 'c' }] }] }],
    ['clé choix121', { ...request, lines: [{ ...request.lines[0], options: [{ groupKey: 'g', choiceKey: 'c'.repeat(121) }] }] }],
    ['variante121', { ...request, lines: [{ ...request.lines[0], variantKey: 'v'.repeat(121) }] }],
    ['nom121', { ...request, pickup: { ...request.pickup, customerName: 'n'.repeat(121) } }],
    ['téléphone33', { ...request, pickup: { ...request.pickup, customerPhone: '1'.repeat(33) } }],
    ['racine inconnue', { ...request, tenantId: identity.tenantId }],
    ['preuve publique', { ...request, recoveryProof: 'a'.repeat(64) }],
    ['prix fourni', { ...request, lines: [{ ...request.lines[0], unitPrice: 1 }] }],
    ['option inconnue', { ...request, lines: [{ ...request.lines[0], options: [{ groupKey: 'g', choiceKey: 'c', price: 1 }] }] }],
    ['PII inconnue', { ...request, pickup: { ...request.pickup, email: 'test@example.invalid' } }],
    ['montant encaissé', { ...request, payment: { method: 'counter', cashReceived: 1250 } }],
    ['paiement cash', { ...request, payment: { method: 'counter', tender: 'cash' } }],
    ['canal caisse', { ...request, channel: 'pos' }],
    ['sans slot', { ...request, pickup: undefined }],
    ['compte fidélité', { ...request, loyaltyMemberId: identity.clientId, loyaltyEarnOperationId: identity.clientId }],
  ])('refuse %s avant admission', (_name, body) => { expect(StaffPhoneOrderAttemptRequestSchema.safeParse(body).success).toBe(false); });
});

describe('preuve de tentative téléphone authentifiée', () => {
  it('accepte pending sans inventer de reçu ni de refus terminal', () => {
    expect(StaffOrderAttemptResultSchema.parse({ ...identity, state: 'pending' })).toEqual({ ...identity, state: 'pending' });
  });
  it('conserve les lignes du reçu pour leur comparaison au corps figé par le POS', () => {
    expect(StaffOrderAttemptResultSchema.parse(created)).toEqual(created);
  });
  it.each(['new', 'preparing', 'ready', 'delivered', 'cancelled'])('reprise de commande déjà %s', (status) => {
    expect(StaffOrderAttemptResultSchema.safeParse({ ...created, order: { ...order, status } }).success).toBe(true);
  });
  it.each(['pending', 'paid', 'refunded'])('le paiement %s du reçu reste une donnée serveur', (status) => {
    expect(StaffOrderAttemptResultSchema.safeParse({ ...created, order: { ...order, payment: { ...order.payment, status } } }).success).toBe(true);
  });
  it.each(['abandoned', 'slot_unavailable', 'invalid_order', 'unavailable'])('accepte le refus persisté %s', (reason) => {
    expect(StaffOrderAttemptResultSchema.safeParse({ ...identity, state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason, message: 'Tentative fermée' }).success).toBe(true);
  });
  it.each([
    ['tenant', { ...created, order: { ...order, tenantId: '507f1f77bcf86cd799439019' } }],
    ['client', { ...created, order: { ...order, clientId: '9d0903d7-b011-47f1-b165-1e63f9e1a027' } }],
    ['canal', { ...created, order: { ...order, channel: 'pos' } }],
    ['livraison', { ...created, order: { ...order, type: 'delivery' } }],
    ['paiement en ligne', { ...created, order: { ...order, payment: { method: 'online', status: 'pending' } } }],
    ['créneau Date non JSON', { ...created, order: { ...order, pickup: { ...order.pickup, slot: new Date(order.pickup.slot) } } }],
    ['montant flottant', { ...created, order: { ...order, totals: { total: 12.5 } } }],
    ['montant non sûr', { ...created, order: { ...order, totals: { total: Number.MAX_SAFE_INTEGER + 1 } } }],
    ['suivi absent', { ...created, order: { ...order, trackingToken: '' } }],
    ['lignes absentes', { ...created, order: { ...order, lines: [] } }],
    ['reçu pending', { ...identity, state: 'pending', order }],
    ['refus sans code', { ...identity, state: 'rejected', reason: 'abandoned', message: 'Fermée' }],
    ['refus sans identité', { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned', message: 'Fermée' }],
    ['identité publique', { ...identity, channel: 'online', state: 'pending' }],
  ])('refuse %s', (_name, result) => { expect(StaffOrderAttemptResultSchema.safeParse(result).success).toBe(false); });
});
