import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model } from 'mongoose';
import type { Order } from '@sm/db';
import type Redis from 'ioredis';
import { ordersChannel, WS_EVENTS, type CustomerSaleAttribution } from '@sm/contracts';
import { OrderRefundsService, type RefundStripeClient } from './order-refunds.service';
import type { ProviderRefund } from './order-refunds.policy';

const ID = '665f0d0a1c2b3d4e5f6a7b8c';
const TENANT = '665f0d0a1c2b3d4e5f6a0001';
const ACCOUNT = 'acct_restaurant';
const OPERATION = 'e404fe33-f766-471e-a6c0-36541d0b1e53';
const body = { password: 'not-stored', amountCents: 250, reason: 'Produit indisponible', operationId: OPERATION };
type Row = {
  __v: number;
  _id: string; tenantId: string; channel: string; totals: { total: number };
  payment: { status: string; stripePaymentIntentId: string; stripeAccountId: string; refundSyncVersion: number; [key: string]: unknown };
  customerOwner?: CustomerSaleAttribution['owner'];
  customerSaleAttribution?: CustomerSaleAttribution;
};
let row: Row;
let provider: ProviderRefund[];
let stripe: RefundStripeClient;
let sut: OrderRefundsService;
let capabilities: string[];
let publication: ReturnType<typeof vi.fn<(channel: string, message: string) => Promise<number>>>;
const get = (object: object, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], object);
const matches = (filter: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => get(row, key) === value);

beforeEach(() => {
  row = { __v: 0, _id: ID, tenantId: TENANT, channel: 'online', totals: { total: 1250 }, payment: { method: 'online', status: 'paid', stripePaymentIntentId: 'pi_paid', stripeAccountId: ACCOUNT, refundSyncVersion: 0 } };
  capabilities = ['bo'];
  provider = [];
  const model = {
    findOne: (filter: Record<string, unknown>) => ({ lean: async () => matches(filter) ? structuredClone(row) : null }),
    findOneAndUpdate: (filter: Record<string, unknown>, update: { $set?: Record<string, unknown>; $inc?: Record<string, number> }) => ({ lean: async () => {
      if (!matches(filter)) return null;
      for (const [key, value] of Object.entries(update.$set ?? {})) row.payment[key.replace('payment.', '')] = value;
      for (const [key, value] of Object.entries(update.$inc ?? {})) {
        if (key === '__v') row.__v += value;
        else row.payment[key.replace('payment.', '')] = Number(get(row, key) ?? 0) + value;
      }
      return structuredClone(row);
    } }),
  } as unknown as Model<Order>;
  stripe = {
    refunds: {
      list: vi.fn(async () => ({ data: structuredClone(provider), has_more: false })),
      create: vi.fn(async (params) => {
        const refund = { id: `re_${provider.length + 1}`, amount: params.amount, status: 'succeeded', metadata: params.metadata };
        provider.push(refund);
        return refund;
      }),
    },
    charges: { retrieve: vi.fn(async () => ({ payment_intent: 'pi_paid' })) },
  };
  publication = vi.fn(async () => 1);
  sut = new OrderRefundsService(model, async () => stripe, { publish: publication } as unknown as Redis, { pourTenant: async () => capabilities } as never, { log: vi.fn(async () => undefined) } as never);
});

describe('restaurant refunds', () => {
  it('publishes the reconciled refund without the protected owner or loyalty attribution keys and values', async () => {
    const owner = { tenantRef: TENANT, parentRef: `AC${'a'.repeat(32)}`, accountId: '11111111-1111-4111-8111-111111111111' };
    const attribution: CustomerSaleAttribution = { version: 1, tenantRef: TENANT,
      clientId: '22222222-2222-4222-8222-222222222222', owner, capturedAt: 1789034400000,
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1250, excludedChargeCents: 0, chargedTotalCents: 1250 },
      decision: 'attributed', memberId: '33333333-3333-4333-8333-333333333333',
      membershipOperationId: '44444444-4444-4444-8444-444444444444', programId: '55555555-5555-4555-8555-555555555555',
      rulesVersion: 1, rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 } };
    row.customerOwner = owner; row.customerSaleAttribution = attribution;
    provider.push({ id: 're_private_projection', amount: 250, status: 'succeeded' });
    expect(await sut.summary(TENANT, ID)).toMatchObject({ status: 'partial', refundedCents: 250 });
    expect(publication).toHaveBeenCalledTimes(1);
    const [channel, raw] = publication.mock.calls[0]!;
    expect(channel).toBe(ordersChannel(TENANT));
    const event = JSON.parse(raw);
    expect(event).toMatchObject({ event: WS_EVENTS.orderUpdated, payload: { _id: ID, payment: { refundedCents: 250 } } });
    for (const key of ['customerOwner', 'customerSaleAttribution']) expect(event.payload).not.toHaveProperty(key);
    for (const privateValue of ['customerOwner', 'customerSaleAttribution', owner.parentRef, owner.accountId,
      attribution.clientId, attribution.memberId, attribution.membershipOperationId, attribution.programId]) expect(raw).not.toContain(privateValue);
    expect(row.customerOwner).toEqual(owner); expect(row.customerSaleAttribution).toEqual(attribution);
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('does not refund a counter payment through a retained canceled Stripe intent', async () => {
    row.payment.method = 'counter';
    await expect(sut.request(TENANT, ID, 'owner1', body)).rejects.toThrow('Aucun paiement Stripe confirmé');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(stripe.refunds.list).not.toHaveBeenCalled();
  });
  it('does not consult Stripe for a counter payment summary', async () => {
    row.payment.method = 'counter';
    expect(await sut.summary(TENANT, ID)).toMatchObject({ refundedCents: 0, pendingRefundCents: 0, remainingCents: 0 });
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    expect(row.__v).toBe(0);
  });
  it('ignores a refund event for an intent retained after switching to counter', async () => {
    row.payment.method = 'counter';
    provider.push({ id: 're_stale', amount: 1250, status: 'succeeded' });
    await sut.webhook({ type: 'refund.updated', account: ACCOUNT, data: { object: { payment_intent: 'pi_paid' } } });
    expect(row.payment.status).toBe('paid');
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    expect(row.__v).toBe(0);
  });
  it('does not overwrite a counter payment when an earlier reconciliation returns late', async () => {
    vi.mocked(stripe.refunds.list).mockImplementationOnce(async () => {
      row.payment.method = 'counter';
      return { data: [{ id: 're_stale', amount: 1250, status: 'succeeded' }], has_more: false };
    });
    await sut.summary(TENANT, ID);
    expect(row.payment.status).toBe('paid');
    expect(row.payment.refundedCents).toBeUndefined();
  });
  it('fence les documents hydratés avant réservation ET avant projection du remboursement', async () => {
    vi.mocked(stripe.refunds.list).mockImplementationOnce(async () => {
      expect(row.__v).toBe(1);
      return { data: [], has_more: false };
    });
    await sut.summary(TENANT, ID);
    expect(row.__v).toBe(2);
  });
  it('uses the original connected account and amount in cents', async () => {
    expect(await sut.request(TENANT, ID, 'owner1', body)).toMatchObject({ status: 'partial', refundedCents: 250, remainingCents: 1000 });
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_paid', amount: 250 }), {
      stripeAccount: ACCOUNT, idempotencyKey: `order-refund:${ID}:${OPERATION}`,
    });
    expect(row.payment.status).toBe('paid');
  });
  it('reconciles a total refund and a pending request distinctly', async () => {
    provider.push({ id: 're_pending', amount: 1250, status: 'pending' });
    expect(await sut.summary(TENANT, ID)).toMatchObject({ status: 'pending', pendingRefundCents: 1250, refundedCents: 0 });
    provider[0]!.status = 'succeeded';
    expect(await sut.summary(TENANT, ID)).toMatchObject({ status: 'refunded', refundedCents: 1250 });
    expect(row.payment.status).toBe('refunded');
  });
  it('does not refund twice after a repeated request even if Stripe pruned its idempotency key', async () => {
    await sut.request(TENANT, ID, 'owner1', body);
    await sut.request(TENANT, ID, 'owner1', body);
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
  it('does not present an immediate provider failure as a successful refund', async () => {
    vi.mocked(stripe.refunds.create).mockImplementationOnce(async (params) => {
      const failed = { id: 're_failed', amount: params.amount, metadata: params.metadata, status: 'failed' };
      provider.push(failed);
      return failed;
    });
    await expect(sut.request(TENANT, ID, 'owner1', body)).rejects.toThrow('échoué');
    expect(row.payment.refundedCents).toBe(0);
    await expect(sut.request(TENANT, ID, 'owner1', body)).rejects.toThrow('échoué');
    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
  });
  it('refuses an operation identifier reused with a different amount', async () => {
    await sut.request(TENANT, ID, 'owner1', body);
    await expect(sut.request(TENANT, ID, 'owner1', { ...body, amountCents: 500 })).rejects.toThrow('autre remboursement');
  });
  it('does not expose or mutate another tenant order', async () => {
    await expect(sut.request('other', ID, 'owner1', body)).rejects.toThrow('introuvable');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('limits the standalone web offer to online orders, including refund reads and writes', async () => {
    capabilities = ['online'];
    expect(await sut.summary(TENANT, ID)).toMatchObject({ remainingCents: 1250 });
    row.channel = 'pos';
    await expect(sut.summary(TENANT, ID)).rejects.toThrow('introuvable');
    await expect(sut.request(TENANT, ID, 'owner1', body)).rejects.toThrow('introuvable');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('ignores the stale result of a concurrent reconciliation', async () => {
    let release: ((value: { data: ProviderRefund[]; has_more: boolean }) => void) | undefined;
    vi.mocked(stripe.refunds.list).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const stale = sut.summary(TENANT, ID);
    await vi.waitFor(() => expect(release).toBeDefined());
    provider = [{ id: 're_total', amount: 1250, status: 'succeeded' }];
    await sut.summary(TENANT, ID);
    release!({ data: [], has_more: false });
    await stale;
    expect(row.payment.refundedCents).toBe(1250);
    expect(row.payment.status).toBe('refunded');
  });
  it('rejects an amount exceeding the balance including pending refunds', async () => {
    provider.push({ id: 're_pending', amount: 1100, status: 'pending' });
    await expect(sut.request(TENANT, ID, 'owner1', body)).rejects.toThrow('dépasse');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
  it('ignores a refund event from another connected account', async () => {
    provider.push({ id: 're_1', amount: 1250, status: 'succeeded' });
    await sut.webhook({ type: 'charge.refunded', account: 'acct_attacker', data: { object: { payment_intent: 'pi_paid' } } });
    expect(stripe.refunds.list).not.toHaveBeenCalled();
    expect(row.payment.status).toBe('paid');
  });
  it('uses current provider state for duplicate and out-of-order events', async () => {
    provider.push({ id: 're_1', amount: 1250, status: 'succeeded' });
    const stale = { type: 'refund.created', account: ACCOUNT, data: { object: { payment_intent: 'pi_paid', status: 'pending' } } };
    await sut.webhook(stale);
    await sut.webhook(stale);
    expect(row.payment.status).toBe('refunded');
    expect(row.payment.refundedCents).toBe(1250);
    provider[0]!.status = 'failed';
    await sut.webhook(stale);
    expect(row.payment.status).toBe('paid');
    expect(row.payment.refundedCents).toBe(0);
  });
});
