import { DIRECTIONS } from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { identiteDuTableau } from './menu-board.repository';

/**
 * L'IDENTITÉ DU TABLEAU DE MENU — l'écran TV du comptoir.
 *
 * L'écran porte le MASQUE observé, et ses deux champs plats en dérivent :
 * `brandColor` est l'accent du masque, `logoUrl` sa marque. Sans ce test, la
 * dérivation ne vivait que dans une méthode de dépôt qui parle à Mongo — donc
 * nulle part.
 */
const tenant = (patch: Record<string, unknown>) =>
  ({ _id: 'tv1', slug: 'classfood', name: 'Classfood', ...patch }) as unknown as Partial<Tenant> & {
    _id: unknown;
  };

describe('l’identité du tableau de menu', () => {
  it('un tenant repris peint l’écran avec l’accent de son masque', () => {
    const id = identiteDuTableau(tenant({ brand: DIRECTIONS.soleil, brandColor: '#c9a15a' }));
    // L'accent DU MASQUE, pas la colonne du tenant (`#c9a15a` ci-dessus).
    expect(id.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
    expect(id.logoUrl).toBeNull();
    expect(id.tenantId).toBe('tv1');
  });

  it('porte le masque observé, dont les champs plats dérivent', () => {
    const id = identiteDuTableau(tenant({ brand: DIRECTIONS.soleil, brandColor: '#c9a15a' }));
    expect(id.brand).toEqual(DIRECTIONS.soleil);
    expect(id.brandColor).toBe(id.brand.palette.accent);
  });

  it('un tenant pas encore repris garde son accent BRUT', () => {
    const id = identiteDuTableau(tenant({ brand: null, brandColor: '#7a2e2a' }));
    expect(id.brandColor).toBe('#7a2e2a');
  });

  it('les horaires traversent en forme neutre, jour par jour', () => {
    const id = identiteDuTableau(
      tenant({
        brand: null,
        brandColor: '#7a2e2a',
        hours: [{ day: 2, lunch: { open: '11:30', close: '14:00' }, dinner: null }],
      }),
    );
    expect(id.hours).toEqual([
      { day: 2, lunch: { open: '11:30', close: '14:00' }, dinner: null },
    ]);
  });
});
