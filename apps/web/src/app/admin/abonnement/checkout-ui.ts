import type { CrmInvoice } from "@sm/contracts";

/** Affichage seulement : la même éligibilité est revalidée au serveur. */
export function canPayInvoice(invoice: CrmInvoice): boolean {
  const total = invoice.totals?.ttcCents;
  return invoice.kind !== "avoir" && Boolean(invoice.issuedAt)
    && (invoice.status === "envoyee" || invoice.status === "en_retard")
    && typeof total === "number" && Number.isSafeInteger(total) && total >= 50;
}

export function safeCheckoutUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password) {
    throw new Error("Lien de paiement invalide.");
  }
  return url.toString();
}
