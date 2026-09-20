import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { HEADERS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { CapaciteGuard } from './capacites';
import { DevicesController } from '../modules/devices/devices.controller';
import { ScreensController } from '../modules/screens/screens.controller';
import { MenuController } from '../modules/menu/menu.controller';
import { OrdersController } from '../modules/orders/orders.controller';
import { EngageController } from '../modules/engage/engage.controller';
import { OrderFinanceController } from '../modules/orders/order-finance.controller';
import { TenantsController } from '../modules/tenants/tenants.controller';
import { AuthGuard } from './auth';
import { OrderRefundMutationPipe } from '../modules/orders/order-refund-mutation.pipe';

type ControllerType = { prototype: object };
function context(controller: ControllerType, method: string, authenticated: boolean): ExecutionContext {
  return {
    getClass: () => controller,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    switchToHttp: () => ({ getRequest: () => ({ user: authenticated ? { tenantId: 'tenant', kind: 'user', role: 'owner' } : undefined }) }),
  } as unknown as ExecutionContext;
}

describe('commercial guard on real mixed controllers', () => {
  it.each([['online'], ['pos']])('opens service hours for its subscribed operational module %s', async (capabilities) => {
    const guard = new CapaciteGuard(new Reflector(), { pourTenant: async () => [capabilities] } as never);
    await expect(guard.canActivate(context(TenantsController, 'updateHours', true))).resolves.toBe(true);
  });

  it('does not allow a loyalty-only owner to edit service hours by direct API access', async () => {
    const guard = new CapaciteGuard(new Reflector(), { pourTenant: async () => ['loyalty'] } as never);
    await expect(guard.canActivate(context(TenantsController, 'updateHours', true))).rejects.toThrow();
    await expect(guard.canActivate(context(TenantsController, 'updateIdentity', true))).resolves.toBe(true);
  });
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
    for (const method of ['summary', 'journal', 'refund', 'withdrawRefund', 'cancel']) {
      expect(Reflect.getMetadata('isPublic', (OrderFinanceController.prototype as unknown as Record<string, object>)[method]!)).not.toBe(true);
    }
  });

  it('publishes a private non-cacheable journal GET on the owner financial controller', () => {
    const method = OrderFinanceController.prototype.journal;
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe(':id/refunds/journal');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    for (const action of ['journal', 'summary'] as const) {
      expect(Reflect.getMetadata(HEADERS_METADATA, OrderFinanceController.prototype[action]))
        .toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    }
  });

  it.each(['owner', 'gerant', 'cogerant', 'caisse', 'cuisine', 'livreur', 'sm_admin'])(
    'enforces the real auth guard for journal role %s, without manager inheritance', async (role) => {
      const request = { headers: { authorization: 'Bearer fixture-only' } };
      const ctx = { ...context(OrderFinanceController, 'journal', false),
        switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      const guard = new AuthGuard({ verifyAsync: async () => ({ sub: 'owner-id', tenantId: 'tenant', kind: 'user', role }) } as never,
        new Reflector(), { assertAllows: async () => undefined } as never);
      if (role === 'owner') await expect(guard.canActivate(ctx)).resolves.toBe(true);
      else await expect(guard.canActivate(ctx)).rejects.toThrow();
    },
  );

  it.each([['bo', true], ['online', true], ['loyalty', false]] as const)(
    'retains the independent commercial guard for journal with %s', async (capability, allowed) => {
      const guard = new CapaciteGuard(new Reflector(), { pourTenant: async () => [capability] } as never);
      if (allowed) await expect(guard.canActivate(context(OrderFinanceController, 'journal', true))).resolves.toBe(true);
      else await expect(guard.canActivate(context(OrderFinanceController, 'journal', true))).rejects.toThrow();
    },
  );

  it('passes the authenticated actor and tenant to the journal without reauthentication or refund execution', async () => {
    const result = { receipt: 'opaque-fixture-result' };
    const refunds = { journal: vi.fn(async () => result), summary: vi.fn(), request: vi.fn() };
    const owner = { verify: vi.fn() };
    const controller = new OrderFinanceController(refunds as never, {} as never, owner as never);
    const actor = { sub: 'authenticated-owner', tenantId: 'tenant', role: 'owner', kind: 'user' } as JwtPayload;
    expect(await controller.journal('tenant', 'order-id', actor)).toBe(result);
    expect(refunds.journal).toHaveBeenCalledExactlyOnceWith('tenant', 'order-id', 'authenticated-owner');
    expect(owner.verify).not.toHaveBeenCalled(); expect(refunds.request).not.toHaveBeenCalled();
    expect(refunds.summary).not.toHaveBeenCalled();
  });
  it.each(['refund', 'withdrawRefund'] as const)(
    '%s attache la garde transport et transmet le corps métier sans version après réauthentification', async (action) => {
      const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, OrderFinanceController, action) as
        Record<string, { pipes?: unknown[] }>;
      const pipes = Object.values(metadata).flatMap(argument => argument.pipes ?? []);
      const pipe = pipes.find(value => value instanceof OrderRefundMutationPipe);
      expect(pipe).toBeInstanceOf(OrderRefundMutationPipe);
      if (!(pipe instanceof OrderRefundMutationPipe)) throw new Error('Garde protocole absente de la route financière.');
      const business = { operationId: '11111111-1111-4111-8111-111111111111', amountCents: 100,
        reason: 'Produit indisponible', password: 'fixture-owner-password' };
      const transformed = pipe.transform({ ...business, clientProtocolVersion: 1 });
      expect(transformed).toEqual(business);
      const result = { receipt: 'fixture-result' };
      const refunds = { request: vi.fn(async () => result), withdraw: vi.fn(async () => result) };
      const owner = { verify: vi.fn(async () => undefined) };
      const controller = new OrderFinanceController(refunds as never, {} as never, owner as never);
      const actor = { sub: 'owner', tenantId: 'tenant', role: 'owner', kind: 'user' } as JwtPayload;
      expect(await controller[action]('tenant', 'order-id', actor, transformed)).toBe(result);
      expect(owner.verify).toHaveBeenCalledExactlyOnceWith(actor, business.password);
      const method = action === 'refund' ? refunds.request : refunds.withdraw;
      const unused = action === 'refund' ? refunds.withdraw : refunds.request;
      expect(method).toHaveBeenCalledExactlyOnceWith('tenant', 'order-id', 'owner', business);
      expect(owner.verify.mock.invocationCallOrder[0]).toBeLessThan(method.mock.invocationCallOrder[0]!);
      expect(unused).not.toHaveBeenCalled();
    },
  );

});
