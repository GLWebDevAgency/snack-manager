import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';
import type { OrderPaymentLifecycleService, OrderPaymentProvider } from './order-payment-lifecycle.service';
import type { EncaissementService } from '../encaissement/encaissement.service';

const TOKEN = 'jeton-de-suivi-valable';
const ORDER_ID = '665f0d0a1c2b3d4e5f6a7b8c';
const TENANT_ID = '665f0d0a1c2b3d4e5f6a0001';
const ACCOUNT_ID = 'acct_resto_test';
const INTENT = { id: 'pi_test', client_secret: 'pi_test_secret', status: 'requires_payment_method', amount: 1250, currency: 'eur' };
const PARAMETERS = { amount: 1250, currency: 'eur' as const, automatic_payment_methods: { enabled: true as const },
  metadata: { orderId: ORDER_ID, tenantId: TENANT_ID, orderNumber: '42' } };

/** Adaptateur SDK seulement : invariants CAS et compte testés sur Mongo réel. */
function build(over: { account?: string | null; secretKey?: string | null } = {}) {
  const order = { _id: ORDER_ID, tenantId: TENANT_ID, number: 42, status: 'new', totals: { total: 1250 },
    payment: { status: 'pending', method: 'online', stripeAccountId: null, stripePaymentIntentId: null } };
  const orders = { findOne: vi.fn().mockResolvedValue(order) };
  const stripe = { paymentIntents: {
    create: vi.fn<(params: Record<string, unknown>, options?: unknown) => Promise<typeof INTENT>>().mockResolvedValue(INTENT),
    retrieve: vi.fn().mockResolvedValue(INTENT), cancel: vi.fn().mockResolvedValue({ ...INTENT, status: 'canceled', client_secret: null }),
  } };
  const encaissement = { compteActifDe: vi.fn().mockResolvedValue(over.account === undefined ? ACCOUNT_ID : over.account) };
  const config = { get: vi.fn((key: string) => key === 'STRIPE_SECRET_KEY'
    ? (over.secretKey === undefined ? 'sk_test_fixture_only' : over.secretKey)
    : key === 'STRIPE_PUBLISHABLE_KEY' ? 'pk_test_fixture_only' : undefined) };
  const lifecycle = {
    open: vi.fn(async (_id: string, _token: unknown, provider: OrderPaymentProvider, resolveAccount: () => Promise<string | null>) => {
      const accountId = await resolveAccount();
      if (!accountId) return null;
      return { intent: await provider.create(PARAMETERS, accountId, 'durable-attempt-test'), accountId, amountCents: 1250 };
    }),
    cancel: vi.fn<OrderPaymentLifecycleService['cancel']>().mockResolvedValue(undefined),
    reconcileSucceeded: vi.fn().mockResolvedValue(null),
  };
  const service = new PaymentsService(orders as unknown as Model<Order>, config as unknown as ConfigService,
    { publish: vi.fn() } as unknown as Redis, encaissement as unknown as EncaissementService,
    lifecycle as unknown as OrderPaymentLifecycleService);
  Object.assign(service, { client: stripe, loadAttempted: true });
  return { service, stripe, encaissement, lifecycle, orders, order };
}

describe('adaptateur charges directes — protocole durable', () => {
  it('crée uniquement sur le compte restaurant avec la clé préparée par le protocole', async () => {
    const { service, stripe, encaissement, lifecycle } = build();
    const response = await service.createIntent(ORDER_ID, TOKEN);
    expect(encaissement.compteActifDe).toHaveBeenCalledWith(TENANT_ID);
    expect(lifecycle.open).toHaveBeenCalledWith(ORDER_ID, TOKEN, expect.any(Object), expect.any(Function));
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(PARAMETERS,
      { stripeAccount: ACCOUNT_ID, idempotencyKey: 'durable-attempt-test' });
    expect(response).toMatchObject({ unavailable: false, stripeAccount: ACCOUNT_ID, clientSecret: INTENT.client_secret });
  });

  it('ne prélève aucune commission et ne transfère pas des fonds via la plateforme', async () => {
    const { service, stripe } = build();
    await service.createIntent(ORDER_ID, TOKEN);
    const params = stripe.paymentIntents.create.mock.calls[0]?.[0];
    expect(params).not.toHaveProperty('application_fee_amount');
    expect(params).not.toHaveProperty('transfer_data');
    expect(params).not.toHaveProperty('on_behalf_of');
  });

  it('sans compte actif, ne tente aucun paiement plateforme', async () => {
    const { service, stripe } = build({ account: null });
    expect((await service.createIntent(ORDER_ID, TOKEN)).unavailable).toBe(true);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('sans clé SDK, ne démarre pas le protocole de paiement', async () => {
    const { service, lifecycle, stripe } = build({ secretKey: null });
    expect((await service.createIntent(ORDER_ID, TOKEN)).unavailable).toBe(true);
    expect(lifecycle.open).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('transmet au protocole l’environnement test explicitement', async () => {
    const { service, lifecycle } = build();
    await service.createIntent(ORDER_ID, TOKEN);
    expect(lifecycle.open.mock.calls[0]?.[2].environment).toBe('test');
  });

  it('refuse une clé dont l’environnement ne peut pas être déterminé', async () => {
    const { service, lifecycle } = build({ secretKey: 'fixture_without_environment' });
    expect((await service.createIntent(ORDER_ID, TOKEN)).unavailable).toBe(true);
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('reconnaît une clé restreinte test sans élargir son environnement', async () => {
    const { service, lifecycle } = build({ secretKey: 'rk_test_fixture_only' });
    expect((await service.createIntent(ORDER_ID, TOKEN)).unavailable).toBe(false);
    expect(lifecycle.open.mock.calls[0]?.[2].environment).toBe('test');
  });

  it('relit un PI sur SON compte initial sans reprendre le compte courant', async () => {
    const { service, lifecycle, stripe, encaissement } = build({ account: 'acct_new' });
    lifecycle.open.mockImplementationOnce(async (_id, _token, provider) => ({
      intent: await provider.retrieve(INTENT.id, 'acct_original'), accountId: 'acct_original', amountCents: 1250,
    }));
    expect(await service.createIntent(ORDER_ID, TOKEN)).toMatchObject({ unavailable: false, stripeAccount: 'acct_original' });
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith(INTENT.id, { stripeAccount: 'acct_original' });
    expect(encaissement.compteActifDe).not.toHaveBeenCalled();
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('ne fournit aucun secret lorsque le protocole refuse la réouverture', async () => {
    const { service, lifecycle, stripe } = build();
    lifecycle.open.mockRejectedValueOnce(new ConflictException('Paiement en cours de fermeture.'));
    const result = await service.createIntent(ORDER_ID, TOKEN).catch((error: unknown) => error);
    if (result instanceof ConflictException) expect(result.getStatus()).toBe(409);
    else expect(result).toMatchObject({ unavailable: true });
    expect(result).not.toHaveProperty('clientSecret');
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('ne masque jamais un timeout par la création d’une seconde intention', async () => {
    const { service, lifecycle, stripe } = build();
    lifecycle.open.mockRejectedValueOnce(new Error('Réponse provider inconnue.'));
    const result = await service.createIntent(ORDER_ID, TOKEN).catch((error: unknown) => error);
    expect(result).not.toHaveProperty('clientSecret');
    expect(lifecycle.open).toHaveBeenCalledTimes(1);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('adaptateur annulation — identité et options provider', () => {
  const actor = { sub: 'cashier-test', tenantId: TENANT_ID, kind: 'staff' as const, role: 'caisse' as const };

  it.each([ACCOUNT_ID, null])('annule sur le compte initial %s avec la même opération durable', async (accountId) => {
    const { service, lifecycle, stripe } = build();
    lifecycle.cancel.mockImplementationOnce(async (_id, _tenant, _by, _reason, provider) => {
      await provider!.cancel(INTENT.id, accountId, 'durable-close-test');
    });
    await service.cancelOrder(ORDER_ID, TENANT_ID, actor, 'Demandé en caisse');
    expect(lifecycle.cancel).toHaveBeenCalledWith(ORDER_ID, TENANT_ID, actor.sub, 'Demandé en caisse', expect.any(Object));
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(INTENT.id,
      { cancellation_reason: 'requested_by_customer' },
      { ...(accountId ? { stripeAccount: accountId } : {}), idempotencyKey: 'durable-close-test' });
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('sans provider, délègue null au protocole sans affirmer une fermeture sûre', async () => {
    const { service, lifecycle, stripe } = build({ secretKey: null });
    lifecycle.cancel.mockRejectedValueOnce(new ConflictException('Provider indisponible.'));
    await expect(service.cancelOrder(ORDER_ID, TENANT_ID, actor, 'Demandé en caisse')).rejects.toBeInstanceOf(ConflictException);
    expect(lifecycle.cancel).toHaveBeenCalledWith(ORDER_ID, TENANT_ID, actor.sub, 'Demandé en caisse', null);
    expect(stripe.paymentIntents.cancel).not.toHaveBeenCalled();
  });
});

describe('accès public au paiement — jeton requis avant le protocole', () => {
  it.each([undefined, { $ne: '' }])('refuse un jeton absent ou injecté', async (token) => {
    const { service, orders, lifecycle } = build();
    await expect(service.createIntent(ORDER_ID, token)).rejects.toThrow(/introuvable/i);
    expect(orders.findOne).not.toHaveBeenCalled();
    expect(lifecycle.open).not.toHaveBeenCalled();
  });

  it('cherche par identifiant ET jeton, puis délègue le même jeton', async () => {
    const { service, orders, lifecycle } = build();
    await service.createIntent(ORDER_ID, TOKEN);
    expect(orders.findOne).toHaveBeenCalledWith({ _id: ORDER_ID, trackingToken: TOKEN });
    expect(lifecycle.open.mock.calls[0]?.slice(0, 2)).toEqual([ORDER_ID, TOKEN]);
  });
});
