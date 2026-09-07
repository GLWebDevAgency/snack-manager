import { DeliveryMissionsViewSchema, DeliveryMissionViewSchema, type DeliveryMissionView } from "@sm/contracts";
import { completeMissionOperation, MissionHttpError, missionRequest, prepareMissionOperation, readMissionOperation, readMissionOperations,
  releaseChangedMissionOperation, type MissionOperation } from "./delivery-missions-operation";
import { missionRefusalMessage } from "./delivery-missions-feedback";

export type MissionsState = Readonly<{
  missions: DeliveryMissionView[]; nextCursor: string | null; loading: boolean; busy: boolean;
  loaded: boolean; stale: boolean; message: string | null; tone: "warning" | "success"; operations: MissionOperation[];
}>;
const INITIAL: MissionsState = { missions: [], nextCursor: null, loading: true, busy: false, loaded: false, stale: true, message: null, tone: "warning", operations: [] };
type Port = {
  scope: string; operatorId: string; revoked: () => void;
  request?: typeof missionRequest; storage?: () => Storage; online?: () => boolean; uuid?: () => string;
};

/** Private projection only. No socket in the tenant-wide room and no persisted customer data. */
export function createDeliveryMissionsClient(port: Port) {
  const request = port.request ?? missionRequest;
  const storage = port.storage ?? (() => sessionStorage);
  const online = port.online ?? (() => navigator.onLine !== false);
  const uuid = port.uuid ?? (() => crypto.randomUUID());
  let state = INITIAL;
  let pageCount = 1;
  let generation = 0;
  let running = false;
  let stopped = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MissionsState>) => {
    if (stopped) return;
    state = { ...state, ...patch }; listeners.forEach(listener => listener());
  };
  const mine = (mission: DeliveryMissionView) => mission.operator?.id === port.operatorId && !["delivered", "cancelled"].includes(mission.orderStatus);
  const merge = (mission: DeliveryMissionView) => {
    const without = state.missions.filter(current => current.id !== mission.id);
    return mine(mission) ? [...without, mission].sort((a, b) => a.id.localeCompare(b.id)) : without;
  };
  function failure(cause: unknown, missionId?: string) {
    if (stopped) return;
    if (cause instanceof MissionHttpError && cause.status === 401) {
      publish({ missions: [], nextCursor: null, operations: [], stale: true, message: cause.message, tone: "warning" });
      port.revoked(); return;
    }
    publish({ stale: !(cause instanceof MissionHttpError && cause.status === 404), tone: "warning", message: !online() ? "Vous êtes hors connexion. Aucun départ ne peut être confirmé."
      : cause instanceof Error ? cause.message : "Les missions n’ont pas pu être vérifiées.",
    ...(cause instanceof MissionHttpError && cause.status === 404 && missionId ? { missions: state.missions.filter(mission => mission.id !== missionId) } : {}) });
  }

  async function refresh(more = false) {
    if (running || stopped) return;
    if (!online()) { failure(new Error("Connexion requise.")); publish({ loading: false }); return; }
    running = true;
    const run = ++generation;
    publish({ loading: true });
    try {
      const operations = readMissionOperations(storage(), port.scope);
      // Never POST on reload, focus or reconnect: only restore the explicit recovery action.
      publish({ operations });
      let cursor = more ? state.nextCursor : null;
      let missions = more ? [...state.missions] : [];
      const wanted = more ? 1 : pageCount;
      let loaded = 0;
      do {
        const page = DeliveryMissionsViewSchema.parse(await request(`/livreur/missions${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`));
        if (page.missions.some(mission => !mine(mission))) throw new Error("La liste des missions ne correspond pas à votre accès.");
        const byId = new Map(missions.map(mission => [mission.id, mission]));
        page.missions.forEach(mission => byId.set(mission.id, mission));
        missions = [...byId.values()]; cursor = page.nextCursor; loaded++;
      } while (cursor && loaded < wanted);
      if (stopped || run !== generation) return;
      pageCount = more ? pageCount + 1 : loaded;
      publish({ missions, nextCursor: cursor, loaded: true, stale: false, message: null });
    } catch (cause) { if (run === generation) failure(cause); }
    finally { if (run === generation) { running = false; publish({ loading: false }); } }
  }

  async function inspect(id: string) {
    if (running || stopped || !online()) return;
    running = true; const run = ++generation; publish({ loading: true });
    try {
      const mission = DeliveryMissionViewSchema.parse(await request(`/livreur/missions/${id}`));
      if (stopped || run !== generation) return;
      if (mission.id !== id) throw new Error("La réponse ne correspond pas à cette mission.");
      publish({ missions: merge(mission), stale: false, tone: "warning", message: mine(mission) ? null : "Cette mission n’est plus attribuée à votre accès." });
      return mine(mission) ? mission : undefined;
    } catch (cause) { if (run === generation) failure(cause, id); }
    finally { if (run === generation) { running = false; publish({ loading: false }); } }
  }

  async function execute(operation: MissionOperation) {
    running = true; const run = ++generation;
    publish({ busy: true, message: null });
    try {
      publish({ operations: readMissionOperations(storage(), port.scope) });
      const raw = await request(`/livreur/missions/${operation.missionId}/depart`, operation.body);
      if (stopped || run !== generation) return;
      const result = completeMissionOperation(storage(), operation, raw);
      publish({ operations: readMissionOperations(storage(), port.scope), missions: merge(result.mission), stale: false, tone: result.outcome === "rejected" ? "warning" : "success",
        message: result.outcome === "rejected" ? missionRefusalMessage(result.refusalCode)
          : result.mission.dispatchedAt ? "Départ confirmé. La commande est en route." : "Action vérifiée. L’état actuel de la mission est affiché." });
    } catch (cause) {
      if (stopped || run !== generation) return;
      if (cause instanceof MissionHttpError && cause.status === 409 && cause.code === "DELIVERY_MISSION_CHANGED") {
        try {
          const raw = await request(`/livreur/missions/${operation.missionId}`);
          if (stopped || run !== generation) return;
          const current = releaseChangedMissionOperation(storage(), operation, cause.code, raw);
          publish({ operations: readMissionOperations(storage(), port.scope), missions: merge(current), stale: false, tone: "warning", message: "La mission a changé depuis votre choix. Vérifiez son état avant de confirmer une nouvelle action." });
        } catch (recoveryError) { if (run === generation) failure(recoveryError, operation.missionId); }
      } else failure(cause, operation.missionId);
    } finally { if (run === generation) { running = false; publish({ busy: false }); } }
  }
  async function dispatch(id: string) {
    if (running || stopped || state.stale || !online() || state.operations.some(operation => operation.missionId === id)) return;
    const mission = state.missions.find(value => value.id === id);
    if (!mission?.canDispatch || !mine(mission)) return;
    try {
      const operation = prepareMissionOperation(storage(), port.scope, id, "dispatch", { operationId: uuid(), expectedRevision: mission.revision });
      await execute(operation);
    } catch (cause) { failure(cause, id); }
  }
  async function resume(id?: string) {
    if (running || stopped || !online()) return;
    try {
      const operation = readMissionOperation(storage(), port.scope, id);
      if (!operation || operation.kind !== "dispatch") throw new Error("La reprise n’est plus disponible. Actualisez les missions.");
      await execute(operation);
    } catch (cause) { failure(cause); }
  }
  return { refresh: () => refresh(), loadMore: () => state.nextCursor ? refresh(true) : Promise.resolve(), inspect, dispatch, resume,
    pause: () => publish({ stale: true }), stop: () => { stopped = true; generation++; running = false; }, start: () => { stopped = false; return refresh(); },
    getSnapshot: () => state, getServerSnapshot: () => INITIAL,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
