import { describe, expect, it } from 'vitest';
import { CreatePublicOrderSchema } from '@sm/contracts';
import { publicRecoveryBinding, assertPublicRecoveryReplay, recoveryReceipt } from './order-recovery';

const tenantId = '507f1f77bcf86cd799439011';
const body = CreatePublicOrderSchema.parse({ clientId: '11111111-1111-4111-8111-111111111111', recoveryProof: 'ab'.repeat(32), lines: [{ productId: 'burger', qty: 1 }], payment: { method: 'counter' }, pickup: { slot: '2026-09-07T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' }, turnstileToken: 'once' });
describe('liaison immuable d’une tentative publique', () => {
  it('sépare domaines tenant, clientId et preuve, sans conserver le secret brut', () => {
    const binding = publicRecoveryBinding(tenantId, body)!;
    expect(binding.proofHash).toMatch(/^[a-f0-9]{64}$/);
    expect(binding.proofHash).not.toContain(body.recoveryProof);
    expect(publicRecoveryBinding('other', body)?.proofHash).not.toBe(binding.proofHash);
    expect(publicRecoveryBinding(tenantId, { ...body, clientId: '22222222-2222-4222-8222-222222222222' })?.proofHash).not.toBe(binding.proofHash);
  });
  it('ignore uniquement la preuve Turnstile à usage unique dans l’empreinte métier', () => {
    expect(publicRecoveryBinding(tenantId, { ...body, turnstileToken: 'fresh' })).toEqual(publicRecoveryBinding(tenantId, body));
    for (const update of [{ payment: { method: 'online' as const } }, { note: 'Autre commande' }, { lines: [{ ...body.lines[0]!, qty: 2 }] }, { pickup: { ...body.pickup, slot: '2026-09-08T18:00:00.000Z' } }]) {
      expect(publicRecoveryBinding(tenantId, { ...body, ...update })?.payloadHash).not.toBe(publicRecoveryBinding(tenantId, body)?.payloadHash);
    }
  });
  it('tous les replays protégés exigent la même preuve, puis le même corps', () => {
    const publicRecovery = publicRecoveryBinding(tenantId, body)!;
    const order = { channel: 'online', publicRecovery };
    expect(() => assertPublicRecoveryReplay(order as never, publicRecovery)).not.toThrow();
    for (const candidate of [undefined, { ...publicRecovery, proofHash: '0'.repeat(64) }]) {
      expect(() => assertPublicRecoveryReplay(order as never, candidate)).toThrow('Commande introuvable');
    }
    expect(() => assertPublicRecoveryReplay(order as never, { ...publicRecovery, payloadHash: '0'.repeat(64) })).toThrow('corps');
  });
  it('ne permet pas d’adopter une ancienne commande ni une vente POS', () => {
    const binding = publicRecoveryBinding(tenantId, body)!;
    expect(() => assertPublicRecoveryReplay({ channel: 'online' } as never, binding)).toThrow('Commande introuvable');
    expect(() => assertPublicRecoveryReplay({ channel: 'pos', publicRecovery: binding } as never, binding)).toThrow('Commande introuvable');
    expect(() => assertPublicRecoveryReplay({ channel: 'online' } as never, undefined)).not.toThrow();
  });
  it('projette un reçu autoritaire minimal y compris commande terminale', () => {
    const result = recoveryReceipt({ _id: '507f1f77bcf86cd799439012', number: 15, channel: 'online', type: 'pickup', status: 'cancelled', trackingToken: 'tracking', payment: { method: 'online', status: 'paid', stripePaymentIntentId: 'pi_secret' }, totals: { total: 1250 }, pickup: { slot: new Date(body.pickup.slot), customerName: 'Camille' }, publicRecovery: publicRecoveryBinding(tenantId, body) } as never);
    expect(result.status).toBe('cancelled');
    expect(Object.keys(result).sort()).toEqual(['_id', 'number', 'payment', 'pickup', 'status', 'totals', 'trackingToken', 'type']);
    expect(result.payment).toEqual({ method: 'online', status: 'paid' });
    expect(result.pickup).toEqual({ slot: body.pickup.slot });
  });
});
