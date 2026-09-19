import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EncaissementService } from '../encaissement/encaissement.service';
import { OrderPaymentLifecycleService } from './order-payment-lifecycle.service';
import { PaymentsService, type StripeWebhookEvent } from './payments.service';

const ORDER_ID = '665f0d0a1c2b3d4e5f6a7b8c';
const TENANT_ID = '665f0d0a1c2b3d4e5f6a0001';
const INTENT_ID = 'pi_sdk_loopback_fixture';
const ACCOUNT_ID = 'acct_sdk_original_fixture';
const TOKEN = 'tracking-loopback-fixture';
const AMOUNT = 3290;
const metadata = { orderId: ORDER_ID, tenantId: TENANT_ID, orderNumber: '3' };
type RequestProjection = { method: string | undefined; path: string; accountHeader: string | undefined; body: string };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections(); server.close(() => resolve());
  })));
});

/** Actual installed Stripe SDK and HTTP serialization, with only a loopback
 * endpoint. Mongo reads are fixtures; any DB write or HTTP POST is refused.
 * Never read application configuration, and never record Authorization. */
async function fixture(options: { accountId?: string | null; closedCounter?: boolean; failFirstRead?: boolean } = {}) {
  const accountId = options.accountId === undefined ? ACCOUNT_ID : options.accountId;
  const calls: RequestProjection[] = [];
  let failedOnce = false;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const path = new URL(request.url ?? '/', 'http://127.0.0.1');
    const accountHeader = request.headers['stripe-account'];
    calls.push({ method: request.method, path: request.url ?? '/',
      accountHeader: typeof accountHeader === 'string' ? accountHeader : undefined, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.method !== 'GET' || path.pathname !== `/v1/payment_intents/${INTENT_ID}`
      || path.search || body || accountHeader !== (accountId ?? undefined)) {
      response.writeHead(400).end(JSON.stringify({ error: { type: 'invalid_request_error',
        message: 'Loopback fixture requires the original account header and no query parameters.' } }));
      return;
    }
    if (options.failFirstRead && !failedOnce) {
      failedOnce = true;
      response.writeHead(503).end(JSON.stringify({ error: { type: 'api_error', message: 'Loopback read unavailable.' } }));
      return;
    }
    response.writeHead(200).end(JSON.stringify({ id: INTENT_ID, object: 'payment_intent',
      client_secret: options.closedCounter ? null : 'loopback-client-secret-fixture',
      status: options.closedCounter ? 'canceled' : 'requires_payment_method',
      amount: AMOUNT, currency: 'eur', metadata, livemode: false }));
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback fixture address');
  const syntheticKey = `sk_test_${randomUUID()}`;
  const stripe = new Stripe(syntheticKey, { host: '127.0.0.1', port: address.port, protocol: 'http',
    maxNetworkRetries: 0, timeout: 2000 });
  const order = {
    _id: ORDER_ID, id: ORDER_ID, tenantId: TENANT_ID, number: 3, __v: 2,
    channel: 'online', type: options.closedCounter ? 'pickup' : 'delivery', status: 'new',
    totals: { total: AMOUNT }, trackingToken: TOKEN,
    payment: { method: options.closedCounter ? 'counter' : 'online', status: 'pending',
      stripeAccountId: accountId, stripePaymentIntentId: INTENT_ID },
    paymentFlow: { version: 1, origin: accountId ? 'created_v1' : 'adopted_intent',
      phase: options.closedCounter ? 'counter_ready' : 'open',
      attempt: { id: 'durable-sdk-fixture', accountId, environment: 'test', amountCents: AMOUNT, currency: 'eur',
        idempotencyKey: 'order-payment:loopback:initial', metadata,
        preparedAt: new Date(0), requestStartedAt: new Date(0), recoveryUntil: new Date(1) },
      close: options.closedCounter ? { operationId: 'close-fixture', destination: 'counter' } : null,
      providerStatus: options.closedCounter ? 'canceled' : 'requires_payment_method' },
  };
  const initialOrder = structuredClone(order);
  const read = { select: () => read, read: () => read, readConcern: () => read,
    maxTimeMS: () => Promise.resolve(order) };
  const orders = {
    findOne: vi.fn().mockResolvedValue(order),
    exists: vi.fn(() => ({ read: () => Promise.resolve({ _id: ORDER_ID }) })),
    findById: vi.fn(() => read),
    findOneAndUpdate: vi.fn(() => { throw new Error('Unexpected Mongo mutation in read-only SDK fixture'); }),
  };
  const model = orders as unknown as Model<Order>;
  const config = { get: (key: string) => key === 'STRIPE_SECRET_KEY' ? syntheticKey
    : key === 'STRIPE_PUBLISHABLE_KEY' ? 'pk_test_loopback_fixture' : undefined };
  const redis = { publish: vi.fn() };
  const encaissement = { compteActifDe: vi.fn().mockResolvedValue('acct_replacement_not_allowed') };
  const service = new PaymentsService(model, config as unknown as ConfigService, redis as unknown as Redis,
    encaissement as unknown as EncaissementService, new OrderPaymentLifecycleService(model));
  Object.assign(service, { client: stripe, loadAttempted: true });
  const expectedRead: RequestProjection = { method: 'GET', path: `/v1/payment_intents/${INTENT_ID}`,
    accountHeader: accountId ?? undefined, body: '' };
  const unchanged = () => {
    expect(order).toEqual(initialOrder);
    expect(orders.findOneAndUpdate).not.toHaveBeenCalled();
    expect(encaissement.compteActifDe).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled();
  };
  return { service, calls, expectedRead, unchanged, accountId };
}

describe('PaymentsService — SDK Stripe réel, HTTP loopback uniquement', () => {
  it('reprend deux fois le PI attaché sur son compte figé avec le header Connect, sans nouveau paiement', async () => {
    const f = await fixture();
    const first = await f.service.createIntent(ORDER_ID, TOKEN);
    expect(f.calls).toEqual([f.expectedRead]);
    expect(first).toMatchObject({ unavailable: false, paymentIntentId: INTENT_ID, stripeAccount: ACCOUNT_ID,
      amount: AMOUNT, currency: 'eur' });
    expect(await f.service.createIntent(ORDER_ID, TOKEN)).toEqual(first);
    expect(f.calls).toEqual([f.expectedRead, f.expectedRead]);
    // Expired creation-recovery window is irrelevant once the PI is attached:
    // these two operations retrieve its known identity and cannot create one.
    f.unchanged();
  });

  it('une lecture indisponible ne crée rien et le geste suivant relit exactement le même PI', async () => {
    const f = await fixture({ failFirstRead: true });
    const failed = await f.service.createIntent(ORDER_ID, TOKEN);
    expect(f.calls).toEqual([f.expectedRead]);
    expect(failed).toMatchObject({ unavailable: true });
    expect(failed).not.toHaveProperty('clientSecret');
    f.unchanged();
    expect(await f.service.createIntent(ORDER_ID, TOKEN)).toMatchObject({ unavailable: false, paymentIntentId: INTENT_ID });
    expect(f.calls).toEqual([f.expectedRead, f.expectedRead]);
    f.unchanged();
  });

  it.each([ACCOUNT_ID, null])('le webhook tardif vérifie le PI fermé sur son scope original %s avant de l’ignorer', async accountId => {
    const f = await fixture({ accountId, closedCounter: true });
    const object = { id: INTENT_ID, amount: AMOUNT, amount_received: AMOUNT, currency: 'eur', metadata };
    const event: StripeWebhookEvent = { id: 'evt_loopback_fixture', type: 'payment_intent.succeeded', livemode: false,
      ...(accountId ? { account: accountId } : {}),
      data: { object },
    };
    // This enters the real lifecycle's counter-close reconciliation branch,
    // which must read the known canceled PI before acknowledging a stale event.
    const pending = f.service.handleWebhookEvent(event).then(value => ({ value }), error => ({ error }));
    const result = await pending;
    expect(f.calls).toEqual([f.expectedRead]);
    expect(result).toMatchObject({ value: { received: true, outcome: 'ignoree' } });
    f.unchanged();
  });
});
