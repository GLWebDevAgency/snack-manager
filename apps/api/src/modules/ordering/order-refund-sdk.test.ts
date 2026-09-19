import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRefundClientFactory } from './order-refund-client.factory';
import { OrderRefundsService, type RefundStripeClient } from './order-refunds.service';

const CHARGE = 'ch_refund_sdk_fixture';
const INTENT = 'pi_refund_sdk_fixture';
const ACCOUNT = 'acct_refund_original_fixture';
type WireRequest = { method: string | undefined; path: string; account: string | string[] | undefined; body: string };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

/** Real factory, service and installed Stripe SDK. Only the HTTP destination
 * and Mongo read are fixtures. No application secret or remote provider is
 * accessed; capture only the Connect header, never Authorization. */
async function fixture(account: string | null, unavailable = false) {
  const requests: WireRequest[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    requests.push({ method: request.method, path: request.url ?? '/', account: request.headers['stripe-account'], body });
    response.setHeader('Content-Type', 'application/json');
    if (request.method !== 'GET' || request.url !== `/v1/charges/${CHARGE}` || body
      || request.headers['stripe-account'] !== (account ?? undefined)) {
      response.writeHead(400).end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Incorrect loopback scope or query.' } }));
      return;
    }
    if (unavailable) {
      response.writeHead(503).end(JSON.stringify({ error: { type: 'api_error', message: 'Loopback charge unavailable.' } }));
      return;
    }
    response.writeHead(200).end(JSON.stringify({ id: CHARGE, object: 'charge',
      payment_intent: account ? INTENT : { id: INTENT, object: 'payment_intent' }, livemode: false }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing loopback address');
  const key = `sk_test_${randomUUID()}`;
  const load = vi.fn(async (secret: string) => new Stripe(secret, { host: '127.0.0.1', port: address.port,
    protocol: 'http', timeout: 2000, maxNetworkRetries: 0 }) as unknown as Omit<RefundStripeClient, 'environment'>);
  const factory = createRefundClientFactory(name => name === 'ORDER_REFUNDS_DURABLE_ENABLED' ? 'true'
    : name === 'STRIPE_SECRET_KEY' ? key : undefined, load);
  // No matching order: assert the real scoped candidate lookup, without
  // manufacturing a financial write or mocking the service's private methods.
  const query = { select: () => query, read: () => query, readConcern: () => query,
    maxTimeMS: () => query, lean: vi.fn(async () => null) };
  const orders = { findOne: vi.fn(() => query), findOneAndUpdate: vi.fn(() => { throw Error('Unexpected financial write'); }) };
  const publish = vi.fn(), logOnce = vi.fn(), pourTenant = vi.fn();
  const service = new OrderRefundsService(orders as unknown as Model<Order>, factory,
    { publish } as unknown as Redis, { pourTenant } as never, { logOnce } as never);
  const event = { type: 'refund.updated', livemode: false, ...(account ? { account } : {}),
    data: { object: { id: 're_webhook_fixture', charge: CHARGE } } };
  const expected: WireRequest = { method: 'GET', path: `/v1/charges/${CHARGE}`, account: account ?? undefined, body: '' };
  const unchanged = () => {
    expect(orders.findOneAndUpdate).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
    expect(logOnce).not.toHaveBeenCalled(); expect(pourTenant).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledOnce();
  };
  return { service, event, requests, expected, orders, unchanged };
}

describe('Refund webhook — real Stripe SDK over loopback HTTP', () => {
  it.each([ACCOUNT, null])('resolves its charge on the original Connect/platform scope %s without putting options in the query', async account => {
    const f = await fixture(account);
    await f.service.webhook(f.event);
    expect(f.requests).toEqual([f.expected]);
    expect(f.orders.findOne).toHaveBeenCalledExactlyOnceWith({ 'payment.method': 'online',
      'payment.stripePaymentIntentId': INTENT, 'payment.stripeAccountId': account });
    f.unchanged();
  });

  it('propagates a failed charge read without an unscoped Mongo fallback or provider mutation', async () => {
    const f = await fixture(ACCOUNT, true);
    const result = await f.service.webhook(f.event).then(() => null, error => error);
    expect(f.requests).toEqual([f.expected]);
    expect(result).toMatchObject({ statusCode: 503 });
    expect(f.orders.findOne).not.toHaveBeenCalled(); f.unchanged();
  });
});
