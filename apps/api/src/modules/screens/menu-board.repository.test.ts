import { DIRECTIONS } from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { identiteDuTableau } from './menu-board.repository';

/**
 * L'IDENTITÉ DU TABLEAU DE MENU — l'écran TV du comptoir.
 *
 * Les écrans gardent leur `theme: brand | dark | light` (spec §2) : ils ne
 * portent pas encore le masque, mais leur mode « brand » lit `brandColor`, et
 * ce champ est désormais un DÉRIVÉ. Sans ce test, la dérivation ne vivait que
 * dans une méthode de dépôt qui parle à Mongo — donc nulle part.
 */
const tenant = (patch: Record<string, unknown>) =>
  ({ _id: 'tv1', slug: 'classfood', name: 'Classfood', ...patch }) as unknown as Partial<Tenant> & {
    _id: unknown;
  };

describe('l’identité du tableau de menu', () => {
  it('un tenant repris peint l’écran avec l’accent de son masque', () => {
    const id = identiteDuTableau(tenant({ brand: DIRECTIONS.soleil, brandColor: '#c9a15a' }));
    expect(id.brandColor).toBe('#E07A1F');
    expect(id.logoUrl).toBeNull();
    expect(id.tenantId).toBe('tv1');
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
