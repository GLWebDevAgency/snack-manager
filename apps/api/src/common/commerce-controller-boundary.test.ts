import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { CapaciteGuard } from './capacites';
import { DevicesController } from '../modules/devices/devices.controller';
import { ScreensController } from '../modules/screens/screens.controller';
import { MenuController } from '../modules/menu/menu.controller';
import { OrdersController } from '../modules/orders/orders.controller';
import { EngageController } from '../modules/engage/engage.controller';
import { OrderFinanceController } from '../modules/orders/order-finance.controller';

type ControllerType = { prototype: object };
function context(controller: ControllerType, method: string, authenticated: boolean): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => ({ user: authenticated ? { tenantId: 'tenant', kind: 'user', role: 'owner' } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('commercial guard on real mixed controllers', () => {
  it.each([
    [DevicesController, 'pairDevice'], [DevicesController, 'pin'], [DevicesController, 'beat'],
    [ScreensController, 'pairDevice'], [ScreensController, 'fetchContent'], [ScreensController, 'beat'],
    [MenuController, 'publicMenu'], [OrdersController, 'createOnline'], [OrdersController, 'tracking'],
  ] as const)('leaves public %s.%s to its tenant/device/token policy', async (controller, method) => {
    const pourTenant = vi.fn();
    const guard = new CapaciteGuard(new Reflector(), { pourTenant } as never);
    await expect(guard.canActivate(context(controller, method, false))).resolves.toBe(true);
    expect(pourTenant).not.toHaveBeenCalled();
  });

  it.each([[DevicesController, 'list'], [ScreensController, 'list']] as const)(
    'does not turn the administrative %s.%s route public', async (controller, method) => {
      const guard = new CapaciteGuard(new Reflector(), { pourTenant: async () => ['online'] } as never);
      await expect(guard.canActivate(context(controller, method, true))).rejects.toThrow();
      await expect(guard.canActivate(context(controller, method, false))).rejects.toThrow();
    },
  );

  it('uses the review method area instead of the promotion area of its class', async () => {
    const guard = new CapaciteGuard(new Reflector(), { pourTenant: async () => ['bo'] } as never);
    await expect(guard.canActivate(context(EngageController, 'listReviews', true))).resolves.toBe(true);
    await expect(guard.canActivate(context(EngageController, 'listPromotions', true))).rejects.toThrow();
  });

  it('keeps financial routes owner-only independently from the subscribed function', () => {
    expect(Reflect.getMetadata('roles', OrderFinanceController)).toEqual(['owner']);
    for (const method of ['summary', 'refund', 'cancel']) {
      expect(Reflect.getMetadata('isPublic', (OrderFinanceController.prototype as unknown as Record<string, object>)[method]!)).not.toBe(true);
    }
  });
});
