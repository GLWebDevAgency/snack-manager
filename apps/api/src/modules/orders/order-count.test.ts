import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ROLES } from '../../common/auth';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

const TENANT = '507f1f77bcf86cd799439011';
const SINCE = '2026-09-03T00:00:00.000Z';

function serviceModel(total = 17) {
  const find = vi.fn().mockReturnValue({
    sort: () => ({ limit: () => ({ lean: async () => [] }) }),
  });
  const countDocuments = vi.fn().mockResolvedValue(total);
  const service = new OrdersService(
    { find, countDocuments } as never,
    {} as never,
    {} as never,
    {} as never,
    { publish: () => undefined } as never,
    { log: async () => undefined } as never,
  );
  return { service, find, countDocuments };
}

describe('GET /orders/count', () => {
  it('compte sans charger la liste et reste strictement tenant-scopé', async () => {
    const { service, find, countDocuments } = serviceModel(23);

    await expect(service.count(TENANT, { status: 'ready', since: SINCE })).resolves.toEqual({
      total: 23,
    });
    expect(find).not.toHaveBeenCalled();
    expect(countDocuments).toHaveBeenCalledOnce();
    expect(countDocuments).toHaveBeenCalledWith({
      tenantId: TENANT,
      status: 'ready',
      createdAt: { $gte: new Date(SINCE) },
    });
  });

  it('partage exactement la fabrique de filtre avec la liste', async () => {
    const { service, find, countDocuments } = serviceModel();
    const filter = { status: 'new' as const, since: SINCE };

    await service.list(TENANT, filter);
    await service.count(TENANT, filter);

    expect(find.mock.calls[0]?.[0]).toEqual(countDocuments.mock.calls[0]?.[0]);
    expect(countDocuments.mock.calls[1]?.[0]).toEqual(countDocuments.mock.calls[0]?.[0]);
  });

  it('expose le contrat { total } avec les mêmes rôles que la liste', async () => {
    const orders = { count: vi.fn().mockResolvedValue({ total: 9 }) };
    const controller = new OrdersController(
      orders as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(controller.count(TENANT, 'preparing', SINCE)).resolves.toEqual({ total: 9 });
    expect(orders.count).toHaveBeenCalledWith(TENANT, {
      status: 'preparing',
      since: SINCE,
    });

    const countHandler = OrdersController.prototype.count;
    const listHandler = OrdersController.prototype.list;
    expect(Reflect.getMetadata(PATH_METADATA, countHandler)).toBe('orders/count');
    expect(Reflect.getMetadata(METHOD_METADATA, countHandler)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(ROLES, countHandler)).toEqual(
      Reflect.getMetadata(ROLES, listHandler),
    );
    expect(Object.getOwnPropertyNames(OrdersController.prototype).indexOf('count')).toBeLessThan(
      Object.getOwnPropertyNames(OrdersController.prototype).indexOf('byId'),
    );
  });
});
