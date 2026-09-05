"use client";

import { useState } from "react";
import { GhostAction, PrimaryAction } from "./primitives";

/** Confirmation explicite, sans dialogue navigateur ni changement optimiste. */
export function CounterPaymentAction({ disabled, busy, onConfirm }: {
  disabled: boolean;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section aria-label="Paiement au retrait" className="mt-4 border-t border-ink/8 pt-4">
      {confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-mut">
            Nous allons vérifier le paiement en ligne avant de le fermer. Votre commande et son numéro restent les mêmes.
            Une fois le changement confirmé, vous réglerez au retrait. Si un paiement bancaire est déjà confirmé ou en cours, le changement sera refusé.
          </p>
          <PrimaryAction disabled={disabled} loading={busy} onClick={() => { void onConfirm().finally(() => setConfirming(false)); }}>
            Confirmer le choix comptoir
          </PrimaryAction>
          <GhostAction disabled={disabled || busy} onClick={() => setConfirming(false)}>Garder le paiement en ligne</GhostAction>
        </div>
      ) : (
        <GhostAction disabled={disabled || busy} onClick={() => setConfirming(true)} icon="euro">Payer au comptoir</GhostAction>
      )}
    </section>
  );
}
