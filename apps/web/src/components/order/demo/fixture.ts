/**
 * Le restaurant fictif de la démonstration — « Le Comptoir ».
 *
 * Même établissement que dans la caisse et l'écran cuisine
 * (`packages/client-core/src/demo`) : même nom, même adresse inventée, mêmes
 * téléphones tirés de la plage que l'ARCEP réserve à la fiction — ils ne
 * sonnent nulle part. La carte, elle, vit dans `carte.ts`.
 *
 * ─── CE QUI NE SE FIGE JAMAIS : LE TEMPS ───
 *
 * Un créneau « 12h30 » enregistré dans un fichier serait, dès le lendemain, un
 * créneau du passé : la page afficherait « aucun créneau ce jour-là », le
 * visiteur conclurait que le restaurant est fermé, et la démonstration
 * démontrerait le contraire de ce qu'on veut montrer. Horaires, créneaux et
 * avis sont donc TOUJOURS calculés à partir de l'instant présent.
 *
 * ─── ET « LE COMPTOIR » EST TOUJOURS OUVERT ───
 *
 * Sa semaine affichée est celle d'un snack ordinaire (11h00–14h30 ·
 * 18h00–23h30, 7j/7), mais si le visiteur arrive en dehors — il est 3 h du
 * matin, ou 16 h entre deux services —, le service DU JOUR est étiré pour
 * contenir l'instant présent. C'est le seul mensonge assumé de la fixture, et
 * il est là pour une raison : la vitrine doit pouvoir être essayée à toute
 * heure. Un restaurateur qui clique « Essayer » à 15 h et tombe sur « Fermé »
 * n'a rien vu du parcours de commande, qui est précisément l'objet de la
 * démonstration.
 */
import type {
  PublicSiteHours,
  PublicSiteResponse,
  PublicSiteReview,
  PublicSiteTenant,
  PickupSlot,
  SlotService,
  SlotsResponse,
} from "@sm/contracts";
import {
  DIRECTIONS,
  NEXT_OPEN_LOOKAHEAD_DAYS,
  RESTAURANT_TZ,
  SLOT_LEAD_TIME_MIN,
} from "@sm/contracts";
import { demoCategories } from "./carte";
import { DEMO_SLUG } from "./mode";
import {
  addDays,
  compareDays,
  formatDay,
  formatHm,
  isoWeekday,
  parisDay,
  parisMinutes,
  parisWallToUtc,
  parseDay,
  parseHm,
  type CalendarDay,
} from "./paris";

/** Réglages de service — ceux qu'un gérant pose dans son back-office. */
export const DEMO_INTERVAL_MIN = 10;
export const DEMO_CAPACITY = 4;

/** Bornes de service affichées dans la semaine du restaurant. */
const LUNCH = { open: 11 * 60, close: 14 * 60 + 30 };
const DINNER = { open: 18 * 60, close: 23 * 60 + 30 };
const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

/** Identité du restaurant fictif, telle que la sert `/public/tenants/:slug`. */
export function demoTenant(now: Date): PublicSiteTenant {
  return {
    slug: DEMO_SLUG,
    name: "Le Comptoir",
    brand: DIRECTIONS.nuit,
    logoUrl: null,
    brandColor: "#c9a15a",
    address: "14 rue des Halles — 76000 Rouen",
    // Plage réservée par l'ARCEP à la fiction : ces numéros ne sonnent nulle part.
    phones: ["01 99 00 12 34", "06 39 98 76 54"],
    hours: demoHours(now),
  };
}

// ─────────────────────────────────────────────────────────────
// Horaires
// ─────────────────────────────────────────────────────────────

const span = (open: number, close: number) => ({
  open: formatHm(open),
  close: formatHm(close),
});

/**
 * La semaine du restaurant, avec le jour courant étiré si besoin (voir l'en-tête).
 */
export function demoHours(now: Date): PublicSiteHours[] {
  const today = isoWeekday(parisDay(now));
  const minutes = parisMinutes(now);
  return [1, 2, 3, 4, 5, 6, 7].map((day) => {
    if (day !== today) {
      return { day, lunch: span(LUNCH.open, LUNCH.close), dinner: span(DINNER.open, DINNER.close) };
    }
    let lunch = { ...LUNCH };
    let dinner = { ...DINNER };
    const inside =
      (minutes >= lunch.open && minutes <= lunch.close) ||
      (minutes >= dinner.open && minutes <= dinner.close);
    if (!inside) {
      // Une demi-heure de marge avant l'instant présent : le visiteur voit un
      // service commencé, pas un service qui ouvre pile quand il arrive.
      const from = Math.max(0, floorTo(minutes - 30, 30));
      if (minutes < lunch.open) {
        lunch = { open: from, close: lunch.close };
      } else if (minutes < dinner.open) {
        // Entre deux services : le soir démarre plus tôt, jamais avant la
        // fermeture du midi — deux plages qui se chevauchent dans la même
        // journée se liraient comme un bug d'horaires.
        dinner = { open: Math.max(from, lunch.close), close: dinner.close };
      } else {
        dinner = { open: dinner.open, close: LAST_MINUTE_OF_DAY };
      }
    }
    return { day, lunch: span(lunch.open, lunch.close), dinner: span(dinner.open, dinner.close) };
  });
}

const floorTo = (value: number, step: number) => Math.floor(value / step) * step;

/** Horaires du jour demandé (`null` si le restaurant ne sert pas ce jour-là). */
export function hoursOf(hours: PublicSiteHours[], day: CalendarDay): PublicSiteHours | null {
  return hours.find((h) => h.day === isoWeekday(day)) ?? null;
}

/** Le restaurant sert-il à cet instant ? (fixture : toujours vrai, par construction) */
export function demoOpenNow(now: Date): boolean {
  const entry = hoursOf(demoHours(now), parisDay(now));
  if (!entry) return false;
  const minutes = parisMinutes(now);
  return [entry.lunch, entry.dinner].some((s) => {
    const open = parseHm(s?.open);
    const close = parseHm(s?.close);
    return open !== null && close !== null && minutes >= open && minutes <= close;
  });
}

// ─────────────────────────────────────────────────────────────
// Créneaux de retrait
// ─────────────────────────────────────────────────────────────

/**
 * Affluence déjà consommée sur un créneau, AVANT les commandes du visiteur.
 *
 * Une grille entièrement verte ne dit rien du produit : le restaurateur doit
 * voir que la capacité se remplit, que 12h30 affiche « complet » un midi, et
 * que le client est réorienté sans drame. Le tirage est déterministe (il ne
 * dépend que de l'instant du créneau) : le rendu serveur et le rechargement
 * côté navigateur montrent la même grille, sans divergence d'hydratation.
 */
export function baseTaken(iso: string): number {
  const bucket = Math.floor(Date.parse(iso) / (DEMO_INTERVAL_MIN * 60_000));
  const draw = Math.abs(Math.sin(bucket) * 10_000) % 10;
  if (draw < 1.2) return DEMO_CAPACITY; // complet
  if (draw < 3.4) return DEMO_CAPACITY - 1; // chargé
  return draw < 5 ? 1 : 0;
}

/** Fenêtres de service d'un jour, en minutes depuis minuit. */
function windowsOf(
  hours: PublicSiteHours[],
  day: CalendarDay,
): { service: SlotService; open: number; close: number }[] {
  const entry = hoursOf(hours, day);
  if (!entry) return [];
  const out: { service: SlotService; open: number; close: number }[] = [];
  for (const service of ["lunch", "dinner"] as const) {
    const open = parseHm(entry[service]?.open);
    const close = parseHm(entry[service]?.close);
    if (open === null || close === null || close < open) continue;
    out.push({ service, open, close });
  }
  return out;
}

/**
 * Créneaux proposables — même calcul que `SlotsService.compute` côté API :
 * grille du jour toutes les `intervalMin`, délai de préparation à partir de
 * maintenant, capacité décomptée des commandes déjà prises.
 */
export function demoSlots(
  now: Date,
  date: string | null,
  taken: (iso: string) => number,
): SlotsResponse {
  const hours = demoHours(now);
  const today = parisDay(now);
  const requested = (date ? parseDay(date) : today) ?? today;
  const isPastDay = compareDays(requested, today) < 0;
  const windows = isPastDay ? [] : windowsOf(hours, requested);

  const earliest = now.getTime() + SLOT_LEAD_TIME_MIN * 60_000;
  const seen = new Set<number>();
  const slots: PickupSlot[] = [];
  for (const window of windows) {
    for (let m = window.open; m <= window.close; m += DEMO_INTERVAL_MIN) {
      const at = parisWallToUtc(requested, m);
      if (at.getTime() < earliest || seen.has(at.getTime())) continue;
      seen.add(at.getTime());
      const iso = at.toISOString();
      const remaining = Math.max(0, DEMO_CAPACITY - taken(iso));
      slots.push({
        iso,
        label: formatHm(m),
        service: window.service,
        remaining,
        full: remaining <= 0,
        load: remaining <= 0 ? "full" : remaining <= Math.ceil(DEMO_CAPACITY / 2) ? "busy" : "calm",
      });
    }
  }
  slots.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));

  const closedToday = slots.length === 0;
  return {
    date: formatDay(requested),
    timezone: RESTAURANT_TZ,
    intervalMin: DEMO_INTERVAL_MIN,
    capacity: DEMO_CAPACITY,
    leadTimeMin: SLOT_LEAD_TIME_MIN,
    slots,
    closedToday,
    // Comme l'API : renseignée seulement quand la journée demandée est vide —
    // c'est elle qui fait apparaître le sélecteur « Aujourd'hui / Demain ».
    nextOpenDate: closedToday ? nextOpenDate(hours, isPastDay ? today : requested) : null,
    closureReason: null,
    paused: false,
  };
}

/** Première date réellement ouverte après `from` — jamais rognée par le délai. */
function nextOpenDate(hours: PublicSiteHours[], from: CalendarDay): string | null {
  for (let i = 1; i <= NEXT_OPEN_LOOKAHEAD_DAYS; i++) {
    const day = addDays(from, i);
    if (windowsOf(hours, day).length === 0) continue;
    return formatDay(day);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Avis
// ─────────────────────────────────────────────────────────────

/**
 * Avis inventés — AUCUN avis réel n'est repris.
 *
 * Les vrais avis d'un client sont ses clients qui parlent de lui : les
 * recopier dans notre vitrine sous un autre nom d'enseigne serait s'approprier
 * sa réputation. Ceux-ci sont écrits pour la démonstration, datés en relatif,
 * et l'un d'eux porte une réponse du restaurant — c'est une fonction du
 * back-office qu'on veut montrer.
 */
const REVIEWS: { author: string; rating: number; text: string; ageH: number; reply?: string }[] = [
  {
    author: "Sabrina M.",
    rating: 5,
    text: "Commande passée à 12h05, retirée à 12h30 pile, tout était chaud. Le tacos gratiné vaut vraiment le détour.",
    ageH: 26,
  },
  {
    author: "Kevin D.",
    rating: 5,
    text: "Je commande depuis le téléphone en sortant du chantier, c'est prêt quand j'arrive. Plus besoin d'attendre au comptoir.",
    ageH: 52,
    reply: "Merci Kevin, à très vite au Comptoir !",
  },
  {
    author: "Léa P.",
    rating: 4,
    text: "Très bon burger et portions généreuses. Un peu d'attente le samedi soir, mais l'équipe prévient quand c'est prêt.",
    ageH: 96,
  },
  {
    author: "Mehdi T.",
    rating: 5,
    text: "Les suppléments sont clairs, on voit le prix avant de valider. Simple et honnête.",
    ageH: 150,
  },
];

function demoReviews(now: Date): PublicSiteResponse["reviews"] {
  const latest: PublicSiteReview[] = REVIEWS.map((review, i) => ({
    _id: `demo-review-${i + 1}`,
    author: review.author,
    rating: review.rating,
    text: review.text,
    createdAt: new Date(now.getTime() - review.ageH * 3_600_000).toISOString(),
    reply: review.reply
      ? {
          text: review.reply,
          at: new Date(now.getTime() - (review.ageH - 3) * 3_600_000).toISOString(),
        }
      : null,
  }));
  const sum = REVIEWS.reduce((total, r) => total + r.rating, 0);
  return {
    avg: Math.round((sum / REVIEWS.length) * 10) / 10,
    // Le compteur affiché n'est pas la longueur de la liste : un restaurant
    // n'expose que ses derniers avis, comme le fait l'API.
    count: 128,
    latest,
  };
}

// ─────────────────────────────────────────────────────────────
// Page publique complète
// ─────────────────────────────────────────────────────────────

/** Réponse de `GET /public/tenants/demo/site`, à l'instant `now`. */
export function demoSite(now: Date, taken: (iso: string) => number): PublicSiteResponse {
  const tenant = demoTenant(now);
  return {
    tenant,
    menu: { categories: demoCategories() },
    // Aucune médiathèque en démonstration — voir `carte.ts`.
    medias: [],
    slots: demoSlots(now, null, taken),
    reviews: demoReviews(now),
    ordering: { paused: false, message: null },
    openNow: demoOpenNow(now),
    todayHours: hoursOf(tenant.hours, parisDay(now)),
    timezone: RESTAURANT_TZ,
  };
}
