import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { type ExecutionContext } from '@nestjs/common';
import { DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionsQuerySchema } from '@sm/contracts';
import { IS_PUBLIC, ROLES } from '../../common/auth';
import { CAPACITES_REQUISES } from '../../common/capacites';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryMissionsController, DeliveryCourierMissionsController, DeliveryCourierHistoryController } from './delivery-missions.controller';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';

const operationId = '11111111-1111-4111-8111-111111111111';
describe('frontières HTTP des missions', () => {
  it('lecture/départ gérant-caisse avec delivery seule, affectation responsable', () => {
    expect(Reflect.getMetadata(ROLES, DeliveryMissionsController)).toEqual(['owner', 'gerant', 'caisse']);
    expect(Reflect.getMetadata(ROLES, DeliveryMissionsController.prototype.assign)).toEqual(['owner', 'gerant']);
    expect(Reflect.getMetadata(CAPACITES_REQUISES, DeliveryMissionsController)).toEqual(['delivery']);
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryMissionsController)).not.toBe(true);
  });
  it('isole les routes livreur et applique quota avant authentification DB', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryCourierMissionsController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', DeliveryCourierMissionsController)).toEqual([DeliveryMissionsQuotaGuard, DeliveryAccessGuard]);
    expect(Reflect.getMetadata('__httpCode__', DeliveryCourierMissionsController.prototype.dispatch)).toBe(200);
    expect(Object.getOwnPropertyNames(DeliveryCourierMissionsController.prototype)).not.toContain('delivered');
  });
  it('historique : même quota et accès privé, aucune mutation exposée', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryCourierHistoryController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', DeliveryCourierHistoryController)).toEqual([DeliveryMissionsQuotaGuard, DeliveryAccessGuard]);
    const service = { historyCourier: vi.fn() };
    const controller = new DeliveryCourierHistoryController(service as never);
    expect(() => controller.list({} as never, {})).toThrow();
    expect(service.historyCourier).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(DeliveryCourierHistoryController.prototype)).toEqual(['constructor', 'list']);
  });
  it('un contrôleur livreur sans contexte ne délègue aucune lecture ni mutation', async () => {
    const service = { listCourier: vi.fn(), getCourier: vi.fn(), dispatchCourier: vi.fn() };
    const controller = new DeliveryCourierMissionsController(service as never);
    await expect(controller.list({} as never, {})).rejects.toThrow();
    await expect(controller.get({} as never, 'id')).rejects.toThrow();
    await expect(controller.dispatch({} as never, 'id', { operationId, expectedRevision: 0 })).rejects.toThrow();
    expect(service.listCourier).not.toHaveBeenCalled(); expect(service.dispatchCourier).not.toHaveBeenCalled();
  });
  it.each([
    { operationId, expectedRevision: 0, status: 'delivered' },
    { operationId, expectedRevision: 0, tenantId: '507f1f77bcf86cd799439011' },
    { operationId, expectedRevision: 0, operatorId: '507f1f77bcf86cd799439011' },
    { operationId, expectedRevision: -1 }, { expectedRevision: 0 },
  ])('rejette un corps départ injecté ou incomplet %j', input => expect(DeliveryMissionDispatchSchema.safeParse(input).success).toBe(false));
  it('rejette un curseur ou une paire accès/révision ambigus', () => {
    expect(DeliveryMissionsQuerySchema.safeParse({ after: 'bad' }).success).toBe(false);
    expect(DeliveryMissionsQuerySchema.safeParse({ tenantId: '507f1f77bcf86cd799439011' }).success).toBe(false);
    expect(DeliveryMissionAssignSchema.safeParse({ operationId, expectedRevision: 0, operatorId: null, expectedOperatorRevision: 1, reason: 'Recette' }).success).toBe(false);
  });
});

describe('quota distribué des missions', () => {
  function fixture(method = 'GET', header = `Bearer ${'a'.repeat(43)}`) {
    const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
    const request = { method, headers: { authorization: header }, socket: { remoteAddress: '127.0.0.1' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    return { quota, context, guard: new DeliveryMissionsQuotaGuard(quota as never) };
  }
  it.each(['GET', 'POST'])('borne source/globale puis secret haché sur %s', async method => {
    const ctx = fixture(method); await expect(ctx.guard.canActivate(ctx.context)).resolves.toBe(true);
    expect(ctx.quota.reserve).toHaveBeenCalledWith(expect.objectContaining({ scope: 'delivery-missions-source', clientLimit: 900, globalLimit: 6000 }));
    expect(ctx.quota.reserveClient).toHaveBeenCalledWith(expect.objectContaining({ scope: method === 'POST' ? 'delivery-missions-write' : 'delivery-missions-read',
      clientKey: expect.stringMatching(/^[a-f0-9]{64}$/), clientLimit: method === 'POST' ? 30 : 180 }));
    expect(ctx.quota.reserve.mock.invocationCallOrder[0]).toBeLessThan(ctx.quota.reserveClient.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(ctx.quota.reserveClient.mock.calls)).not.toContain('a'.repeat(43));
  });
  it('borne les mauvaises authentifications avant de laisser la garde les refuser', async () => {
    const ctx = fixture('GET', 'Bearer malformed.fixture');
    await expect(ctx.guard.canActivate(ctx.context)).resolves.toBe(true);
    expect(ctx.quota.reserve).toHaveBeenCalledOnce(); expect(ctx.quota.reserveClient).not.toHaveBeenCalled();
  });
  it('ne consomme pas un second bucket après un refus source/global', async () => {
    const ctx = fixture(); ctx.quota.reserve.mockResolvedValue(false);
    await expect(ctx.guard.canActivate(ctx.context)).rejects.toMatchObject({ status: 429 });
    expect(ctx.quota.reserveClient).not.toHaveBeenCalled();
  });
  it('refuse un quota individuel épuisé', async () => {
    const ctx = fixture(); ctx.quota.reserveClient.mockResolvedValue(false);
    await expect(ctx.guard.canActivate(ctx.context)).rejects.toMatchObject({ status: 429 });
  });
  it('une panne Redis échoue fermée avec un message générique', async () => {
    const ctx = fixture(); ctx.quota.reserve.mockRejectedValue(new Error('fixture-private-dependency'));
    const failure = await ctx.guard.canActivate(ctx.context).catch(error => error);
    expect(failure).toMatchObject({ status: 503 }); expect(failure.message).not.toContain('fixture-private-dependency');
  });
});
