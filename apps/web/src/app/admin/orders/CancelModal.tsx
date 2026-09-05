"use client";

/**
 * Modale « Annuler la commande » (ajout production, traçabilité NF525) :
 * raison obligatoire + re-saisie du PIN staff, POST /orders/:id/cancel.
 * Modale destructive : fermeture explicite uniquement (croix ou Retour).
 */

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { Btn, Field, Input, Modal, useToast } from "@/components/ui";
import { customerName, type Order } from "./types";

const PIN_RE = /^\d{4,6}$/;

export function CancelModal({
  order,
  onClose,
  onCancelled,
  owner = false,
}: {
  /** Commande visée — null : modale fermée. */
  order: Order | null;
  onClose: () => void;
  /** Appelé avec la commande annulée renvoyée par l'API. */
  onCancelled: (updated: Order) => void;
  owner?: boolean;
}) {
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Erreur affichée en ligne sous le PIN (comme MovementModal) : un toast seul
  // se manque quand on regarde le clavier pour retaper le PIN.
  const [error, setError] = useState<string | null>(null);

  // Champs remis à zéro à chaque nouvelle cible (le PIN ne persiste jamais).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- PIN et motif sont saisis à la main : aucun rendu ne peut les recalculer. Sans cette remise à zéro, le PIN tapé pour annuler la commande A resterait pré-rempli à l'ouverture de la commande B — une annulation définitive de la mauvaise commande, journalisée NF525, à un clic.
    setPin("");
    setReason("");
    setSubmitting(false);
    setError(null);
  }, [order?._id]);

  // La MÊME borne que l'API (`OrderCancelSchema`) : « x » passait cet écran et
  // se faisait refuser côté serveur, ce qui fait chercher la faute au PIN.
  const valid = (owner ? pin.length > 0 : PIN_RE.test(pin)) && reason.trim().length >= 3;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!order || !valid || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.post<Order>(`/orders/${order._id}/${owner ? "cancel-owner" : "cancel"}`, {
        ...(owner ? { password: pin } : { pin }),
        reason: reason.trim(),
      });
      toast(`Commande n°${order.number} annulée`, { icon: "check" });
      onCancelled(updated);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? `${owner ? "Mot de passe" : "PIN"} incorrect — annulation refusée`
          : err instanceof Error
            ? err.message
            : "Échec de l'annulation — réessayez",
      );
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={order !== null}
      onClose={() => { if (!submitting) onClose(); }}
      destructive
      title={`Annuler la commande n°${order?.number ?? ""}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Retour
          </Btn>
          <Btn
            size="sm"
            // Rouge fonctionnel : annulation définitive, journalisée NF525 —
            // jamais l'accent tenant (même motif que la suppression de catégorie).
            style={{ background: "var(--cf-red)", color: "var(--cf-text)" }}
            onClick={() => void submit()}
            disabled={!valid || submitting}
          >
            {submitting ? "Annulation…" : "Confirmer l'annulation"}
          </Btn>
        </>
      }
    >
      {order && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-mut">
            La commande de <strong className="text-ink">{customerName(order)}</strong>{" "}
            sera annulée définitivement. L’opération est journalisée (NF525) —
            saisissez votre {owner ? "mot de passe" : "PIN"} pour confirmer.
          </p>
          {order.payment.method === "online" && order.payment.status === "paid" && (
            <p className="rounded-ctrl bg-alert/10 p-3 text-sm text-alertt" role="note">
              Le paiement a déjà été encaissé. L’annulation ne rembourse pas le client : utilisez ensuite « Rembourser » dans la fiche commande.
            </p>
          )}
          <Field label="Raison de l'annulation" htmlFor="cancel-reason">
            <Input
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex. : client absent, erreur de saisie…"
              maxLength={200}
              disabled={submitting}
              autoFocus
            />
          </Field>
          <Field
            label={owner ? "Votre mot de passe" : "PIN staff"}
            htmlFor="cancel-pin"
            hint={owner ? "Le mot de passe de votre compte propriétaire." : "4 à 6 chiffres — jamais mémorisé."}
            error={error}
          >
            <Input
              id="cancel-pin"
              type="password"
              inputMode={owner ? undefined : "numeric"}
              autoComplete={owner ? "current-password" : "off"}
              pattern={owner ? undefined : "[0-9]*"}
              maxLength={owner ? 256 : 6}
              value={pin}
              onChange={(e) => setPin(owner ? e.target.value : e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              disabled={submitting}
              className="tabular-nums"
            />
          </Field>
          {/* Soumission Entrée depuis les champs */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
