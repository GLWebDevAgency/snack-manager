import { describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';

const TENANT = '507f1f77bcf86cd799439011';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';

function serviceWith(result: unknown) {
  const lean = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ lean });
  const findOne = vi.fn().mockReturnValue({ select });
  const service = new OrdersService(
    { findOne } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { pourTenant: async () => ["bo"] } as never,
  );
  return { findOne, lean, select, service };
}

describe('état sûr du gain fidélité par commande', () => {
  it('reste tenant-scopé et ne sélectionne que les champs techniques nécessaires', async () => {
    const { service, findOne, select } = serviceWith({
      loyaltyEarnState: 'completed',
      loyaltyEarnAttempts: 2,
      loyaltyEarnLastError: null,
    });

    await expect(service.loyaltyEarnStatusByClientId(TENANT, CLIENT_ID)).resolves.toEqual({
      state: 'completed',
      attempts: 2,
      errorCode: null,
    });
    expect(findOne).toHaveBeenCalledWith({ tenantId: TENANT, clientId: CLIENT_ID });
    expect(select).toHaveBeenCalledWith(
      '+loyaltyEarnState +loyaltyEarnAttempts +loyaltyEarnLastError',
    );
  });

  it('masque un état ou un message historique non conforme', async () => {
    const { service } = serviceWith({
      loyaltyEarnState: 'valeur-inconnue',
      loyaltyEarnAttempts: -4,
      loyaltyEarnLastError: 'Téléphone 06 12 34 56 78',
    });

    await expect(service.loyaltyEarnStatusByClientId(TENANT, CLIENT_ID)).resolves.toEqual({
      state: 'none',
      attempts: 0,
      errorCode: null,
    });
  });

  it('distingue une commande absente', async () => {
    const { service } = serviceWith(null);
    await expect(service.loyaltyEarnStatusByClientId(TENANT, CLIENT_ID)).resolves.toBeNull();
  });
});
