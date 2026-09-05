import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from './marque';
import {
  SCENOGRAPHIES, SCENOGRAPHY_FAMILIES, SCREEN_PRESENTATION_DEFAULT,
  ScreenCreateSchema, ScreenUpdateSchema, ScreenPreviewSchema,
  ScreenPresentationSchema, screenPresentationOf,
} from './screens';
import { CategoryFeaturedUpdateSchema } from './menu-featured';

describe('Studio des écrans — contrats et compatibilité', () => {
  it('les quinze modèles sont tous classés une fois et enregistrables', () => {
    const familyIds = SCENOGRAPHY_FAMILIES.flatMap((family) => [...family.scenographies]);
    expect(familyIds).toHaveLength(15);
    expect(new Set(familyIds).size).toBe(15);
    expect([...familyIds].sort()).toEqual([...SCENOGRAPHIES].sort());
    for (const scenography of SCENOGRAPHIES) expect(ScreenUpdateSchema.parse({ scenography })).toEqual({ scenography });
  });
  it('les anciens écrans héritent de la marque, sans réécriture lors d’un PATCH', () => {
    expect(ScreenUpdateSchema.parse({ name: 'Salle' })).not.toHaveProperty('presentation');
    expect(screenPresentationOf(undefined)).toEqual(SCREEN_PRESENTATION_DEFAULT);
    expect(screenPresentationOf({ version: 99 })).toEqual(SCREEN_PRESENTATION_DEFAULT);
    expect(ScreenPresentationSchema.parse({})).toEqual({ version: 1, corners: 'brand', priceScale: 'balanced', motion: 'brand' });
  });
  it('la présentation refuse couleurs, polices, logos, nombres libres et versions inconnues', () => {
    for (const presentation of [
      { typography: 'editorial' }, { palette: DIRECTIONS.neon.palette }, { logo: 'x' },
      { version: 2 }, { corners: 30 }, { priceScale: 3 }, { motion: 'fastest' },
    ]) expect(ScreenPresentationSchema.safeParse(presentation).success).toBe(false);
  });
  it('le masque brouillon existe uniquement en aperçu', () => {
    expect(ScreenPreviewSchema.parse({ brandDraft: DIRECTIONS.neon }).brandDraft).toEqual(DIRECTIONS.neon);
    expect(ScreenUpdateSchema.parse({ brandDraft: DIRECTIONS.neon })).toEqual({});
    expect(ScreenCreateSchema.parse({ name: 'Salle', brandDraft: DIRECTIONS.neon })).not.toHaveProperty('brandDraft');
    expect(ScreenPreviewSchema.safeParse({ brandDraft: { ...DIRECTIONS.neon, surprise: true } }).success).toBe(false);
  });
});

describe('Sélection éditoriale de la catégorie', () => {
  const ids = Array.from({ length: 4 }, (_, i) => `65f00000000000000000000${i}`);
  it('accepte le retrait total et une sélection ordonnée de trois produits', () => {
    expect(CategoryFeaturedUpdateSchema.parse({ productIds: [], expectedRevision: 0 }).productIds).toEqual([]);
    expect(CategoryFeaturedUpdateSchema.parse({ productIds: ids.slice(0, 3).reverse(), expectedRevision: 7 }).productIds).toEqual(ids.slice(0, 3).reverse());
  });
  it('refuse le quatrième, les doublons, les ids invalides et une révision absente', () => {
    for (const productIds of [ids, [ids[0], ids[0]], ['invalide']]) {
      expect(CategoryFeaturedUpdateSchema.safeParse({ productIds, expectedRevision: 0 }).success).toBe(false);
    }
    expect(CategoryFeaturedUpdateSchema.safeParse({ productIds: [] }).success).toBe(false);
  });
});
