import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { DeliveryHandoffIncidentSchema, DeliveryHandoffReasonSchema, DeliveryHandoffResolveSchema,
  DeliveryHandoffSubmitSchema, DeliveryProofRequestSchema, type JwtPayload } from '@sm/contracts';
import { IS_PUBLIC, ROLES } from '../../common/auth';
import { CAPACITES_REQUISES } from '../../common/capacites';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';
import { DeliveryCourierHandoffController, DeliveryCustomerProofController, DeliveryHandoffController,
  DeliveryProofQuotaGuard } from './delivery-handoff.controller';

const operation = { operationId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, expectedMissionRevision: 2 };
describe('remise — frontières HTTP', () => {
  it('sépare preuve, signalement et dérogation du responsable sans capacité RH', () => {
    expect(Reflect.getMetadata(ROLES, DeliveryHandoffController)).toEqual(['owner', 'gerant', 'caisse']);
    expect(Reflect.getMetadata(CAPACITES_REQUISES, DeliveryHandoffController)).toEqual(['delivery']);
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryHandoffController)).not.toBe(true);
    for (const method of ['override', 'rotate'] as const) {
      expect(Reflect.getMetadata(ROLES, DeliveryHandoffController.prototype[method])).toEqual(['owner', 'gerant']);
    }
    for (const method of ['confirm', 'incident', 'override', 'rotate', 'resolve'] as const) {
      expect(Reflect.getMetadata('__httpCode__', DeliveryHandoffController.prototype[method])).toBe(200);
      expect(Reflect.getMetadata('__headers__', DeliveryHandoffController.prototype[method]))
        .toContainEqual({ name: 'Cache-Control', value: 'private, no-store' });
    }
  });
  it('quota avant session opaque, sans route livreur override/rotate', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryCourierHandoffController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', DeliveryCourierHandoffController)).toEqual([DeliveryMissionsQuotaGuard, DeliveryAccessGuard]);
    expect(Object.getOwnPropertyNames(DeliveryCourierHandoffController.prototype)).not.toContain('override');
    expect(Object.getOwnPropertyNames(DeliveryCourierHandoffController.prototype)).not.toContain('rotate');
    expect(Reflect.getMetadata('__guards__', DeliveryCustomerProofController)).toEqual([DeliveryProofQuotaGuard]);
  });
  it.each(['get', 'confirm', 'incident', 'resolve'] as const)('ne délègue pas %s sans session vérifiée', method => {
    const service = { getCourier: vi.fn(), confirmCourier: vi.fn(), incidentCourier: vi.fn(), resolveCourier: vi.fn() };
    const controller = new DeliveryCourierHandoffController(service as never);
    expect(() => controller[method]({} as never, 'id', { ...operation, action: 'handoff' } as never)).toThrow();
    for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
  });
  it.each(['override', 'rotate'] as const)('recovery %s conserve les droits de son action', action => {
    const service = { resolveManager: vi.fn(), resolveCourier: vi.fn() };
    const manager = new DeliveryHandoffController(service as never);
    const courier = new DeliveryCourierHandoffController(service as never);
    const input = { ...operation, action };
    expect(() => manager.resolve('tenant', 'id', { role: 'caisse' } as JwtPayload, input)).toThrow();
    expect(() => courier.resolve({ deliverySession: {} } as never, 'id', input)).toThrow();
    expect(service.resolveManager).not.toHaveBeenCalled(); expect(service.resolveCourier).not.toHaveBeenCalled();
    manager.resolve('tenant', 'id', { role: 'cogerant' } as JwtPayload, input);
    expect(service.resolveManager).toHaveBeenCalledOnce();
  });
  it.each([
    { ...operation, proof: { kind: 'pin', value: '123456' }, status: 'delivered' },
    { ...operation, proof: { kind: 'pin', value: '12345' } },
    { ...operation, proof: { kind: 'qr', value: 'https://unsafe.invalid' } },
    { ...operation, proof: { kind: 'pin', value: '123456', token: 'private' } },
    { ...operation, expectedRevision: -1, proof: { kind: 'pin', value: '123456' } },
  ])('refuse un corps de confirmation invalide', body => expect(DeliveryHandoffSubmitSchema.safeParse(body).success).toBe(false));
  it('borne les autres corps ; suivi public et motif libre ne sont pas des preuves', () => {
    expect(DeliveryProofRequestSchema.safeParse({ trackingToken: 'tracking' }).success).toBe(false);
    expect(DeliveryHandoffIncidentSchema.safeParse({ ...operation, code: 'customer_absent', reason: 'secret' }).success).toBe(false);
    expect(DeliveryHandoffReasonSchema.safeParse({ ...operation, reason: 'court' }).success).toBe(false);
    expect(DeliveryHandoffResolveSchema.safeParse({ ...operation, action: 'handoff', proof: 'secret' }).success).toBe(false);
  });
});

describe('preuve client — quota partagé fail-closed', () => {
  function fixture() {
    const quota = { reserve: vi.fn().mockResolvedValue(true) };
    const setHeader = vi.fn();
    const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }),
      getResponse: () => ({ setHeader }) }) } as unknown as ExecutionContext;
    return { quota, setHeader, context, guard: new DeliveryProofQuotaGuard(quota as never) };
  }
  it('borne la source et le global, sans identifiant client ni secret', async () => {
    const ctx = fixture(); await expect(ctx.guard.canActivate(ctx.context)).resolves.toBe(true);
    expect(ctx.quota.reserve).toHaveBeenCalledWith({ scope: 'delivery-proof-source', clientKey: '127.0.0.1',
      windowMs: 60_000, clientLimit: 300, globalLimit: 1000 });
    expect(ctx.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('refuse source/globale épuisée, sans mettre en cache le refus', async () => {
    const ctx = fixture(); ctx.quota.reserve.mockResolvedValue(false);
    await expect(ctx.guard.canActivate(ctx.context)).rejects.toMatchObject({ status: 429 });
    expect(ctx.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('masque la panne Redis et refuse l’accès', async () => {
    const ctx = fixture(); ctx.quota.reserve.mockRejectedValue(new Error('private-provider-fixture'));
    const error = await ctx.guard.canActivate(ctx.context).catch(failure => failure);
    expect(error).toMatchObject({ status: 503 }); expect(error.message).not.toContain('private-provider-fixture');
  });
});
