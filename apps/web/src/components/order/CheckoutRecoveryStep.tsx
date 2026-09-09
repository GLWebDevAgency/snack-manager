"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import type { VisibleCheckoutAttempt } from "./checkout-attempt";
import { GhostAction, PrimaryAction } from "./primitives";
import { hhmm } from "./helpers";
import { customerTrackingHref } from "./delivery-proof-access";

/** Restores a request or its receipt. Stored state is never payment authority. */
export function CheckoutRecoveryStep({
  attempt, busy, embed, archived = false, resendReady = false,
  onRecover, onResend, onAbandon, onNew,
}: {
  attempt: VisibleCheckoutAttempt;
  busy: boolean;
  embed: boolean;
  archived?: boolean;
  resendReady?: boolean;
  onRecover: () => void;
  onResend: () => void;
  onAbandon: () => void;
  onNew: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [observedAt] = useState(Date.now);
  if (attempt.state === "received") return (
    <section className="flex flex-col gap-4 rounded-card border border-ink/10 bg-card p-5">
      <div className="flex items-center gap-3">
        <Icon name="clock" size={22} />
        <h2 className="text-xl font-extrabold text-ink">
          {archived ? "Votre dernière commande" : "Votre commande est enregistrée"}
        </h2>
      </div>
      <p className="text-sm leading-relaxed text-mut">
        {attempt.receipt.number !== undefined ? `Commande n° ${attempt.receipt.number}. ` : ""}
        Retrouvez son état et, si nécessaire, reprenez son paiement. Aucun nouvel envoi n’est nécessaire.
      </p>
      <Link
        href={customerTrackingHref(attempt.receipt.orderId, attempt.receipt.trackingToken, attempt, observedAt)}
        target={embed ? "_blank" : undefined}
        rel={embed ? "noopener noreferrer" : undefined}
        prefetch={false}
        className="flex min-h-[52px] items-center justify-center gap-2 rounded-pill bg-accent px-5 text-center text-[15px] font-extrabold text-onaccent transition-transform duration-fast ease-sm active:scale-[0.97] motion-reduce:transform-none"
      >Suivre ma commande <Icon name="arrow" size={16} /></Link>
      {!archived && <GhostAction disabled={busy} onClick={onNew}>Préparer une nouvelle commande</GhostAction>}
      <p className="text-xs leading-relaxed text-mut">Ce lien reste sur cet appareil. Ne le partagez qu’avec une personne de confiance.</p>
    </section>
  );
  if (attempt.state === "rejected") return (
    <section className="flex flex-col gap-4 rounded-card border border-ink/10 bg-card p-5">
      <h2 className="text-xl font-extrabold text-ink">Votre demande peut être modifiée</h2>
      <p className="text-sm leading-relaxed text-mut">{attempt.rejection.message}</p>
      <p className="text-sm leading-relaxed text-mut">Le serveur a confirmé la fermeture de cette tentative. Votre panier est conservé : vous pouvez le corriger et choisir un nouveau créneau.</p>
      <PrimaryAction disabled={busy} loading={busy} onClick={onNew}>Revenir à mon panier</PrimaryAction>
    </section>
  );
  return (
    <section className="flex flex-col gap-4 rounded-card border border-ink/10 bg-card p-5">
      <h2 className="text-xl font-extrabold text-ink">Vérifions votre commande</h2>
      <p className="text-sm leading-relaxed text-mut">Votre demande est sauvegardée sur cet appareil. Nous devons retrouver la réponse du restaurant avant de la modifier.</p>
      <div className="rounded-card bg-ink/5 px-4 py-3 text-sm text-ink">
        <span className="font-bold">{attempt.payload.fulfillment === "delivery" ? "Livraison" : "Retrait"}</span>
        {" · "}{hhmm(attempt.payload.pickup.slot)}{" · "}
        {attempt.payload.lines.reduce((sum, line) => sum + line.qty, 0)} article(s)
        <p className="mt-1 text-mut">{attempt.payload.payment.method === "online" ? "Paiement en ligne demandé, non confirmé" : "Paiement au comptoir demandé"}</p>
      </div>
      <PrimaryAction disabled={busy} loading={busy} onClick={onRecover}>Retrouver ma commande</PrimaryAction>
      <GhostAction disabled={busy || !resendReady} onClick={onResend}>Réessayer cet envoi</GhostAction>
      <p className="text-xs leading-relaxed text-mut">Le même panier, le même créneau et la même référence seront réutilisés. La vérification de sécurité ci-dessous est nécessaire pour réessayer l’envoi.</p>
      <div className="border-t border-ink/10 pt-3">
        {confirming ? <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-mut">Nous allons demander la fermeture de cette tentative. Si le restaurant a déjà accepté la commande, elle sera conservée et son suivi vous sera proposé. Aucun paiement ni commande acceptée ne sera annulé ici.</p>
          <PrimaryAction disabled={busy} loading={busy} onClick={() => { setConfirming(false); onAbandon(); }}>Fermer cette tentative</PrimaryAction>
          <GhostAction disabled={busy} onClick={() => setConfirming(false)}>Garder cette demande</GhostAction>
        </div> : <GhostAction disabled={busy} onClick={() => setConfirming(true)}>Modifier ma demande</GhostAction>}
      </div>
    </section>
  );
}
