import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CreatePublicOrder } from '@sm/contracts';
import { OrdersController } from './orders.controller';

const TENANT = '507f1f77bcf86cd799439011';

const body = (method: 'online' | 'counter' = 'counter'): CreatePublicOrder => ({
  clientId: '11111111-1111-4111-8111-111111111111',
  lines: [{ productId: 'produit', options: [], removed: [], qty: 1 }],
  payment: { method },
  pickup: {
    slot: '2026-08-29T18:00:00.000Z',
    customerName: 'Camille',
    customerPhone: '0612345678',
  },
  turnstileToken: 'preuve-ephemere',
});

function setup(
  over: {
    existing?: unknown;
    existingAfterGate?: unknown;
    gateError?: Error;
    createError?: Error;
    created?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let idempotenceReads = 0;
  const orders = {
    findByClientId: vi.fn().mockImplementation(async () => {
      calls.push('idempotence');
      idempotenceReads += 1;
      return idempotenceReads === 1
        ? (over.existing ?? null)
        : (over.existingAfterGate ?? null);
    }),
    createWithOutcome: vi.fn().mockImplementation(async (...args: unknown[]) => {
      calls.push('create');
      if (over.createError) throw over.createError;
      return { order: { ok: true, args }, created: over.created ?? true };
    }),
  };
  const tenants = {
    bySlug: vi.fn().mockResolvedValue({
      _id: TENANT,
      account: { status: 'active' },
      settings: { onlineOrderingPaused: false },
    }),
  };
  const slots = {
    exigerDisponible: vi.fn().mockImplementation(async () => void calls.push('slot')),
  };
  const publicOrderGate = {
    authorize: vi.fn().mockImplementation(async () => {
      calls.push('gate');
      if (over.gateError) throw over.gateError;
      return {
        provider: 'turnstile',
        quotaReservation: { tenantId: TENANT, id: 'reservation' },
      };
    }),
    serializeSlot: vi.fn().mockImplementation(async (_input: unknown, work: () => unknown) => {
      calls.push('lock');
      return work();
    }),
    release: vi.fn().mockImplementation(async () => void calls.push('release')),
  };
  const controller = new OrdersController(
    orders as never,
    {} as never,
    tenants as never,
    slots as never,
    publicOrderGate as never,
  );
  return { controller, orders, slots, publicOrderGate, calls };
}

describe('une commande publique ne rejoint la cuisine qu apres ses controles', () => {
  it.each(['counter', 'online'] as const)(
    'verifie le creneau puis la preuve et le quota avant create (%s)',
    async (method) => {
      const ctx = setup();
      await ctx.controller.createOnline('classfood', body(method));

      expect(ctx.calls).toEqual([
        'idempotence',
        'slot',
        'gate',
        'lock',
        'idempotence',
        'slot',
        'create',
      ]);
      expect(ctx.publicOrderGate.authorize).toHaveBeenCalledWith({
        tenantId: TENANT,
        tenantSlug: 'classfood',
        turnstileToken: 'preuve-ephemere',
      });
      expect(ctx.publicOrderGate.serializeSlot).toHaveBeenCalledWith(
        { tenantId: TENANT, slot: body(method).pickup.slot },
        expect.any(Function),
      );
      expect(ctx.orders.createWithOutcome).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          channel: 'online',
          type: 'pickup',
          payment: { method: 'counter' },
        }),
        'online:turnstile',
      );
      expect(ctx.orders.createWithOutcome.mock.calls[0]?.[1]).not.toHaveProperty(
        'turnstileToken',
      );
      expect(ctx.publicOrderGate.release).not.toHaveBeenCalled();
    },
  );

  it('ne cree et ne publie rien quand la preuve est refusee', async () => {
    const ctx = setup({ gateError: new BadRequestException('preuve refusee') });
    await expect(ctx.controller.createOnline('classfood', body())).rejects.toThrow(/preuve/);
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });

  it('rend le rejeu existant sans reutiliser la preuve a usage unique', async () => {
    const existing = { _id: 'commande', trackingToken: 'secret' };
    const ctx = setup({ existing });
    await expect(ctx.controller.createOnline('classfood', body())).resolves.toBe(existing);
    expect(ctx.slots.exigerDisponible).not.toHaveBeenCalled();
    expect(ctx.publicOrderGate.authorize).not.toHaveBeenCalled();
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });

  it('rend le quota si le corps metier echoue apres la preuve', async () => {
    const ctx = setup({ createError: new BadRequestException('produit invalide') });
    await expect(ctx.controller.createOnline('classfood', body())).rejects.toThrow(/produit/);
    expect(ctx.publicOrderGate.release).toHaveBeenCalledOnce();
  });

  it('rend le quota si une replique gagne la course idempotente sous verrou', async () => {
    const raced = { _id: 'commande', trackingToken: 'secret' };
    const ctx = setup({ existingAfterGate: raced });
    await expect(ctx.controller.createOnline('classfood', body())).resolves.toBe(raced);
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
    expect(ctx.publicOrderGate.release).toHaveBeenCalledOnce();
  });
});
