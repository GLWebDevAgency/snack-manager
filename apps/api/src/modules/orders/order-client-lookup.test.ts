import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersController } from './orders.controller';

const TENANT = '507f1f77bcf86cd799439011';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function controllerWith(result: unknown) {
  const orders = {
    findByClientId: vi.fn().mockResolvedValue(result),
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
});
