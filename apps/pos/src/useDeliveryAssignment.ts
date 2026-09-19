import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  DeliveryAvailableOperatorsViewSchema, DeliveryMissionViewSchema,
  type DeliveryAvailableOperatorsView, type DeliveryMissionView,
} from '@sm/contracts';
import {
  completeDeliveryAssignment, DELIVERY_ASSIGNMENT_REASON, prepareDeliveryAssignment,
  readDeliveryAssignments, releaseChangedDeliveryAssignment, SmApiError, uuid,
  type DeliveryAssignmentOperation, type SmClient,
} from '@sm/client-core';

export interface DeliveryAssignmentAccess {
  client: Pick<SmClient, 'get' | 'direct' | 'tenantStore'>;
  ownerId: string | null;
  onSessionExpired: () => void;
}
type Operator = DeliveryAvailableOperatorsView['operators'][number];
const unavailable = 'Connexion requise pour vérifier les livreurs et confirmer l’affectation.';
const unknownResult = 'Affectation à vérifier. Reprenez la même action pour connaître son résultat.';
function subscribeConnection(onChange: () => void) {
  globalThis.addEventListener?.('online', onChange);
  globalThis.addEventListener?.('offline', onChange);
  return () => { globalThis.removeEventListener?.('online', onChange); globalThis.removeEventListener?.('offline', onChange); };
}
const browserOffline = () => globalThis.navigator?.onLine === false;

async function deadline<T>(work: Promise<T>, message = 'La vérification prend trop de temps. Actualisez lorsque la connexion revient.'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 15_000);
    })]);
  } finally { clearTimeout(timer); }
}
const refusal = (code: string) => code === 'DELIVERY_OPERATOR_CHANGED'
  ? 'Ce livreur n’est plus disponible. Actualisez la liste avant de choisir.'
  : code === 'delivery.mission.not_ready' ? 'La cuisine doit terminer la préparation avant l’affectation.'
    : code === 'delivery.mission.departed' ? 'Le départ est déjà confirmé.'
      : 'Cette commande ne peut plus être affectée. Son état actuel est affiché.';

/** No cached availability, optimistic assignment or offline queue. The durable
 * reference survives a timeout, closing the sheet and restarting the POS. */
export function useDeliveryAssignment(id: string, access: DeliveryAssignmentAccess, menuOffline: boolean) {
  const disconnected = useSyncExternalStore(subscribeConnection, browserOffline, () => false);
  const offline = menuOffline || disconnected;
  const { client, ownerId } = access;
  const [mission, setMission] = useState<DeliveryMissionView | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pending, setPending] = useState<DeliveryAssignmentOperation | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const alive = useRef(false), inFlight = useRef(false), sequence = useRef(0);
  const reading = useRef(false);
  // Follow fresh cursors when refreshing visited pages: eligibility may change boundaries.
  const visitedPages = useRef(1);
  const previousOffline = useRef(offline);
  const context = useRef({ offline, ownerId, id, expired: access.onSessionExpired });
  context.current = { offline, ownerId, id, expired: access.onSessionExpired };
  const current = useCallback(() => alive.current && context.current.ownerId === ownerId
    && context.current.id === id, [id, ownerId]);
  const connected = useCallback(() => current() && !context.current.offline
    && globalThis.navigator?.onLine !== false, [current]);
  const readPending = useCallback(async () => (await readDeliveryAssignments(client.tenantStore))
    .find(operation => operation.missionId === id) ?? null, [client, id]);
  const readMission = useCallback(async () => {
    const result = DeliveryMissionViewSchema.parse(await deadline(client.get<unknown>(`/delivery/missions/${id}`)));
    if (result.id !== id) throw new Error('La commande reçue ne correspond pas à celle affichée. Actualisez.');
    return result;
  }, [client, id]);
  const reportError = useCallback((cause: unknown) => {
    if (!current()) return;
    if (cause instanceof SmApiError && cause.status === 401) context.current.expired();
    setError(cause instanceof SmApiError && cause.status === 403
      ? 'Votre accès ne permet pas cette affectation. Faites vérifier les droits de livraison par un responsable.'
      : cause instanceof Error ? cause.message : unknownResult);
  }, [current]);

  const refresh = useCallback(async (more = false, cursor: string | null = null) => {
    if (!current() || inFlight.current || reading.current) return;
    reading.current = true;
    const request = ++sequence.current;
    setLoading(true);
    try {
      const operation = await deadline(readPending());
      if (!current() || request !== sequence.current) return;
      setPending(operation);
      if (!ownerId) throw new Error('Reconnectez votre session de caisse pour affecter un livreur.');
      if (!connected()) throw new Error(unavailable);
      const readPages = async () => {
        const pages: DeliveryAvailableOperatorsView[] = [];
        const seen = new Set<string>();
        let after = more ? cursor : null;
        for (let index = 0; index < (more ? 1 : visitedPages.current); index++) {
          if (!connected() || request !== sequence.current) throw new Error(unavailable);
          const page = DeliveryAvailableOperatorsViewSchema.parse(await deadline(client.get<unknown>(
            `/delivery/operators/available${after ? `?after=${encodeURIComponent(after)}` : ''}`,
          )));
          if (page.nextCursor && (page.nextCursor === after || seen.has(page.nextCursor))) {
            throw new Error('La liste des livreurs doit être actualisée.');
          }
          pages.push(page);
          if (!page.nextCursor) break;
          seen.add(page.nextCursor); after = page.nextCursor;
        }
        return pages;
      };
      const [fresh, pages] = await Promise.all([readMission(), readPages()]);
      if (!current() || request !== sequence.current || !connected()) return;
      const last = pages.at(-1)!;
      if (more && last.nextCursor === cursor) throw new Error('La liste des livreurs doit être actualisée.');
      const available = [...new Map(pages.flatMap(page => page.operators).map(item => [item.id, item])).values()];
      setMission(fresh);
      setOperators(previous => more ? [...new Map([...previous, ...available].map(item => [item.id, item])).values()] : available);
      visitedPages.current = more ? visitedPages.current + 1 : pages.length;
      setNextCursor(last.nextCursor);
      if (!more) setSelection(selected => available.some(operator => operator.id === selected && operator.departedCount === 0) ? selected : null);
      setError(null);
    } catch (cause) {
      if (request === sequence.current) reportError(cause);
    } finally {
      reading.current = false;
      if (current() && request === sequence.current) setLoading(false);
    }
  }, [client, connected, current, ownerId, readMission, readPending, reportError]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => { if (connected() && !inFlight.current) void refresh(); }, 15_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    return () => { alive.current = false; sequence.current++; clearInterval(timer); subscription.remove(); };
  }, [connected, refresh]);
  useEffect(() => {
    if (previousOffline.current && !offline) void refresh();
    previousOffline.current = offline;
  }, [offline, refresh]);

  const act = async (resume = false) => {
    if (!connected() || inFlight.current || reading.current || !ownerId || loading) return;
    const chosen = operators.find(operator => operator.id === selection);
    if (!resume && (!mission || !chosen || !mission.canAssign || mission.operator
      || mission.dispatchedAt || mission.orderStatus !== 'ready' || chosen.departedCount > 0 || error)) return;
    inFlight.current = true; sequence.current++; setBusy(true); setError(null); setFeedback(null);
    let operation: DeliveryAssignmentOperation | null = null;
    try {
      operation = await readPending();
      if (!connected()) throw new Error(unavailable);
      if (operation && operation.ownerId !== ownerId) throw new Error('L’équipier ayant commencé cette affectation doit se reconnecter pour la vérifier.');
      if (resume && !operation) throw new Error('Cette action a déjà été traitée. Actualisez la commande.');
      if (!resume) {
        if (operation) throw new Error(unknownResult);
        const fresh = await readMission();
        if (!connected()) throw new Error(unavailable);
        setMission(fresh);
        if (fresh.revision !== mission!.revision || !fresh.canAssign || fresh.orderStatus !== 'ready' || fresh.operator || fresh.dispatchedAt) {
          setSelection(null); throw new Error('La commande a changé. Actualisez avant de choisir un livreur.');
        }
        operation = await prepareDeliveryAssignment(client.tenantStore, { ownerId, missionId: id,
          body: { operationId: uuid(), expectedRevision: fresh.revision, operatorId: chosen!.id,
            expectedOperatorRevision: chosen!.revision, reason: DELIVERY_ASSIGNMENT_REASON } });
      }
      if (!current()) return;
      setPending(operation);
      if (!connected()) throw new Error(unavailable);
      const raw = await deadline(client.direct<unknown>('POST', `/delivery/missions/${id}/assignment`, operation!.body), unknownResult);
      // A previous staff member's late response must not change a new session.
      if (!current()) return;
      const result = await completeDeliveryAssignment(client.tenantStore, operation!, raw);
      if (!current()) return;
      setPending(null); setSelection(null); setMission(result.mission);
      setFeedback(result.outcome === 'rejected' ? refusal(result.refusalCode)
        : result.replay ? 'Action vérifiée. Le livreur actuel est affiché.' : 'Affectation confirmée.');
    } catch (cause) {
      if (!current()) return;
      if (operation && cause instanceof SmApiError && cause.status === 409
        && (cause.body as { code?: unknown } | null)?.code === 'DELIVERY_MISSION_CHANGED') {
        try {
          const fresh = await readMission();
          if (!current()) return;
          await releaseChangedDeliveryAssignment(client.tenantStore, operation, 'DELIVERY_MISSION_CHANGED', fresh);
          if (!current()) return;
          setPending(null); setMission(fresh); setSelection(null);
          setError('La commande a changé depuis votre choix. Actualisez avant une nouvelle affectation.');
        } catch (failure) { reportError(failure); }
      } else reportError(cause);
      try { const stored = await readPending(); if (current()) setPending(stored); } catch (failure) { reportError(failure); }
    } finally { if (current()) { inFlight.current = false; setBusy(false); } }
  };
  return { mission, operators, nextCursor, pending, selection, setSelection, loading, busy, error, feedback, offline,
    refresh: () => refresh(), more: () => refresh(true, nextCursor), assign: () => act(), resume: () => act(true) };
}
