import { describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { DeliveryService } from './delivery.service';

const tenantId = '507f1f77bcf86cd799439011';
const actor = { sub: 'owner', tenantId, role: 'owner' } as JwtPayload;
function setup(over: Record<string, unknown> = {}) {
  const row = { _id: 'order', tenantId, type: 'delivery', status: 'ready', payment: { status: 'paid' }, delivery: { dispatchedAt: null }, ...over };
  const updated = { ...row, toJSON: () => ({ ...row, delivery: { dispatchedAt: '2026-09-05T10:00:00Z' } }) };
  const orders = { findOne: vi.fn(() => ({ select: vi.fn().mockResolvedValue(row) })), findOneAndUpdate: vi.fn().mockResolvedValue(updated) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const tenants = { findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ onlineDelivery: true }) })) };
  const service = new DeliveryService(tenants as never, {} as never, orders as never, audit as never, redis as never, {} as never);
  return { service, orders, audit, redis, row };
}

describe('départ du livreur', () => {
  it('refuse préparation inachevée et paiement non confirmé', async () => {
    const preparing = setup({ status: 'preparing' });
    await expect(preparing.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/prête/);
    const pending = setup({ payment: { status: 'pending' } });
    await expect(pending.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/paiement/i);
    expect(pending.orders.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('compare les préconditions lors de la mutation et incrémente la version contre l’annulation concurrente', async () => {
    const ctx = setup();
    await ctx.service.dispatch(tenantId, 'order', { driverName: 'Nadia' }, actor);
    expect(ctx.orders.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId, channel: 'online', type: 'delivery', status: 'ready', 'payment.status': 'paid', 'delivery.dispatchedAt': null, 'paymentFlow.phase': { $nin: ['closing', 'closed', 'review_required'] } }), expect.objectContaining({ $inc: { __v: 1 }, $set: expect.objectContaining({ 'delivery.driverName': 'Nadia' }) }), expect.any(Object));
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.dispatch', actor }));
    expect(ctx.redis.publish).toHaveBeenCalledOnce();
  });
  it('renvoie un départ déjà enregistré sans changer son horodatage ou son livreur', async () => {
    const ctx = setup({ delivery: { dispatchedAt: new Date(), driverName: 'Nadia' } });
    await expect(ctx.service.dispatch(tenantId, 'order', { driverName: 'Autre' }, actor)).resolves.toBe(ctx.row);
    expect(ctx.orders.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });
  it.each(['closing', 'closed', 'review_required'])('refuse un départ pendant %s même si le paiement local indique payé', async (phase) => {
    const ctx = setup({ paymentFlow: { phase } });
    await expect(ctx.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/paiement/i);
    expect(ctx.orders.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });
  it('échoue sans publication si une fermeture gagne le CAS avant le départ', async () => {
    const ctx = setup();
    ctx.orders.findOneAndUpdate.mockResolvedValueOnce(null as never);
    await expect(ctx.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/parallèle/i);
    expect(ctx.audit.log).not.toHaveBeenCalled();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });
});
