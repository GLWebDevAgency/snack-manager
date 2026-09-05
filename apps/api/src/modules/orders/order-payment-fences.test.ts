import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

const TENANT = '507f1f77bcf86cd799439011';
const ID = '507f1f77bcf86cd799439012';
const owner: JwtPayload = { sub: 'owner', tenantId: TENANT, role: 'owner', kind: 'user' };
const caisse: JwtPayload = { sub: 'staff', tenantId: TENANT, role: 'caisse', kind: 'staff' };

function setup(overrides: Record<string, unknown> = {}) {
  const row = { _id: ID, tenantId: TENANT, number: 42, status: 'ready', type: 'pickup',
    statusHistory: [] as unknown[],
    totals: { subtotal: 2000, total: 2000, discount: null },
    payment: { status: 'pending', method: 'counter', stripePaymentIntentId: null },
    paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null },
    ...overrides,
    save: vi.fn(async () => undefined),
    toObject: () => ({ _id: ID, status: row.status, paymentFlow: row.paymentFlow }),
  };
  const audit = { log: vi.fn(async () => undefined) };
  const redis = { publish: vi.fn(async (_channel: string, _payload: string) => 1) };
  const payments = { cancelOrder: vi.fn(async () => { row.status = 'cancelled'; }) };
  const service = new OrdersService({} as never, {} as never, {} as never, {} as never,
    redis as never, audit as never, {} as never, { pourTenant: async () => ['bo'] } as never,
    payments as never);
  vi.spyOn(service, 'byId').mockResolvedValue(row as never);
  return { service, row, audit, redis, payments };
}

describe('commande — barrières du cycle de paiement', () => {
  const counterProof = () => ({ version: 1, origin: 'created_v1', phase: 'counter_ready',
    attempt: { id: 'attempt', requestStartedAt: new Date(), accountId: 'acct_original', amountCents: 2000 },
    close: { destination: 'counter', operationId: 'switch' }, providerStatus: 'canceled',
    providerCheckedAt: new Date(), reviewReason: null });
  const counterPayment = { status: 'pending', method: 'counter', stripePaymentIntentId: 'pi_cancelled', stripeAccountId: 'acct_original' };
  it('ne laisse pas un appel interne contourner la fermeture via un simple changement de statut', async () => {
    const ctx = setup();
    await expect(ctx.service.updateStatus(TENANT, ID, 'cancelled', owner)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.row.save).not.toHaveBeenCalled();
  });
  for (const phase of ['closing', 'closed', 'review_required']) {
    it.each(['preparing', 'ready', 'delivered'] as const)(`bloque la mutation %s pendant ${phase}`, async (status) => {
      const ctx = setup({ status: status === 'delivered' ? 'ready' : 'new',
        paymentFlow: { version: 1, origin: 'created_v1', phase, attempt: null } });
      await expect(ctx.service.updateStatus(TENANT, ID, status, caisse)).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.row.save).not.toHaveBeenCalled();
      expect(ctx.row.statusHistory).toEqual([]);
      expect(ctx.redis.publish).not.toHaveBeenCalled();
    });
  }

  it.each([
    null,
    { version: 1, origin: 'legacy_unknown', phase: 'open', attempt: null },
    { version: 1, origin: 'adopted_intent', phase: 'open', attempt: null },
    { version: 1, origin: 'created_v1', phase: 'open', attempt: { id: 'prepared-not-yet-local-pi' } },
    { version: 1, origin: 'created_v1', phase: 'settled', attempt: null },
  ])('ne solde jamais au comptoir une tentative engagée ou un historique inconnu : %j', async (paymentFlow) => {
    const ctx = setup({ paymentFlow });
    await expect(ctx.service.updateStatus(TENANT, ID, 'delivered', caisse)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.payment.status).toBe('pending');
    expect(ctx.row.status).toBe('ready');
    expect(ctx.row.save).not.toHaveBeenCalled();
  });

  it('conserve la remise déjà payée d’une commande historique sans réencaisser', async () => {
    const ctx = setup({ paymentFlow: null, payment: { status: 'paid', method: 'online' } });
    await ctx.service.updateStatus(TENANT, ID, 'delivered', caisse);
    expect(ctx.row.status).toBe('delivered');
    expect(ctx.row.payment.status).toBe('paid');
  });

  it('ne transforme pas le choix en ligne en paiement comptoir même avant sa première tentative bancaire', async () => {
    const ctx = setup({ payment: { status: 'pending', method: 'online', stripePaymentIntentId: null } });
    await expect(ctx.service.updateStatus(TENANT, ID, 'delivered', caisse)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.status).toBe('ready');
    expect(ctx.row.payment.status).toBe('pending');
    expect(ctx.row.save).not.toHaveBeenCalled();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });

  it('autorise le règlement comptoir prouvé sans aucune tentative et ne diffuse pas la preuve', async () => {
    const ctx = setup();
    await ctx.service.updateStatus(TENANT, ID, 'delivered', caisse);
    expect(ctx.row.payment.status).toBe('paid');
    expect(ctx.redis.publish).toHaveBeenCalledOnce();
    expect(ctx.redis.publish.mock.calls[0]?.[1]).not.toContain('paymentFlow');
  });

  it.each(['created_v1', 'adopted_intent'])('la caisse remet un retrait basculé avec preuve bancaire %s sans effacer son PI annulé', async (origin) => {
    const ctx = setup({ channel: 'online', payment: { ...counterPayment }, paymentFlow: { ...counterProof(), origin } });
    await ctx.service.updateStatus(TENANT, ID, 'delivered', caisse);
    expect(ctx.row.payment).toMatchObject({ status: 'paid', method: 'counter', stripePaymentIntentId: 'pi_cancelled' });
    expect(ctx.row.status).toBe('delivered');
    expect(ctx.row.save).toHaveBeenCalledOnce();
    expect(ctx.redis.publish.mock.calls[0]?.[1]).not.toContain('paymentFlow');
  });

  it('la bascule prouvée sans appel provider permet le règlement comptoir', async () => {
    const ctx = setup({ channel: 'online', paymentFlow: { ...counterProof(), attempt: null, providerStatus: 'not_started' } });
    await ctx.service.updateStatus(TENANT, ID, 'delivered', caisse);
    expect(ctx.row.payment.status).toBe('paid');
  });

  it.each([
    { providerStatus: 'processing' }, { providerStatus: null }, { providerCheckedAt: null },
    { origin: 'legacy_unknown' }, { close: null }, { close: { destination: 'cancel_order', operationId: 'other' } },
    { reviewReason: 'inconsistent' }, { attempt: { requestStartedAt: new Date(), amountCents: 1, accountId: 'acct_original' } },
    { attempt: { requestStartedAt: new Date(), amountCents: 2000, accountId: 'acct_other' } },
    { providerStatus: 'not_started' },
  ])('un mode comptoir avec preuve incomplète ne solde rien : %j', async (patch) => {
    const ctx = setup({ channel: 'online', payment: { ...counterPayment }, paymentFlow: { ...counterProof(), ...patch } });
    await expect(ctx.service.updateStatus(TENANT, ID, 'delivered', caisse)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.payment.status).toBe('pending');
    expect(ctx.row.status).toBe('ready');
    expect(ctx.row.save).not.toHaveBeenCalled();
  });

  it.each([{ type: 'delivery' }, { channel: 'pos' }, { payment: { ...counterPayment, method: 'online' } }])('la preuve comptoir ne s’applique pas à une autre nature de commande : %j', async (patch) => {
    const ctx = setup({ channel: 'online', payment: { ...counterPayment }, paymentFlow: counterProof(), ...patch });
    await expect(ctx.service.updateStatus(TENANT, ID, 'delivered', caisse)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.save).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { version: 1, origin: 'created_v1', phase: 'open', attempt: { id: 'prepared' } },
    { version: 1, origin: 'created_v1', phase: 'closing', attempt: null },
    { version: 1, origin: 'created_v1', phase: 'settled', attempt: null },
  ])('refuse de changer le montant dès que sa stabilité bancaire est requise : %j', async (paymentFlow) => {
    const ctx = setup({ paymentFlow });
    await expect(ctx.service.discount(TENANT, ID, { staffId: 'manager', role: 'gerant' }, 100, 'Geste commercial'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.totals.total).toBe(2000);
    expect(ctx.row.save).not.toHaveBeenCalled();
  });

  it('ne contourne jamais la fermeture Stripe lors du rejeu d’une ancienne annulation', async () => {
    const ctx = setup({ status: 'cancelled', paymentFlow: null });
    await ctx.service.cancelAsOwner(TENANT, ID, owner, 'Client absent');
    expect(ctx.payments.cancelOrder).toHaveBeenCalledWith(ID, TENANT, owner, 'Client absent');
    expect(ctx.row.save).not.toHaveBeenCalled();
  });

  it('l’annulation PIN transmet l’identité du valideur et le motif au propriétaire du cycle bancaire', async () => {
    const ctx = setup();
    await ctx.service.cancel(TENANT, ID, { staffId: 'manager', role: 'gerant' }, 'Client absent');
    expect(ctx.payments.cancelOrder).toHaveBeenCalledWith(ID, TENANT,
      { sub: 'manager', tenantId: TENANT, role: 'gerant', kind: 'staff' }, 'Client absent');
    expect(ctx.row.save).not.toHaveBeenCalled();
    expect(ctx.audit.log).toHaveBeenCalledOnce();
    expect(ctx.redis.publish).toHaveBeenCalledOnce();
  });

  it.each(['owner', 'pin'] as const)('une fermeture incertaine %s ne simule jamais une annulation réussie', async (path) => {
    const ctx = setup();
    ctx.payments.cancelOrder.mockRejectedValue(new ConflictException('Paiement à vérifier'));
    const result = path === 'owner' ? ctx.service.cancelAsOwner(TENANT, ID, owner, 'Client absent')
      : ctx.service.cancel(TENANT, ID, { staffId: 'manager', role: 'gerant' }, 'Client absent');
    await expect(result).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.row.status).toBe('ready');
    expect(ctx.row.save).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });

  it('la cuisine ne peut pas fermer le paiement en contournant le contrôleur', async () => {
    const ctx = setup();
    await expect(ctx.service.cancel(TENANT, ID, { staffId: 'cook', role: 'cuisine' }, 'Client absent'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(ctx.payments.cancelOrder).not.toHaveBeenCalled();
  });
});
