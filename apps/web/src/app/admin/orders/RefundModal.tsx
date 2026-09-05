"use client";

import { useEffect, useState } from "react";
import type { OrderRefundSummary } from "@sm/contracts";
import { api } from "@/lib/api";
import { fmtEuro } from "@/lib/format";
import { Btn, Field, Input, Modal, useToast } from "@/components/ui";
import type { Order } from "./types";
import { refundAmountCents, refundAmountInput } from "./refund-amount";
import { hasOnlinePaymentToRefund } from "./refund-eligibility";

export function RefundModal({ order, onClose, onRefunded }: {
  order: Order; onClose: () => void; onRefunded: (order: Order) => void;
}) {
  const toast = useToast();
  const [summary, setSummary] = useState<OrderRefundSummary | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const cents = refundAmountCents(amount);
  const valid = hasOnlinePaymentToRefund(order.payment) && summary && cents !== null && cents <= summary.remainingCents && reason.trim().length >= 3 && password.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    void api.get<OrderRefundSummary>(`/orders/${order._id}/refunds`, { signal: controller.signal })
      .then((result) => { setSummary(result); setAmount(refundAmountInput(result.remainingCents)); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Impossible de vérifier le paiement."); });
    return () => controller.abort();
  }, [order._id]);

  async function submit() {
    if (!valid || submitting) return;
    const id = operationId ?? crypto.randomUUID();
    setOperationId(id);
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<OrderRefundSummary>(`/orders/${order._id}/refunds`, {
        amountCents: cents, reason: reason.trim(), password, operationId: id,
      });
      const updated = await api.get<Order>(`/orders/${order._id}`);
      toast(result.pendingRefundCents > 0 ? "Remboursement demandé — confirmation bancaire en attente" : "Remboursement confirmé", { icon: "check" });
      setPassword("");
      onRefunded(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "La réponse n’a pas été reçue. Réessayez : cette opération ne sera pas doublée.");
      setSubmitting(false);
    }
  }

  return <Modal open destructive title={`Rembourser la commande n°${order.number}`}
    onClose={() => { if (!submitting) onClose(); }} footer={<>
      <Btn variant="ghost" disabled={submitting} onClick={onClose}>Retour</Btn>
      <Btn disabled={!valid || submitting} onClick={() => void submit()}>
        {submitting ? "Demande en cours…" : operationId ? "Réessayer le remboursement" : "Confirmer le remboursement"}
      </Btn>
    </>}>
    <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="text-sm text-mut">Le montant est reversé sur le moyen de paiement d’origine. Ce geste ne change pas l’avancement de la commande.</p>
      {summary ? <div className="rounded-ctrl border border-line2 p-3 text-sm">
        <div className="flex justify-between"><span>Déjà remboursé</span><strong>{fmtEuro(summary.refundedCents)}</strong></div>
        {summary.pendingRefundCents > 0 && <div className="flex justify-between text-prept"><span>En attente</span><strong>{fmtEuro(summary.pendingRefundCents)}</strong></div>}
        <div className="mt-2 flex justify-between"><span>Disponible</span><strong>{fmtEuro(summary.remainingCents)}</strong></div>
      </div> : !error && <p role="status" className="text-sm text-mut">Vérification du paiement…</p>}
      <Field label="Montant à rembourser (€)" htmlFor="refund-amount"><Input id="refund-amount" inputMode="decimal" value={amount}
        onChange={(event) => setAmount(event.target.value)} disabled={!summary || !!operationId || submitting} maxLength={11} /></Field>
      <Field label="Motif" htmlFor="refund-reason"><Input id="refund-reason" value={reason} onChange={(event) => setReason(event.target.value)}
        placeholder="Ex. : un produit n’était plus disponible" disabled={!!operationId || submitting} maxLength={200} /></Field>
      <Field label="Votre mot de passe" htmlFor="refund-password"><Input id="refund-password" type="password" autoComplete="current-password"
        value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting} maxLength={256} /></Field>
      {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
      {summary?.remainingCents === 0 && <p className="text-sm text-mut">La totalité du paiement est déjà remboursée ou en cours de remboursement.</p>}
    </form>
  </Modal>;
}
