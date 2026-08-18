import { unwrap } from '../shared/result';
import { BrandTheme, HexColor } from './brand-theme';
import { Restaurant } from './restaurant';
import { DayHours, ServiceHours, ServiceWindow } from './service-hours';
import { TenantSlug } from './public-domain';
import type { Weekday } from './wall-clock';

/**
 * Le pilote Class'Food, tel qu'il tourne réellement — jeu d'essai des tests du
 * sous-domaine RESTAURANT.
 *
 * Ce fichier n'a pas vocation à être exporté par le paquet : il ne sert qu'à
 * écrire des tests contre des horaires vrais plutôt que contre un « 9h–18h »
 * de laboratoire, où aucun bug de coupure ne se serait jamais montré.
 *
 * 7j/7, midi 11h30–14h30 et soir 18h00–22h30 — SAUF lundi et vendredi, où
 * seul le service du soir tourne (jours creux du midi à Perriers).
 */

const LUNCH: readonly Weekday[] = [2, 3, 4, 6, 7];
const ALL_DAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function classFoodHours(): ServiceHours {
  const days = ALL_DAYS.map((weekday) => {
    const windows = [
      ...(LUNCH.includes(weekday) ? [unwrap(ServiceWindow.parse('lunch', '11:30', '14:30'))] : []),
      unwrap(ServiceWindow.parse('dinner', '18:00', '22:30')),
    ];
    return unwrap(DayHours.create(weekday, windows));
  });
  return unwrap(ServiceHours.create(days));
}

export function classFoodTheme(): BrandTheme {
  return unwrap(
    BrandTheme.create({ name: "Class'Food", accent: unwrap(HexColor.create('#C8281E')) }),
  );
}

export function classFoodRestaurant(): Restaurant {
  return unwrap(
    Restaurant.create({
      slug: unwrap(TenantSlug.create('classfood')),
      name: "Class'Food · Perriers",
      hours: classFoodHours(),
      theme: classFoodTheme(),
    }),
  );
}
