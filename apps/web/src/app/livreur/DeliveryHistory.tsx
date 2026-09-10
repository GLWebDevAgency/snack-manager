"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeliveryHistoryViewSchema, type DeliveryHistoryView } from "@sm/contracts";
import { Btn } from "@/components/ui/Btn";
import { Icon } from "@/components/ui/icons";
import { missionRequest, MissionHttpError } from "./delivery-missions-operation";

export function deliveryMoney(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}
function historyTime(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso));
}

/** A separate read model; never merges completed missions into the active controller. */
export function DeliveryHistory({ operatorId, available, active, onRevoked }: {
  operatorId: string; available: boolean; active: boolean; onRevoked: () => void;
}) {
  const [data, setData] = useState<DeliveryHistoryView>({ missions: [], nextCursor: null });
  const [loading, setLoading] = useState(false); const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0); const busy = useRef(false); const snapshot = useRef(data);
  useLayoutEffect(() => { snapshot.current = data; }, [data]);
  const load = useCallback(async (more = false) => {
    if (!available || busy.current) return;
    busy.current = true; const run = ++generation.current; setLoading(true); setError(null);
    try {
      const cursor = more ? snapshot.current.nextCursor : null;
      const page = DeliveryHistoryViewSchema.parse(await missionRequest(`/livreur/history${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`));
      if (run !== generation.current) return;
      if (page.missions.some(mission => mission.operator?.id !== operatorId)) throw new Error("Cet historique ne correspond pas à votre accès.");
      setData(current => ({ missions: more ? [...new Map([...current.missions, ...page.missions].map(mission => [mission.id, mission])).values()] : page.missions, nextCursor: page.nextCursor }));
      setLoaded(true);
    } catch (cause) {
      if (run !== generation.current) return;
      if (cause instanceof MissionHttpError && cause.status === 401) { setData({ missions: [], nextCursor: null }); onRevoked(); return; }
      setError("L’historique n’a pas pu être vérifié. Réessayez lorsque la connexion est disponible.");
    } finally { if (run === generation.current) { busy.current = false; setLoading(false); } }
  }, [available, operatorId, onRevoked]);
  useEffect(() => {
    if (active && available) void load();
    // The generation is an async response counter, not a DOM ref. Invalidate the latest request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { generation.current++; busy.current = false; };
  }, [active, available, load]);
  return <section className="lv-page" hidden={!active} aria-labelledby="lv-history-title" aria-busy={loading}>
    <div className="lv-page-heading"><h2 id="lv-history-title">Historique</h2><Btn variant="ghost" size="sm" disabled={!available || loading} onClick={() => void load()}>Actualiser l’historique</Btn></div>
    <p className="lv-copy">Vos livraisons terminées, de la plus récente à la plus ancienne. L’heure de remise est confirmée par le restaurant.</p>
    {!available && <p className="lv-msg warn" role="status">Accès à vérifier. Les informations affichées peuvent avoir changé.</p>}
    {error && <p className="lv-msg warn" role="alert">{error}</p>}
    {loading && !loaded && <p role="status" className="lv-copy">Chargement de l’historique…</p>}
    {loaded && !data.missions.length && <div className="lv-empty"><span><Icon name="clock" size={26} /></span><b>Aucune livraison terminée</b><p>Les remises confirmées de vos missions apparaîtront ici.</p></div>}
    <ul className="lv-history-list">{data.missions.map(mission => <li key={mission.id} className="lv-block">
      <div className="lv-history-head"><b className="lv-history-number">N°{mission.number}</b><span className="lv-chip ok"><Icon name="check" size={12} />Livrée</span></div>
      <div className="lv-block-body"><p className="lv-history-customer">{mission.customer.name || "Client"}</p><address className="lv-address lv-copy">{mission.address.line1}<br />{mission.address.postalCode} {mission.address.city}</address><p className="lv-history-time">Remise le {historyTime(mission.deliveredAt)}</p>
        {mission.paymentSummary && <div className="lv-history-payment"><b>{deliveryMoney(mission.paymentSummary.totalCents)}</b><span>{mission.paymentSummary.method === "online" ? "Paiement en ligne" : "Paiement au comptoir"}{mission.paymentSummary.status === "refunded" ? " · remboursé" : ""}</span></div>}
      </div>
    </li>)}</ul>
    {data.nextCursor && <Btn block variant="ghost" disabled={!available || loading} onClick={() => void load(true)}>Charger les livraisons précédentes</Btn>}
  </section>;
}
