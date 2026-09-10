"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import type { DeliveryHandoffAction, DeliveryHandoffIncident, DeliveryHandoffProof, DeliveryHandoffState } from "@sm/contracts";
import { Icon } from "@/components/ui/icons";
import { Btn } from "@/components/ui/Btn";
import { Field, Input, Select } from "@/components/ui/fields";
import { Skeleton } from "@/components/ui/Skeleton";
import { createDeliveryHandoffClient, HANDOFF_INCIDENT_LABELS, type HandoffRequest } from "./client";
import { DeliveryHandoffScanner } from "./Scanner";

export function DeliveryHandoffPanel({ missionId, scope, path, available, manager = false, request, current, onRevoked, onBusyChange, onComplete, onTerminal, driver = false }: {
  missionId: string; scope: string; path: string; available: boolean; driver?: boolean; manager?: boolean; request?: HandoffRequest;
  current?: () => boolean; onRevoked?: () => void; onBusyChange?: (busy: boolean) => void; onComplete?: () => void;
  onTerminal?: (status: "delivered" | "cancelled") => void;
}) {
  const [client] = useState(() => createDeliveryHandoffClient({ missionId, scope, path, request, current, revoked: onRevoked, activity: onBusyChange }));
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getServerSnapshot);
  const terminal = state.view?.orderStatus === "delivered" || state.view?.orderStatus === "cancelled";
  useEffect(() => {
    if (!available) { client.pause(); return; }
    void client.start();
    const refresh = () => {
      const snapshot = client.getSnapshot();
      if (document.visibilityState === "visible" && !["delivered", "cancelled"].includes(snapshot.view?.orderStatus ?? "")) void client.refresh();
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [available, client]);
  useEffect(() => () => client.stop(), [client]);
  useEffect(() => {
    const status = state.view?.orderStatus;
    if (!state.pending && (status === "delivered" || status === "cancelled")) onTerminal?.(status);
  }, [onTerminal, state.pending, state.view?.orderStatus]);

  return <section className="lv-handoff mt-5 border-t border-line pt-5" aria-label="Remise au client" aria-busy={state.busy || state.loading}>
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-mut">Dernière étape</p>
    <h3 className="mt-1 text-lg font-semibold tracking-[-0.025em]">Remise au client</h3>
    {state.loading && !state.view && !state.pending && <Skeleton className="mt-4 h-28" />}
    {state.message && <p role={state.outcome === "applied" ? "status" : "alert"} className={`mt-4 rounded-card border p-3 text-sm leading-6 ${state.outcome === "applied" ? "border-ok/30 bg-ok/5 text-okt" : "border-prep/30 bg-prep/5 text-prept"}`}>{state.message}</p>}
    {!available && <p role="status" className="mt-3 text-sm text-prept">Accès à vérifier. Aucun geste n’est autorisé pour le moment.</p>}
    {state.pending ? <div className="mt-4 rounded-card border border-prep/30 bg-prep/5 p-4">
      <h4 className="font-semibold">Une action reste à vérifier</h4>
      <p className="mt-2 text-sm leading-6 text-mut">La commande peut déjà avoir été mise à jour. Vérifiez la même référence, sans recommencer la remise. Si l’action n’était pas arrivée, cette vérification la fermera sans l’appliquer.</p>
      <Btn block className="mt-4 min-h-12 whitespace-normal" disabled={!available || state.busy || state.loading} onClick={() => void client.resolve()}>{state.busy ? "Vérification…" : "Vérifier cette action"}</Btn>
    </div> : state.view && available && !terminal ? <HandoffForm key={`${state.view.revision}:${state.view.missionRevision}`} state={state.view} manager={manager} driver={driver}
      disabled={state.busy || state.loading || state.stale} onSubmit={(action, details) => client.act(action, details)} /> : null}
    {terminal && !state.pending && <div className={driver ? "lv-terminal" : "mt-4"}>{driver && state.view?.orderStatus === "delivered" && <><span className="lv-terminal-icon"><Icon name="check" size={46} /></span><h4>Remise confirmée</h4></>}<p className="text-sm leading-6 text-mut">{state.view?.orderStatus === "delivered" ? "La remise est enregistrée sur le serveur. Aucun nouveau code n’est nécessaire." : "Cette commande est annulée. Ne la remettez pas au client."}</p>
      {onComplete && <Btn block className="mt-4 min-h-12" disabled={state.busy} onClick={onComplete}>Retour aux commandes</Btn>}
    </div>}
    {!terminal && <Btn block variant="ghost" className="mt-4 min-h-11" disabled={!available || state.busy || state.loading} onClick={() => void client.refresh()}>Actualiser la remise</Btn>}
  </section>;
}

function HandoffForm({ state, manager, disabled, onSubmit, driver }: {
  state: DeliveryHandoffState; manager: boolean; disabled: boolean; driver: boolean;
  onSubmit: (action: DeliveryHandoffAction, details: unknown) => Promise<void>;
}) {
  const [action, setAction] = useState<DeliveryHandoffAction>("handoff");
  const [scannerMode, setScannerMode] = useState(false);
  const [scannerEpoch, setScannerEpoch] = useState(0);
  const closeScanner = useCallback(() => setScannerMode(false), []);
  return <div className="mt-4">
    {state.incident && <p role="status" className="mb-4 rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">Incident signalé : {HANDOFF_INCIDENT_LABELS[state.incident.code]}. Le restaurant doit décider de la suite ; ce signalement n’annule ni ne rembourse la commande.</p>}
    <div className={driver ? "lv-handoff-modes" : "flex flex-wrap gap-2"} aria-label="Action de remise">
      <Btn size="sm" aria-pressed={action === "handoff" && !scannerMode} variant={action === "handoff" && !scannerMode ? "ink" : "ghost"} className="min-h-11" disabled={disabled} onClick={() => { setAction("handoff"); setScannerMode(false); if (driver) setScannerEpoch(value => value + 1); }}>{driver ? "Code" : "Code du client"}</Btn>
      {driver && <Btn size="sm" aria-pressed={action === "handoff" && scannerMode} variant={scannerMode ? "ink" : "ghost"} disabled={disabled || !state.canHandoff} onClick={() => { setAction("handoff"); setScannerEpoch(value => value + 1); setScannerMode(true); }}>Scanner</Btn>}
      <Btn size="sm" aria-pressed={action === "incident"} variant={action === "incident" ? "ink" : "ghost"} className="min-h-11" disabled={disabled} onClick={() => { setAction("incident"); setScannerMode(false); }}>{driver ? "Incident" : "Signaler un incident"}</Btn>
    </div>
    {manager && (state.canOverride || state.canRotate) && <div className="mt-3 flex flex-wrap gap-2">
      {state.canOverride && <Btn size="sm" aria-pressed={action === "override"} variant={action === "override" ? "ink" : "ghost"} className="min-h-11" disabled={disabled} onClick={() => setAction("override")}>Remise exceptionnelle</Btn>}
      {state.canRotate && <Btn size="sm" aria-pressed={action === "rotate"} variant={action === "rotate" ? "ink" : "ghost"} className="min-h-11" disabled={disabled} onClick={() => setAction("rotate")}>Renouveler le code</Btn>}
    </div>}
    <HandoffActionForm key={`${action}:${scannerEpoch}`} action={action} state={state} disabled={disabled} onSubmit={onSubmit} driver={driver} scannerMode={driver ? scannerMode : undefined} onScannerClose={closeScanner} />
  </div>;
}

function HandoffActionForm({ action, state, disabled, onSubmit, driver, scannerMode, onScannerClose }: {
  action: DeliveryHandoffAction; state: DeliveryHandoffState; disabled: boolean; driver: boolean; scannerMode?: boolean; onScannerClose: () => void;
  onSubmit: (action: DeliveryHandoffAction, details: unknown) => Promise<void>;
}) {
  const [pin, setPin] = useState(""); const [qr, setQr] = useState<string | null>(null); const [localScanning, setScanning] = useState(false);
  const scanning = scannerMode ?? localScanning;
  const [code, setCode] = useState<DeliveryHandoffIncident["code"]>("customer_absent"); const [reason, setReason] = useState("");
  const readQr = useCallback((value: string) => { setQr(value); setScanning(false); setPin(""); onScannerClose(); }, [onScannerClose]);
  const allowed = action === "handoff" ? state.canHandoff && Boolean(qr || /^\d{6}$/.test(pin)) : action === "incident" ? true : action === "override" ? state.canOverride && reason.trim().length >= 10 : state.canRotate && reason.trim().length >= 10;
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled || !allowed) return;
    const details = action === "handoff" ? { proof: (qr ? { kind: "qr", value: qr } : { kind: "pin", value: pin }) as DeliveryHandoffProof }
      : action === "incident" ? { code } : { reason: reason.trim() };
    setPin(""); setQr(null); setReason(""); setScanning(false);
    await onSubmit(action, details);
  }
  return <form className="mt-4 space-y-4" onSubmit={event => void submit(event)}>
    {action === "handoff" ? <>
      <p className="text-sm leading-6 text-mut">Demandez le code affiché sur le suivi du client au moment de lui remettre sa commande. Ni sa carte fidélité ni son numéro de commande ne remplacent ce code.</p>
      {!state.canHandoff && <p role="status" className="text-sm leading-6 text-prept">{state.proof?.locked ? "Le code est bloqué. Signalez l’incident au restaurant." : "La remise par code n’est pas disponible. Actualisez ou signalez l’incident au restaurant."}</p>}
      {scanning && !disabled ? <DeliveryHandoffScanner missionId={state.missionId} proofId={state.proof?.id ?? null} onRead={readQr} onClose={() => { setScanning(false); onScannerClose(); }} /> : <>
        {qr ? <p role="status" className="rounded-card border border-line bg-bg p-3 text-sm">QR reconnu. La commande n’est pas encore déclarée livrée : confirmez sa remise ci-dessous.</p>
          : <Field label="Code de remise à six chiffres" htmlFor={`handoff-pin-${state.missionId}`}><div className={driver ? "lv-code-input" : undefined}>
            {driver && <div className="lv-code-cells" aria-hidden>{Array.from({ length: 6 }, (_, index) => <span key={index} className={index === pin.length ? "current" : ""}>{pin[index] ?? ""}</span>)}</div>}
            <Input id={`handoff-pin-${state.missionId}`} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} maxLength={6} value={pin} disabled={disabled || !state.canHandoff} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} className={driver ? "lv-pin-native" : "min-h-12 text-center font-mono text-2xl tracking-[0.25em]"} />
          </div>{driver && !state.proof?.locked && <div className="lv-numpad">{["1", "2", "3", "4", "5", "6", "7", "8", "9", "Effacer", "0", "⌫"].map(key => <button type="button" key={key} disabled={disabled || !state.canHandoff} aria-label={key === "⌫" ? "Effacer le dernier chiffre" : key === "Effacer" ? "Effacer le code" : key} className={key.length > 1 || key === "⌫" ? "fn" : undefined} onClick={() => setPin(current => key === "Effacer" ? "" : key === "⌫" ? current.slice(0, -1) : (current + key).slice(0, 6))}>{key}</button>)}</div>}</Field>}
        {!driver && <Btn block variant="ghost" className="min-h-12" disabled={disabled || !state.canHandoff} onClick={() => { setQr(null); setScanning(true); }}>Scanner le QR du client</Btn>}
      </>}
    </> : action === "incident" ? <>
      <p className="text-sm leading-6 text-mut">Décrivez la situation au restaurant sans déclarer la commande livrée. Aucun remboursement ni nouvelle livraison ne sera déclenché automatiquement.</p>
      {driver ? <div className="lv-incidents" role="group" aria-label="Que se passe-t-il ?">{Object.entries(HANDOFF_INCIDENT_LABELS).map(([value, label]) => <button type="button" key={value} aria-pressed={code === value} disabled={disabled} onClick={() => setCode(value as DeliveryHandoffIncident["code"])}><Icon name="alert" size={18} />{label}</button>)}</div>
        : <Field label="Que se passe-t-il ?" htmlFor={`handoff-incident-${state.missionId}`}><Select id={`handoff-incident-${state.missionId}`} value={code} disabled={disabled} onChange={event => setCode(event.target.value as DeliveryHandoffIncident["code"])}>{Object.entries(HANDOFF_INCIDENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>}
    </> : <>
      <p className="rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{action === "override" ? "Vous confirmez exceptionnellement la remise sans le code client. Cette décision sera motivée et enregistrée sous votre accès ; elle ne contourne ni le paiement ni le départ." : "L’ancien code deviendra inutilisable et l’incident sera clôturé. Le client devra actualiser son suivi pour afficher le nouveau code ; la commande ne sera pas déclarée livrée."}</p>
      <Field label="Motif de votre décision (10 caractères minimum)" htmlFor={`handoff-reason-${state.missionId}`}><textarea id={`handoff-reason-${state.missionId}`} value={reason} maxLength={300} disabled={disabled} onChange={event => setReason(event.target.value)} className="min-h-24 w-full rounded-ctrl border border-line bg-bg p-3 text-base text-ink outline-none focus:border-focus" /></Field>
      <p className="text-xs leading-5 text-mut">Ne saisissez pas le code client, de coordonnées ni d’information personnelle dans ce motif.</p>
    </>}
    {!scanning && <Btn type="submit" block className="min-h-12 whitespace-normal" disabled={disabled || !allowed}>{disabled ? "Vérification…" : action === "handoff" ? "Confirmer la remise au client" : action === "incident" ? "Enregistrer l’incident" : action === "override" ? "Confirmer la remise exceptionnelle" : "Renouveler le code et reprendre"}</Btn>}
  </form>;
}
