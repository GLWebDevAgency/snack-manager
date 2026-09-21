import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Module, UnauthorizedException, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorageService, getStorageToken } from '@nestjs/throttler';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapaciteGuard, CapacitesService } from '../../common/capacites';
import { OrderCounterRefundController } from './order-counter-refund.controller';
import { OrderCounterRefundService } from '../ordering/order-counter-refund.service';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { AuthService } from '../auth/auth.service';

// Real Nest routes/pipes/throttles. Session and credential adapters are boundary
// doubles here; their database/Argon2 checks are covered in their own suites.
describe('counter refund HTTP protocol and financial reauthentication', () => {
  const actor = { tenantId: '507f1f77bcf86cd799439011', sub: '507f1f77bcf86cd799439021', kind: 'user', role: 'owner' };
  const orderId = '507f1f77bcf86cd799439031', managerId = '507f1f77bcf86cd799439041';
  const refunds = { execute: vi.fn(async () => ({ journal: { operations: [] }, mayDisburse: false })), journal: vi.fn(async () => ({ operations: [] })) };
  const owner = { verify: vi.fn(async () => undefined) };
  const auth = { verifyPin: vi.fn(async () => ({ staffId: managerId, role: 'gerant' })) };
  let app: INestApplication, origin: string;
  const body = () => ({ operationId: randomUUID(), amountCents: 100, reason: 'Article rendu', tender: 'cash',
    allocation: { version: 1, merchandiseCents: 100, deliveryCents: 0 }, clientProtocolVersion: 1,
    authorization: { kind: 'owner_password', password: randomUUID() } });
  const request = (path: string, value: unknown) => fetch(`${origin}/orders/${orderId}/counter-refunds/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value),
  });
  beforeAll(async () => {
    Reflect.defineMetadata('design:paramtypes', [OrderCounterRefundService, OwnerReauthentication, AuthService], OrderCounterRefundController);
    Reflect.defineMetadata('design:paramtypes', [Reflector, CapacitesService], CapaciteGuard);
    class FixtureModule {}
    Module({ imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
      controllers: [OrderCounterRefundController], providers: [
        { provide: CapacitesService, useValue: { pourTenant: async () => ['bo', 'online'] } },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService], useFactory: (reflector: Reflector, capabilities: CapacitesService) => new CapaciteGuard(reflector, capabilities) },
        { provide: OrderCounterRefundService, useValue: refunds }, { provide: OwnerReauthentication, useValue: owner },
        { provide: AuthService, useValue: auth }, { provide: APP_GUARD, useValue: { canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest().user = actor; return true;
        } } },
      ] })(FixtureModule);
    app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1'); origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  beforeEach(() => {
    const storage = app.get<ThrottlerStorageService>(getStorageToken()); storage.onApplicationShutdown(); storage.storage.clear();
    vi.clearAllMocks(); owner.verify.mockResolvedValue(undefined); auth.verifyPin.mockResolvedValue({ staffId: managerId, role: 'gerant' });
    actor.kind = 'user'; actor.role = 'owner';
  });
  afterAll(async () => { await app?.close(); });
  it.each(['prepare', 'start', 'confirm', 'withdraw', 'no-effect'])('rejects old %s before reauthentication or business writes', async action => {
    const value = { ...body(), clientProtocolVersion: undefined, attestation: action === 'confirm' ? 'cash_returned' : action === 'no-effect' ? 'no_money_returned' : undefined,
      ...(action === 'no-effect' ? { resolutionReason: 'Aucun geste ni paiement en cours' } : {}) };
    expect((await request(action, value)).status).toBe(400);
    expect(refunds.execute).not.toHaveBeenCalled(); expect(owner.verify).not.toHaveBeenCalled(); expect(auth.verifyPin).not.toHaveBeenCalled();
  });
  it.each(['prepare', 'start', 'confirm', 'withdraw', 'no-effect'])('reauthenticates %s on every invocation without persisting the credential', async action => {
    const value = { ...body(), ...(action === 'confirm' ? { attestation: 'cash_returned' } : {}),
      ...(action === 'no-effect' ? { attestation: 'no_money_returned', resolutionReason: 'Aucun geste ni paiement en cours' } : {}) };
    const first = await request(action, value); expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('private, no-store');
    expect((await request(action, value)).status).toBe(200);
    expect(owner.verify).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(refunds.execute.mock.calls)).not.toContain(value.authorization.password);
    expect(JSON.stringify(refunds.execute.mock.calls)).not.toContain('authorization');
    owner.verify.mockRejectedValueOnce(new UnauthorizedException());
    expect((await request(action, value)).status).toBe(401); expect(refunds.execute).toHaveBeenCalledTimes(2);
  });
  it('accepts a cashier with a freshly verified manager PIN and preserves both identities', async () => {
    actor.kind = 'staff'; actor.role = 'caisse';
    const value = { ...body(), authorization: { kind: 'manager_pin', pin: '1234' } };
    expect((await request('prepare', value)).status).toBe(200);
    expect(refunds.execute).toHaveBeenCalledWith('prepare', actor.tenantId, orderId, actor,
      { sub: managerId, kind: 'staff', role: 'gerant' }, expect.objectContaining({ operationId: value.operationId }));
    auth.verifyPin.mockResolvedValueOnce({ staffId: managerId, role: 'caisse' });
    expect((await request('start', value)).status).toBe(403);
    expect(refunds.execute).toHaveBeenCalledOnce();
  });
  it('reserves no-effect to an owner user/password, never a manager or owner-shaped staff token', async () => {
    for (const [kind, role] of [['staff', 'owner'], ['staff', 'gerant'], ['user', 'cogerant']]) {
      actor.kind = kind!; actor.role = role!;
      expect((await request('no-effect', { ...body(), attestation: 'no_money_returned', resolutionReason: 'Aucun geste ni paiement en cours' })).status).toBe(403);
    }
    expect(owner.verify).not.toHaveBeenCalled(); expect(refunds.execute).not.toHaveBeenCalled();
  });
  it('rate limits repeated financial confirmations before credential processing', async () => {
    const value = body();
    for (let n = 0; n < 5; n++) expect((await request('prepare', value)).status).toBe(200);
    expect((await request('prepare', value)).status).toBe(429); expect(owner.verify).toHaveBeenCalledTimes(5);
  });
  it('reads the journal without a bank call or any mutation and prevents caching', async () => {
    const response = await fetch(`${origin}/orders/${orderId}/counter-refunds/journal`);
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(refunds.journal).toHaveBeenCalledWith(actor.tenantId, orderId, actor);
    expect(refunds.execute).not.toHaveBeenCalled(); expect(owner.verify).not.toHaveBeenCalled();
  });
});
