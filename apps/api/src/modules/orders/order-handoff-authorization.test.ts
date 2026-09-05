import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload, OrderStatus, OrderType } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const TENANT = '507f1f77bcf86cd799439011';
const ORDER = '507f1f77bcf86cd799439012';
const TYPES: OrderType[] = ['pickup', 'surplace', 'emporter', 'delivery'];
const HANDOFF_ROLES = ['owner', 'cogerant', 'gerant', 'caisse'] as const;

function actor(role: JwtPayload['role'], tenantId = TENANT): JwtPayload {
  return { sub: `${role}-person`, tenantId, role,
    kind: role === 'owner' || role === 'cogerant' || role === 'comptable' ? 'user' : 'staff' };
}

function setup(type: OrderType, status: OrderStatus = 'ready') {
  const publish = vi.fn(async () => 1);
  const order = {
    _id: ORDER, tenantId: TENANT, type, status,
    statusHistory: [] as { status: OrderStatus; at: Date; by: string }[],
    payment: { status: type === 'delivery' ? 'paid' : 'pending', method: 'counter' },
    paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null },
    delivery: type === 'delivery' ? { dispatchedAt: new Date(), deliveredAt: null as Date | null } : null,
    save: vi.fn(async () => undefined), toObject: () => ({ _id: ORDER, status: order.status }),
  };
  const service = new OrdersService({} as never, {} as never, {} as never, {} as never,
    { publish } as never, {} as never, {} as never, { pourTenant: async () => ['bo'] } as never, {} as never);
  const read = vi.spyOn(service, 'byId').mockResolvedValue(order as never);
  return { service, order, read, publish };
}

describe('remise client — autorité distincte de la préparation cuisine', () => {
  it.each(TYPES)('refuse la cuisine avant lecture/mutation pour %s', async (type) => {
    const { service, order, read, publish } = setup(type);
    await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('cuisine')))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
    expect(order.save).not.toHaveBeenCalled();
    expect(order.status).toBe('ready');
    expect(order.payment.status).toBe(type === 'delivery' ? 'paid' : 'pending');
    expect(order.delivery?.deliveredAt ?? null).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['delivered', 'cancelled'] as const)('refuse aussi un rejeu cuisine sur une commande %s', async (status) => {
    const { service, order } = setup('pickup', status);
    await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('cuisine')))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(order.save).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'ready', 'delivered'] as const)('refuse un acteur d’un autre restaurant vers %s', async (status) => {
    const { service, read, order } = setup('pickup', 'new');
    await expect(service.updateStatus(TENANT, ORDER, status, actor('owner', 'other-tenant')))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
    expect(order.save).not.toHaveBeenCalled();
  });

  it('refuse un rôle de lecture sans droit de remise', async () => {
    const { service, read } = setup('pickup');
    await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('comptable')))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(read).not.toHaveBeenCalled();
  });

  for (const role of HANDOFF_ROLES) {
    it.each(TYPES)(`${role} confirme la remise %s depuis prêt`, async (type) => {
      const { service, order } = setup(type);
      await service.updateStatus(TENANT, ORDER, 'delivered', actor(role));
      expect(order.status).toBe('delivered');
      expect(order.statusHistory).toEqual([{ status: 'delivered', at: expect.any(Date), by: `${role}-person` }]);
      expect(order.payment.status).toBe('paid');
      expect(order.save).toHaveBeenCalledOnce();
      if (type === 'delivery') expect(order.delivery?.deliveredAt).toBeInstanceOf(Date);
    });
  }

  for (const status of ['new', 'preparing'] as const) {
    it.each(TYPES)(`refuse une remise %s depuis ${status} sans étape prêt`, async (type) => {
      const { service, order } = setup(type, status);
      await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('caisse')))
        .rejects.toBeInstanceOf(ConflictException);
      expect(order.save).not.toHaveBeenCalled();
      expect(order.status).toBe(status);
      expect(order.statusHistory).toEqual([]);
    });
  }

  for (const status of ['preparing', 'ready'] as const) {
    it.each(TYPES)(`la cuisine conserve la préparation %s vers ${status}`, async (type) => {
      const { service, order } = setup(type, 'new');
      await service.updateStatus(TENANT, ORDER, status, actor('cuisine'));
      expect(order.status).toBe(status);
      expect(order.save).toHaveBeenCalledOnce();
      expect(order.delivery?.deliveredAt ?? null).toBeNull();
    });
  }

  it('la caisse ne remet pas une livraison impayée', async () => {
    const { service, order } = setup('delivery');
    order.payment.status = 'pending';
    await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('caisse')))
      .rejects.toBeInstanceOf(ConflictException);
    expect(order.save).not.toHaveBeenCalled();
    expect(order.payment.status).toBe('pending');
    expect(order.delivery?.deliveredAt).toBeNull();
  });

  it('la caisse ne remet pas une livraison sans départ confirmé', async () => {
    const { service, order } = setup('delivery');
    order.delivery!.dispatchedAt = null as never;
    await expect(service.updateStatus(TENANT, ORDER, 'delivered', actor('caisse')))
      .rejects.toBeInstanceOf(ConflictException);
    expect(order.save).not.toHaveBeenCalled();
    expect(order.delivery?.deliveredAt).toBeNull();
  });

  it.each(['delivered', 'cancelled'] as const)('conserve le rejeu caisse sans mutation de l’état terminal %s', async (status) => {
    const { service, order, publish } = setup('pickup', status);
    expect(await service.updateStatus(TENANT, ORDER, 'delivered', actor('caisse'))).toBe(order);
    expect(order.status).toBe(status);
    expect(order.save).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('conserve le rejeu cuisine dépassé sans régression de prêt vers préparation', async () => {
    const { service, order } = setup('pickup');
    expect(await service.updateStatus(TENANT, ORDER, 'preparing', actor('cuisine'))).toBe(order);
    expect(order.status).toBe('ready');
    expect(order.save).not.toHaveBeenCalled();
  });

  it('le contrôleur transmet toute l’identité vérifiée au service, pas seulement son identifiant', async () => {
    const updateStatus = vi.fn();
    const controller = new OrdersController({ updateStatus } as never, {} as never, {} as never,
      {} as never, {} as never);
    const user = actor('caisse');
    controller.updateStatus(TENANT, user, ORDER, { status: 'delivered' });
    expect(updateStatus).toHaveBeenCalledWith(TENANT, ORDER, 'delivered', user);
  });
});
