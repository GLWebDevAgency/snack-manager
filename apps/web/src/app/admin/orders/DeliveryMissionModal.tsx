"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DeliveryMissionViewSchema, DeliveryOperatorsViewSchema, type DeliveryMissionView, type DeliveryOperatorsView } from "@sm/contracts";
import { ApiError, api, getToken } from "@/lib/api";
import { isDemoActive } from "@/lib/demo/mode";
import { Btn } from "@/components/ui/Btn";
import { Field, Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { MissionAddress, missionStatus, missionTime } from "../../livreur/delivery-missions";
import { completeMissionOperation, prepareMissionOperation, readMissionOperation, releaseChangedMissionOperation, type MissionOperation } from "../../livreur/delivery-missions-operation";
import { roleAdmin } from "../session";
import type { Order } from "./types";
import { managerMissionScope } from "./delivery-mission-scope";
import { missionRefusalMessage } from "../../livreur/delivery-missions-feedback";
import { DeliveryHandoffPanel } from "@/components/delivery-handoff/Panel";
import { adminHandoffRequest } from "@/components/delivery-handoff/admin-request";

const PATH = "/delivery/missions";
const REQUEST_MS = 12_000;
const canManage = (role: string | null) => ["owner", "gerant", "cogerant"].includes(role ?? "");
const codeOf = (cause: unknown) => cause instanceof ApiError && cause.body && typeof cause.body === "object" && "code" in cause.body && typeof cause.body.code === "string" ? cause.body.code : "";

/** Affectation and departure are separate server-confirmed operations, never free-text driver names. */
export function DeliveryMissionModal({ order, onClose, onUpdated }: {
  order: Order; onClose: () => void; onUpdated: () => void;
}) {
  const [session] = useState(getToken);
  const manager = canManage(roleAdmin(session));
  const [mission, setMission] = useState<DeliveryMissionView | null>(null);
  const [operators, setOperators] = useState<DeliveryOperatorsView | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  const [operation, setOperation] = useState<MissionOperation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const handoffBusyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackWarning, setFeedbackWarning] = useState(false);
  const alive = useRef(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const currentSession = () => getToken() === session;
  const eligible = operators?.operators.filter(operator => operator.effectiveActive) ?? [];
  const chosen = eligible.find(operator => operator.id === selection);

  const load = useCallback(async () => {
    if (busyRef.current || handoffBusyRef.current || isDemoActive()) return;
    const run = ++generation.current;
    setLoading(true); setError(null);
    try {
      const signal = AbortSignal.timeout(REQUEST_MS);
      const [raw, tenant, directory] = await Promise.all([
        api.get<unknown>(`${PATH}/${order._id}`, { signal }), api.get<{ _id: string }>("/tenants/me", { signal }),
        manager ? api.get<unknown>("/delivery/operators", { signal }) : Promise.resolve(null),
      ]);
      if (!alive.current || generation.current !== run || getToken() !== session) return;
      const view = DeliveryMissionViewSchema.parse(raw);
      if (view.id !== order._id || !/^[a-f0-9]{24}$/.test(tenant._id)) throw new Error("Réponse inattendue. Aucune action n’est autorisée.");
      const nextScope = managerMissionScope(session, tenant._id);
      const pending = readMissionOperation(sessionStorage, nextScope, order._id);
      setMission(view); setScope(nextScope); setOperation(pending);
      setOperators(directory ? DeliveryOperatorsViewSchema.parse(directory) : null);
      setSelection("");
    } catch (cause) {
      if (alive.current && run === generation.current) {
        if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) setMission(null);
        setError(cause instanceof ApiError && cause.status === 403 ? "Votre accès ne permet pas de gérer cette livraison." : "La livraison n’a pas pu être vérifiée. Actualisez avant de continuer.");
      }
    } finally { if (alive.current && run === generation.current) setLoading(false); }
  }, [manager, order._id, session]);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- authenticated mission/directory and durable pending operation are external state.
    void load();
    return () => { alive.current = false; };
  }, [load]);

  useEffect(() => {
    const verifyIdentity = () => {
      if (getToken() === session) return;
      setMission(null); setOperators(null); setScope(null); setOperation(null); setFeedback(null);
      setError("La session a changé. Fermez cette fenêtre puis rouvrez la livraison avec votre accès actuel.");
    };
    window.addEventListener("storage", verifyIdentity);
    window.addEventListener("focus", verifyIdentity);
    return () => { window.removeEventListener("storage", verifyIdentity); window.removeEventListener("focus", verifyIdentity); };
  }, [session]);

  async function moreOperators() {
    if (!operators?.nextCursor || busyRef.current || !currentSession()) return;
    busyRef.current = true; setLoading(true); setError(null);
    try {
      const next = DeliveryOperatorsViewSchema.parse(await api.get<unknown>(`/delivery/operators?after=${encodeURIComponent(operators.nextCursor)}`, { signal: AbortSignal.timeout(REQUEST_MS) }));
      if (!alive.current || !currentSession()) return;
      const rows = new Map(operators.operators.map(operator => [operator.id, operator]));
      next.operators.forEach(operator => rows.set(operator.id, operator));
      setOperators({ ...operators, operators: [...rows.values()], nextCursor: next.nextCursor });
    } catch { setError("Les livreurs suivants n’ont pas pu être chargés. La sélection précédente est conservée ; actualisez avant de confirmer."); }
    finally { busyRef.current = false; if (alive.current) setLoading(false); }
  }

  async function execute(pending: MissionOperation) {
    const endpoint = `${PATH}/${pending.missionId}/${pending.kind === "assignment" ? "assignment" : "dispatch"}`;
    try {
      const raw = await api.post<unknown>(endpoint, pending.body, { signal: AbortSignal.timeout(REQUEST_MS) });
      if (!alive.current || !currentSession()) return;
      const result = completeMissionOperation(sessionStorage, pending, raw);
      setOperation(null);
      if (result.mission.id === order._id) setMission(result.mission);
      setSelection("");
      setFeedbackWarning(result.outcome === "rejected");
      setFeedback(result.outcome === "rejected" ? missionRefusalMessage(result.refusalCode)
        : pending.kind === "assignment" ? "Affectation vérifiée. L’état courant est affiché ; aucun départ n’a été confirmé." : result.mission.dispatchedAt ? "Départ confirmé. La commande est en route." : "Action vérifiée. Consultez l’état courant de la livraison.");
      onUpdated();
    } catch (cause) {
      if (!alive.current || !currentSession()) return;
      if (cause instanceof ApiError && cause.status === 409 && codeOf(cause) === "DELIVERY_MISSION_CHANGED") {
        try {
          const raw = await api.get<unknown>(`${PATH}/${pending.missionId}`, { signal: AbortSignal.timeout(REQUEST_MS) });
          if (!alive.current || !currentSession()) return;
          const current = releaseChangedMissionOperation(sessionStorage, pending, codeOf(cause), raw);
          setOperation(null); if (current.id === order._id) setMission(current);
          setSelection(""); setError("La mission a changé depuis votre choix. Actualisez puis choisissez de nouveau ; aucun second geste n’a été envoyé.");
          onUpdated(); return;
        } catch { /* Keep the exact operation unless the newer view proves the explicit conflict. */ }
      }
      if (!alive.current || !currentSession()) return;
      if (cause instanceof ApiError && [401, 403, 404].includes(cause.status)) setMission(null);
      setError(cause instanceof ApiError && cause.status === 401 ? "Votre session a expiré. Reconnectez-vous puis reprenez la même vérification."
        : "La réponse n’est pas confirmée. La même action est conservée. Vérifiez-la avant tout nouvel envoi.");
    }
  }

  async function act(kind: MissionOperation["kind"], resume = false) {
    if (busyRef.current || loading || !scope || !currentSession() || navigator.onLine === false || isDemoActive()) return;
    if (kind === "assignment" && !manager) return;
    busyRef.current = true; setBusy(true); setError(null); setFeedback(null);
    try {
      const stored = readMissionOperation(sessionStorage, scope, order._id);
      if (resume) {
        if (!stored || (stored.kind === "assignment" && !manager)) throw new Error("Reprise indisponible pour cet accès.");
        setOperation(stored); await execute(stored); return;
      }
      if (stored || !mission) throw new Error("Une action précédente doit être vérifiée.");
      const viewed = mission;
      const operator = chosen;
      if (kind === "assignment" && (!viewed.canAssign || (selection !== "none" && !operator))) return;
      if (kind === "dispatch" && !viewed.canDispatch) return;
      const current = DeliveryMissionViewSchema.parse(await api.get<unknown>(`${PATH}/${order._id}`, { signal: AbortSignal.timeout(REQUEST_MS) }));
      if (!alive.current || !currentSession()) return;
      if (current.id !== order._id) throw new Error("Mission inattendue.");
      setMission(current);
      if (current.revision !== viewed.revision || (kind === "assignment" ? !current.canAssign : !current.canDispatch)) {
        setSelection(""); setError("La commande a évolué. Vérifiez les informations actualisées avant de confirmer."); return;
      }
      const base = { operationId: crypto.randomUUID(), expectedRevision: current.revision };
      const body = kind === "assignment" ? { ...base, operatorId: selection === "none" ? null : operator!.id,
        expectedOperatorRevision: selection === "none" ? null : operator!.revision,
        reason: selection === "none" ? "Retrait de l’affectation" : current.operator ? "Changement de livreur" : "Organisation de la tournée" } : base;
      const pending = prepareMissionOperation(sessionStorage, scope, order._id, kind, body);
      setOperation(pending);
      await execute(pending);
    } catch (cause) {
      if (alive.current) setError(cause instanceof Error ? cause.message : "L’action n’a pas pu être sauvegardée. Aucun nouvel envoi.");
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }

  const locked = loading || busy || handoffBusy || Boolean(operation) || Boolean(error) || !scope;
  const selectionValid = Boolean(mission?.canAssign && (selection === "none" ? mission.operator : chosen && chosen.id !== mission.operator?.id));
  return <Modal open title={`Livraison — n°${order.number}`} onClose={() => { if (!busy && !handoffBusyRef.current) onClose(); }} footer={<>
    <Btn variant="ghost" disabled={busy || handoffBusy} onClick={onClose}>Fermer</Btn>
    {mission && !mission.dispatchedAt && <Btn className="min-h-12 whitespace-normal" disabled={locked || !mission.canDispatch} aria-busy={busy} onClick={() => void act("dispatch")}>Confirmer le départ</Btn>}
  </>}>
    {isDemoActive() ? <p className="text-sm leading-6 text-mut">L’affectation et les départs nécessitent un restaurant connecté. Aucun faux départ n’est créé en démonstration.</p> : <>
      {loading && !mission && <Skeleton className="h-40" />}
      {error && <p role="alert" className="mb-4 rounded-card border border-prep/30 bg-prep/5 p-3 text-sm leading-6 text-prept">{error}</p>}
      {feedback && <p role={feedbackWarning ? "alert" : "status"} className={`mb-4 text-sm leading-6 ${feedbackWarning ? "text-prept" : "text-okt"}`}>{feedback}</p>}
      {operation && <div className="mb-4 rounded-card border border-prep/30 bg-prep/5 p-4">
        <h3 className="text-sm font-bold">Une action reste à vérifier</h3>
        <p className="mt-2 text-sm leading-6 text-mut">La même référence et les mêmes paramètres seront renvoyés. Actualiser ou fermer cette fenêtre n’annule pas une demande déjà envoyée.</p>
        <Btn block className="mt-3 min-h-12 whitespace-normal" disabled={busy || loading || (operation.kind === "assignment" && !manager)} onClick={() => void act(operation.kind, true)}>{busy ? "Vérification…" : "Vérifier la même action"}</Btn>
      </div>}
      {mission && <>
        <p className="text-sm font-bold text-accentink">{missionStatus(mission)}</p>
        <p className="mb-4 mt-1 text-xs text-mut">Livraison prévue · {missionTime(mission.scheduledAt)}</p>
        <MissionAddress mission={mission} />
        {mission.instructions && <p className="mt-3 text-sm leading-6 text-prept">{mission.instructions}</p>}
        <section className="mt-5 border-t border-line pt-4" aria-label="Affectation du livreur">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-mut">Livreur attribué</p>
          <p className="mt-2 text-base font-semibold">{mission.operator?.name ?? "Aucun livreur attribué"}</p>
          {mission.dispatchedAt ? <p className="mt-2 text-sm leading-6 text-mut">Départ enregistré le {missionTime(mission.dispatchedAt)}. L’affectation ne peut plus être modifiée dans ce parcours.</p>
            : manager && mission.canAssign ? <div className="mt-4 space-y-3">
              <Field label={mission.operator ? "Changer l’affectation" : "Choisir un livreur"} htmlFor={`mission-operator-${order._id}`}><Select id={`mission-operator-${order._id}`} value={selection} onChange={event => setSelection(event.target.value)} disabled={locked}>
                <option value="">Sélectionner un accès livreur</option>
                {eligible.map(operator => <option key={operator.id} value={operator.id}>{operator.name}{operator.sessionState === "connected" ? " · téléphone associé" : " · téléphone à associer"}</option>)}
                {mission.operator && <option value="none">Retirer l’affectation</option>}
              </Select></Field>
              {operators?.nextCursor && <Btn variant="ghost" size="sm" disabled={loading || busy} onClick={() => void moreOperators()}>Charger plus de livreurs</Btn>}
              {eligible.length === 0 && <p className="text-sm leading-6 text-mut">Aucun accès actif dans cette page. <a className="underline underline-offset-4" href={busy ? undefined : "/admin/livraison"} aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined}>Gérer les accès livreur</a>.</p>}
              <Btn block variant="ghost" className="min-h-12 whitespace-normal" disabled={locked || !selectionValid} onClick={() => void act("assignment")}>{selection === "none" ? "Confirmer le retrait de l’affectation" : "Confirmer l’affectation"}</Btn>
              <p className="text-xs leading-5 text-mut">L’affectation ne déclenche pas le départ. Une réaffectation retire la mission de l’accès précédent.</p>
            </div> : !mission.operator && <p className="mt-2 text-sm leading-6 text-prept">Un gérant doit attribuer un livreur avant de confirmer le départ.</p>}
        </section>
        {!mission.dispatchedAt && <p className="mt-5 border-t border-line pt-4 text-sm leading-6 text-mut">{mission.canDispatch ? "Confirmez uniquement lorsque ce livreur a récupéré la commande. Le client verra qu’elle est en route." : !mission.paymentReady ? "Le paiement doit être confirmé avant le départ." : mission.orderStatus !== "ready" ? "La cuisine doit terminer la préparation avant le départ." : "Vérifiez l’affectation et l’accès du livreur avant le départ."}</p>}
        {mission.dispatchedAt && scope && <DeliveryHandoffPanel key={`${scope}:${mission.id}`} missionId={mission.id} scope={scope}
          path={`${PATH}/${mission.id}/handoff`} available={!loading && !busy && !operation && !error} manager={manager}
          request={adminHandoffRequest} current={currentSession}
          onBusyChange={value => { handoffBusyRef.current = value; setHandoffBusy(value); }}
          onComplete={() => { onUpdated(); onClose(); }} />}
      </>}
      <Btn variant="ghost" block className="mt-4 min-h-11" disabled={busy || handoffBusy || loading} onClick={() => void load()}>Actualiser la livraison</Btn>
    </>}
  </Modal>;
}
