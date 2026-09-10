import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, marqueEffective } from '@sm/contracts';
import { BrandSub, ProductSchema } from './schemas';

const BrandDoc = mongoose.model('BrandPresentationTest', new mongoose.Schema({ brand: BrandSub }));
const ProductDoc = mongoose.model('ProductPresentationTest', ProductSchema);
const tenantId = new mongoose.Types.ObjectId();

describe('persistance de la présentation sans reprise destructive', () => {
  it('conserve accroches, mode et image, puis accepte leur retrait', () => {
    const brand = { ...DIRECTIONS.soleil, tagline: 'Fait maison.', taglineSub: 'À emporter.', hero: 'https://example.test/hero.webp' };
    const doc = new BrandDoc({ brand });
    expect(doc.validateSync()).toBeUndefined();
    expect(marqueEffective(doc)).toMatchObject(brand);
    doc.set('brand.tagline', null);
    expect(marqueEffective(doc).tagline).toBeNull();
    expect(doc.validateSync()).toBeUndefined();
  });

  it('n’ajoute pas d’accroches artificielles aux anciennes marques hydratées', () => {
    expect(marqueEffective(BrandDoc.hydrate({ brand: DIRECTIONS.nuit }))).toEqual(marqueEffective({ brand: DIRECTIONS.nuit }));
  });

  it('borne les accroches même hors route API', () => {
    const doc = new BrandDoc({ brand: { ...DIRECTIONS.nuit, tagline: 'a'.repeat(49), taglineSub: 'a'.repeat(91) } });
    expect(Object.keys(doc.validateSync()!.errors).sort()).toEqual(['brand.tagline', 'brand.taglineSub']);
  });

  it('les anciens produits gardent le rendu détouré et le choix automatique ; false et null restent distincts', () => {
    const doc = new ProductDoc({ tenantId, name: 'Plat', price: 875 });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.photoKind).toBe('cutout');
    expect(doc.popularOverride).toBeNull();
    doc.set({ photoKind: 'cover', popularOverride: false });
    expect(doc.toObject()).toMatchObject({ photoKind: 'cover', popularOverride: false, price: 875 });
    doc.set('popularOverride', null);
    expect(doc.popularOverride).toBeNull();
    doc.set('photoKind', 'autre');
    expect(doc.validateSync()?.errors.photoKind).toBeDefined();
  });
});
