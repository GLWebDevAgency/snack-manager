import { DeliverySettingsSchema, type DeliverySettings } from "@sm/contracts";

export type DeliveryPricingMode = "fixed" | "threshold" | "free";
export type DeliveryZoneDraft = {
  id: string; name: string; postalCodes: string; pricingMode: DeliveryPricingMode;
  fee: string; minimum: string; freeFrom: string;
};
export type DeliveryDraft = Omit<DeliverySettings, "zones"> & { zones: DeliveryZoneDraft[] };

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Jamais de parseFloat ni d’arrondi silencieux d’un troisième chiffre. */
export function parseDeliveryEuro(value: string): number | null {
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}

/** Projection canonique commune au brouillon et à sa baseline sauvegardée. */
export function toDeliveryDraft(settings: DeliverySettings): DeliveryDraft {
  return { enabled: settings.enabled, leadTimeMin: settings.leadTimeMin, slotCapacity: settings.slotCapacity,
    zones: settings.zones.map(zone => ({
      id: zone.id, name: zone.name, postalCodes: zone.postalCodes.join(", "),
      pricingMode: zone.feeCents === 0 ? "free" : zone.freeDeliveryFromCents ? "threshold" : "fixed",
      fee: euros(zone.feeCents), minimum: euros(zone.minimumOrderCents),
      freeFrom: zone.freeDeliveryFromCents ? euros(zone.freeDeliveryFromCents) : "",
    })) };
}

/** Les champs cachés restent dans le brouillon lorsqu’on compare les modes. */
export function withDeliveryPricingMode(zone: DeliveryZoneDraft, pricingMode: DeliveryPricingMode): DeliveryZoneDraft {
  return { ...zone, pricingMode };
}

export function newDeliveryZone(id: string): DeliveryZoneDraft {
  return { id, name: "", postalCodes: "", pricingMode: "fixed", fee: "5,00", minimum: "15,00", freeFrom: "30,00" };
}

export function parseDeliveryDraft(draft: DeliveryDraft):
  { success: true; data: DeliverySettings } | { success: false; message: string } {
  const zones: DeliverySettings["zones"] = [];
  for (const [index, zone] of draft.zones.entries()) {
    const label = zone.name.trim() ? `Zone « ${zone.name.trim()} »` : `Zone ${index + 1}`;
    const minimum = parseDeliveryEuro(zone.minimum);
    if (minimum === null || minimum > 100_000) return { success: false, message: `${label} : le minimum doit être compris entre 0 et 1 000,00 €, avec deux décimales au maximum.` };
    const fee = zone.pricingMode === "free" ? 0 : parseDeliveryEuro(zone.fee);
    if (fee === null || fee > 10_000) return { success: false, message: `${label} : les frais doivent être compris entre 0,01 et 100,00 €, avec deux décimales au maximum.` };
    if (zone.pricingMode !== "free" && fee === 0) return { success: false, message: `${label} : saisissez des frais supérieurs à zéro, ou choisissez « Toujours offerte ».` };
    const freeFrom = zone.pricingMode === "threshold" ? parseDeliveryEuro(zone.freeFrom) : null;
    if (zone.pricingMode === "threshold" && (freeFrom === null || freeFrom === 0 || freeFrom > 100_000)) {
      return { success: false, message: `${label} : le seuil de gratuité doit être compris entre 0,01 et 1 000,00 €, avec deux décimales au maximum.` };
    }
    zones.push({ id: zone.id, name: zone.name, postalCodes: zone.postalCodes.split(/[\s,;]+/).filter(Boolean),
      feeCents: fee, minimumOrderCents: minimum, freeDeliveryFromCents: freeFrom });
  }
  const parsed = DeliverySettingsSchema.safeParse({ enabled: draft.enabled, leadTimeMin: draft.leadTimeMin, slotCapacity: draft.slotCapacity, zones });
  if (parsed.success) return { success: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  if (issue?.path[0] === "zones" && typeof issue.path[1] === "number") {
    const zone = draft.zones[issue.path[1]];
    const label = zone?.name.trim() ? `Zone « ${zone.name.trim()} »` : `Zone ${issue.path[1] + 1}`;
    if (issue.path.includes("name")) return { success: false, message: `${label} : renseignez un nom de 2 à 60 caractères.` };
    if (issue.path.includes("postalCodes")) return { success: false, message: issue.code === "custom" ? issue.message : `${label} : saisissez des codes postaux à 5 chiffres, séparés par une virgule.` };
  }
  if (issue?.path.includes("leadTimeMin")) return { success: false, message: "Le délai de livraison doit être compris entre 20 et 180 minutes." };
  if (issue?.path.includes("slotCapacity")) return { success: false, message: "La capacité doit être un nombre entier de 1 à 50 livraisons par créneau." };
  return { success: false, message: issue?.code === "custom" ? issue.message : "Vérifiez les informations de vos zones de livraison." };
}

export function zonePricingSummary(zone: DeliveryZoneDraft): string {
  const minimum = parseDeliveryEuro(zone.minimum);
  const fee = parseDeliveryEuro(zone.fee);
  const threshold = parseDeliveryEuro(zone.freeFrom);
  if (minimum === null || minimum > 100_000) return "Minimum de commande à compléter";
  if (zone.pricingMode === "free") return `Livraison offerte · minimum ${euros(minimum)} €`;
  if (fee === null || fee <= 0 || fee > 10_000) return "Frais de livraison à compléter";
  if (zone.pricingMode === "threshold") {
    if (threshold === null || threshold <= 0 || threshold > 100_000) return "Seuil de gratuité à compléter";
    return `${euros(fee)} € · offerte dès ${euros(threshold)} € · minimum ${euros(minimum)} €`;
  }
  return `${euros(fee)} € · minimum ${euros(minimum)} €`;
}
