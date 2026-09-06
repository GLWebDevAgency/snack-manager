import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { CreatePublicOrderSchema } from '@sm/contracts';
import { PublicOrderRecoveryController } from './public-order-recovery.controller';
import { OrdersController } from './orders.controller';
import { publicRecoveryBinding } from './order-recovery';

const tenantId = '507f1f77bcf86cd799439011';
const body = CreatePublicOrderSchema.parse({ clientId: '11111111-1111-4111-8111-111111111111', recoveryProof: 'ab'.repeat(32), lines: [{ productId: 'burger', qty: 1 }], payment: { method: 'counter' }, pickup: { slot: '2026-09-07T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' }, turnstileToken: 'once' });
const request = { headers: {}, socket: { remoteAddress: '127.0.0.1' } } as never;
function setup() {
  const calls: string[] = [];
  const quota = { reserve: vi.fn(async () => { calls.push('source'); return true; }), reserveClient: vi.fn(async () => { calls.push('attempt'); return true; }) };
  const tenants = { bySlug: vi.fn(async () => { calls.push('tenant'); return { _id: tenantId, account: { status: 'active' }, onlineOrdering: true, settings: { onlineOrderingPaused: false } }; }) };
  const admissions = { recover: vi.fn().mockResolvedValue({ state: 'pending' }), begin: vi.fn().mockResolvedValue({ state: 'pending' }), claimValidation: vi.fn().mockResolvedValue({ ...publicRecoveryBinding(tenantId, body), validationOwner: 'owner' }), reject: vi.fn().mockResolvedValue({ state: 'rejected', reason: 'abandoned', code: 'ORDER_ATTEMPT_REJECTED', message: 'Abandonnée' }), materializeSlot: vi.fn(async () => void calls.push('drain')), createdOrder: vi.fn().mockResolvedValue({ _id: 'full-document', lines: ['preserved'] }), rejectionError: vi.fn(({ rejection }) => new ConflictException({ code: 'ORDER_ATTEMPT_REJECTED', reason: rejection, message: 'Refus durable' })) };
  const releaseValidation = vi.fn();
  Object.assign(admissions, { releaseValidation });
  const controller = new PublicOrderRecoveryController(admissions as never, tenants as never, quota as never);
  const orders = { findPublicReplay: vi.fn().mockResolvedValue(null), createWithOutcome: vi.fn().mockResolvedValue({ created: true, order: { _id: 'full-document' } }) };
  const slots = { exigerDisponible: vi.fn(async () => void calls.push('slot')) };
  const gate = { authorize: vi.fn().mockResolvedValue({ quotaReservation: {} }), serializeSlot: vi.fn(async (_input: unknown, run: () => unknown) => run()), release: vi.fn() };
  const creation = new OrdersController(orders as never, {} as never, tenants as never, slots as never, gate as never, admissions as never, quota as never);
  return { controller, creation, calls, quota, tenants, admissions, orders, slots, gate, releaseValidation };
}

describe('reprise publique : frontières et quotas', () => {
  it('réserve quota source puis tentative avant toute lecture tenant/commande', async () => {
    const ctx = setup();
    expect(await ctx.controller.recover('classfood', { clientId: body.clientId, recoveryProof: body.recoveryProof! }, request)).toEqual({ state: 'pending' });
    expect(ctx.calls).toEqual(['source', 'attempt', 'tenant']);
    expect(ctx.admissions.recover).toHaveBeenCalledWith(tenantId, body.clientId, body.recoveryProof);
    expect(JSON.stringify(ctx.quota.reserve.mock.calls)).not.toContain(body.recoveryProof);
  });
  it.each(['source', 'attempt'] as const)('quota%s refusé429 sans lecture de commande', async (scope) => {
    const ctx = setup();
    (scope === 'source' ? ctx.quota.reserve : ctx.quota.reserveClient).mockResolvedValue(false);
    await expect(ctx.controller.recover('classfood', { clientId: body.clientId, recoveryProof: body.recoveryProof! }, request)).rejects.toMatchObject({ status: 429 });
    expect(ctx.tenants.bySlug).not.toHaveBeenCalled();
    expect(ctx.admissions.recover).not.toHaveBeenCalled();
  });
  it('Redis indisponible503, jamais récupération ouverte', async () => {
    const ctx = setup(); ctx.quota.reserve.mockRejectedValue(new Error('redis'));
    await expect(ctx.controller.recover('classfood', { clientId: body.clientId, recoveryProof: body.recoveryProof! }, request)).rejects.toMatchObject({ status: 503 });
    expect(ctx.admissions.recover).not.toHaveBeenCalled();
  });
  it('tenant inconnu et commande inconnue ont le même reçu404 non terminal', async () => {
    const ctx = setup(); ctx.tenants.bySlug.mockRejectedValue(new NotFoundException('Établissement introuvable'));
    await expect(ctx.controller.recover('unknown', { clientId: body.clientId, recoveryProof: body.recoveryProof! }, request)).rejects.toMatchObject({ status: 404, response: { code: 'ORDER_RECOVERY_NOT_FOUND', message: 'Commande introuvable' } });
  });
  it('abandon crée une tombstone prouvée et ne demande aucun paiement/Turnstile', async () => {
    const ctx = setup();
    expect(await ctx.controller.abandon('classfood', { ...body, recoveryProof: body.recoveryProof!, turnstileToken: undefined }, request)).toMatchObject({ state: 'rejected' });
    expect(ctx.admissions.reject).toHaveBeenCalledWith(tenantId, body.clientId, publicRecoveryBinding(tenantId, body), 'abandoned');
    expect(ctx.gate.authorize).not.toHaveBeenCalled();
  });
  it('une commande engagée est récupérée, jamais abandonnée', async () => {
    const ctx = setup(); const result = { state: 'created', order: { _id: 'kept' } };
    ctx.admissions.begin.mockResolvedValue(result);
    expect(await ctx.controller.abandon('classfood', { ...body, recoveryProof: body.recoveryProof! }, request)).toEqual(result);
    expect(ctx.admissions.reject).not.toHaveBeenCalled();
  });
  it('interdit la mise en cache des preuves de récupération/abandon', () => {
    for (const method of [PublicOrderRecoveryController.prototype.recover, PublicOrderRecoveryController.prototype.abandon]) {
      expect(Reflect.getMetadata(HEADERS_METADATA, method)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
    }
  });
});

describe('création protégée : admission avant effets et rejeu indépendant de la disponibilité', () => {
  it('rejoue le document COMPLET avant pause/créneau/Turnstile, sans adoption clientId', async () => {
    const ctx = setup();
    ctx.admissions.begin.mockResolvedValue({ state: 'created', order: { _id: 'minimal' } });
    ctx.tenants.bySlug.mockResolvedValue({ _id: tenantId, settings: { onlineOrderingPaused: true } } as never);
    expect(await ctx.creation.createOnline('classfood', body, request)).toEqual({ _id: 'full-document', lines: ['preserved'] });
    expect(ctx.slots.exigerDisponible).not.toHaveBeenCalled();
    expect(ctx.gate.authorize).not.toHaveBeenCalled();
    expect(ctx.orders.findPublicReplay).not.toHaveBeenCalled();
  });
  it('une seconde validation ne réserve ni quota cuisine ni promotion', async () => {
    const ctx = setup(); ctx.admissions.claimValidation.mockResolvedValue(null);
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toMatchObject({ status: 503 });
    expect(ctx.gate.authorize).not.toHaveBeenCalled();
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });
  it('un jeton Turnstile refusé libère ce validateur pour une preuve fraîche, sans abandon forcé', async () => {
    const ctx = setup(); ctx.gate.authorize.mockRejectedValue(new BadRequestException('expired proof'));
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toMatchObject({ status: 400 });
    expect(ctx.releaseValidation).toHaveBeenCalledWith(tenantId, body.clientId, expect.objectContaining({ validationOwner: 'owner' }));
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
    expect(ctx.admissions.reject).not.toHaveBeenCalled();
  });
  it('créneau refusé enregistré rejected avant retour, pas simple409 ambigu', async () => {
    const ctx = setup(); ctx.slots.exigerDisponible.mockRejectedValue(new ConflictException('plein'));
    ctx.admissions.reject.mockResolvedValue({ state: 'rejected', reason: 'slot_unavailable' });
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED' } });
    expect(ctx.admissions.reject).toHaveBeenCalledWith(tenantId, body.clientId, expect.any(Object), 'slot_unavailable');
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });
  it('matérialise sous verrou avant la deuxième vérification capacité ; aucune preuve brute dans le DTO privé', async () => {
    const ctx = setup(); await ctx.creation.createOnline('classfood', body, request);
    expect(ctx.calls.slice(-3)).toEqual(['slot', 'drain', 'slot']);
    expect(ctx.orders.createWithOutcome.mock.calls[0]?.[1]).not.toHaveProperty('recoveryProof');
    expect(ctx.orders.createWithOutcome.mock.calls[0]?.[1]).not.toHaveProperty('turnstileToken');
  });
  it('erreur Mongo après début de création conserve le quota incertain et ne produit aucun refus terminal', async () => {
    const ctx = setup(); ctx.orders.createWithOutcome.mockRejectedValue(new Error('write response lost'));
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toThrow('write response lost');
    expect(ctx.admissions.reject).not.toHaveBeenCalled();
    expect(ctx.gate.release).not.toHaveBeenCalled();
  });
  it('erreur métier avant commit rend le quota uniquement après rejet durable', async () => {
    const ctx = setup(); ctx.orders.createWithOutcome.mockRejectedValue(new BadRequestException('invalid product'));
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toMatchObject({ status: 409 });
    expect(ctx.admissions.reject).toHaveBeenCalled();
    expect(ctx.gate.release).toHaveBeenCalledOnce();
  });
  it('404 de preuve ne descend jamais vers création', async () => {
    const ctx = setup(); ctx.admissions.begin.mockRejectedValue(new NotFoundException('Commande introuvable'));
    await expect(ctx.creation.createOnline('classfood', body, request)).rejects.toMatchObject({ status: 404 });
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
    expect(ctx.gate.authorize).not.toHaveBeenCalled();
  });
});
