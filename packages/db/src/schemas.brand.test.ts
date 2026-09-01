import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, marqueEffective } from '@sm/contracts';
import { MODELS } from './schemas';

/**
 * Un document HYDRATÉ, pas un littéral : c'est ce que l'API lit vraiment.
 * Le sous-document `brand` porte des clés de prototype que le schéma strict
 * du contrat refusait — et tous les tenants repris retombaient sur Nuit.
 */
const Tenant =
  mongoose.models[MODELS.Tenant.name] ??
  mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

describe('le masque lu depuis un document Mongoose', () => {
  it('un tenant repris rend SON masque, pas le repli', () => {
    const doc = Tenant.hydrate({ slug: 'x', name: 'X', brandColor: '#2E9E4F', logoUrl: null, brand: DIRECTIONS.soleil });
    const b = marqueEffective(doc);
    expect(b.preset).toBe('soleil');
    expect(b.palette.accent).toBe('#E07A1F');
  });

  it('un tenant sans masque rend le repli avec son accent', () => {
    const doc = Tenant.hydrate({ slug: 'y', name: 'Y', brandColor: '#2E9E4F', logoUrl: null, brand: null });
    const b = marqueEffective(doc);
    expect(b.preset).toBe('nuit');
    expect(b.palette.accent).toBe('#2e9e4f');
  });
});
