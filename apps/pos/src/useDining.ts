import { useCallback, useEffect, useRef, useState } from 'react';
import { DiningRoomSchema, DiningSessionSchema, type DiningRoom, type DiningSession } from '@sm/contracts';
import { client } from './client';
import { KEYS } from './pos-state';
import type { ServerOrderRow } from './service-state';
import { clearDiningOperation, diningOperationPath, diningOperationRejected, observeDiningOperation, prepareDiningOperation, readDiningOperation,
  withDiningDeadline, type DiningAction, type DiningOperation } from './dining-operation';

export type DiningResult = { session: DiningSession; order?: ServerOrderRow };
export type DiningDetails = { session: DiningSession; orders: ServerOrderRow[] };

export function useDining(active: boolean, offline: boolean, ownerId: string | null, draftId: string) {
  const [room, setRoom] = useState<DiningRoom | null>(null);
  const [details, setDetails] = useState<DiningDetails | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const [pending, setPending] = useState<DiningOperation | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(true);
  const running = useRef(false);
  const generation = useRef(0);
  const storageGeneration = useRef(0);
  const currentSelection = useRef(selectedId);
  const currentOwner = useRef(ownerId);
  const currentDraft = useRef(draftId);
  currentSelection.current = selectedId;
  currentOwner.current = ownerId;
  currentDraft.current = draftId;

  useEffect(() => {
    alive.current = true;
    let initial = true;
    const read = () => {
      const request = ++storageGeneration.current;
      void readDiningOperation(client.tenantStore).then((operation) => {
        if (!alive.current || request !== storageGeneration.current) return;
        setPending((previous) => observeDiningOperation(previous, operation, currentDraft.current)); setStorageError(null);
        if (initial && operation && operation.action !== 'open') select(operation.sessionId);
        initial = false; setReady(true);
      }).catch((e: unknown) => { if (alive.current && request === storageGeneration.current) setStorageError(e instanceof Error ? e.message : 'Stockage de salle indisponible.'); });
    };
    read();
    const external = (event: StorageEvent) => { if (event.key === null || event.key === KEYS.diningOperation) read(); };
    if (typeof window !== 'undefined') window.addEventListener('storage', external);
    return () => { alive.current = false; generation.current += 1; if (typeof window !== 'undefined') window.removeEventListener('storage', external); };
  }, []);

  const refresh = useCallback(async () => {
    if (offline) return;
    const request = ++generation.current;
    const id = currentSelection.current;
    try {
      const [nextRoom, nextDetails] = await Promise.all([
        withDiningDeadline(client.get<DiningRoom>('/dining/room')),
        id ? withDiningDeadline(client.get<DiningDetails>(`/dining/sessions/${id}`)) : Promise.resolve(null),
      ]);
      const validRoom = DiningRoomSchema.parse(nextRoom);
      if (nextDetails) {
        DiningSessionSchema.parse(nextDetails.session);
        if (nextDetails.session.id !== id || !Array.isArray(nextDetails.orders)) throw new Error('Réponse de salle incohérente. Actualisez avant de continuer.');
      }
      if (!alive.current || request !== generation.current || id !== currentSelection.current) return;
      setRoom(validRoom); setDetails(nextDetails); setReadAt(Date.now()); setError(null);
    } catch (e) {
      if (alive.current && request === generation.current) setError(e instanceof Error ? e.message : 'Salle indisponible.');
    }
  }, [offline]);

  useEffect(() => {
    if (!active && !selectedId && !pending) return;
    void refresh();
    const timer = setInterval(() => { setClock(Date.now()); if (!running.current) void refresh(); }, 10_000);
    return () => { clearInterval(timer); generation.current += 1; };
  }, [active, selectedId, pending, refresh]);

  const acknowledge = useCallback(async (operationId: string) => {
    storageGeneration.current += 1;
    await clearDiningOperation(client.tenantStore, operationId);
    storageGeneration.current += 1;
    if (alive.current) setPending((previous) => previous?.body.operationId === operationId ? null : previous);
  }, []);

  const execute = useCallback(async (proposed: DiningAction | DiningOperation): Promise<DiningResult> => {
    if (!ready || running.current || offline) throw new Error(offline ? 'Connexion requise pour confirmer une opération de salle.' : 'Patientez pendant la vérification de la salle.');
    if (!ownerId || ('ownerId' in proposed && proposed.ownerId !== ownerId)) throw new Error('Reconnectez l’équipier ayant lancé cette opération pour reprendre sa confirmation.');
    running.current = true; generation.current += 1;
    if (alive.current) { setBusy(true); setError(null); }
    let operation: DiningOperation | undefined;
    try {
      storageGeneration.current += 1;
      operation = await prepareDiningOperation(client.tenantStore, { ...proposed, ownerId });
      storageGeneration.current += 1;
      if (alive.current) setPending(operation);
      if (!alive.current || currentOwner.current !== ownerId) throw new Error('Session modifiée. Reconnectez l’équipier à l’origine de cette opération pour la vérifier.');
      const response = await withDiningDeadline(client.direct<unknown>('POST', diningOperationPath(operation), operation.body));
      let result: DiningResult;
      if (operation.action === 'order') {
        const value = response as DiningResult;
        const session = DiningSessionSchema.parse(value?.session);
        if (session.id !== operation.sessionId || value.order?.clientId !== operation.body.operationId
          || value.order.dining?.sessionId !== session.id || !value.order._id || !session.orderIds.includes(value.order._id) || !Number.isSafeInteger(value.order.number)) {
          throw new Error('Envoi non confirmé. Vérifiez la même référence de commande.');
        }
        result = { session, order: value.order };
        // Le caller doit journaliser cette commande avant d'acquitter l'intention.
      } else if (operation.action === 'serve') {
        const value = response as DiningResult;
        const session = DiningSessionSchema.parse(value?.session);
        if (session.id !== operation.sessionId || value.order?._id !== operation.orderId
          || value.order.dining?.sessionId !== session.id || !value.order.dining.servedAt
          || !Number.isFinite(Date.parse(value.order.dining.servedAt))) throw new Error('Le service reste à confirmer avec la même référence.');
        result = { session, order: value.order };
        await acknowledge(operation.body.operationId);
      } else {
        const session = DiningSessionSchema.parse(response);
        const expectedId = operation.action === 'open' ? operation.body.operationId : operation.sessionId;
        if (session.id !== expectedId) throw new Error('La réponse ne correspond pas à cette tablée.');
        result = { session };
        await acknowledge(operation.body.operationId);
      }
      if (alive.current) {
        if (result.session.state === 'closed') { select(null); setDetails(null); }
        else { select(result.session.id); currentSelection.current = result.session.id; }
      }
      return result;
    } catch (e) {
      if (operation && diningOperationRejected(e, operation.body.operationId)) await acknowledge(operation.body.operationId);
      if (!operation) {
        try { const stored = await readDiningOperation(client.tenantStore); if (alive.current) setPending((previous) => observeDiningOperation(previous, stored, currentDraft.current)); }
        catch (readError) { if (alive.current) setStorageError(readError instanceof Error ? readError.message : 'Stockage de salle indisponible.'); }
      }
      if (alive.current) setError(e instanceof Error ? e.message : 'Résultat de salle inconnu. Vérifiez la même opération.');
      throw e;
    } finally {
      running.current = false;
      if (alive.current) { setBusy(false); void refresh(); }
    }
  }, [acknowledge, offline, ownerId, ready, refresh]);

  const selectSession = useCallback((id: string | null) => {
    generation.current += 1; currentSelection.current = id; select(id); setDetails(null);
  }, []);
  const session = details?.session.id === selectedId ? details.session : room?.sessions.find((item) => item.id === selectedId) ?? null;
  return { room, details, session, selectedId, selectSession, pending, ready, error, storageError, busy, refresh, execute, acknowledge,
    ownerMismatch: !!pending && pending.ownerId !== ownerId,
    stale: offline || !!error || !readAt || clock - readAt > 30_000, readAt };
}

export type DiningController = ReturnType<typeof useDining>;
