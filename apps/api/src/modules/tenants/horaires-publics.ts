import type { PublicSiteHours } from '@sm/contracts';

/**
 * Un créneau tel qu'il DORT en base — donc sans rien garantir de sa forme.
 *
 * `PATCH /tenants/me/hours` valide désormais ce qu'il écrit
 * (`TenantHoursUpdateSchema`), mais une garde d'ENTRÉE ne réécrit pas le
 * passé : la base porte encore ce que la route nue y a laissé, plus ce que
 * l'admin-cli et les scripts de reprise y posent sans passer par zod. Une
 * plage à moitié saisie (`{ open: '11:00' }`, `close` perdu) reste donc
 * possible à la LECTURE, et c'est cette lecture-là qui sort vers le public.
 */
type CreneauStocke = { open?: unknown; close?: unknown } | null | undefined;

/** Une journée telle qu'elle dort en base, mêmes réserves. */
type JourStocke =
  | { day?: unknown; lunch?: CreneauStocke; dinner?: CreneauStocke }
  | null
  | undefined;

const creneauPublic = (c: CreneauStocke): { open: string; close: string } | null =>
  c && typeof c.open === 'string' && typeof c.close === 'string'
    ? { open: c.open, close: c.close }
    : null;

/**
 * LES HORAIRES, DANS LA SEULE FORME QUI SORT VERS LE PUBLIC.
 *
 * Trois surfaces rendent les mêmes horaires — la vitrine (`tenantPublicDe`),
 * l'écran de salle (`identiteDuTableau`) et la fiche publique
 * (`publicBySlug`) — et elles le faisaient de trois façons : deux copies
 * identiques du même `map`, et une troisième qui rendait le tableau de
 * sous-documents Mongoose TEL QUEL. Trois formes pour une donnée, dont une
 * qui laissait le vocabulaire de la base (documents hydratés, méthodes de
 * prototype) traverser jusqu'à une page cliente.
 *
 * Ce qui sort d'ici est un objet NU, conforme au contrat `PublicSiteHours` :
 * `day` ramené à un nombre, et un service ramené à `null` dès qu'il lui manque
 * une borne. Ce dernier point est une garde, pas une coquetterie : la route
 * d'écriture est validée depuis, mais ce qu'elle a écrit AVANT dort toujours
 * en base, et une journée à moitié saisie doit sortir FERMÉE plutôt que de
 * partir en `close: undefined` dans le calcul des créneaux de toute une page
 * de commande.
 */
export function horairesPublics(
  hours: readonly JourStocke[] | null | undefined,
): PublicSiteHours[] {
  return (hours ?? []).map((h) => ({
    day: Number(h?.day ?? 0),
    lunch: creneauPublic(h?.lunch),
    dinner: creneauPublic(h?.dinner),
  }));
}
