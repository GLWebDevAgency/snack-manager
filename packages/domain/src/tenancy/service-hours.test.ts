import { describe, expect, it } from 'vitest';
import { unwrap } from '../shared/result';
import { classFoodHours } from './classfood.fixture';
import { DayHours, ServiceHours, ServiceWindow } from './service-hours';
import { CalendarDay, WallTime } from './wall-clock';

// Repères : 17/08/2026 = lundi · 19/08 = mercredi · 21/08 = vendredi.
// Heures écrites avec leur décalage explicite (+02:00 en été, +01:00 en hiver)
// pour que le test dise l'heure du restaurant, pas celle du serveur.

describe('ServiceHours', () => {
  const hours = classFoodHours();

  it('sert le midi et le soir un mercredi', () => {
    expect(hours.isOpenAt(new Date('2026-08-19T12:30:00+02:00'))).toBe(true);
    expect(hours.isOpenAt(new Date('2026-08-19T19:30:00+02:00'))).toBe(true);
  });

  it('ne sert que le soir le lundi et le vendredi', () => {
    expect(hours.isOpenAt(new Date('2026-08-17T12:30:00+02:00'))).toBe(false);
    expect(hours.isOpenAt(new Date('2026-08-17T19:30:00+02:00'))).toBe(true);
    expect(hours.isOpenAt(new Date('2026-08-21T12:30:00+02:00'))).toBe(false);
    expect(hours.isOpenAt(new Date('2026-08-21T19:30:00+02:00'))).toBe(true);
  });

  it('ferme pendant la coupure de l’après-midi', () => {
    // 15h30 un mercredi : entre les deux services, la cuisine est vide.
    expect(hours.isOpenAt(new Date('2026-08-19T15:30:00+02:00'))).toBe(false);
  });

  it('reste ouvert à l’heure pile de fermeture', () => {
    // 22h30 est encore une heure de retrait : c'est le dernier créneau annoncé.
    expect(hours.isOpenAt(new Date('2026-08-19T22:30:00+02:00'))).toBe(true);
    expect(hours.isOpenAt(new Date('2026-08-19T22:31:00+02:00'))).toBe(false);
  });

  it('lit 18h00 comme une heure de Perriers, été comme hiver', () => {
    // Même heure murale, deux instants UTC différents : sans gestion du fuseau,
    // le service du soir ouvrirait avec une heure de retard tout l'hiver.
    expect(hours.isOpenAt(new Date('2026-07-20T18:00:00+02:00'))).toBe(true);
    expect(hours.isOpenAt(new Date('2026-07-20T17:30:00+02:00'))).toBe(false);
    expect(hours.isOpenAt(new Date('2026-01-19T18:00:00+01:00'))).toBe(true);
    expect(hours.isOpenAt(new Date('2026-01-19T17:30:00+01:00'))).toBe(false);
  });

  it('annonce le service du soir quand le midi est terminé', () => {
    const next = hours.nextOpening(new Date('2026-08-19T15:00:00+02:00'));
    expect(next?.toISOString()).toBe(new Date('2026-08-19T18:00:00+02:00').toISOString());
  });

  it('annonce le midi du lendemain quand la soirée est finie', () => {
    // Mercredi 23h : le prochain service est le midi du jeudi.
    const next = hours.nextOpening(new Date('2026-08-19T23:00:00+02:00'));
    expect(next?.toISOString()).toBe(new Date('2026-08-20T11:30:00+02:00').toISOString());
  });

  it('saute le midi fermé du vendredi', () => {
    // Jeudi 23h : vendredi midi n'existe pas, on annonce le vendredi soir.
    const next = hours.nextOpening(new Date('2026-08-20T23:00:00+02:00'));
    expect(next?.toISOString()).toBe(new Date('2026-08-21T18:00:00+02:00').toISOString());
  });

  it('annonce le service suivant même pendant le service en cours', () => {
    // « Ouvert » et « prochaine ouverture » répondent à deux questions distinctes.
    const next = hours.nextOpening(new Date('2026-08-19T12:30:00+02:00'));
    expect(next?.toISOString()).toBe(new Date('2026-08-19T18:00:00+02:00').toISOString());
  });

  it('ne trouve aucune réouverture quand la semaine type est vide', () => {
    expect(ServiceHours.closedAllWeek().nextOpening(new Date('2026-08-19T12:00:00+02:00'))).toBe(
      null,
    );
  });

  it('considère fermé tout jour non saisi', () => {
    const dinnerOnly = unwrap(
      ServiceHours.create([
        unwrap(DayHours.create(3, [unwrap(ServiceWindow.parse('dinner', '18:00', '22:30'))])),
      ]),
    );
    expect(dinnerOnly.on(3).isClosed()).toBe(false);
    expect(dinnerOnly.on(1).isClosed()).toBe(true);
  });

  it('reste ouvert après minuit quand le service déborde sur la nuit', () => {
    // Un snack qui ferme à 1h saisit « 25:00 » : 00h30 appartient encore au
    // service de la veille, pas à une journée qui n'a pas commencé.
    const lateNight = unwrap(
      ServiceHours.create([
        unwrap(DayHours.create(6, [unwrap(ServiceWindow.parse('dinner', '18:00', '25:00'))])),
      ]),
    );
    // Samedi 22/08/2026 au soir → dimanche 00h30.
    expect(lateNight.isOpenAt(new Date('2026-08-23T00:30:00+02:00'))).toBe(true);
    expect(lateNight.isOpenAt(new Date('2026-08-23T01:30:00+02:00'))).toBe(false);
  });
});

describe('ServiceWindow', () => {
  it('refuse une fermeture antérieure à l’ouverture', () => {
    const inverted = ServiceWindow.parse('lunch', '14:30', '11:30');
    expect(inverted.ok).toBe(false);
    if (!inverted.ok) expect(inverted.error.code).toBe('hours.invalid');
  });

  it('refuse une heure illisible', () => {
    const typo = ServiceWindow.parse('dinner', '18h00', '22:30');
    expect(typo.ok).toBe(false);
  });

  it('refuse une ouverture au-delà de minuit', () => {
    // « 25:00 » n'a de sens que pour une fermeture : un service ne commence pas
    // le lendemain du jour où il est saisi.
    const late = ServiceWindow.parse('dinner', '25:00', '26:00');
    expect(late.ok).toBe(false);
  });
});

describe('DayHours', () => {
  it('refuse deux services qui se chevauchent le même jour', () => {
    // Faute de saisie classique : midi fermé à 18h30 au lieu de 14h30.
    const overlapping = DayHours.create(3, [
      unwrap(ServiceWindow.parse('lunch', '11:30', '18:30')),
      unwrap(ServiceWindow.parse('dinner', '18:00', '22:30')),
    ]);
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) expect(overlapping.error.message).toContain('chevauchent');
  });

  it('range les services par heure d’ouverture, quel que soit l’ordre de saisie', () => {
    const day = unwrap(
      DayHours.create(3, [
        unwrap(ServiceWindow.parse('dinner', '18:00', '22:30')),
        unwrap(ServiceWindow.parse('lunch', '11:30', '14:30')),
      ]),
    );
    expect(day.windows.map((w) => w.service)).toEqual(['lunch', 'dinner']);
    expect(day.label()).toBe('11:30 – 14:30 · 18:00 – 22:30');
  });
});

describe('WallTime et CalendarDay', () => {
  it('lit une heure de saisie et la réaffiche à la française', () => {
    expect(unwrap(WallTime.parse('8:30')).format()).toBe('08:30');
    expect(unwrap(WallTime.parse('22:30')).minutes).toBe(1350);
  });

  it('ramène une heure d’après minuit sur l’horloge du client', () => {
    expect(unwrap(WallTime.parse('25:00')).format()).toBe('01:00');
  });

  it('refuse une date qui n’existe pas', () => {
    const impossible = CalendarDay.parse('2026-02-31');
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) expect(impossible.error.code).toBe('day.invalid');
  });

  it('rattache un instant à la journée du restaurant', () => {
    // 00h30 heure de Paris appartient au 20 août, pas au 19 comme le dirait UTC.
    expect(CalendarDay.from(new Date('2026-08-20T00:30:00+02:00')).toISO()).toBe('2026-08-20');
  });
});
