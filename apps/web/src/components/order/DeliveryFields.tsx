"use client";

import { useId } from "react";
import type { DeliveryAddress, DeliveryQuote } from "@sm/contracts";
import { Banner, GhostAction, Money, SectionLabel, Spinner } from "./primitives";

/** Les frais effectifs viennent du devis serveur, jamais d'un seuil recalculé ici. */
export function DeliveryFee({ quote, mono = false }: { quote: DeliveryQuote; mono?: boolean }) {
  return quote.feeCents === 0
    ? <span className="font-semibold text-okt">Offerts</span>
    : <Money cents={quote.feeCents} mono={mono} />;
}

export function FreeDeliveryHint({ quote }: { quote: DeliveryQuote }) {
  const remaining = quote.remainingForFreeDeliveryCents;
  if (quote.feeCents === 0) return <span className="block font-semibold text-okt">Votre livraison est offerte.</span>;
  if (remaining == null || remaining <= 0) return null;
  return <span className="block">Il manque <Money cents={remaining} /> de produits après remise pour la livraison offerte.</span>;
}

/** Saisie courte, avec validation explicite de la zone et du prix côté restaurant. */
export function DeliveryFields({ address, instructions, quote, busy, error, onAddress, onInstructions, onVerify }: {
  address: DeliveryAddress;
  instructions: string;
  quote: DeliveryQuote | null;
  busy: boolean;
  error: string | null;
  onAddress: (next: DeliveryAddress) => void;
  onInstructions: (next: string) => void;
  onVerify: () => void;
}) {
  const id = useId();
  const input = "min-h-12 w-full rounded-card border border-linefirm bg-ink/5 px-3.5 py-3 text-[16px] text-ink outline-none transition-colors duration-fast placeholder:text-mut focus:border-focus";
  return (
    <section className="mt-6 flex flex-col gap-4 border-t border-ink/10 pt-5" aria-labelledby={`${id}-title`}>
      <SectionLabel><span id={`${id}-title`}>Votre adresse de livraison</span></SectionLabel>
      <p className="text-[13px] leading-relaxed text-mut">Votre restaurant assure la livraison. Vérifiez votre adresse pour connaître les frais et le minimum de commande.</p>
      {([
        ["line1", "Numéro et rue", "address-line1", "12 rue des Fleurs", 160],
        ["line2", "Bâtiment, étage, appartement (facultatif)", "address-line2", "Bâtiment B, 2e étage", 160],
        ["postalCode", "Code postal", "postal-code", "69001", 5],
        ["city", "Ville", "address-level2", "Lyon", 100],
      ] as const).map(([key, label, complete, placeholder, max]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-${key}`} className="text-[13px] font-semibold text-ink">{label}</label>
          <input id={`${id}-${key}`} className={input} value={address[key] ?? ""} autoComplete={complete} maxLength={max} placeholder={placeholder} inputMode={key === "postalCode" ? "numeric" : "text"} onChange={(event) => onAddress({ ...address, [key]: event.target.value })} />
        </div>
      ))}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-instructions`} className="text-[13px] font-semibold text-ink">Indications pour le livreur (facultatif)</label>
        <textarea id={`${id}-instructions`} className={`${input} min-h-20 resize-y`} maxLength={300} rows={2} value={instructions} onChange={(event) => onInstructions(event.target.value)} placeholder="Interphone, accès à la cour…" />
      </div>
      {error && <div role="alert"><Banner tone="alert" title="Adresse à vérifier">{error}</Banner></div>}
      {quote ? (
        <div role="status"><Banner tone="ok" icon="check" title="Nous livrons à cette adresse">
          {quote.discount && <span className="mb-1 block">{quote.discount.reason} : −<Money cents={quote.discount.amount} />.</span>}
          Produits{quote.discount ? " après remise" : ""} <Money cents={quote.subtotalCents} /> · frais de livraison <DeliveryFee quote={quote} />.
          <span className="mt-1 block font-semibold">Total estimé <Money cents={quote.totalCents} />.</span>
          <span className="mt-1 block"><FreeDeliveryHint quote={quote} /></span>
          <span className="mt-1 block">Minimum <Money cents={quote.minimumOrderCents} /> de produits après remise. Prix et disponibilité de l’offre revérifiés à la validation.</span>
          Choisissez ensuite votre heure de livraison estimée.
        </Banner></div>
      ) : (
        <GhostAction disabled={busy} onClick={onVerify}>{busy ? <><Spinner /> Vérification…</> : "Vérifier mon adresse"}</GhostAction>
      )}
    </section>
  );
}
