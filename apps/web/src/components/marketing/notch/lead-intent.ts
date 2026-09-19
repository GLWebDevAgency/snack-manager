/** Public, non-sensitive project choices. Unknown URL values are never sent to the lead API. */
export const LEAD_NEEDS = {
  service: "Organiser le service et la gestion",
  gestion: "Choisir l’offre Gestion",
  boost: "Choisir l’offre Boost",
  "menu-papier": "Refaire mon menu papier",
  "menu-tv": "Préparer mes menus TV",
  "carte-tv": "Réunir menus papier et TV",
  "commande-directe": "Développer la commande directe",
  fidelite: "Préparer un pilote fidélité",
  livraison: "Préparer ma livraison avec mes livreurs",
  communication: "Confier mon site ou ma communication",
  "etre-conseille": "Être conseillé sur mon projet",
} as const;
export type LeadNeed = keyof typeof LEAD_NEEDS;
export function knownNeed(value: string | null): LeadNeed | "" {
  return value && Object.prototype.hasOwnProperty.call(LEAD_NEEDS, value) ? value as LeadNeed : "";
}
export function needFromSearch(search: string): LeadNeed | "" {
  return knownNeed(new URLSearchParams(search).get("besoin"));
}
export const LEAD_INTENT_EVENT = "snackmanager:project-intent";
