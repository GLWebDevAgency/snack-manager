import { describe, expect, it } from 'vitest';
import { FixedClock } from '../shared/clock';
import { unwrap } from '../shared/result';
import { classFoodHours } from './classfood.fixture';
import { Closure } from './closure';
import {
  EMPTY_OCCUPANCY,
  generateSlots,
  occupancyOf,
  SlotPolicy,
  type SlotOccupancy,
} from './pickup-slot';
import { CalendarDay } from './wall-clock';

// Mercredi 19/08/2026 : midi 11h30–14h30, soir 18h00–22h30.
const WEDNESDAY = unwrap(CalendarDay.parse('2026-08-19'));
const MONDAY = unwrap(CalendarDay.parse('2026-08-17'));

const hours = classFoodHours();
const at = (iso: string): FixedClock => new FixedClock(new Date(iso));
const labels = (slots: readonly { label(): string }[]): string[] => slots.map((s) => s.label());

describe('generateSlots', () => {
  it('propose un créneau toutes les 10 minutes sur chaque service', () => {
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-19T09:00:00+02:00'),
    );
    expect(labels(slots).slice(0, 3)).toEqual(['11:30', '11:40', '11:50']);
    // Bornes incluses : 14h30 et 22h30 sont des heures de retrait annoncées.
    expect(labels(slots)).toContain('14:30');
    expect(labels(slots).at(-1)).toBe('22:30');
  });

  it('ne propose jamais un créneau avant le délai de préparation de 20 minutes', () => {
    // Commande passée à 19h15 : la cuisine ne sort rien avant 19h35, donc le
    // premier créneau de la grille est 19h40.
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-19T19:15:00+02:00'),
    );
    expect(labels(slots)[0]).toBe('19:40');
  });

  it('ne propose aucun créneau du midi les jours où le restaurant ne sert que le soir', () => {
    const slots = generateSlots(
      MONDAY,
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-17T09:00:00+02:00'),
    );
    expect(labels(slots)[0]).toBe('18:00');
    expect(labels(slots)).not.toContain('12:00');
  });

  it('ne propose rien pour une journée déjà passée', () => {
    const slots = generateSlots(
      unwrap(CalendarDay.parse('2026-08-18')),
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-19T09:00:00+02:00'),
    );
    expect(slots).toEqual([]);
  });

  it('affiche un créneau complet plutôt que de le masquer', () => {
    // Quatre commandes déjà prises à 19h30 : le client doit voir que le créneau
    // existe et qu'il est plein, sinon il croit le restaurant fermé.
    const occupancy: SlotOccupancy = {
      takenAt: (slot) => (slot.getTime() === WEDNESDAY.atMinutes(19 * 60 + 30).getTime() ? 4 : 0),
    };
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      occupancy,
      at('2026-08-19T18:00:00+02:00'),
    );
    const full = slots.find((s) => s.label() === '19:30');
    expect(full?.isFull).toBe(true);
    expect(full?.remaining).toBe(0);
    expect(slots.find((s) => s.label() === '19:40')?.remaining).toBe(4);
  });

  it('rattache une commande « au plus tôt » au créneau ouvert qui la précède', () => {
    // 19h33 ne tombe sur aucun pas de 10 minutes : la place doit être décomptée
    // de 19h30, sans quoi le comptoir accepterait cinq sacs sur le même pas.
    const occupancy = occupancyOf(
      [new Date('2026-08-19T19:33:00+02:00')],
      SlotPolicy.DEFAULT,
    );
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      occupancy,
      at('2026-08-19T18:00:00+02:00'),
    );
    expect(slots.find((s) => s.label() === '19:30')?.remaining).toBe(3);
    expect(slots.find((s) => s.label() === '19:40')?.remaining).toBe(4);
  });

  it('retire les créneaux couverts par une fermeture exceptionnelle du soir', () => {
    const closure = unwrap(
      Closure.between(
        new Date('2026-08-19T18:00:00+02:00'),
        new Date('2026-08-19T23:00:00+02:00'),
        'Panne de friteuse',
      ),
    );
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-19T09:00:00+02:00'),
      [closure],
    );
    expect(labels(slots).at(-1)).toBe('14:30');
    expect(labels(slots)).not.toContain('19:30');
  });

  it('vide la journée quand la fermeture la couvre entièrement', () => {
    const closure = unwrap(Closure.onDay(WEDNESDAY, 'Congés'));
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      SlotPolicy.DEFAULT,
      EMPTY_OCCUPANCY,
      at('2026-08-19T09:00:00+02:00'),
      [closure],
    );
    expect(slots).toEqual([]);
  });

  it('respecte un pas et une capacité personnalisés', () => {
    const policy = unwrap(SlotPolicy.create({ intervalMinutes: 15, capacity: 6 }));
    const slots = generateSlots(
      WEDNESDAY,
      hours,
      policy,
      EMPTY_OCCUPANCY,
      at('2026-08-19T09:00:00+02:00'),
    );
    expect(labels(slots).slice(0, 3)).toEqual(['11:30', '11:45', '12:00']);
    expect(slots[0]?.remaining).toBe(6);
  });
});

describe('SlotPolicy', () => {
  it('livre le réglage d’ouverture de compte : 10 minutes, 4 commandes, 20 minutes de préparation', () => {
    expect(SlotPolicy.DEFAULT.intervalMinutes).toBe(10);
    expect(SlotPolicy.DEFAULT.capacity).toBe(4);
    expect(SlotPolicy.DEFAULT.leadTimeMinutes).toBe(20);
  });

  it('refuse un pas nul, qui produirait une grille infinie', () => {
    const zero = SlotPolicy.create({ intervalMinutes: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.code).toBe('slot.policy');
  });

  it('refuse une capacité nulle, qui fermerait le service sans le dire', () => {
    expect(SlotPolicy.create({ capacity: 0 }).ok).toBe(false);
  });
});

describe('Closure', () => {
  it('couvre des journées entières quand le gérant saisit « du 24 au 26 »', () => {
    const from = unwrap(CalendarDay.parse('2026-08-24'));
    const to = unwrap(CalendarDay.parse('2026-08-26'));
    const closure = unwrap(Closure.wholeDays(from, to, 'Congés annuels'));

    expect(closure.covers(new Date('2026-08-24T00:00:00+02:00'))).toBe(true);
    // Le dernier soir doit être fermé lui aussi : c'est tout l'enjeu.
    expect(closure.covers(new Date('2026-08-26T22:00:00+02:00'))).toBe(true);
    expect(closure.covers(new Date('2026-08-27T00:30:00+02:00'))).toBe(false);
    expect(closure.coversWholeDay(unwrap(CalendarDay.parse('2026-08-25')))).toBe(true);
  });

  it('refuse une fermeture qui finit avant de commencer', () => {
    const inverted = Closure.between(
      new Date('2026-08-26T12:00:00+02:00'),
      new Date('2026-08-24T12:00:00+02:00'),
    );
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error.code).toBe('closure.invalid');
  });

  it('affiche un motif par défaut quand le gérant n’a rien saisi', () => {
    const closure = unwrap(Closure.onDay(WEDNESDAY));
    expect(closure.reason).toBe('Fermeture exceptionnelle');
  });
});
