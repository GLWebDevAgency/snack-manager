import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

const tenantId = 'a'.repeat(24), id = 'b'.repeat(24), token = 'guest-tracking-capability';
const original = { _id: id, tenantId, trackingToken: token, channel: 'online', type: 'pickup', customerOwner: null, number: 42,
  lines: [{ productId: 'c'.repeat(24), name: 'Menu recette', variantKey: 'grand', variantName: 'Grand', qty: 2, unitPrice: 900,
    options: [{ groupKey: 'sauces', choiceKey: 'samourai', name: 'Samouraï', priceDelta: 0 }], removed: ['oignons'], note: 'PRIVATE_LINE_NOTE' }],
  pickup: { customerName: 'PRIVATE_CUSTOMER', customerPhone: 'PRIVATE_PHONE' }, payment: { stripePaymentIntentId: 'PRIVATE_PI' },
  publicRecovery: { proofHash: 'PRIVATE_PROOF' } };
function fixture(changes: Record<string, unknown> = {}) {
  const row = { ...original, ...changes };
  const chain = (value: unknown) => { const query = { select: vi.fn(() => query), read: vi.fn(() => query), readConcern: vi.fn(() => query), maxTimeMS: vi.fn(() => query), lean: vi.fn(async () => value) }; return query; };
  const findOne = vi.fn((filter: Record<string, unknown>) => chain(filter._id === row._id && filter.trackingToken === row.trackingToken
    && filter.tenantId === row.tenantId && filter.customerOwner === null && row.customerOwner == null
    && filter.channel === row.channel && ['pickup', 'delivery'].includes(row.type) ? row : null));
  const tenants = { findOne: vi.fn(({ slug }) => chain(slug === 'recette' ? { _id: tenantId } : slug === 'autre' ? { _id: 'd'.repeat(24) } : null)) };
  const orders = { findOne, updateOne: vi.fn(), create: vi.fn() }, redis = { publish: vi.fn() };
  const service = new OrdersService(orders as never, {} as never, {} as never, {} as never, redis as never, {} as never, tenants as never, {} as never, {} as never);
  return { service, orders, tenants, redis };
}
describe('recommander une commande invitée depuis son reçu', () => {
  it('projette uniquement les références historiques sous le tenant et la capacité exacts, sans écriture', async () => {
    const f = fixture(); const result = await f.service.publicReorder('recette', id, token);
    expect(result).toEqual({ tenantSlug: 'recette', orderId: id, number: 42,
      lines: [{ productId: 'c'.repeat(24), name: 'Menu recette', variantKey: 'grand', variantName: 'Grand', qty: 2, unitPrice: 900,
        options: [{ groupKey: 'sauces', choiceKey: 'samourai' }], removed: ['oignons'] }] });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|trackingToken|customerOwner/);
    expect(f.orders.updateOne).not.toHaveBeenCalled(); expect(f.orders.create).not.toHaveBeenCalled(); expect(f.redis.publish).not.toHaveBeenCalled();
    expect(f.orders.findOne).toHaveBeenCalledWith(expect.objectContaining({ tenantId, customerOwner: null, channel: 'online', trackingToken: token }));
  });
  it.each([['recette', id, undefined], ['recette', id, 'incorrect'], ['autre', id, token], ['inconnu', id, token], ['../recette', id, token], ['recette', 'invalid', token]])('renvoie le même 404 pour une capacité ou portée refusée %#', async (slug, orderId, capability) => {
    await expect(fixture().service.publicReorder(slug!, orderId!, capability)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([{ customerOwner: { accountId: 'private' } }, { channel: 'pos' }, { channel: 'phone' }, { type: 'surplace' }])('refuse compte privé ou commande hors périmètre %#', async changes => {
    await expect(fixture(changes).service.publicReorder('recette', id, token)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('accepte les reçus invités historiques et livraison sans leur donner de code de remise', async () => {
    const f = fixture({ customerOwner: undefined, type: 'delivery', lines: [{ ...original.lines[0], productId: undefined }] });
    const result = await f.service.publicReorder('recette', id, token);
    expect(result.lines[0]?.productId).toBeNull(); expect(JSON.stringify(result)).not.toMatch(/proof|delivery|PRIVATE/);
  });
});
