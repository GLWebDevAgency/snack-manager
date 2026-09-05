import { describe, expect, it } from 'vitest';
import { OptionGroupSchema, ProductUpdateSchema } from './index';
import { normalizeLegacyOptionGroup } from './menu-legacy-options';

const cheese = () => ({
  key: 'fromage', name: 'Fromage', type: 'single' as const, min: 1,
  choices: ['Cheddar', 'Raclette', 'Chèvre', 'Boursin', 'Emmental'].map((name, i) => ({
    key: `cheese-${i}`, name, priceDelta: 0,
  })),
  max: null, perVariant: null,
});

describe('normalisation en lecture des groupes Mongo historiques', () => {
  it('ne crashe pas sur un groupe null et ne le répare pas silencieusement', () => {
    const normalized = normalizeLegacyOptionGroup(null);
    expect(normalized).toBeNull();
    expect(ProductUpdateSchema.safeParse({ optionGroups: [normalized] }).success).toBe(false);
  });

  it('omet les deux null historiques sans modifier la source', () => {
    const source = Object.freeze(cheese());
    const normalized = normalizeLegacyOptionGroup(source);
    expect(normalized).not.toHaveProperty('max');
    expect(normalized).not.toHaveProperty('perVariant');
    expect(source).toMatchObject({ max: null, perVariant: null });
    expect(normalized.choices).toBe(source.choices);
  });

  it('rend le groupe single à cinq fromages gratuits rééditable ; maximum effectif un', () => {
    const source = cheese();
    expect(ProductUpdateSchema.safeParse({ optionGroups: [source] }).success).toBe(false);
    const parsed = ProductUpdateSchema.parse({ optionGroups: [normalizeLegacyOptionGroup(source)] });
    expect(parsed.optionGroups?.[0]).toMatchObject({ min: 1, max: 1 });
    expect(parsed.optionGroups?.[0]?.choices.map((choice) => choice.priceDelta)).toEqual([0, 0, 0, 0, 0]);
    expect(parsed).not.toHaveProperty('variants');
    expect(parsed).not.toHaveProperty('price');
  });

  it('conserve exactement les règles non nulles, notamment les zéros par variante', () => {
    const perVariant = Object.freeze({ classique: { min: 0, max: 0 }, fromage: { min: 1, max: 1, priceDelta: 0 } });
    const source = { ...cheese(), max: 1, perVariant };
    const normalized = normalizeLegacyOptionGroup(source);
    expect(normalized).toEqual(source);
    expect(normalized.perVariant).toBe(perVariant);
    expect(OptionGroupSchema.parse(normalized).perVariant).toEqual(perVariant);
  });

  it.each([0, -1, 1.5, '1'])('ne masque pas un maximum invalide : %s', (max) => {
    const normalized = normalizeLegacyOptionGroup({ ...cheese(), max });
    expect(normalized.max).toBe(max);
    expect(OptionGroupSchema.safeParse(normalized).success).toBe(false);
  });

  it('ne transforme pas une règle corrompue en absence de règle', () => {
    const normalized = normalizeLegacyOptionGroup({ ...cheese(), perVariant: 'invalid' });
    expect(normalized.perVariant).toBe('invalid');
    expect(OptionGroupSchema.safeParse(normalized).success).toBe(false);
  });

  it('est idempotent et conserve les autres champs, même facultatifs', () => {
    const source = { ...cheese(), max: undefined, perVariant: undefined, provenance: 'legacy-read' };
    const normalized = normalizeLegacyOptionGroup(source);
    expect(normalizeLegacyOptionGroup(normalized)).toEqual(normalized);
    expect(normalized.provenance).toBe('legacy-read');
  });
});
