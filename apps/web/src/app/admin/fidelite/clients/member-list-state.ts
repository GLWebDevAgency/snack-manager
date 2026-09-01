import type { LoyaltyMemberSummary } from "@sm/contracts";

export type LoyaltyMemberStatusFilter = "all" | LoyaltyMemberSummary["status"];

/**
 * Réconcilie une mutation de fiche avec la page actuellement filtrée.
 *
 * Une carte bloquée depuis la vue « Actives » doit disparaître immédiatement,
 * et non rester visible jusqu'au prochain rechargement. À l'inverse, une carte
 * qui entre dans le filtre courant est insérée en tête sans doublon.
 */
export function reconcileLoyaltyMemberList(
  list: readonly LoyaltyMemberSummary[],
  member: LoyaltyMemberSummary,
  filter: LoyaltyMemberStatusFilter,
): LoyaltyMemberSummary[] {
  if (filter !== "all" && member.status !== filter) {
    return list.filter((item) => item.id !== member.id);
  }

  return list.some((item) => item.id === member.id)
    ? list.map((item) => (item.id === member.id ? member : item))
    : [member, ...list];
}
