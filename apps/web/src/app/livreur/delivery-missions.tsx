"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { DeliveryMissionView, DeliverySessionView } from "@sm/contracts";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { SMTabBar, SMTabBarSpacer, useSMTabTransition } from "@/components/ui/SMTabBar";
import { DeliveryDialog, DeliveryPowered, deliveryInitials } from "./delivery-presentation";
import { deliveryNavigationUrl, deliverySmsUrl, useDeliveryWakeLock, useDeliveryPreferences } from "./delivery-preferences";
import { DeliveryHistory, deliveryMoney } from "./DeliveryHistory";
import { Skeleton } from "@/components/ui/Skeleton";
import { createDeliveryMissionsClient } from "./delivery-missions-client";
import { DeliveryHandoffPanel } from "@/components/delivery-handoff/Panel";
import { DeliveryHandoffRecoveries } from "@/components/delivery-handoff/Recoveries";

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

export function DeliveryMissions({ session, available, onRevoked, tab = "tour", onTab = () => {}, appearance, account, accountIdentity }: {
  session: DeliverySessionView; available: boolean; onRevoked: () => void;
  tab?: string; onTab?: (tab: string) => void; appearance: ReturnType<typeof useDeliveryPreferences>; account: ReactNode; accountIdentity?: ReactNode;
}) {
  const [client] = useState(() => createDeliveryMissionsClient({
    scope: `driver:${session.restaurantSlug}:${session.operatorId}`, operatorId: session.operatorId, revoked: onRevoked,
  }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const [filter, setFilter] = useState("todo");
  const [handing, setHanding] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const handoffTerminal = useCallback((status: "delivered" | "cancelled") => {
    setHandoffNotice(status === "delivered" ? "Remise confirmée sur le serveur. La mission terminée quitte votre tournée." : "Le serveur indique que cette commande est annulée. Ne la remettez pas au client.");
  }, []);
  const handoffBusyRef = useRef(false);
  const selected = state.missions.find(mission => mission.id === selectedId) ?? null;
  const disabled = !available || state.loading || state.busy || state.stale || handoffBusy;
  const selectedPending = state.operations.some(operation => operation.missionId === selectedId);

  useEffect(() => {
    if (!available) { client.pause(); return; }
    void client.start();
    const refresh = () => { if (document.visibilityState === "visible" && !handoffBusyRef.current) void client.refresh(); };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [available, client]);
  useEffect(() => () => client.stop(), [client]);

  async function inspect(id: string) {
    const current = await client.inspect(id);
    if (current) { setHandoffNotice(null); setHanding(false); setSelectedId(current.id); }
  }

  const { preferences, update, alert, alertMessage, theme } = appearance;
  const todo = state.missions.filter(mission => !mission.dispatchedAt);
  const route = state.missions.filter(mission => mission.dispatchedAt);
  const ready = todo.filter(mission => mission.canDispatch).length;
  const late = state.missions.filter(mission => missionTone(mission, now) === "late").length;
  const visible = filter === "route" ? route : [...todo].sort((a, b) => Number(b.canDispatch) - Number(a.canDispatch) || (a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity) - (b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity));
  const wakeStatus = useDeliveryWakeLock(preferences.wake && available && route.length > 0);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!state.loaded || state.stale || state.loading || !available) return;
    const ids = new Set(state.missions.map(mission => mission.id));
    const fresh = seen.current && [...ids].some(id => !seen.current!.has(id));
    seen.current = ids;
    if (fresh && preferences.alerts) void alert();
  }, [state.loaded, state.stale, state.loading, state.missions, available, preferences.alerts, alert]);
  const { selectTab, contentProps } = useSMTabTransition({ activeKey: tab, onSelect: onTab });
  function closeMission() { if (!state.busy && !handoffBusyRef.current) { setHanding(false); setSelectedId(null); } }
  function closeHandoff() { if (!handoffBusyRef.current) setHanding(false); }
  const next = route.find(mission => mission.id !== selectedId);
  const why = selected ? selected.canDispatch ? "En confirmant, vous indiquez avoir récupéré cette commande et démarrer sa livraison. Le client verra qu’elle est en route."
    : !selected.paymentReady ? "Le paiement doit être confirmé par le restaurant avant le départ."
      : selected.orderStatus !== "ready" ? "Attendez que la cuisine ait terminé la préparation avant de récupérer la commande."
        : "L’accès ou l’affectation doit être vérifié avec le restaurant avant le départ." : "";

  return <>
    <div className="lv-recoveries">
      <DeliveryHandoffRecoveries scope={`driver:${session.restaurantSlug}:${session.operatorId}`} available={available} selectedMission={selected?.id ?? null} onRevoked={onRevoked} />
      {state.operations.map((operation, index) => <Card key={operation.missionId} className="m-4 p-4">
        <h3 className="text-sm font-bold">Un départ reste à vérifier</h3>
        <p className="mt-2 text-sm leading-6 text-mut">La réponse de cette mission n’est pas confirmée. Reprenez la même vérification, sans confirmer un deuxième départ. Vos autres missions restent accessibles.</p>
        <Btn block className="mt-4 whitespace-normal" disabled={!available || state.loading || state.busy} onClick={() => void client.resume(operation.missionId)}>{state.busy ? "Vérification…" : `Vérifier le départ ${state.missions.find(mission => mission.id === operation.missionId) ? `n°${state.missions.find(mission => mission.id === operation.missionId)!.number}` : `en attente ${index + 1}`}`}</Btn>
      </Card>)}
    </div>
    <div {...contentProps}>
      <section className="lv-page" hidden={tab !== "tour"} aria-labelledby="delivery-missions-title" aria-busy={state.loading || state.busy}>
        <h2 id="delivery-missions-title" className="lv-missions-heading">Mes missions {state.loaded && `· ${state.missions.length}${state.nextCursor ? "+" : ""}`}</h2>
        <div className="lv-tour"><div className={`lv-stat${ready ? " hot" : ""}`}><b>{state.loaded ? ready : "—"}</b><span>Prêtes à partir</span></div><div className="lv-stat"><b>{state.loaded ? route.length : "—"}</b><span>En route</span></div><div className={`lv-stat${late ? " late" : ""}`}><b>{state.loaded ? late : "—"}</b><span>En retard</span></div></div>
        {state.nextCursor && <p className="lv-copy">Compteurs des missions affichées. Chargez la suite pour voir toute la tournée.</p>}
        <div className="lv-tabs" aria-label="Filtrer la tournée"><button type="button" aria-pressed={filter === "todo"} onClick={() => setFilter("todo")}>À récupérer<span className="lv-count">{todo.length}</span></button><button type="button" aria-pressed={filter === "route"} onClick={() => setFilter("route")}>En route<span className="lv-count">{route.length}</span></button></div>
        {state.message && <p role={state.tone === "warning" ? "alert" : "status"} className={`lv-msg ${state.tone === "warning" ? "warn" : "ok"}`}>{state.message}</p>}
        {handoffNotice && <p role="status" className="lv-msg">{handoffNotice}</p>}
        {!available && <p role="status" className="sr-only">Accès à vérifier : aucun départ n’est autorisé pour le moment.</p>}
        {!state.loaded && state.loading ? <div className="space-y-3" aria-label="Chargement des missions"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          : state.loaded && !visible.length ? <div className="lv-empty"><span><Icon name="truck" size={26} /></span><b>{filter === "todo" ? "Rien à récupérer" : "Aucune commande en route"}</b><p>{filter === "todo" ? "Le restaurant vous attribuera vos prochaines livraisons. La liste se met à jour toute seule." : "Confirmez un départ depuis « À récupérer » après avoir pris les sacs."}</p></div>
            : <ul className="lv-mlist">{visible.map(mission => <li key={mission.id}><MissionCard mission={mission} now={now} disabled={disabled} onOpen={() => void inspect(mission.id)} /></li>)}</ul>}
        {state.nextCursor && <Btn block variant="ghost" disabled={!available || state.loading || state.busy} onClick={() => void client.loadMore()}>Charger d’autres missions</Btn>}
        <Btn block variant="ghost" disabled={!available || state.loading || state.busy} onClick={() => void client.refresh()}>Actualiser les missions</Btn>
        <DeliveryPowered />
      </section>
      <section className="lv-page" hidden={tab !== "map"} aria-labelledby="lv-map-title">
        <h2 id="lv-map-title" className="lv-section-title">Votre parcours</h2><p className="lv-copy">Vos arrêts et leurs adresses. Ouvrez votre application de navigation pour calculer un itinéraire réel.</p>
        {session.restaurantAddress && <div className="lv-route-stop"><span className="lv-route-marker"><Icon name="home" size={20} /></span><div><b>{session.restaurantName}</b><p>{session.restaurantAddress}</p><a href={deliveryNavigationUrl(session.restaurantAddress, preferences.navigation)} target="_blank" rel="noreferrer" className="lv-map-link">Revenir au restaurant<Icon name="arrow" size={14} /></a></div></div>}
        {route.length === 0 && <p className="lv-msg">Aucune mission en route. Vos départs confirmés apparaîtront ici.</p>}
        <ol className="lv-route-list">{route.map((mission, index) => <li key={mission.id} className="lv-route-stop"><span className="lv-route-marker">{index + 1}</span><div><b>N°{mission.number} · {mission.customer.name || "Client"}</b><MissionAddress mission={mission} /><div className="lv-route-actions"><a href={deliveryNavigationUrl(mission.address, preferences.navigation)} target="_blank" rel="noreferrer" className="lv-map-link">Itinéraire<Icon name="arrow" size={14} /></a><button type="button" className="lv-map-link" disabled={disabled} onClick={() => void inspect(mission.id)}>Voir la mission</button></div></div></li>)}</ol>
        <p className="lv-fine">Les arrêts suivent l’ordre des missions affichées. Ce schéma n’est pas géographique : aucune distance ni optimisation du trajet n’est présumée.</p>
        {state.nextCursor && <Btn block variant="ghost" disabled={!available || state.loading || state.busy} onClick={() => void client.loadMore()}>Charger d’autres missions</Btn>}
      </section>
      <DeliveryHistory operatorId={session.operatorId} available={available} active={tab === "history"} onRevoked={onRevoked} />
      <section className="lv-page lv-account" hidden={tab !== "account"} aria-labelledby="lv-account-title">
        <h2 id="lv-account-title">Mon compte</h2>{accountIdentity}
        <h3 className="lv-group">Affichage</h3><div className="lv-tabs" aria-label="Thème de l’application">{(["dark", "light", "auto"] as const).map(value => <button type="button" key={value} aria-pressed={preferences.theme === value} onClick={() => update({ theme: value })}>{value === "dark" ? "Sombre" : value === "light" ? "Clair" : "Système"}</button>)}</div>
        <p className="lv-fine">Le mode Système suit le réglage clair ou sombre du téléphone.</p>
        <h3 className="lv-group">En tournée</h3>
        <label className="lv-setting"><span><b>Alerte nouvelle mission</b><small>Son et vibration lorsque l’application est ouverte</small></span><input type="checkbox" role="switch" checked={preferences.alerts} onChange={event => { update({ alerts: event.target.checked }); if (event.target.checked) void alert(true); }} /></label>
        {preferences.alerts && <><Btn block variant="ghost" onClick={() => void alert(true)}>Tester l’alerte</Btn>{alertMessage && <p className="lv-fine" role="status">{alertMessage}</p>}</>}
        <label className="lv-setting"><span><b>Application de navigation</b><small>Les adresses s’ouvrent après votre appui</small></span><select aria-label="Application de navigation" value={preferences.navigation} onChange={event => update({ navigation: event.target.value as typeof preferences.navigation })}><option value="google">Google Maps</option><option value="apple">Plans</option><option value="waze">Waze</option></select></label>
        <label className="lv-setting"><span><b>Écran toujours allumé</b><small>{wakeStatus}</small></span><input type="checkbox" role="switch" checked={preferences.wake} onChange={event => update({ wake: event.target.checked })} /></label>
        {session.restaurantPhones?.[0] && <a className="lv-action" href={`tel:${session.restaurantPhones[0].replace(/[^+\d]/g, "")}`}><Icon name="phone" size={18} />Appeler le restaurant</a>}
        <h3 className="lv-group">Accès et installation</h3>{account}
        <DeliveryPowered />
      </section>
      <SMTabBarSpacer />
    </div>
    <div className="lv-navigation"><SMTabBar items={[{ key: "tour", label: "Tournée", icon: color => <Icon name="truck" size={23} style={{ color }} />, badge: ready || undefined }, { key: "map", label: "Carte", icon: color => <Icon name="pin" size={23} style={{ color }} /> }, { key: "history", label: "Historique", icon: color => <Icon name="clock" size={23} style={{ color }} /> }, { key: "account", label: "Compte", icon: color => <Icon name="user" size={23} style={{ color }} /> }]} activeKey={tab} onSelect={selectTab} theme={theme} minimizable={!selected} hidden={Boolean(selected)} ariaLabel="Navigation livreur" /></div>
    <DeliveryDialog open={Boolean(selected)} title={selected ? `Mission n°${selected.number}` : "Mission"} onClose={closeMission} closeDisabled={state.busy || handoffBusy} footer={selected && <>
      {!selected.dispatchedAt && <p className="lv-why"><Icon name={selected.canDispatch ? "check" : "alert"} size={15} />{why}</p>}
      {!selected.dispatchedAt ? <button type="button" className="lv-cta" disabled={disabled || selectedPending || !selected.canDispatch} aria-busy={state.busy} onClick={() => void client.dispatch(selected.id)}><Icon name="truck" size={20} />{state.busy ? "Confirmation…" : "Confirmer mon départ"}</button>
        : <button type="button" className="lv-cta done" disabled={!available || state.busy || handoffBusy} onClick={() => setHanding(true)}><Icon name="check" size={20} />Remettre au client</button>}
      <button type="button" className="lv-close-text" disabled={state.busy || handoffBusy} onClick={closeMission}>Fermer</button>
    </>}>
      {selected && <>
        <div className="lv-hero"><span className="lv-number"><small>COMMANDE</small><b>{selected.number}</b></span><div className="lv-hero-status"><span className={`lv-status ${missionTone(selected, now)}`}>{missionStatus(selected)}</span><span className="lv-eta">{missionEta(selected, now)}</span></div></div>
        {state.message && !selectedPending && <p role={state.tone === "warning" ? "alert" : "status"} className={`lv-msg ${state.tone === "warning" ? "warn" : "ok"}`}>{state.message}</p>}
        {selectedPending && <div className="lv-msg warn"><div><p role="alert">La réponse reste à vérifier. Reprenez la même action, sans confirmer un nouveau départ.</p><Btn block className="mt-3" disabled={!available || state.loading || state.busy} onClick={() => void client.resume(selected.id)}>Vérifier ce départ</Btn></div></div>}
        <section className="lv-block"><h3 className="lv-block-head">Adresse</h3><div className="lv-block-body"><address className="lv-address lv-address-big">{selected.address.line1}<small>{[selected.address.line2, `${selected.address.postalCode} ${selected.address.city}`].filter(Boolean).join(" · ")}</small></address>
          <div className="lv-actions"><a className="lv-action primary" href={deliveryNavigationUrl(selected.address, preferences.navigation)} target="_blank" rel="noreferrer"><Icon name="navigation" size={18} />Itinéraire</a><a className="lv-action" href={deliveryNavigationUrl(selected.address, "waze")} target="_blank" rel="noreferrer"><Icon name="route" size={18} />Waze</a></div>
          {selected.instructions && <p className="lv-instructions"><small>Consigne du client</small>{selected.instructions}</p>}
        </div></section>
        <section className="lv-block"><h3 className="lv-block-head">Client</h3><div className="lv-block-body"><div className="lv-customer"><span className="lv-avatar">{deliveryInitials(selected.customer.name || "Client")}</span><div className="lv-customer-info"><b>{selected.customer.name || "Client"}</b><small>{selected.customer.phone || "Téléphone non fourni"}</small></div>{selected.customer.phone && <a className="lv-call" href={`tel:${selected.customer.phone.replace(/[^+\d]/g, "")}`} aria-label="Appeler le client"><Icon name="phone" size={20} /></a>}</div>
          {selected.customer.phone && <div className="lv-actions"><a className="lv-action" href={deliverySmsUrl(selected.customer.phone, `Bonjour, votre commande ${session.restaurantName} n°${selected.number} arrive dans quelques minutes.`)}><Icon name="message" size={16} />« J’arrive »</a><a className="lv-action" href={deliverySmsUrl(selected.customer.phone, `Bonjour, je suis devant chez vous avec votre commande ${session.restaurantName} n°${selected.number}.`)}><Icon name="home" size={16} />« Je suis là »</a></div>}
        </div></section>
        <section className="lv-block"><h3 className="lv-block-head">À récupérer<span>{selected.items.reduce((sum, item) => sum + item.qty, 0)} articles</span></h3><div className="lv-block-body"><ul className="lv-items">{selected.items.map((item, index) => <li key={index}><b>{item.qty}×</b><span>{item.name}{item.variantName && <span className="lv-variant">{item.variantName}</span>}</span></li>)}</ul><p className="lv-bags"><Icon name="bag" size={16} />Vérifiez les sacs et les boissons avant de partir.</p></div></section>
        <section className="lv-block"><h3 className="lv-block-head">Paiement</h3><div className="lv-block-body"><div className={`lv-payment${!selected.paymentReady ? " blocked" : ""}`}><span><Icon name={selected.paymentReady ? "check" : "alert"} size={18} /></span><div><b>{!selected.paymentReady ? "Paiement à vérifier" : selected.paymentSummary?.method === "online" ? "Payée en ligne" : "Paiement confirmé"}</b><small>{selected.paymentReady ? "Rien à encaisser" : "Le restaurant doit confirmer avant le départ"}</small></div>{selected.paymentSummary && <strong className="lv-payment-total">{deliveryMoney(selected.paymentSummary.totalCents)}</strong>}</div></div></section>
        {selected.dispatchedAt && <DeliveryDialog open={handing} sheet title={`Remise au client · n°${selected.number}`} onClose={closeHandoff} closeDisabled={handoffBusy}>
          <DeliveryHandoffPanel driver key={`${session.operatorId}:${selected.id}`} missionId={selected.id} scope={`driver:${session.restaurantSlug}:${session.operatorId}`} path={`/livreur/missions/${selected.id}/handoff`}
            available={handing && available && !state.loading && !state.busy && !state.stale} onRevoked={onRevoked}
            onBusyChange={busy => { handoffBusyRef.current = busy; setHandoffBusy(busy); }} onTerminal={handoffTerminal}
            onComplete={() => { setHanding(false); setSelectedId(null); void client.refresh(); }} />
          {handoffNotice?.startsWith("Remise confirmée") && next && <button type="button" className="lv-next" disabled={state.busy || handoffBusy} onClick={() => void inspect(next.id)}><span className="lv-label">Prochaine mission en route</span><b>N°{next.number} · {next.address.line1}</b><span>{missionTime(next.scheduledAt)}</span></button>}
        </DeliveryDialog>}
      </>}
    </DeliveryDialog>
  </>;
}

function missionTone(mission: DeliveryMissionView, now: number) {
  if (mission.dispatchedAt) return "route";
  if (!mission.paymentReady) return "blocked";
  if (mission.orderStatus === "ready" && mission.scheduledAt && Date.parse(mission.scheduledAt) < now - 300_000) return "late";
  return mission.orderStatus === "ready" ? "ready" : "prep";
}
function missionEta(mission: DeliveryMissionView, now: number) {
  if (!mission.scheduledAt) return "Créneau non indiqué";
  const minutes = Math.ceil((Date.parse(mission.scheduledAt) - now) / 60_000);
  if (missionTone(mission, now) === "late") return `En retard de ${Math.abs(minutes)} min`;
  if (minutes > 0 && minutes < 120) return `Dans ${minutes} min · ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(mission.scheduledAt))}`;
  return `Prévue ${missionTime(mission.scheduledAt)}`;
}
function MissionCard({ mission, now, disabled, onOpen }: { mission: DeliveryMissionView; now: number; disabled: boolean; onOpen: () => void }) {
  const tone = missionTone(mission, now);
  return <button type="button" className={`lv-mcard ${tone}`} aria-label={`Voir la mission n°${mission.number}`} disabled={disabled} onClick={onOpen}>
    <span className="lv-rail" aria-hidden /><span className="lv-mh"><span className="lv-number"><small>N°</small><b>{mission.number}</b></span><span className="lv-mmeta"><span className={`lv-status ${tone}`}><Icon name={tone === "route" ? "truck" : tone === "blocked" ? "alert" : tone === "ready" ? "bag" : "clock"} size={14} />{missionStatus(mission)}</span><span className="lv-eta">{missionEta(mission, now)}</span></span><Icon name="arrow" size={20} /></span>
    <span className="lv-card-address"><Icon name="pin" size={16} /><span>{mission.address.line1}<small>{[mission.address.line2, `${mission.address.postalCode} ${mission.address.city}`].filter(Boolean).join(" · ")}</small></span></span>
    <span className="lv-mf"><span className="lv-chip"><Icon name="bag" size={12} />{mission.items.reduce((sum, item) => sum + item.qty, 0)} articles</span>{mission.paymentReady && <span className="lv-chip ok"><Icon name="check" size={12} />{mission.paymentSummary?.method === "online" ? "Payée en ligne" : "Paiement confirmé"}</span>}{mission.instructions && <span className="lv-chip warn"><Icon name="message" size={12} />Consigne</span>}</span>
  </button>;
}
