"use client";

import { Field, Input } from "@/components/ui";
import { cx } from "@/lib/cx";
import { withDeliveryPricingMode, zonePricingSummary, type DeliveryPricingMode, type DeliveryZoneDraft } from "./delivery-draft";

const MODES: { value: DeliveryPricingMode; label: string; hint: string }[] = [
  { value: "fixed", label: "Tarif fixe", hint: "Les mêmes frais pour chaque commande." },
  { value: "threshold", label: "Offerte dès un seuil", hint: "Des frais en dessous, offerte à partir du montant choisi." },
  { value: "free", label: "Toujours offerte", hint: "Aucun frais pour les commandes éligibles." },
];

export function ZonePricingFields({ zone, onChange }: {
  zone: DeliveryZoneDraft; onChange: (next: DeliveryZoneDraft) => void;
}) {
  return <div className="flex flex-col gap-4">
    <fieldset role="radiogroup" aria-labelledby={`${zone.id}-pricing-label`} className="min-w-0">
      <legend id={`${zone.id}-pricing-label`} className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-mut">Tarification de la livraison</legend>
      <div className="flex flex-col gap-2">
        {MODES.map(mode => <label key={mode.value} className={cx(
          "flex min-h-12 cursor-pointer items-center gap-3 rounded-ctrl border p-3 transition-colors duration-fast focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
          zone.pricingMode === mode.value ? "border-accent bg-accentwash" : "border-linefirm bg-surface hover:border-mut",
        )}>
          <input type="radio" name={`${zone.id}-pricing-mode`} value={mode.value} checked={zone.pricingMode === mode.value}
            onChange={() => onChange(withDeliveryPricingMode(zone, mode.value))} className="size-4 shrink-0 accent-accent"
            aria-labelledby={`${zone.id}-${mode.value}-label`}
            aria-describedby={`${zone.id}-${mode.value}-hint`} />
          <span className="min-w-0"><span id={`${zone.id}-${mode.value}-label`} className="block text-sm font-semibold text-ink">{mode.label}</span>
            <span id={`${zone.id}-${mode.value}-hint`} className="mt-0.5 block text-xs leading-relaxed text-mut">{mode.hint}</span></span>
        </label>)}
      </div>
    </fieldset>
    <div className="grid gap-3 sm:grid-cols-2">
      {zone.pricingMode !== "free" && <Field label="Frais de livraison (€)" htmlFor={`${zone.id}-fee`} hint="Le tarif facturé, de 0,01 à 100 €.">
        <Input id={`${zone.id}-fee`} inputMode="decimal" value={zone.fee} maxLength={7} onChange={event => onChange({ ...zone, fee: event.target.value })} />
      </Field>}
      {zone.pricingMode === "threshold" && <Field label="Livraison offerte dès (€)" htmlFor={`${zone.id}-free-from`} hint="Montant des produits après remise, hors frais.">
        <Input id={`${zone.id}-free-from`} inputMode="decimal" value={zone.freeFrom} maxLength={7} placeholder="30,00" onChange={event => onChange({ ...zone, freeFrom: event.target.value })} />
      </Field>}
      <Field label="Minimum de commande (€)" htmlFor={`${zone.id}-minimum`} hint="Nécessaire pour commander, même si la livraison est offerte. Après remise, hors frais.">
        <Input id={`${zone.id}-minimum`} inputMode="decimal" value={zone.minimum} maxLength={7} onChange={event => onChange({ ...zone, minimum: event.target.value })} />
      </Field>
    </div>
    <p role="status" className="rounded-ctrl bg-ink/5 px-3 py-2 text-[13px] font-semibold leading-relaxed text-ink">{zonePricingSummary(zone)}</p>
  </div>;
}
