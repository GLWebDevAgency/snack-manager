"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DeliveryMissionView, DeliverySessionView } from "@sm/contracts";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { createDeliveryMissionsClient } from "./delivery-missions-client";

export function missionStatus(mission: DeliveryMissionView) {
  if (mission.orderStatus === "cancelled") return "Annulée";
  if (mission.orderStatus === "delivered") return "Terminée";
  if (mission.dispatchedAt) return "En route";
  if (!mission.paymentReady) return "Paiement à vérifier";
  return mission.orderStatus === "ready" ? "Prête à récupérer" : "En préparation";
}
export function missionTime(at: string | null) {
  return at ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(at)) : "Créneau non indiqué";
}
export function MissionAddress({ mission }: { mission: DeliveryMissionView }) {
  return <address className="break-words text-sm not-italic leading-6 text-ink">{mission.address.line1}
    {mission.address.line2 && <><br />{mission.address.line2}</>}<br />{mission.address.postalCode} {mission.address.city}</address>;
}

export function DeliveryMissions({ session, available, onRevoked }: {
  session: DeliverySessionView; available: boolean; onRevoked: () => void;
}) {
  const [client] = useState(() => createDeliveryMissionsClient({
    scope: `driver:${session.restaurantSlug}:${session.operatorId}`, operatorId: session.operatorId, revoked: onRevoked,
  }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = state.missions.find(mission => mission.id === selectedId) ?? null;
  const disabled = !available || state.loading || state.busy || state.stale;
  const selectedPending = state.operations.some(operation => operation.missionId === selectedId);

  useEffect(() => {
    if (!available) { client.pause(); return; }
    void client.start();
    const refresh = () => { if (document.visibilityState === "visible") void client.refresh(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [available, client]);
  useEffect(() => () => client.stop(), [client]);

  async function inspect(id: string) {
    const current = await client.inspect(id);
    if (current) setSelectedId(current.id);
  }

  return <section className="mt-6 border-t border-line pt-5" aria-labelledby="delivery-missions-title" aria-busy={state.loading || state.busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mut">Votre tournée</p>
        <h2 id="delivery-missions-title" className="mt-1 text-2xl font-semibold tracking-[-0.04em]">Mes missions {state.loaded && <span className="text-mut">· {state.missions.length}{state.nextCursor ? "+" : ""}</span>}</h2></div>
      <Btn variant="ghost" size="sm" className="min-h-11" disabled={!available || state.loading || state.busy} onClick={() => void client.refresh()}>Actualiser les missions</Btn>
    </div>
    <p className="mt-3 text-xs leading-5 text-mut">Seules les commandes qui vous sont confiées apparaissent ici. Confirmez le départ après avoir récupéré les sacs au restaurant.</p>
    {state.message && <p role={state.tone === "warning" ? "alert" : "status"} className={`mt-4 rounded-card border p-3 text-sm leading-6 ${state.tone === "warning" ? "border-prep/30 bg-prep/8 text-prept" : "border-ok/25 bg-ok/5 text-okt"}`}>{state.message}</p>}
    {!available && <p role="status" className="sr-only">Accès à vérifier : aucun départ n’est autorisé pour le moment.</p>}
    {state.operations.map((operation, index) => <Card key={operation.missionId} className="mt-4 p-4">
      <h3 className="text-sm font-bold">Un départ reste à vérifier</h3>
      <p className="mt-2 text-sm leading-6 text-mut">La réponse de cette mission n’est pas confirmée. Reprenez la même vérification, sans confirmer un deuxième départ. Vos autres missions restent accessibles.</p>
      <Btn block className="mt-4 min-h-12 whitespace-normal" disabled={!available || state.loading || state.busy} onClick={() => void client.resume(operation.missionId)}>{state.busy ? "Vérification…" : `Vérifier le départ ${state.missions.find(mission => mission.id === operation.missionId) ? `n°${state.missions.find(mission => mission.id === operation.missionId)!.number}` : `en attente ${index + 1}`}`}</Btn>
    </Card>)}
    {!state.loaded && state.loading ? <div className="mt-5 space-y-3" aria-label="Chargement des missions"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      : state.loaded && state.missions.length === 0 ? <EmptyState className="mt-5 px-0" icon="truck" title="Aucune mission pour le moment" hint="Le restaurant vous attribuera vos prochaines livraisons. Actualisez pour vérifier." />
        : <div className="mt-5 space-y-6">{[false, true].map(dispatched => {
          const missions = state.missions.filter(mission => Boolean(mission.dispatchedAt) === dispatched);
          return missions.length > 0 && <section key={String(dispatched)} aria-label={dispatched ? "Missions en route" : "Missions à récupérer"}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-mut">{dispatched ? "En route" : "À récupérer"}</h3>
            <ul className="space-y-3">{missions.map(mission => <li key={mission.id}><Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="cf-fig text-xl font-bold tracking-[-0.03em]">Commande n°{mission.number}</p>
                <span className={`rounded-pill border px-2.5 py-1 text-xs font-semibold ${mission.canDispatch ? "border-ok/30 text-okt" : "border-line text-mut"}`}>{missionStatus(mission)}</span></div>
              <p className="mt-2 text-xs text-mut">Livraison prévue · {missionTime(mission.scheduledAt)}</p>
              <div className="mt-4"><MissionAddress mission={mission} /></div>
              <Btn block variant="ghost" iconRight="arrow" className="mt-4 min-h-12" disabled={disabled} onClick={() => void inspect(mission.id)}>Voir la mission n°{mission.number}</Btn>
            </Card></li>)}</ul>
          </section>;
        })}</div>}
    {state.nextCursor && <Btn block variant="ghost" className="mt-4 min-h-12" disabled={!available || state.loading || state.busy} onClick={() => void client.loadMore()}>Charger d’autres missions</Btn>}

    <Modal open={Boolean(selected)} title={selected ? `Mission n°${selected.number}` : "Mission"} onClose={() => { if (!state.busy) setSelectedId(null); }} footer={selected && <>
      <Btn variant="ghost" disabled={state.busy} onClick={() => setSelectedId(null)}>Fermer</Btn>
      {!selected.dispatchedAt && <Btn className="min-h-12 whitespace-normal" disabled={disabled || selectedPending || !selected.canDispatch} aria-busy={state.busy} onClick={() => void client.dispatch(selected.id)}>{state.busy ? "Confirmation…" : "Confirmer mon départ"}</Btn>}
    </>}>
      {selected && <>
        {state.message && !selectedPending && <p role={state.tone === "warning" ? "alert" : "status"} className={`mb-4 text-sm leading-6 ${state.tone === "warning" ? "text-prept" : "text-okt"}`}>{state.message}</p>}
        {selectedPending && <div className="mb-4 rounded-card border border-prep/30 bg-prep/5 p-3"><p role="alert" className="text-sm leading-6 text-prept">La réponse reste à vérifier. Reprenez la même action, sans confirmer un nouveau départ.</p><Btn block className="mt-3 min-h-12" disabled={!available || state.loading || state.busy} onClick={() => void client.resume(selected.id)}>Vérifier ce départ</Btn></div>}
        <p className="text-sm font-bold text-accentink">{missionStatus(selected)}</p>
        <p className="mt-1 text-sm text-mut">Livraison prévue · {missionTime(selected.scheduledAt)}</p>
        <div className="mt-5"><p className="mb-1 font-semibold">{selected.customer.name || "Client"}</p><MissionAddress mission={selected} /></div>
        {selected.customer.phone && <a className="cf-press mt-3 inline-flex min-h-12 items-center gap-2 rounded-pill border border-line px-4 text-sm font-semibold" href={`tel:${selected.customer.phone.replace(/[^+\d]/g, "")}`}><Icon name="phone" size={16} />Appeler le client</a>}
        {selected.instructions && <p className="mt-4 rounded-card border border-prep/25 bg-prep/5 p-3 text-sm leading-6 text-prept">{selected.instructions}</p>}
        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.1em] text-mut">À récupérer</h3>
        <ul className="space-y-2 text-sm">{selected.items.map((item, index) => <li key={index} className="flex gap-2"><span className="cf-fig font-bold">{item.qty}×</span><span>{item.name}{item.variantName ? ` · ${item.variantName}` : ""}</span></li>)}</ul>
        <p className="mt-5 border-t border-line pt-4 text-sm leading-6 text-mut">{selected.dispatchedAt ? "Départ enregistré. Pour confirmer la remise ou signaler un incident, contactez le restaurant." : selected.canDispatch ? "En confirmant, vous indiquez avoir récupéré cette commande et démarrer sa livraison. Le client verra qu’elle est en route." : !selected.paymentReady ? "Le paiement doit être confirmé par le restaurant avant le départ." : selected.orderStatus !== "ready" ? "Attendez que la cuisine ait terminé la préparation avant de récupérer la commande." : "L’accès ou l’affectation doit être vérifié avec le restaurant avant le départ."}</p>
      </>}
    </Modal>
  </section>;
}
