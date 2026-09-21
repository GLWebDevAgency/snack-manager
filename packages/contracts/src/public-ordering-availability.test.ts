import { describe, expect, it } from 'vitest';
import { PublicOrderingAvailabilitySchema } from './public-ordering-availability';

function observation() {
  return {
    observedAt: '2026-09-21T16:00:00.000Z', openNow: true,
    ordering: { paused: false, message: null },
    todayHours: { day: 1, lunch: null, dinner: { open: '18:00', close: '22:00' } },
    timezone: 'Europe/Paris',
    slots: { date: '2026-09-21', timezone: 'Europe/Paris', intervalMin: 10, capacity: 4, leadTimeMin: 20,
      slots: [{ iso: '2026-09-21T16:20:00.000Z', label: '18:20', service: 'dinner', remaining: 4, full: false, load: 'calm' }],
      closedToday: false, nextOpenDate: null, closureReason: null, paused: false },
  };
}

describe('public ordering availability', () => {
  it('accepts the public snapshot without any catalogue, identity or payment fields', () => {
    expect(PublicOrderingAvailabilitySchema.parse(observation())).toEqual(observation());
  });

  it.each([
    { observedAt: 'yesterday' }, { observedAt: undefined }, { openNow: 'true' },
    { todayHours: { day: 8, lunch: null, dinner: null } },
    { todayHours: { day: 1, lunch: { open: '29:00', close: '14:00' }, dinner: null } },
    { ordering: { paused: false, message: null, accountStatus: 'active' } },
    { ordering: { paused: true, message: 'x'.repeat(201) } },
    { brand: {} }, { categories: [] }, { payment: { secret: 'not-a-real-secret' } },
  ])('refuses a malformed or widened projection %j', (patch) => {
    expect(PublicOrderingAvailabilitySchema.safeParse({ ...observation(), ...patch }).success).toBe(false);
  });

  it('rejects malformed slot instants and additional slot fields without normalizing the proof', () => {
    const valid = observation();
    for (const patch of [{ iso: '18:20' }, { label: '24:00' }, { tenantId: 'private' }]) {
      expect(PublicOrderingAvailabilitySchema.safeParse({ ...valid, slots: {
        ...valid.slots, slots: [{ ...valid.slots.slots[0], ...patch }],
      } }).success).toBe(false);
    }
  });

  it('keeps physical opening distinct from future capacity or a commercial pause', () => {
    const valid = observation();
    expect(PublicOrderingAvailabilitySchema.safeParse({ ...valid, openNow: false }).success).toBe(true);
    expect(PublicOrderingAvailabilitySchema.safeParse({ ...valid, ordering: { paused: true, message: null } }).success).toBe(true);
  });
});
