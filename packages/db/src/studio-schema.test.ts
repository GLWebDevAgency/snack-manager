import { describe, expect, it } from 'vitest';
import { model, Types } from 'mongoose';
import { CategorySchema, ScreenSchema } from './schemas';

const Category = model('StudioCategoryTest', CategorySchema);
const Screen = model('StudioScreenTest', ScreenSchema);

describe('La persistance borne les réglages du studio', () => {
  it('refuse quatre références ou une sélection dupliquée même sans passer par HTTP', () => {
    const ids = Array.from({ length: 4 }, () => new Types.ObjectId());
    for (const featuredProductIds of [ids, [ids[0], ids[0]]]) {
      expect(new Category({ tenantId: new Types.ObjectId(), name: 'Burgers', featuredProductIds }).validateSync()).toBeDefined();
    }
    expect(new Category({ tenantId: new Types.ObjectId(), name: 'Burgers', featuredProductIds: ids.slice(0, 3) }).validateSync()).toBeUndefined();
  });
  it('une ancienne présentation reste absente et une nouvelle version inconnue est refusée', () => {
    const base = { tenantId: new Types.ObjectId(), name: 'Salle', scenography: 'halo' };
    expect(new Screen(base).presentation).toBeUndefined();
    expect(new Screen({ ...base, presentation: { version: 9 } }).validateSync()).toBeDefined();
    expect(new Screen({ ...base, presentation: { typography: 'editorial' } }).validateSync()).toBeDefined();
    expect(new Screen({ ...base, presentation: { version: 1, corners: 'round', priceScale: 'large', motion: 'off' } }).validateSync()).toBeUndefined();
  });
});
