import { describe, expect, it } from 'vitest';
import { DIRECTIONS, marqueEffective, brandColorDe, logoUrlDe } from '@sm/contracts';
import { tenantPublicDe } from './site.service';

describe('la charge publique du site porte le masque', () => {
  it('un tenant repris rend son brand tel quel, et les plats en dérivent', () => {
    const t = { slug: 'x', name: 'X', brand: DIRECTIONS.soleil, brandColor: '#000000', logoUrl: null, address: '', phones: [], hours: [] };
    const v = tenantPublicDe(t);
    expect(v.brand).toEqual(DIRECTIONS.soleil);
    expect(v.brandColor).toBe(brandColorDe(DIRECTIONS.soleil));
    expect(v.logoUrl).toBe(logoUrlDe(DIRECTIONS.soleil));
  });

  it('un tenant non repris rend le repli Nuit avec son accent', () => {
    const t = { slug: 'x', name: 'X', brand: null, brandColor: '#2E9E4F', logoUrl: 'https://r2/l.png', address: '', phones: [], hours: [] };
    const v = tenantPublicDe(t);
    expect(v.brand.preset).toBe('nuit');
    expect(v.brand.palette.accent).toBe('#2e9e4f');
    expect(v.brandColor).toBe('#2e9e4f');
    expect(v.logoUrl).toBe('https://r2/l.png');
    expect(v.brand).toEqual(marqueEffective(t));
  });
});
