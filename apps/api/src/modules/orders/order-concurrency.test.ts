import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

const TENANT = '507f1f77bcf86cd799439011';
const ORDER = '507f1f77bcf86cd799439012';

function harness() {
  let version = 0;
  const audit = { log: vi.fn() };
  const publish = vi.fn();
  const service = new OrdersService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { publish } as never,
    audit as never,
  );

  // Chaque appel lit bien le même état `ready` / __v=0 avant que les
  // continuations asynchrones ne sauvegardent. Le premier save gagne ; le
  // second reproduit le VersionError émis par Mongoose avec optimisticConcurrency.
  (service as unknown as { byId: () => Promise<unknown> }).byId = async () => {
    const readVersion = version;
    return {
      _id: ORDER,
      number: 42,
      status: 'ready',
      statusHistory: [],
      payment: { status: 'paid', method: 'counter', tender: 'card' },
      totals: { subtotal: 2_000, discount: null, total: 2_000 },
      save: async () => {
        if (readVersion !== version) {
          const conflict = new Error('No matching document found for id');
          conflict.name = 'VersionError';
          throw conflict;
        }
        version += 1;
      },
      toObject: () => ({}),
    };
  };

  return { service, audit, publish, version: () => version };
}

type SensitiveAction = (service: OrdersService) => Promise<unknown>;

const actions: [string, SensitiveAction][] = [
  [
    'annulation',
    (service) =>
      service.cancel(TENANT, ORDER, { staffId: 'staff-caisse', role: 'caisse' }, 'Erreur de saisie'),
  ],
  [
    'remise',
    (service) =>
      service.discount(
        TENANT,
        ORDER,
        { staffId: 'staff-gerant', role: 'gerant' },
        500,
        'Geste commercial',
      ),
  ],
];

describe('Order — aucune perte de mise à jour concurrente', () => {
  it.each(actions)(
    'une livraison et une %s lancées ensemble ne peuvent pas réussir toutes les deux',
    async (_label, sensitiveAction) => {
      const { service, audit, version } = harness();

      const results = await Promise.allSettled([
        service.updateStatus(TENANT, ORDER, 'delivered', 'cuisine'),
        sensitiveAction(service),
      ]);

      expect(results[0]).toMatchObject({ status: 'fulfilled' });
      expect(results[1]).toMatchObject({
        status: 'rejected',
        reason: expect.any(ConflictException),
      });
      expect(version()).toBe(1);
      expect(audit.log).not.toHaveBeenCalled();
    },
  );
});
