import 'reflect-metadata';
import { HttpException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC } from '../../common/auth';
import { toRecord } from '../ops/ops-exception.filter';
import { DeliverySessionExchangeSchema } from '@sm/contracts';
import { zod } from '../../common/zod.pipe';
import { DeliveryAccessController } from './delivery-access.controller';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { hashDeliveryAccessSecret } from './delivery-access.service';

const INPUT = { token: 'A'.repeat(43), nonce: 'B'.repeat(43) };
const VIEW = { operatorId: '65f000000000000000000001', name: 'Fixture', restaurantName: 'Test',
  restaurantSlug: 'test', expiresAt: '2030-01-08T12:00:00.000Z' };
function harness() {
  const access = { exchange: vi.fn().mockResolvedValue({ token: 'C'.repeat(43), session: VIEW }), logout: vi.fn() };
  const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
  return { access, quota, controller: new DeliveryAccessController(access as never, quota as never) };
}
function request(realIp?: string, forwardedFor = '198.51.100.1') {
  return { headers: { 'x-real-ip': realIp, 'x-forwarded-for': forwardedFor }, socket: { remoteAddress: '127.0.0.1' } };
}

describe('DeliveryAccessController — surface et quotas', () => {
  it('exempte la surface JWT mais protège session et logout avec la garde livreur propre', () => {
    expect(Reflect.getMetadata(IS_PUBLIC, DeliveryAccessController)).toBe(true);
    for (const action of ['session', 'logout'] as const) {
      expect(Reflect.getMetadata(GUARDS_METADATA, DeliveryAccessController.prototype[action])).toContain(DeliveryAccessGuard);
    }
    for (const action of ['exchange', 'session', 'logout'] as const) {
      expect(Reflect.getMetadata(HEADERS_METADATA, DeliveryAccessController.prototype[action])).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, DeliveryAccessController.prototype.logout)).toBe(204);
  });

  it('réserve source partagée puis empreinte invitation, sans token ni nonce dans Redis', async () => {
    const h = harness();
    await h.controller.exchange(INPUT, request('203.0.113.10') as never);
    expect(h.quota.reserve).toHaveBeenCalledWith({ scope: 'delivery-exchange-source', clientKey: '203.0.113.10',
      windowMs: 60_000, clientLimit: 300, globalLimit: 1_000 });
    expect(h.quota.reserveClient).toHaveBeenCalledWith({ scope: 'delivery-exchange-invite', clientKey: hashDeliveryAccessSecret(INPUT.token),
      windowMs: 60_000, clientLimit: 10 });
    expect(h.quota.reserve.mock.invocationCallOrder[0]).toBeLessThan(h.quota.reserveClient.mock.invocationCallOrder[0]!);
    expect(h.quota.reserveClient.mock.invocationCallOrder[0]).toBeLessThan(h.access.exchange.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(h.quota.reserveClient.mock.calls)).not.toContain(INPUT.token);
    expect(JSON.stringify(h.quota.reserveClient.mock.calls)).not.toContain(INPUT.nonce);
  });

  it('changer le nonce ne crée pas de nouveau budget invitation', async () => {
    const h = harness();
    await h.controller.exchange(INPUT, request() as never);
    await h.controller.exchange({ ...INPUT, nonce: 'D'.repeat(43) }, request() as never);
    expect(h.quota.reserveClient.mock.calls[0]).toEqual(h.quota.reserveClient.mock.calls[1]);
  });

  it('refuse la source pleine avant toute dimension secondaire ou lecture Mongo, ignore X-Forwarded-For', async () => {
    const h = harness(); h.quota.reserve.mockResolvedValue(false);
    const failure = await h.controller.exchange(INPUT, request(undefined, 'spoof') as never).catch(error => error);
    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(429);
    expect(h.quota.reserve).toHaveBeenCalledWith(expect.objectContaining({ clientKey: '127.0.0.1' }));
    expect(h.quota.reserveClient).not.toHaveBeenCalled();
    expect(h.access.exchange).not.toHaveBeenCalled();
  });

  it('refuse une invitation dont le quota est plein avant la consommation', async () => {
    const h = harness(); h.quota.reserveClient.mockResolvedValue(false);
    await expect(h.controller.exchange(INPUT, request() as never)).rejects.toSatisfy((error: HttpException) => error.getStatus() === 429);
    expect(h.access.exchange).not.toHaveBeenCalled();
  });

  it.each(['reserve', 'reserveClient'] as const)('Redis %s indisponible échoue fermé avec une erreur sans secret', async method => {
    const h = harness();
    h.quota[method].mockRejectedValue(new Error(`private ${INPUT.token} ${INPUT.nonce}`));
    const failure = await h.controller.exchange(INPUT, request() as never).catch(error => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    const observable = JSON.stringify({ response: failure.getResponse(), record: toRecord(failure) });
    expect(observable).not.toContain(INPUT.token);
    expect(observable).not.toContain(INPUT.nonce);
    expect(h.access.exchange).not.toHaveBeenCalled();
  });

  it('validation stricte ne renvoie pas les valeurs secrètes reçues', () => {
    const pipe = zod(DeliverySessionExchangeSchema);
    try {
      pipe.transform({ token: `${INPUT.token}.invalid`, nonce: `${INPUT.nonce}.invalid` });
      expect.fail('invalid body accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const serialized = JSON.stringify((error as HttpException).getResponse());
      expect(serialized).not.toContain(INPUT.token);
      expect(serialized).not.toContain(INPUT.nonce);
    }
    expect(() => pipe.transform({ ...INPUT, tenantId: 'foreign' })).toThrow();
  });

  it('projette exclusivement la vue session, jamais le contexte d’autorité', async () => {
    const h = harness();
    const deliverySession = { session: VIEW, sessionHash: 'private-hash', tenantId: 'private-id', sessionVersion: 'private-version' };
    expect(h.controller.session({ deliverySession } as never)).toEqual(VIEW);
    await h.controller.logout({ deliverySession } as never);
    expect(h.access.logout).toHaveBeenCalledWith(deliverySession);
    expect(() => h.controller.session({} as never)).toThrow(UnauthorizedException);
  });
});

describe('DeliveryAccessGuard — aucun rôle JWT', () => {
  const context = (request: unknown) => ({ switchToHttp: () => ({ getRequest: () => request }) });

  it('attache seulement deliverySession, jamais req.user', async () => {
    const authenticate = vi.fn().mockResolvedValue({ session: VIEW });
    const guard = new DeliveryAccessGuard({ authenticate } as never);
    const request = { headers: { authorization: `Bearer ${INPUT.token}` } };
    await expect(guard.canActivate(context(request) as never)).resolves.toBe(true);
    expect(request).not.toHaveProperty('user');
    expect(request).toHaveProperty('deliverySession', { session: VIEW });
    expect(authenticate).toHaveBeenCalledWith(INPUT.token);
  });

  it.each([undefined, '', 'Basic arbitrary', 'Bearer short', `Bearer ${INPUT.token} `, `Bearer ${INPUT.token},second`])('rejette un header %s avant la base', async authorization => {
    const authenticate = vi.fn(); const guard = new DeliveryAccessGuard({ authenticate } as never);
    await expect(guard.canActivate(context({ headers: { authorization } }) as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('rejette aussi un vrai JWT staff signé sans lui faire endosser la session livreur', async () => {
    const jwt = new JwtService({ secret: 'fixture-only' });
    const token = await jwt.signAsync({ kind: 'staff', role: 'gerant', tenantId: 'fixture' });
    const authenticate = vi.fn(); const guard = new DeliveryAccessGuard({ authenticate } as never);
    await expect(guard.canActivate(context({ headers: { authorization: `Bearer ${token}` } }) as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
