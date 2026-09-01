import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersController } from './orders.controller';

const TENANT = '507f1f77bcf86cd799439011';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function controllerWith(result: unknown, loyaltyStatus: unknown = null) {
  const orders = {
    findByClientId: vi.fn().mockResolvedValue(result),
    loyaltyEarnStatusByClientId: vi.fn().mockResolvedValue(loyaltyStatus),
  };
  const controller = new OrdersController(
    orders as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { controller, orders };
}

describe('réconciliation exacte des commandes POS', () => {
  it('recherche uniquement dans le tenant authentifié et restitue le ticket', async () => {
    const order = { _id: 'commande', clientId: CLIENT_ID, number: 412 };
    const { controller, orders } = controllerWith(order);

    await expect(controller.byClientId(TENANT, CLIENT_ID)).resolves.toBe(order);
    expect(orders.findByClientId).toHaveBeenCalledWith(TENANT, CLIENT_ID);
  });

  it('ne transforme pas une absence en réponse vide ambiguë', async () => {
    const { controller } = controllerWith(null);

    await expect(controller.byClientId(TENANT, CLIENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('ne restitue au POS que l’état sûr du gain lié à sa vente', async () => {
    const status = { state: 'completed', attempts: 2, errorCode: null };
    const { controller, orders } = controllerWith({}, status);

    await expect(controller.loyaltyEarnStatus(TENANT, CLIENT_ID)).resolves.toBe(status);
    expect(orders.loyaltyEarnStatusByClientId).toHaveBeenCalledWith(TENANT, CLIENT_ID);
  });

  it('répond 404 si la vente du tenant est absente', async () => {
    const { controller } = controllerWith({}, null);

    await expect(controller.loyaltyEarnStatus(TENANT, CLIENT_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
