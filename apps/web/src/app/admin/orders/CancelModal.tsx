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
}: {
  /** Commande visée — null : modale fermée. */
  order: Order | null;
  onClose: () => void;
  /** Appelé avec la commande annulée renvoyée par l'API. */
  onCancelled: (updated: Order) => void;
}) {
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Champs remis à zéro à chaque nouvelle cible (le PIN ne persiste jamais).
  useEffect(() => {
    setPin("");
    setReason("");
    setSubmitting(false);
  }, [order?._id]);

  const valid = PIN_RE.test(pin) && reason.trim().length > 0;

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!order || !valid || submitting) return;
    setSubmitting(true);
    try {
      const updated = await api.post<Order>(`/orders/${order._id}/cancel`, {
        pin,
        reason: reason.trim(),
      });
      toast(`Commande n°${order.number} annulée`, { icon: "check" });
      onCancelled(updated);
    } catch (err) {
      toast(
        err instanceof ApiError && err.status === 401
          ? "PIN incorrect — annulation refusée"
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
      onClose={onClose}
      destructive
      title={`Annuler la commande n°${order?.number ?? ""}`}
      footer={
        <>
          <Btn variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Retour
          </Btn>
          <Btn
            variant="ink"
            size="sm"
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
            sera annulée définitivement. L'opération est journalisée (NF525) —
            saisissez votre PIN pour confirmer.
          </p>
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
            label="PIN staff"
            htmlFor="cancel-pin"
            hint="4 à 6 chiffres — jamais mémorisé."
          >
            <Input
              id="cancel-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
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
