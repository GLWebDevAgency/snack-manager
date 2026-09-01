export const LOYALTY_NAVIGATION = [
  { href: "/admin/fidelite", label: "Vue d'ensemble", exact: true },
  { href: "/admin/fidelite/programme", label: "Programme", exact: false },
  { href: "/admin/fidelite/recompenses", label: "Récompenses", exact: false },
  { href: "/admin/fidelite/clients", label: "Clients", exact: false },
] as const;

export function isLoyaltyRouteActive(
  pathname: string,
  item: (typeof LOYALTY_NAVIGATION)[number],
): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
