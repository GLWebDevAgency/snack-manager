import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { Types, type Model } from 'mongoose';
import { BadRequestException, ConflictException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Invoice } from '@sm/db';
import type Stripe from 'stripe';
import { InvoiceCheckoutGateway, type InvoiceCheckoutSession } from './invoice-checkout.gateway';
import { InvoiceCheckoutService } from './invoice-checkout.service';
import { InvoiceCheckoutWebhookController, InvoiceOwnerGuard } from './invoice-checkout.controller';
import type { TenantSessionGuard } from './tenant-session.guard';

const INVOICE_ID = new Types.ObjectId().toHexString();
const TENANT_ID = new Types.ObjectId().toHexString();
type Row = Record<string, any>;
const session = (over: Partial<InvoiceCheckoutSession> = {}): InvoiceCheckoutSession => ({
  id: 'cs_test_invoice', url: 'https://checkout.stripe.com/c/pay/test', status: 'open', mode: 'payment',
  payment_status: 'unpaid', amount_total: 4_680, currency: 'eur', livemode: false,
  client_reference_id: INVOICE_ID, metadata: { purpose: 'sm_invoice', invoiceId: INVOICE_ID, tenantId: TENANT_ID },
  payment_intent: null, expires_at: Math.floor(Date.now() / 1000) + 86_400, ...over,
});
function setup(over: Row = {}) {
  const row: Row = { _id: INVOICE_ID, tenantId: TENANT_ID, number: 'SM-2026-0042', kind: 'abonnement',
    status: 'envoyee', issuedAt: new Date(), amountCents: 3_900, vat: { ratePercent: 20, amountsAre: 'ht' },
    stripeCheckoutSessionId: null, stripePaymentIntentId: null, ...over };
  const same = (a: unknown, b: unknown) => a == null && b == null || String(a) === String(b);
  const matches = (filter: Row) => Object.entries(filter).every(([key, value]) =>
    value && typeof value === 'object' && '$in' in value ? value.$in.includes(row[key]) : same(row[key], value));
  const db = {
    findOne: vi.fn((filter: Row) => ({ lean: async () => matches(filter) ? { ...row } : null })),
    findOneAndUpdate: vi.fn((filter: Row, update: Row) => ({ lean: async () => {
      if (!matches(filter)) return null;
      Object.assign(row, update.$set);
      return { ...row };
    } })),
  };
  let remote = session();
  const gateway = {
    enabled: vi.fn(() => true), live: vi.fn(() => false),
    create: vi.fn(async () => remote), retrieve: vi.fn(async () => remote),
    expire: vi.fn(async () => { remote = { ...remote, status: 'expired' }; }),
  };
  const service = new InvoiceCheckoutService(db as unknown as Model<Invoice>, gateway as unknown as InvoiceCheckoutGateway);
  return { row, db, gateway, service, remote: (next: InvoiceCheckoutSession) => { remote = next; } };
}
const event = (over: Row = {}) => ({ id: 'evt_invoice', type: 'checkout.session.completed', data: { object: session() }, ...over }) as Stripe.Event;

describe('Checkout facture plateforme', () => {
  it('envoie le TTC figé, sans générer une autre facture', async () => {
    const { service, gateway, row } = setup();
    expect(await service.checkout(TENANT_ID, INVOICE_ID)).toEqual({ url: 'https://checkout.stripe.com/c/pay/test' });
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ totalCents: 4_680, invoiceId: INVOICE_ID, tenantId: TENANT_ID, idempotencyKey: `sm-invoice:${INVOICE_ID}:initial` }));
    expect(row.number).toBe('SM-2026-0042');
    expect(row.status).toBe('envoyee');
  });

  it.each(['brouillon', 'payee', 'annulee'])('refuse une facture %s', async (status) => {
    const { service, gateway } = setup({ status });
    await expect(service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow(ConflictException);
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('refuse autre tenant, avoir et absence de configuration', async () => {
    const { service, gateway } = setup();
    await expect(service.checkout(new Types.ObjectId().toHexString(), INVOICE_ID)).rejects.toThrow('introuvable');
    await expect(setup({ kind: 'avoir' }).service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow(ConflictException);
    gateway.enabled.mockReturnValue(false);
    await expect(service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow('indisponible');
  });

  it('réutilise le même Checkout ouvert', async () => {
    const { service, gateway } = setup({ stripeCheckoutSessionId: 'cs_test_invoice' });
    await service.checkout(TENANT_ID, INVOICE_ID);
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('une session expirée ouvre une nouvelle génération idempotente', async () => {
    const { service, gateway, row } = setup({ stripeCheckoutSessionId: 'cs_expired' });
    gateway.retrieve.mockResolvedValueOnce(session({ id: 'cs_expired', status: 'expired' }));
    await service.checkout(TENANT_ID, INVOICE_ID);
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: `sm-invoice:${INVOICE_ID}:cs_expired` }));
    expect(row.stripeCheckoutSessionId).toBe('cs_test_invoice');
  });

  it('respecte le régime TTC figé, sans appliquer une nouvelle TVA', async () => {
    const { service, gateway } = setup({ amountCents: 4_680, vat: { ratePercent: 10, amountsAre: 'ttc' } });
    await service.checkout(TENANT_ID, INVOICE_ID);
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ totalCents: 4_680 }));
  });

  it('préserve une ancienne facture sans estampille TVA lors du paiement', async () => {
    const { service, row, gateway, remote } = setup({ vat: undefined });
    // Le régime historique documenté est appliqué par invoiceTotals, pas écrit en base.
    const { invoiceTotals } = await import('@sm/contracts');
    const expected = invoiceTotals(row.amountCents, null).ttcCents;
    remote(session({ amount_total: expected }));
    await service.checkout(TENANT_ID, INVOICE_ID);
    expect(gateway.create).toHaveBeenCalledWith(expect.objectContaining({ totalCents: expected }));
    expect(row.vat).toBeUndefined();
    expect(row.number).toBe('SM-2026-0042');
  });

  it('deux créations concurrentes conservent la même clé et la même session', async () => {
    const { service, gateway, row } = setup();
    const results = await Promise.all([service.checkout(TENANT_ID, INVOICE_ID), service.checkout(TENANT_ID, INVOICE_ID)]);
    expect(results[0]).toEqual(results[1]);
    expect(new Set(gateway.create.mock.calls.map((call) => (call as unknown as [{ idempotencyKey: string }])[0].idempotencyKey)).size).toBe(1);
    expect(row.stripeCheckoutSessionId).toBe('cs_test_invoice');
    expect(gateway.expire).not.toHaveBeenCalled();
  });

  it('expire le nouveau lien si une annulation manuelle gagne la course', async () => {
    const { service, gateway, row } = setup();
    gateway.create.mockImplementation(async () => { row.status = 'annulee'; return session(); });
    await expect(service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow('changé');
    expect(gateway.expire).toHaveBeenCalledWith('cs_test_invoice');
    expect(row.status).toBe('annulee');
  });

  it('refuse une redirection non Stripe', async () => {
    const { service, remote } = setup();
    remote(session({ url: 'https://stripe.com.evil.example/pay' }));
    await expect(service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow('Lien');
  });

  it('n’écrase pas une session déjà complétée même si son webhook tarde', async () => {
    const { service, remote, gateway } = setup({ stripeCheckoutSessionId: 'cs_test_invoice' });
    remote(session({ status: 'complete', payment_status: 'paid', payment_intent: 'pi_invoice' }));
    await expect(service.checkout(TENANT_ID, INVOICE_ID)).rejects.toThrow('Confirmation');
    expect(gateway.create).not.toHaveBeenCalled();
  });

  it('confirme une seule fois et persiste les trois références Stripe', async () => {
    const { service, remote, row } = setup({ stripeCheckoutSessionId: 'cs_test_invoice' });
    remote(session({ status: 'complete', payment_status: 'paid', payment_intent: 'pi_invoice' }));
    const results = await Promise.all([service.webhook(event()), service.webhook(event({ id: 'evt_replay' }))]);
    expect(results.map((result) => result.result).sort()).toEqual(['paid', 'replay']);
    expect(row).toMatchObject({ status: 'payee', method: 'carte', stripeCheckoutSessionId: 'cs_test_invoice', stripePaymentIntentId: 'pi_invoice' });
    expect(row.stripePaymentEventId).toBe('evt_invoice');
  });

  it.each([
    { amount_total: 1 }, { currency: 'usd' }, { livemode: true }, { id: 'cs_wrong' },
    { client_reference_id: 'wrong' }, { metadata: { purpose: 'sm_invoice', invoiceId: INVOICE_ID, tenantId: 'wrong' } },
  ])('refuse un paiement non concordant : %o', async (changes) => {
    const { service, remote, row } = setup({ stripeCheckoutSessionId: 'cs_test_invoice' });
    remote(session({ status: 'complete', payment_status: 'paid', payment_intent: 'pi_invoice', ...changes }));
    await expect(service.webhook(event())).rejects.toThrow('concordant');
    expect(row.status).toBe('envoyee');
  });

  it('un événement connecté, échoué ou impayé ne déclasse aucune facture', async () => {
    const { service, row } = setup({ stripeCheckoutSessionId: 'cs_test_invoice' });
    expect((await service.webhook(event({ account: 'acct_restaurant' }))).result).toBe('ignored');
    expect((await service.webhook(event({ type: 'checkout.session.async_payment_failed' }))).result).toBe('ignored');
    expect((await service.webhook(event())).result).toBe('not_paid');
    expect(row.status).toBe('envoyee');
  });

  it('ne réactive pas une facture annulée', async () => {
    const { service, remote, row } = setup({ stripeCheckoutSessionId: 'cs_test_invoice', status: 'annulee' });
    remote(session({ status: 'complete', payment_status: 'paid', payment_intent: 'pi_invoice' }));
    await expect(service.webhook(event())).rejects.toThrow('rapprochement');
    expect(row.status).toBe('annulee');
  });
});

describe('frontières HTTP Checkout', () => {
  it('ne propose le paiement qu’après activation explicite et URL de retour sûre', () => {
    const values: Record<string, string> = {
      STRIPE_BILLING_CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_invoice',
      STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test', STRIPE_BILLING_RETURN_URL: 'https://staging.example.test/admin/abonnement',
    };
    const gateway = new InvoiceCheckoutGateway({ get: (key: string) => values[key] } as ConfigService);
    expect(gateway.enabled()).toBe(true);
    values.STRIPE_BILLING_RETURN_URL = 'https://staging.example.test/admin/abonnement?next=https://evil.example';
    expect(gateway.enabled()).toBe(false);
    values.STRIPE_BILLING_RETURN_URL = 'http://staging.example.test/admin/abonnement';
    expect(gateway.enabled()).toBe(false);
    values.STRIPE_BILLING_RETURN_URL = 'https://staging.example.test/admin/abonnement';
    values.STRIPE_BILLING_CHECKOUT_ENABLED = 'false';
    expect(gateway.enabled()).toBe(false);
  });

  it('utilise Checkout payment, EUR TTC exact, sans facture Stripe ni frais Connect', async () => {
    const values: Record<string, string> = {
      STRIPE_BILLING_CHECKOUT_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_invoice',
      STRIPE_BILLING_WEBHOOK_SECRET: 'whsec_test', STRIPE_BILLING_RETURN_URL: 'https://staging.example.test/admin/abonnement',
    };
    const gateway = new InvoiceCheckoutGateway({ get: (key: string) => values[key] } as ConfigService);
    const create = vi.fn().mockResolvedValue(session());
    // Doublure locale de la seule frontière SDK ; aucun appel réseau Stripe.
    Object.assign(gateway, { client: { checkout: { sessions: { create } } } });
    await gateway.create({ invoiceId: INVOICE_ID, tenantId: TENANT_ID, number: 'SM-2026-0042', totalCents: 4_680, idempotencyKey: 'invoice-key' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'payment', invoice_creation: { enabled: false }, automatic_tax: { enabled: false },
      adaptive_pricing: { enabled: false }, allow_promotion_codes: false,
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 4_680, product_data: { name: 'Facture Snack Manager SM-2026-0042 — TTC' } } }],
    }), { idempotencyKey: 'invoice-key' });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('subscription_data');
    expect(create.mock.calls[0]?.[1]).not.toHaveProperty('stripeAccount');
  });

  it('la session propriétaire valide passe, une session révoquée reste refusée', async () => {
    const sessionGuard = { canActivate: vi.fn().mockResolvedValue(true) };
    const guard = new InvoiceOwnerGuard(sessionGuard as unknown as TenantSessionGuard);
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { role: 'owner', kind: 'user' } }) }) } as ExecutionContext;
    expect(await guard.canActivate(context)).toBe(true);
    sessionGuard.canActivate.mockRejectedValue(new ForbiddenException('Session révoquée'));
    await expect(guard.canActivate(context)).rejects.toThrow('révoquée');
  });

  it.each(['comptable', 'cogerant', 'caisse', 'sm_admin'])('refuse %s après la vérification de session', async (role) => {
    const guard = new InvoiceOwnerGuard({ canActivate: vi.fn(async () => true) } as unknown as TenantSessionGuard);
    const context = { switchToHttp: () => ({ getRequest: () => ({ user: { role, kind: 'user' } }) }) } as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('vérifie le HMAC Stripe brut, et rejette une altération sans appeler le service', async () => {
    const secret = 'whsec_invoice_test';
    const config = { get: (key: string) => ({ STRIPE_SECRET_KEY: 'sk_test_invoice', STRIPE_BILLING_WEBHOOK_SECRET: secret })[key] } as ConfigService;
    const gateway = new InvoiceCheckoutGateway(config);
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify(event()));
    const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload.toString()}`).digest('hex')}`;
    expect(gateway.constructEvent(payload, signature).id).toBe('evt_invoice');
    const service = { webhook: vi.fn() };
    const controller = new InvoiceCheckoutWebhookController(gateway, service as unknown as InvoiceCheckoutService);
    await expect(controller.webhook({ rawBody: Buffer.from('{}') } as any, signature)).rejects.toThrow(BadRequestException);
    expect(service.webhook).not.toHaveBeenCalled();
  });
});
