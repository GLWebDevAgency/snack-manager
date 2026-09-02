import type { LoyaltyCustomerCard } from "@sm/contracts";

export function loyaltyScanSuccessAnnouncement(
  card: LoyaltyCustomerCard,
  unitSingular: string,
  unitPlural: string,
): string {
  const units = card.member.balanceUnits === 1 ? unitSingular : unitPlural;
  return `Carte de ${card.member.alias} chargée. Solde : ${card.member.balanceUnits.toLocaleString("fr-FR")} ${units}.`;
}
