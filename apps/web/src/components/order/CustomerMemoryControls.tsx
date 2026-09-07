"use client";

import { validRememberedCustomer } from "./customer-memory";
import type { useCustomerDetails } from "./useCustomerDetails";

/** An explicit convenience choice, not consent to marketing or loyalty enrollment. */
export function CustomerMemoryControls({ details }: { details: ReturnType<typeof useCustomerDetails> }) {
  const { customer, remembered, message, busy, save, forget } = details;
  const unchanged = remembered?.customer.name === customer.name.trim() && remembered?.customer.phone === customer.phone.trim();
  const action = "min-h-11 rounded-chip px-3 py-2 text-[13px] font-semibold transition-colors duration-fast ease-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none";
  return <section aria-label="Mémorisation des coordonnées" className="rounded-card border border-line bg-ink/[0.025] p-4">
    <p className="text-[14px] font-bold text-ink">Gagner du temps la prochaine fois</p>
    <p className="mt-1 text-[13px] leading-relaxed text-mut">Facultatif : conserver votre nom et votre téléphone 7 jours pour ce restaurant, sur cet appareil uniquement. À éviter sur un appareil partagé. Cela ne crée pas de compte ni de carte fidélité.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={`${action} border border-linefirm text-ink hover:bg-ink/5`} disabled={busy || !validRememberedCustomer(customer) || unchanged} onClick={() => { void save(); }}>
        {busy ? "Enregistrement…" : unchanged ? "Coordonnées mémorisées" : remembered ? "Mettre à jour la mémorisation" : "Mémoriser ces coordonnées"}
      </button>
      {remembered && <button type="button" disabled={busy} className={`${action} text-ink underline underline-offset-4 hover:bg-ink/5`} onClick={() => { void forget(); }}>Effacer mes coordonnées</button>}
    </div>
    {message && <p role="status" className="mt-2 text-[13px] leading-relaxed text-mut">{message}</p>}
  </section>;
}
