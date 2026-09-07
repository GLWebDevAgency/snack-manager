import { DeliveryHandoffIncidentSchema, DeliveryHandoffReasonSchema, DeliveryHandoffStateSchema, DeliveryHandoffSubmitSchema,
  type DeliveryHandoffAction, type DeliveryHandoffRefusalCode, type DeliveryHandoffState } from "@sm/contracts";
import { completeHandoffOperation, prepareHandoffOperation, readHandoffOperations, type HandoffOperation, type HandoffStore } from "./journal";

export const HANDOFF_INCIDENT_LABELS = { customer_absent: "Client absent", unreachable: "Client injoignable", address_issue: "Adresse ou accès introuvable", proof_unavailable: "Code de remise indisponible", customer_refused: "Commande refusée par le client" } as const;
const REFUSALS: Record<DeliveryHandoffRefusalCode, string> = {
  invalid: "Cette commande ne permet pas une remise en livraison.", closed: "Cette commande est déjà terminée ou annulée. Actualisez son état.",
  not_departed: "Le départ doit être confirmé avant la remise.", payment_blocked: "Le restaurant doit vérifier le paiement avant la remise.",
  proof_unavailable: "Le code de remise n’est pas disponible. Signalez l’incident au restaurant.",
  proof_expired: "Le code de remise a expiré. Le responsable peut le renouveler.", proof_locked: "Le code est bloqué après plusieurs essais. Contactez le restaurant.",
  proof_incorrect: "Le code ou le QR ne correspond pas à cette remise. Vérifiez-le avec le client avant un nouvel essai.",
  incident_required: "Signalez d’abord l’incident avant une confirmation exceptionnelle.", operator_changed: "L’accès ou l’affectation a changé. Contactez le restaurant.",
  abandoned: "La vérification a fermé cette tentative sans l’appliquer. Vérifiez l’état affiché avant un nouveau geste.",
};
const UNKNOWN = "La réponse n’est pas confirmée. Vérifiez la même action avant de recommencer la remise.";
export class HandoffHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(status === 401 ? "Votre accès a expiré ou a été retiré." : status === 404 ? "Cette mission n’est plus disponible pour cet accès."
      : status === 429 ? "Trop de tentatives. Patientez avant de réessayer." : UNKNOWN);
  }
}
export type HandoffRequest = (path: string, body?: unknown) => Promise<unknown>;
export const handoffRequest: HandoffRequest = async (path, body) => {
  const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin", redirect: "error",
    signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const raw: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new HandoffHttpError(response.status, raw && typeof raw === "object" && "code" in raw && typeof raw.code === "string" ? raw.code : "UNKNOWN");
  return raw;
};
export type HandoffClientState = Readonly<{ view: DeliveryHandoffState | null; pending: HandoffOperation | null; loading: boolean; busy: boolean; stale: boolean;
  message: string | null; outcome: "applied" | "rejected" | "abandoned" | null }>;
const INITIAL: HandoffClientState = { view: null, pending: null, loading: true, busy: false, stale: true, message: null, outcome: null };
type Port = { missionId: string; scope: string; path: string; request?: HandoffRequest; storage?: () => HandoffStore;
  current?: () => boolean; revoked?: () => void; online?: () => boolean; uuid?: () => string; activity?: (busy: boolean) => void };

/** Shared by BO and courier. No mutation on mount/poll/reconnect. A lost POST
 * is resolved by operation identity, not by storing or resending the secret.
 */
export function createDeliveryHandoffClient(port: Port) {
  const request = port.request ?? handoffRequest;
  const store = port.storage ?? (() => sessionStorage);
  const online = port.online ?? (() => navigator.onLine !== false);
  const current = port.current ?? (() => true);
  let state = INITIAL; let stopped = false; let running = false; let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<HandoffClientState>) => { if (!stopped) {
    const previousBusy = state.busy;
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
    if (state.busy !== previousBusy) port.activity?.(state.busy);
  } };
  const pending = () => readHandoffOperations(store(), port.scope).find(entry => entry.missionId === port.missionId) ?? null;
  const stillCurrent = (run: number) => {
    if (stopped || run !== generation) return false;
    if (!current()) { publish({ view: null, pending: null, loading: false, busy: false, stale: true, outcome: null, message: "La session a changé. Rouvrez cette mission avec votre accès actuel." }); return false; }
    return true;
  };
  const parseView = (raw: unknown) => {
    const value = DeliveryHandoffStateSchema.parse(raw);
    if (value.missionId !== port.missionId) throw Error("Unexpected mission");
    return value;
  };
  function fail(cause: unknown, duringMutation = false) {
    if (cause instanceof HandoffHttpError && cause.status === 401) {
      publish({ view: null, pending: null, stale: true, outcome: null, message: cause.message }); port.revoked?.(); return;
    }
    publish({ stale: true, outcome: null,
      ...(cause instanceof HandoffHttpError && [403, 404].includes(cause.status) ? { view: null } : {}),
      message: !online() ? "Connexion requise. Aucune remise ni aucun incident ne peut être confirmé hors ligne."
        : cause instanceof HandoffHttpError ? cause.message : duringMutation ? UNKNOWN : "L’état de la remise n’a pas pu être vérifié. Actualisez avant de continuer." });
  }
  async function refresh() {
    if (running || stopped) return;
    if (!online()) { fail(null); publish({ loading: false }); return; }
    running = true; const run = ++generation; publish({ loading: true });
    try {
      publish({ pending: pending() });
      const raw = await request(port.path);
      if (!stillCurrent(run)) return;
      publish({ view: parseView(raw), stale: false, message: null, outcome: null });
    } catch (cause) { if (stillCurrent(run)) fail(cause); }
    finally { if (run === generation) { running = false; publish({ loading: false }); } }
  }
  async function send(saved: HandoffOperation, endpoint: string, body: unknown, run: number) {
    try {
      const raw = await request(`${port.path}/${endpoint}`, body);
      if (!stillCurrent(run)) return;
      const result = completeHandoffOperation(store(), saved, raw);
      publish({ view: result.state, pending: null, stale: false, outcome: result.outcome,
        message: result.outcome !== "applied" ? REFUSALS[result.refusalCode]
          : result.action === "handoff" || result.action === "override" ? "Remise confirmée. La commande est livrée."
            : result.action === "incident" ? "Incident enregistré. La commande n’est pas déclarée livrée ; contactez le restaurant pour la suite."
              : "Code renouvelé et incident clôturé. Le client doit actualiser son code avant la remise." });
    } catch (cause) { if (stillCurrent(run)) fail(cause, true); }
  }
  async function act(action: DeliveryHandoffAction, details: unknown) {
    if (running || stopped || state.stale || !state.view || state.pending || !online() || !current()) return;
    const viewed = state.view;
    const snapshot = structuredClone(details);
    if (action === "handoff" ? !viewed.canHandoff : action === "override" ? !viewed.canOverride : action === "rotate" ? !viewed.canRotate : ["delivered", "cancelled"].includes(viewed.orderStatus)) return;
    running = true; const run = ++generation; publish({ busy: true, message: null, outcome: null });
    try {
      const existing = pending();
      if (existing) { publish({ pending: existing }); return; }
      const fresh = parseView(await request(port.path));
      if (!stillCurrent(run)) return;
      publish({ view: fresh });
      if (fresh.revision !== viewed.revision || fresh.missionRevision !== viewed.missionRevision
        || (action === "handoff" ? !fresh.canHandoff : action === "override" ? !fresh.canOverride : action === "rotate" ? !fresh.canRotate : ["delivered", "cancelled"].includes(fresh.orderStatus))) {
        publish({ message: "La mission a changé. Vérifiez les informations actualisées avant de confirmer de nouveau." }); return;
      }
      const operation = { operationId: (port.uuid ?? (() => crypto.randomUUID()))(), expectedRevision: fresh.revision, expectedMissionRevision: fresh.missionRevision, action };
      const base = { operationId: operation.operationId, expectedRevision: operation.expectedRevision, expectedMissionRevision: operation.expectedMissionRevision };
      const candidate = { ...(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {}), ...base };
      const body = action === "handoff" ? DeliveryHandoffSubmitSchema.parse(candidate) : action === "incident" ? DeliveryHandoffIncidentSchema.parse(candidate) : DeliveryHandoffReasonSchema.parse(candidate);
      let saved: HandoffOperation;
      try { saved = prepareHandoffOperation(store(), port.scope, port.missionId, operation); }
      catch { publish({ stale: true, message: "La sauvegarde de l’action est indisponible. Aucun nouvel envoi n’a été transmis." }); return; }
      publish({ pending: saved });
      await send(saved, action === "handoff" ? "confirm" : action, body, run);
    } catch (cause) { if (stillCurrent(run)) fail(cause); }
    finally { if (run === generation) { running = false; publish({ busy: false }); } }
  }
  async function resolve() {
    if (running || stopped || !online() || !current()) return;
    running = true; const run = ++generation; publish({ busy: true, message: null, outcome: null });
    try {
      const saved = pending();
      if (!saved) { publish({ pending: null, stale: true, message: "Aucune action à reprendre. Actualisez la mission." }); return; }
      publish({ pending: saved });
      await send(saved, "resolve", saved.operation, run);
    } catch (cause) { if (stillCurrent(run)) fail(cause, true); }
    finally { if (run === generation) { running = false; publish({ busy: false }); } }
  }
  return { act, resolve, refresh, start: () => { stopped = false; return refresh(); },
    pause: () => { generation++; running = false; publish({ view: null, loading: false, busy: false, stale: true }); },
    stop: () => { stopped = true; generation++; running = false; port.activity?.(false); },
    getSnapshot: () => state, getServerSnapshot: () => INITIAL,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
