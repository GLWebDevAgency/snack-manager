import { describe, expect, it } from 'vitest';
import { BrandSchema, BrandStrictSchema, DIRECTIONS, marqueEffective, masquePourFond } from './marque';
import { ProductCreateSchema, ProductUpdateSchema } from './index';

describe('présentation de la commande — un seul contrat de marque et de produit', () => {
  it('lit toujours une ancienne marque et garde les accroches sans second modèle', () => {
    expect(BrandSchema.parse(DIRECTIONS.nuit)).toEqual(DIRECTIONS.nuit);
    const brand = BrandStrictSchema.parse({ ...DIRECTIONS.nuit, tagline: '  Du goût, fait maison.  ', taglineSub: 'Prêt à emporter.' });
    expect(brand.tagline).toBe('Du goût, fait maison.');
    expect(marqueEffective({ brand }).taglineSub).toBe('Prêt à emporter.');
    expect(masquePourFond(brand, 'light')).toMatchObject({ tagline: brand.tagline, taglineSub: brand.taglineSub, hero: brand.hero });
  });

  it.each([['tagline', 48], ['taglineSub', 90]] as const)('borne %s côté écriture et autorise son retrait', (field, limit) => {
    expect(BrandStrictSchema.safeParse({ ...DIRECTIONS.nuit, [field]: 'a'.repeat(limit) }).success).toBe(true);
    expect(BrandStrictSchema.safeParse({ ...DIRECTIONS.nuit, [field]: 'a'.repeat(limit + 1) }).success).toBe(false);
    expect(BrandStrictSchema.parse({ ...DIRECTIONS.nuit, [field]: null })[field]).toBeNull();
  });

  it('un PATCH de nom ne remet ni popularité ni photo à zéro', () => {
    expect(ProductUpdateSchema.parse({ name: 'Le nouveau nom' })).toEqual({ name: 'Le nouveau nom' });
    expect(ProductUpdateSchema.parse({ popular: true, photoCover: true })).toEqual({});
  });

  it('accepte les trois intentions éditoriales et les deux présentations', () => {
    for (const popularOverride of [null, true, false]) {
      for (const photoKind of ['cutout', 'cover']) {
        expect(ProductUpdateSchema.parse({ popularOverride, photoKind })).toEqual({ popularOverride, photoKind });
        expect(ProductCreateSchema.parse({ categoryId: 'category', name: 'Plat', popularOverride, photoKind })).toMatchObject({ popularOverride, photoKind });
      }
    }
    expect(ProductUpdateSchema.safeParse({ photoKind: 'crop' }).success).toBe(false);
    expect(ProductUpdateSchema.safeParse({ popularOverride: 'true' }).success).toBe(false);
  });
});
