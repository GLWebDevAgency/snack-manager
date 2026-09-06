import { describe, expect, it } from 'vitest';
import { RecoverPublicOrderSchema, PublicOrderRecoveryReceiptSchema } from './order-recovery';
import { CreatePublicOrderSchema } from './index';

const request = { clientId: '11111111-1111-4111-8111-111111111111', recoveryProof: 'ab'.repeat(32) };
describe('preuve indépendante de reprise publique', () => {
  it('accepte exactement une clé UUID et 256 bits encodés en hexadécimal', () => {
    expect(RecoverPublicOrderSchema.parse(request)).toEqual(request);
  });
  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'AB'.repeat(32), 'g'.repeat(64)])('refuse la preuve malformée %s', (recoveryProof) => {
    expect(RecoverPublicOrderSchema.safeParse({ ...request, recoveryProof }).success).toBe(false);
  });
  it.each([{ phone: '0612345678' }, { orderId: '507f1f77bcf86cd799439011' }, { trackingToken: 'secret' }])('ne permet aucune clé alternative %o', (extra) => {
    expect(RecoverPublicOrderSchema.safeParse({ ...request, ...extra }).success).toBe(false);
  });
  it('préserve les anciens clients mais accepte la preuve des nouveaux', () => {
    const body = { clientId: request.clientId, lines: [{ productId: 'burger', qty: 1 }], payment: { method: 'counter' }, pickup: { slot: '2026-09-07T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' }, turnstileToken: 'transient' };
    expect(CreatePublicOrderSchema.safeParse(body).success).toBe(true);
    expect(CreatePublicOrderSchema.parse({ ...body, recoveryProof: request.recoveryProof }).recoveryProof).toBe(request.recoveryProof);
  });
  it('le reçu exclut coordonnées, secrets techniques et détails bancaires', () => {
    const receipt = { _id: '507f1f77bcf86cd799439011', number: 12, type: 'pickup', status: 'new', trackingToken: 'tracking', payment: { method: 'counter', status: 'pending' }, totals: { total: 1200 }, pickup: { slot: '2026-09-07T18:00:00.000Z' } };
    expect(PublicOrderRecoveryReceiptSchema.safeParse(receipt).success).toBe(true);
    for (const extra of [{ publicRecovery: {} }, { recoveryProof: request.recoveryProof }, { payment: { ...receipt.payment, stripePaymentIntentId: 'pi_x' } }, { pickup: { ...receipt.pickup, customerName: 'Camille' } }]) {
      expect(PublicOrderRecoveryReceiptSchema.safeParse({ ...receipt, ...extra }).success).toBe(false);
    }
  });
});
