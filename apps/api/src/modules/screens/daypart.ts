import { tenancy } from '@sm/domain';
import type { ScreenNextOpening, ScreenService } from '@sm/contracts';

/**
 * DAYPARTING — quel service tourne à cet instant, et quand on rouvre.
 *
 * Rien n'est recalculé ici : `ServiceHours` (@sm/domain) sait déjà lire les
 * deux services d'une journée, gérer la coupure de 15 h, le service du soir qui
 * déborde après minuit et le changement d'heure. Ce fichier ne fait que
 * traduire la forme stockée en base vers l'agrégat, puis l'agrégat vers ce
 * qu'un téléviseur doit afficher.
 */

/** Horaires tels qu'ils sont stockés sur le tenant. */
export interface RawDayHours {
  day: number; // ISO : 1 = lundi … 7 = dimanche
  lunch: { open: string; close: string } | null;
  dinner: { open: string; close: string } | null;
}

/**
 * Construit les horaires hebdomadaires depuis la saisie du back-office.
 *
 * Une plage illisible (« 25h » saisi à la main, champ vidé à moitié) ferme ce
 * seul service au lieu de faire échouer la requête : un écran de salle qui
 * s'éteint parce qu'un horaire est mal saisi serait un très mauvais échange.
 */
export function serviceHoursOf(raw: readonly RawDayHours[] | null | undefined): tenancy.ServiceHours {
  const seen = new Set<number>();
  const days: tenancy.DayHours[] = [];

  for (const entry of raw ?? []) {
    const weekday = Number(entry?.day);
    if (!tenancy.isWeekday(weekday) || seen.has(weekday)) continue;
    seen.add(weekday);

    const windows: tenancy.ServiceWindow[] = [];
    for (const service of tenancy.SERVICE_NAMES) {
      const slot = entry[service];
      if (!slot?.open || !slot?.close) continue;
      const parsed = tenancy.ServiceWindow.parse(service, slot.open, slot.close);
      if (parsed.ok) windows.push(parsed.value);
    }

    const day = tenancy.DayHours.create(weekday, windows);
    days.push(day.ok ? day.value : tenancy.DayHours.closed(weekday));
  }

  const hours = tenancy.ServiceHours.create(days);
  return hours.ok ? hours.value : tenancy.ServiceHours.closedAllWeek();
}

/**
 * Le service en cours, `'closed'` s'il n'y en a pas.
 *
 * On interroge aussi la veille : un « 18:00 – 25:00 » du samedi couvre encore
 * 0 h 30, qui appartient déjà au dimanche civil. Sans ça l'écran basculerait
 * sur « Fermé » en plein coup de feu.
 */
export function currentService(hours: tenancy.ServiceHours, now: Date): ScreenService {
  const today = tenancy.CalendarDay.from(now);
  const minutes = tenancy.minutesOfDay(now);

  const open = hours.on(today.weekday()).openWindowAt(minutes);
  if (open) return open.service;

  const overnight = hours
    .on(today.plusDays(-1).weekday())
    .openWindowAt(minutes + tenancy.MINUTES_PER_DAY);
  return overnight ? overnight.service : 'closed';
}

/**
 * Prochain service assuré, avec les plages de cette journée-là qui RESTENT.
 *
 * Plusieurs plages plutôt qu'une seule : « Demain · 11:30 – 14:30 · 18:00 –
 * 22:30 » est l'information que cherche le passant derrière la vitrine, pas
 * seulement l'heure du premier service.
 *
 * Mais uniquement celles à venir : à 15 h, réafficher « 11:30 – 14:30 » ferait
 * croire au client qu'il vient de rater son créneau alors qu'il attend le soir.
 */
export function nextOpeningOf(hours: tenancy.ServiceHours, now: Date): ScreenNextOpening | null {
  const openings = hours.openingsFrom(now);
  const first = openings[0];
  if (!first) return null;

  return {
    dayLabel: relativeDayLabel(tenancy.CalendarDay.from(now), first.day),
    date: first.day.toISO(),
    windows: openings.filter((o) => o.day.equals(first.day)).map((o) => o.window.label()),
    opensAt: first.opensAt.toISOString(),
  };
}

/**
 * « Aujourd'hui », « Demain », sinon le jour de la semaine.
 *
 * Au-delà de deux jours, un nom de jour est plus parlant qu'une date : personne
 * ne lit « 21/08 » sur un écran en passant.
 */
export function relativeDayLabel(today: tenancy.CalendarDay, day: tenancy.CalendarDay): string {
  if (day.equals(today)) return "Aujourd'hui";
  if (day.equals(today.plusDays(1))) return 'Demain';
  return tenancy.WEEKDAY_LABELS[day.weekday()];
}
