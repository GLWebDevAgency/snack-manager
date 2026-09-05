"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Btn, Field, Input, Modal } from "@/components/ui";
import type { Order } from "./types";

export function DispatchModal({ order, onClose, onDispatched }: {
  order: Order; onClose: () => void; onDispatched: (order: Order) => void;
}) {
  const [driverName, setDriverName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = !driverName.trim() || driverName.trim().length >= 2;
  async function dispatch() {
    if (!valid || pending) return;
    setPending(true);
    setError(null);
    try {
      const updated = await api.post<Order>(`/orders/${order._id}/dispatch`, driverName.trim() ? { driverName: driverName.trim() } : {});
      onDispatched(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de confirmer le départ.");
      setPending(false);
    }
  }
  return <Modal open title={`Confirmer le départ — n°${order.number}`} onClose={() => { if (!pending) onClose(); }}
    footer={<><Btn variant="ghost" disabled={pending} onClick={onClose}>Retour</Btn>
      <Btn disabled={!valid || pending} onClick={() => void dispatch()}>{pending ? "Confirmation…" : "Partie avec le livreur"}</Btn></>}>
    <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void dispatch(); }}>
      <p className="text-sm text-mut">Confirmez que le livreur a récupéré cette commande. Le client verra qu’elle est en route.</p>
      {order.delivery && <address className="text-sm not-italic text-ink">{order.delivery.address.line1}<br />
        {order.delivery.address.postalCode} {order.delivery.address.city}</address>}
      <Field label="Prénom du livreur (facultatif)" htmlFor="dispatch-driver"><Input id="dispatch-driver" autoFocus value={driverName}
        onChange={(e) => setDriverName(e.target.value)} maxLength={80} disabled={pending} /></Field>
      {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
    </form>
  </Modal>;
}
