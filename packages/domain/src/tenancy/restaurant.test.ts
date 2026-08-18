import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import { unwrap } from '../shared/result';
import { classFoodHours, classFoodRestaurant, classFoodTheme } from './classfood.fixture';
import { Closure } from './closure';
import { EMPTY_OCCUPANCY } from './pickup-slot';
import { PublicDomain, TenantSlug } from './public-domain';
import { Restaurant } from './restaurant';
import { CalendarDay } from './wall-clock';

const WEDNESDAY = unwrap(CalendarDay.parse('2026-08-19'));

describe('Restaurant', () => {
  const classFood = classFoodRestaurant();

  it('n’est pas ouvert malgré ses horaires quand une fermeture exceptionnelle tombe dessus', () => {
    const evening = new Date('2026-08-19T19:30:00+02:00');
    expect(classFood.isOpenAt(evening)).toBe(true);

    const closed = classFood.closeExceptionally(unwrap(Closure.onDay(WEDNESDAY, 'Congés')));
    expect(closed.isOpenAt(evening)).toBe(false);
  });

  it('annonce la réouverture après les congés, pas le service annulé', () => {
    const from = unwrap(CalendarDay.parse('2026-08-19'));
    const to = unwrap(CalendarDay.parse('2026-08-21'));
    const closed = classFood.closeExceptionally(unwrap(Closure.wholeDays(from, to, 'Congés')));

    // Fermé du mercredi au vendredi : la prochaine ouverture est le samedi midi.
    const next = closed.nextOpening(new Date('2026-08-19T09:00:00+02:00'));
    expect(next?.toISOString()).toBe(new Date('2026-08-22T11:30:00+02:00').toISOString());
  });

  it('ne propose aucun créneau un jour de fermeture exceptionnelle', () => {
    const closed = classFood.closeExceptionally(unwrap(Closure.onDay(WEDNESDAY, 'Congés')));
    const clock = new FixedClock(new Date('2026-08-19T09:00:00+02:00'));

    expect(classFood.pickupSlotsOn(WEDNESDAY, EMPTY_OCCUPANCY, clock).length).toBeGreaterThan(0);
    expect(closed.pickupSlotsOn(WEDNESDAY, EMPTY_OCCUPANCY, clock)).toEqual([]);
    expect(closed.closureOn(WEDNESDAY)?.reason).toBe('Congés');
  });

  it('sert une adresse par défaut dérivée du slug, sans démarche du restaurateur', () => {
    expect(classFood.defaultDomain('snackmanager.fr')).toBe('classfood.snackmanager.fr');
    expect(classFood.primaryDomain('snackmanager.fr')).toBe('classfood.snackmanager.fr');
  });

  it('préfère le domaine du restaurateur dès qu’il en rattache un', () => {
    const custom = unwrap(PublicDomain.create('commander.classfood.fr'));
    const branded = unwrap(classFood.attachDomain(custom));
    expect(branded.primaryDomain('snackmanager.fr')).toBe('commander.classfood.fr');
  });

  it('refuse de rattacher deux fois le même domaine', () => {
    const custom = unwrap(PublicDomain.create('commander.classfood.fr'));
    const branded = unwrap(classFood.attachDomain(custom));
    const again = branded.attachDomain(unwrap(PublicDomain.create('COMMANDER.classfood.fr')));

    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('domain.duplicate');
  });

  it('reste immuable : chaque changement produit un nouveau restaurant', () => {
    const closed = classFood.closeExceptionally(unwrap(Closure.onDay(WEDNESDAY)));
    expect(classFood.closures).toHaveLength(0);
    expect(closed.closures).toHaveLength(1);
  });

  it('refuse un restaurant sans nom', () => {
    const nameless = Restaurant.create({
      slug: unwrap(TenantSlug.create('classfood')),
      name: '  ',
      hours: classFoodHours(),
      theme: classFoodTheme(),
    });
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.error.code).toBe('restaurant.invalid');
  });
});
