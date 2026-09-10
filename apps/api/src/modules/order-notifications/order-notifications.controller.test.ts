import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OrderNotificationsController } from './order-notifications.controller';
import { OrderNotificationsService } from './order-notifications.service';
import { pushFixture } from './order-push.test-fixture';
const service = { configView: vi.fn(async () => ({ available: true, publicKey: 'public' })),
  subscribe: vi.fn(async () => ({ state: 'active', expiresAt: null, revision: 1 })),
  status: vi.fn(async () => ({ state: 'off', expiresAt: null, revision: 0 })), revoke: vi.fn(async () => ({ state: 'off', expiresAt: null, revision: 1 })) };
@Module({ imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }])], controllers: [OrderNotificationsController], providers: [{ provide: OrderNotificationsService, useValue: service }] })
class FixtureModule {}
let app: INestApplication, origin: string;
beforeAll(async () => { app = await NestFactory.create(FixtureModule, { logger: false }); await app.listen(0, '127.0.0.1'); origin = await app.getUrl(); });
afterAll(async () => { await app?.close(); });
describe('routes notifications — HTTP local réel, service remplacé', () => {
  it('valide le corps strict et n’expose la preuve dans aucune URL ou réponse', async () => {
    const { subscription } = pushFixture(); const body = { trackingToken: 'fixture-capability', subscription, expectedRevision: 0 };
    const path = origin + '/public/tenants/restaurant/orders/order-id/ready-notification';
    const bad = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, tenantId: 'forged' }) });
    expect(bad.status).toBe(400); expect(service.subscribe).not.toHaveBeenCalled();
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ state: 'active', expiresAt: null, revision: 1 });
    expect(service.subscribe).toHaveBeenCalledExactlyOnceWith('restaurant', 'order-id', body);
  });
  it('borne les requêtes publiques avant toute lecture du service', async () => {
    const path = origin + '/public/tenants/restaurant/order-notifications/config';
    for (let count = 0; count < 60; count++) expect((await fetch(path)).status).toBe(200);
    expect((await fetch(path)).status).toBe(429); expect(service.configView).toHaveBeenCalledTimes(60);
  });
});
