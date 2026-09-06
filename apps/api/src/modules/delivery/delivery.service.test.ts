import { describe, expect, it, vi } from 'vitest';
import { Mongoose } from 'mongoose';
import { MODELS } from '@sm/db';
import { DEFAULT_DELIVERY_SETTINGS, type JwtPayload } from '@sm/contracts';
import { DeliveryService } from './delivery.service';

const tenantId = '507f1f77bcf86cd799439011';
const actor = { sub: 'owner', tenantId, role: 'owner' } as JwtPayload;
function setup(over: Record<string, unknown> = {}) {
  const row = { _id: 'order', tenantId, type: 'delivery', status: 'ready', payment: { status: 'paid' }, delivery: { dispatchedAt: null }, ...over };
  const updated = { ...row, toJSON: () => ({ ...row, delivery: { dispatchedAt: '2026-09-05T10:00:00Z' } }) };
  const orders = { findOne: vi.fn(() => ({ select: vi.fn().mockResolvedValue(row) })), findOneAndUpdate: vi.fn().mockResolvedValue(updated) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const tenants = { findById: vi.fn(() => ({ lean: vi.fn().mockResolvedValue({ onlineDelivery: true }) })) };
  const service = new DeliveryService(tenants as never, {} as never, orders as never, audit as never, redis as never, {} as never);
  return { service, orders, audit, redis, row };
}

describe('départ du livreur', () => {
  it('refuse préparation inachevée et paiement non confirmé', async () => {
    const preparing = setup({ status: 'preparing' });
    await expect(preparing.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/prête/);
    const pending = setup({ payment: { status: 'pending' } });
    await expect(pending.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/paiement/i);
    expect(pending.orders.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it('compare les préconditions lors de la mutation et incrémente la version contre l’annulation concurrente', async () => {
    const ctx = setup();
    await ctx.service.dispatch(tenantId, 'order', { driverName: 'Nadia' }, actor);
    expect(ctx.orders.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ tenantId, channel: 'online', type: 'delivery', status: 'ready', 'payment.status': 'paid', 'delivery.dispatchedAt': null, 'paymentFlow.phase': { $nin: ['closing', 'closed', 'review_required'] } }), expect.objectContaining({ $inc: { __v: 1 }, $set: expect.objectContaining({ 'delivery.driverName': 'Nadia' }) }), expect.any(Object));
    expect(ctx.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'order.dispatch', actor }));
    expect(ctx.redis.publish).toHaveBeenCalledOnce();
  });
  it('renvoie un départ déjà enregistré sans changer son horodatage ou son livreur', async () => {
    const ctx = setup({ delivery: { dispatchedAt: new Date(), driverName: 'Nadia' } });
    await expect(ctx.service.dispatch(tenantId, 'order', { driverName: 'Autre' }, actor)).resolves.toBe(ctx.row);
    expect(ctx.orders.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });
  it.each(['closing', 'closed', 'review_required'])('refuse un départ pendant %s même si le paiement local indique payé', async (phase) => {
    const ctx = setup({ paymentFlow: { phase } });
    await expect(ctx.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/paiement/i);
    expect(ctx.orders.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });
  it('échoue sans publication si une fermeture gagne le CAS avant le départ', async () => {
    const ctx = setup();
    ctx.orders.findOneAndUpdate.mockResolvedValueOnce(null as never);
    await expect(ctx.service.dispatch(tenantId, 'order', {}, actor)).rejects.toThrow(/parallèle/i);
    expect(ctx.audit.log).not.toHaveBeenCalled();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });
});

describe('réglages livraison sous autorité du calendrier', () => {
  // Vrai schéma Mongoose, sans connexion : la réponse du writer est hydratée,
  // ses sous-documents ne sont pas des objets JSON acceptés par Zod strict.
  const TenantDocument = new Mongoose().model('DeliverySettingsResponseTest', MODELS.Tenant.schema);

  function fixture(over: Record<string, unknown> = {}) {
    const row: Record<string, unknown> = { _id: tenantId, delivery: { ...DEFAULT_DELIVERY_SETTINGS }, ...over };
    const read = Promise.resolve(row);
    const query = Object.assign(read, { select: vi.fn(() => read), read: vi.fn(() => read),
      readConcern: vi.fn(() => read), maxTimeMS: vi.fn(() => read), lean: vi.fn(() => read) });
    const writeSelect = vi.fn();
    const tenants = {
      findById: vi.fn(() => query),
      findByIdAndUpdate: vi.fn(),
      findOneAndUpdate: vi.fn((_filter: unknown, update: { $set: { delivery: unknown } }) => {
        const result = TenantDocument.hydrate({ ...row, delivery: update.$set.delivery });
        const write = Promise.resolve(result);
        return Object.assign(write, { select: (value: string) => {
          writeSelect(value);
          if (value === '-capacityControl') result.set('capacityControl', undefined);
          return write;
        } });
      }),
    };
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new DeliveryService(tenants as never, {} as never, {} as never, audit as never, {} as never, {} as never);
    return { service, tenants, query, writeSelect, audit };
  }

  it('préserve les frais/seuils configurés et trace seulement après le CAS du tenant historique', async () => {
    const ctx = fixture();
    const settings = { ...DEFAULT_DELIVERY_SETTINGS, enabled: true, zones: [{ id: 'local', name: 'Zone locale', postalCodes: ['75001'],
      feeCents: 500, minimumOrderCents: 1500, freeDeliveryFromCents: 3500 }] };
    await expect(ctx.service.updateSettings(tenantId, settings, actor)).resolves.toEqual(settings);
    expect(ctx.tenants.findByIdAndUpdate).not.toHaveBeenCalled();
    expect(ctx.query.select).toHaveBeenCalledWith('_id capacityControl');
    expect(ctx.writeSelect).toHaveBeenCalledWith('-capacityControl');
    expect(ctx.query.read).toHaveBeenCalledWith('primary');
    expect(ctx.query.readConcern).toHaveBeenCalledWith('majority');
    expect(ctx.query.maxTimeMS).toHaveBeenCalledWith(10_000);
    expect(ctx.tenants.findOneAndUpdate).toHaveBeenCalledWith({ _id: tenantId, capacityControl: { $exists: false } },
      { $set: { delivery: settings } }, expect.objectContaining({ new: true, runValidators: true, context: 'query',
        writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } }));
    expect(ctx.audit.log).toHaveBeenCalledWith({ tenantId, actor, action: 'tenant.settings', meta: { delivery: settings } });
  });

  it('rend la configuration enregistrée depuis un vrai document hydraté, jamais le repli livraison désactivée', async () => {
    const ctx = fixture();
    const settings = { ...DEFAULT_DELIVERY_SETTINGS, enabled: true, leadTimeMin: 60, slotCapacity: 5,
      zones: [{ id: 'centre', name: 'Centre ville', postalCodes: ['75002'], feeCents: 500,
        minimumOrderCents: 1500, freeDeliveryFromCents: 3500 }] };
    const result = await ctx.service.updateSettings(tenantId, settings, actor);
    const response = await ctx.tenants.findOneAndUpdate.mock.results[0]!.value;
    expect(response).toBeInstanceOf(TenantDocument);
    expect(result).toEqual(settings);
    expect(result.enabled).toBe(true);
    expect(result.zones[0]).toMatchObject({ feeCents: 500, freeDeliveryFromCents: 3500 });
  });

  it('ne rend que les réglages livraison, jamais le contrôle privé', async () => {
    const capacityControl = { version: 1, state: 'active', configRevision: 3,
      bootstrapId: '11111111-1111-4111-8111-111111111111', cutoverAt: new Date('2030-05-01T00:00:00Z'), dayIntent: null };
    const ctx = fixture({ capacityControl });
    const result = await ctx.service.updateSettings(tenantId, DEFAULT_DELIVERY_SETTINGS, actor);
    expect(result).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(result).not.toHaveProperty('capacityControl');
    expect(ctx.tenants.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: tenantId,
      'capacityControl.state': 'active', 'capacityControl.bootstrapId': capacityControl.bootstrapId,
      'capacityControl.configRevision': 3 }), expect.objectContaining({ $inc: { 'capacityControl.configRevision': 1 } }), expect.any(Object));
  });

  it('un échec de persistance n’annonce aucun succès au journal', async () => {
    const ctx = fixture();
    ctx.tenants.findOneAndUpdate.mockImplementationOnce(() => {
      const write = Promise.resolve(null as never);
      return Object.assign(write, { select: () => Promise.reject(new Error('Résultat indéterminé')) });
    });
    await expect(ctx.service.updateSettings(tenantId, DEFAULT_DELIVERY_SETTINGS, actor)).rejects.toThrow();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });

  it('une configuration invalide est refusée avant lecture, écriture ou audit', async () => {
    const ctx = fixture();
    await expect(ctx.service.updateSettings(tenantId, { ...DEFAULT_DELIVERY_SETTINGS, enabled: true }, actor)).rejects.toThrow();
    expect(ctx.tenants.findById).not.toHaveBeenCalled();
    expect(ctx.tenants.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.audit.log).not.toHaveBeenCalled();
  });
});
