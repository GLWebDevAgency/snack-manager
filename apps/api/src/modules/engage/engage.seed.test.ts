import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model } from 'mongoose';
import type { Promotion, Review } from '@sm/db';
import { EngageService } from './engage.service';

/**
 * LE GARDE-FOU DES FAUX AVIS — régression du 24/08/2026.
 *
 * Le seed d'avis de démonstration tournait SANS la garde `demoSeedEnabled` :
 * en production, un vrai restaurant voyait douze avis de fiction apparaître
 * dans son onglet Avis à la première ouverture. Ces tests verrouillent les
 * deux côtés de la porte.
 */

const fakeReviews = (count: number) => {
  const insertMany = vi.fn().mockResolvedValue([]);
  const chain = { sort: () => ({ lean: () => Promise.resolve([]) }) };
  return {
    model: {
      countDocuments: vi.fn().mockResolvedValue(count),
      insertMany,
      find: vi.fn().mockReturnValue(chain),
    } as unknown as Model<Review>,
    insertMany,
  };
};

const service = (reviews: Model<Review>) =>
  new EngageService({} as unknown as Model<Promotion>, reviews);

afterEach(() => {
  delete process.env.SM_DEMO_SEED;
});

describe('Seed des avis de démonstration', () => {
  it('n’écrit RIEN quand la démo est coupée — la production, donc', async () => {
    delete process.env.SM_DEMO_SEED;
    const { model, insertMany } = fakeReviews(0);
    await service(model).listReviews('tenant-reel', 'all');
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('amorce une collection vide quand la démo est explicitement active', async () => {
    process.env.SM_DEMO_SEED = 'on';
    const { model, insertMany } = fakeReviews(0);
    await service(model).listReviews('tenant-demo', 'all');
    expect(insertMany).toHaveBeenCalledOnce();
  });

  it('ne réécrit jamais par-dessus des avis existants, même en démo', async () => {
    process.env.SM_DEMO_SEED = 'on';
    const { model, insertMany } = fakeReviews(3);
    await service(model).listReviews('tenant-demo', 'all');
    expect(insertMany).not.toHaveBeenCalled();
  });
});
