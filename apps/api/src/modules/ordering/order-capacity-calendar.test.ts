import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildOrderCapacityCalendar, InvalidCapacityCalendarDay, InvalidCapacityCalendarHours,
  InvalidCapacityCalendarSettings, InvalidCapacityCalendarClosures, type OrderCapacityCalendarInput,
} from './order-capacity-calendar';
import { SlotsService, type TenantWithId } from './slots.service';

const MONDAY = '2026-09-07';
function input(overrides: Partial<OrderCapacityCalendarInput> = {}): OrderCapacityCalendarInput {
  return {
    hours: [{ day: 1, lunch: { open: '11:00', close: '12:00' }, dinner: { open: '18:00', close: '19:00' } }],
    closures: [], settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 },
    ...overrides,
  };
}
const instants = (result: ReturnType<typeof buildOrderCapacityCalendar>) => result.slots.map((slot) => slot.at.toISOString());

afterEach(() => vi.useRealTimers());

describe('grille brute et pure du calendrier de capacité', () => {
  it('fige les deux services, leurs bornes inclusives et les capacités distinctes', () => {
    const result = buildOrderCapacityCalendar(input(), MONDAY);
    expect(result).toMatchObject({ day: MONDAY, timezone: 'Europe/Paris', intervalMin: 30, closed: false, emptyReason: null, closureReason: null });
    expect(instants(result)).toEqual([
      '2026-09-07T09:00:00.000Z', '2026-09-07T09:30:00.000Z', '2026-09-07T10:00:00.000Z',
      '2026-09-07T16:00:00.000Z', '2026-09-07T16:30:00.000Z', '2026-09-07T17:00:00.000Z',
    ]);
    expect(result.slots.map((slot) => slot.service)).toEqual(['lunch', 'lunch', 'lunch', 'dinner', 'dinner', 'dinner']);
    expect(result.slots.every((slot) => slot.kitchenCapacity === 4 && slot.deliveryCapacity === 2)).toBe(true);
  });

  it('ne consulte ni maintenant, ni leadTime, ni pause, ni compte Connect', () => {
    const base = input();
    const config = { ...base, settings: { ...base.settings, onlineOrderingPaused: true },
      delivery: { slotCapacity: 3, enabled: false, leadTimeMin: 180 },
      encaissement: { chargesEnabled: false }, account: { status: 'suspended' } };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2020-01-01T00:00:00.000Z');
    const before = buildOrderCapacityCalendar(config, MONDAY);
    vi.setSystemTime('2040-01-01T00:00:00.000Z');
    expect(buildOrderCapacityCalendar(config, MONDAY)).toEqual(before);
    expect(before.slots).toHaveLength(6);
    expect(before.slots.every((slot) => slot.deliveryCapacity === 3)).toBe(true);
  });

  it('applique les valeurs historiques par défaut seulement aux réglages absents', () => {
    const result = buildOrderCapacityCalendar(input({ settings: undefined, delivery: undefined }), MONDAY);
    expect(result.intervalMin).toBe(10);
    expect(result.slots).toHaveLength(14);
    expect(result.slots[0]).toMatchObject({ kitchenCapacity: 4, deliveryCapacity: 2 });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-01', '2026-9-07', '2026-09-07T00:00:00Z', '', ' 2026-09-07'])('refuse la journée invalide %s', (day) => {
    expect(() => buildOrderCapacityCalendar(input(), day)).toThrow(InvalidCapacityCalendarDay);
  });

  it('la validation de journée stricte ne convertit pas un tableau ou objet en date', () => {
    expect(() => buildOrderCapacityCalendar(input(), [MONDAY] as unknown as string)).toThrow(InvalidCapacityCalendarDay);
  });

  it('accepte le 29 février d’une année bissextile', () => {
    const result = buildOrderCapacityCalendar(input({ hours: [{ day: 2, lunch: { open: '12:00', close: '13:00' }, dinner: null }] }), '2028-02-29');
    expect(result.day).toBe('2028-02-29');
    expect(result.slots).toHaveLength(3);
  });

  it.each([{ hours: [] }, { hours: [{ day: 1, lunch: null, dinner: null }] }])('rend une fermeture explicite sans service : $hours', ({ hours }) => {
    expect(buildOrderCapacityCalendar(input({ hours }), MONDAY)).toMatchObject({ slots: [], closed: true, emptyReason: 'no_service', closureReason: null });
  });

  it('un autre jour de semaine ne crée aucun horaire imaginaire', () => {
    expect(buildOrderCapacityCalendar(input(), '2026-09-08')).toMatchObject({ slots: [], closed: true, emptyReason: 'no_service' });
  });

  it('déduplique les services chevauchants en conservant la priorité lunch du service actuel', () => {
    const result = buildOrderCapacityCalendar(input({ hours: [{ day: 1,
      lunch: { open: '11:00', close: '12:00' }, dinner: { open: '11:30', close: '12:30' } }] }), MONDAY);
    expect(result.slots).toHaveLength(4);
    expect(result.slots.map((slot) => slot.service)).toEqual(['lunch', 'lunch', 'lunch', 'dinner']);
    expect(new Set(instants(result)).size).toBe(4);
  });

  it('refuse les jours dupliqués plutôt que masquer la deuxième configuration', () => {
    expect(() => buildOrderCapacityCalendar(input({ hours: [...input().hours!, ...input().hours!] }), MONDAY)).toThrow(InvalidCapacityCalendarHours);
  });

  it.each([
    { hours: 'not-an-array' }, { hours: [null] },
    { hours: [{ day: 1, lunch: { open: 1100, close: '12:00' }, dinner: null }] },
  ])('une ancienne donnée horaires malformée rend une erreur typée : %j', (malformed) => {
    expect(() => buildOrderCapacityCalendar(input(malformed as unknown as Partial<OrderCapacityCalendarInput>), MONDAY)).toThrow(InvalidCapacityCalendarHours);
  });

  it.each([
    ['18:00', '02:00'], ['18:00', '26:00'], ['24:00', '25:00'], ['18:61', '20:00'],
    ['18h00', '20:00'], ['', '20:00'], ['18:00', '18:00'],
  ])('bloque les horaires non supportés %s→%s, sans prétendre que le restaurant est fermé', (open, close) => {
    expect(() => buildOrderCapacityCalendar(input({ hours: [{ day: 1, lunch: null, dinner: { open, close } }] }), MONDAY)).toThrow(InvalidCapacityCalendarHours);
  });

  it('00:00→24:00 ne produit que des instants du jour Paris, sans le minuit suivant', () => {
    const result = buildOrderCapacityCalendar(input({ hours: [{ day: 1, lunch: { open: '00:00', close: '24:00' }, dinner: null }] }), MONDAY);
    expect(result.slots).toHaveLength(48);
    expect(instants(result)[0]).toBe('2026-09-06T22:00:00.000Z');
    expect(instants(result).at(-1)).toBe('2026-09-07T21:30:00.000Z');
    expect(instants(result)).not.toContain('2026-09-07T22:00:00.000Z');
  });

  it('une fermeture date seule couvre toute la journée et conserve son motif', () => {
    const result = buildOrderCapacityCalendar(input({ closures: [{ from: new Date(MONDAY), to: new Date(MONDAY), reason: 'Congés' }] }), MONDAY);
    expect(result).toMatchObject({ slots: [], closed: true, emptyReason: 'exceptional_closure', closureReason: 'Congés' });
  });

  it('une période de fermeture date seule inclut son dernier jour', () => {
    const result = buildOrderCapacityCalendar(input({ closures: [{ from: new Date('2026-09-05'), to: new Date(MONDAY), reason: 'Fermeture' }] }), MONDAY);
    expect(result.slots).toHaveLength(0);
    expect(result.closureReason).toBe('Fermeture');
  });

  it('reconnaît aussi le minuit Paris comme borne date seule', () => {
    const result = buildOrderCapacityCalendar(input({ closures: [{ from: new Date('2026-09-06T22:00:00.000Z'), to: new Date('2026-09-06T22:00:00.000Z'), reason: '' }] }), MONDAY);
    expect(result).toMatchObject({ slots: [], emptyReason: 'exceptional_closure', closureReason: 'Fermeture exceptionnelle' });
  });

  it('une fermeture horaire exclut exactement les deux bornes, pas le service suivant', () => {
    const result = buildOrderCapacityCalendar(input({ closures: [{ from: new Date('2026-09-07T09:30:00.000Z'), to: new Date('2026-09-07T10:00:00.000Z'), reason: 'Maintenance' }] }), MONDAY);
    expect(instants(result)).toEqual(['2026-09-07T09:00:00.000Z', '2026-09-07T16:00:00.000Z', '2026-09-07T16:30:00.000Z', '2026-09-07T17:00:00.000Z']);
    expect(result).toMatchObject({ closed: false, emptyReason: null, closureReason: null });
  });

  it('si des fermetures partielles vident la grille, rend le premier motif bloquant', () => {
    const result = buildOrderCapacityCalendar(input({ closures: [
      { from: new Date('2026-09-07T09:00:00.000Z'), to: new Date('2026-09-07T10:00:00.000Z'), reason: 'Midi fermé' },
      { from: new Date('2026-09-07T16:00:00.000Z'), to: new Date('2026-09-07T17:00:00.000Z'), reason: 'Soir fermé' },
    ] }), MONDAY);
    expect(result).toMatchObject({ slots: [], closed: true, emptyReason: 'exceptional_closure', closureReason: 'Midi fermé' });
  });

  it.each([
    { from: new Date('invalid'), to: new Date(MONDAY) },
    { from: new Date(MONDAY), to: new Date('invalid') },
    { from: new Date('2026-09-08'), to: new Date(MONDAY) },
    { from: null, to: new Date(MONDAY) },
  ])('une fermeture malformée ne devient jamais une ouverture silencieuse : %j', (closure) => {
    expect(() => buildOrderCapacityCalendar(input({ closures: [closure] }), MONDAY)).toThrow(InvalidCapacityCalendarClosures);
  });

  it('une fermeture sans fin garde la convention existante de la borne de départ', () => {
    expect(buildOrderCapacityCalendar(input({ closures: [{ from: new Date(MONDAY), reason: 'Fermé' }] }), MONDAY))
      .toMatchObject({ slots: [], closed: true, emptyReason: 'exceptional_closure', closureReason: 'Fermé' });
  });

  it.each([{ closures: 'not-an-array' }, { closures: [null] }])('une ancienne collection de fermetures malformée reste bloquée : %j', (malformed) => {
    expect(() => buildOrderCapacityCalendar(input(malformed as unknown as Partial<OrderCapacityCalendarInput>), MONDAY)).toThrow(InvalidCapacityCalendarClosures);
  });

  it.each([0, -1, 1.5, 101, Infinity, NaN])('refuse une capacité cuisine explicite invalide %s', (slotCapacity) => {
    expect(() => buildOrderCapacityCalendar(input({ settings: { slotIntervalMin: 30, slotCapacity } }), MONDAY)).toThrow(InvalidCapacityCalendarSettings);
  });
  it.each([0, -1, 1.5, 51, Infinity, NaN])('refuse une capacité livraison explicite invalide %s', (slotCapacity) => {
    expect(() => buildOrderCapacityCalendar(input({ delivery: { slotCapacity } }), MONDAY)).toThrow(InvalidCapacityCalendarSettings);
  });
  it.each([0, -1, 4, 61, 10.5, Infinity, NaN])('refuse un pas explicite hors contrat %s', (slotIntervalMin) => {
    expect(() => buildOrderCapacityCalendar(input({ settings: { slotIntervalMin, slotCapacity: 4 } }), MONDAY)).toThrow(InvalidCapacityCalendarSettings);
  });

  it('accepte les bornes de capacité et produit une grille finie', () => {
    const result = buildOrderCapacityCalendar(input({ settings: { slotIntervalMin: 5, slotCapacity: 100 }, delivery: { slotCapacity: 50 },
      hours: [{ day: 1, lunch: { open: '00:00', close: '24:00' }, dinner: null }] }), MONDAY);
    expect(result.slots).toHaveLength(288);
    expect(result.slots[0]).toMatchObject({ kitchenCapacity: 100, deliveryCapacity: 50 });
  });

  it.each([
    ['2026-03-29', ['2026-03-29T00:00:00.000Z', '2026-03-29T00:30:00.000Z', '2026-03-29T01:00:00.000Z', '2026-03-29T01:30:00.000Z', '2026-03-29T02:00:00.000Z']],
    ['2026-10-25', ['2026-10-24T23:00:00.000Z', '2026-10-24T23:30:00.000Z', '2026-10-25T01:00:00.000Z', '2026-10-25T01:30:00.000Z', '2026-10-25T02:00:00.000Z', '2026-10-25T02:30:00.000Z', '2026-10-25T03:00:00.000Z']],
  ] as const)('préserve la conversion DST actuelle et ne duplique aucun instant pour %s', (day, expected) => {
    const result = buildOrderCapacityCalendar(input({ hours: [{ day: 7, lunch: { open: '01:00', close: '04:00' }, dinner: null }] }), day);
    expect(instants(result)).toEqual(expected);
    expect(new Set(instants(result)).size).toBe(result.slots.length);
  });

  it('ne modifie ni les tableaux sources, ni les dates de fermeture', () => {
    const config = input({ closures: [{ from: new Date('2026-09-07T09:30:00.000Z'), to: new Date('2026-09-07T10:00:00.000Z'), reason: 'Test' }] });
    const before = structuredClone(config);
    const result = buildOrderCapacityCalendar(config, MONDAY);
    result.slots[0]!.at.setTime(0);
    expect(config).toEqual(before);
    expect(instants(buildOrderCapacityCalendar(config, MONDAY))[0]).toBe('2026-09-07T09:00:00.000Z');
  });

  it.each([MONDAY, '2026-03-29', '2026-10-25'])('reste identique à SlotsService hors filtres dynamiques sur %s', async (day) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime('2026-01-01T00:00:00.000Z');
    const config = input({ hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
      lunch: { open: '01:00', close: '04:00' }, dinner: { open: '18:00', close: '19:00' } })) });
    const service = new SlotsService({ aggregate: vi.fn().mockResolvedValue([]) } as never);
    const current = await service.compute({ ...config, _id: '507f1f77bcf86cd799439011' } as unknown as TenantWithId, day);
    const raw = buildOrderCapacityCalendar(config, day);
    expect(raw.slots.map((slot) => ({ iso: slot.at.toISOString(), service: slot.service })))
      .toEqual(current.slots.map(({ iso, service }) => ({ iso, service })));
    expect(raw.slots.every((slot) => slot.kitchenCapacity === current.capacity)).toBe(true);
  });
});
