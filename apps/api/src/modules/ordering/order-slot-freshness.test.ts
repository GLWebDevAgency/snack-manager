import { describe, expect, it } from 'vitest';
import { NEXT_OPEN_LOOKAHEAD_DAYS, SLOT_LEAD_TIME_MIN } from '@sm/contracts';
import { assertOrderSlotFresh } from './order-slot-freshness';
import { addDays, parisWallToUtc, parisYmd } from './paris-time';

describe('fraîcheur temporelle commune des créneaux', () => {
  const now = new Date('2030-05-02T07:00:00.000Z');
  it('accepte exactement le délai minimum, refuse une milliseconde trop tôt', () => {
    const minimum = new Date(now.getTime() + SLOT_LEAD_TIME_MIN * 60_000);
    expect(assertOrderSlotFresh(minimum.toISOString(), now)).toEqual(minimum);
    expect(() => assertOrderSlotFresh(new Date(minimum.getTime() - 1).toISOString(), now)).toThrow();
  });
  it.each(['not-a-date', '', '2030-99-99T18:00:00.000Z'])('refuse %s', (slot) => {
    expect(() => assertOrderSlotFresh(slot, now)).toThrow();
  });
  it('refuse un créneau passé même lorsque son jour comporte une place libre', () => {
    expect(() => assertOrderSlotFresh('2030-05-01T18:00:00.000Z', now)).toThrow();
  });
  it.each(['2026-03-28T23:30:00.000Z', '2026-10-24T22:30:00.000Z'])('horizon par jours Paris autour du changement d’heure %s', (value) => {
    const at = new Date(value); const lastDay = addDays(parisYmd(at), NEXT_OPEN_LOOKAHEAD_DAYS);
    const lastSlot = parisWallToUtc(lastDay, 23, 59);
    expect(assertOrderSlotFresh(lastSlot.toISOString(), at)).toEqual(lastSlot);
    expect(() => assertOrderSlotFresh(parisWallToUtc(addDays(lastDay, 1), 0).toISOString(), at)).toThrow();
  });
});
