import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { CounterRefundIntent, CounterRefundJournal } from '@sm/contracts';
import { adoptCounterRefundIntent, closeSupersededCounterRefundResolution, markCounterRefundIntent, prepareCounterRefundIntent, prepareCounterRefundNoEffect, readCounterRefundIntent,
  reconcileCounterRefundJournal, type CounterRefundLocalIntent } from '@sm/client-core';
import { counterRefundAuthorization, createCounterRefundTransport, type CounterRefundAccess, type CounterRefundStep } from './counter-refund';

function subscribeConnection(listener: () => void) {
  globalThis.addEventListener?.('online', listener); globalThis.addEventListener?.('offline', listener);
  return () => { globalThis.removeEventListener?.('online', listener); globalThis.removeEventListener?.('offline', listener); };
}
const browserOffline = () => globalThis.navigator?.onLine === false;
export function useCounterRefund(orderId: string, access: CounterRefundAccess, menuOffline: boolean) {
  const disconnected = useSyncExternalStore(subscribeConnection, browserOffline, () => false), offline = disconnected || menuOffline;
  const [journal, setJournal] = useState<CounterRefundJournal | null>(null);
  const [pending, setPending] = useState<CounterRefundLocalIntent | null>(null);
  const [blocked, setBlocked] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null), [feedback, setFeedback] = useState<string | null>(null);
  const [processingWarning, setProcessingWarning] = useState<string | null>(null);
  const [permission, setPermission] = useState<{ operationId: string; until: number } | null>(null);
  const [clearInputs, setClearInputs] = useState(0);
  const alive = useRef(false), inFlight = useRef(false), cycle = useRef(0), foreground = useRef(true);
  const context = useRef({ access, orderId, offline }); context.current = { access, orderId, offline };
  const current = useCallback(() => alive.current && context.current.access === access && context.current.orderId === orderId, [access, orderId]);
  const connected = useCallback(() => current() && foreground.current && !context.current.offline && !browserOffline(), [current]);
  const transport = useMemo(() => createCounterRefundTransport(access, connected), [access, connected]);
  useEffect(() => { if (offline) { cycle.current++; setPermission(null); setClearInputs(value => value + 1); } }, [offline]);
  useEffect(() => {
    if (!permission) return;
    const timer = setTimeout(() => setPermission(null), Math.max(0, permission.until - performance.now()));
    return () => clearTimeout(timer);
  }, [permission]);
  const readLocal = useCallback(async () => {
    const result = await readCounterRefundIntent(access.client.tenantStore, access.ownerId, orderId);
    if (current()) { setPending(result.state === 'pending' ? result.intent : null); setBlocked(result.state === 'blocked'); }
    return result;
  }, [access, current, orderId]);
  const accept = useCallback(async (view: CounterRefundJournal) => {
    // Durable acknowledgement precedes the UI, including failures of local IO.
    await reconcileCounterRefundJournal(access.client.tenantStore, orderId, view);
    if (!current()) return;
    await readLocal(); if (current()) setJournal(view);
  }, [access, orderId, current, readLocal]);
  const refresh = useCallback(async () => {
    if (!current() || inFlight.current) return;
    inFlight.current = true; const version = cycle.current; setLoading(true); setError(null); setPermission(null);
    try {
      await readLocal(); if (!connected() || cycle.current !== version) throw Error('Connexion requise pour vérifier un remboursement comptoir.');
      const view = await transport.read(orderId);
      if (!connected() || cycle.current !== version) return;
      await accept(view);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Le remboursement reste à vérifier.'); }
    finally { inFlight.current = false; if (current()) setLoading(false); }
  }, [current, connected, transport, orderId, readLocal, accept]);
  useEffect(() => {
    alive.current = true;
    const pause = () => { cycle.current++; foreground.current = false; setPermission(null); setClearInputs(value => value + 1); };
    const resume = () => { foreground.current = true; };
    const state = AppState.addEventListener('change', value => { if (value === 'active') resume(); else pause(); });
    const visibility = () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') pause(); else resume(); };
    globalThis.addEventListener?.('offline', pause); globalThis.addEventListener?.('online', resume); globalThis.addEventListener?.('pagehide', pause);
    globalThis.addEventListener?.('blur', pause); globalThis.addEventListener?.('focus', resume);
    globalThis.document?.addEventListener('visibilitychange', visibility);
    void refresh();
    return () => { alive.current = false; cycle.current++; state.remove(); globalThis.removeEventListener?.('offline', pause);
      globalThis.removeEventListener?.('blur', pause); globalThis.removeEventListener?.('focus', resume);
      globalThis.removeEventListener?.('online', resume); globalThis.removeEventListener?.('pagehide', pause); globalThis.document?.removeEventListener('visibilitychange', visibility); };
  }, [refresh]);
  async function act(step: CounterRefundStep, secret: string, draft?: CounterRefundIntent, resolutionReason?: string) {
    if (inFlight.current || !connected()) return;
    inFlight.current = true; const version = cycle.current; setBusy(true); setError(null); setFeedback(null); setPermission(null); setClearInputs(value => value + 1);
    const stillCurrent = () => connected() && cycle.current === version;
    try {
      let local = await readLocal(); if (!stillCurrent()) return;
      if (step === 'prepare' && local.state === 'none' && draft) {
        local = { state: 'pending', intent: await prepareCounterRefundIntent(access.client.tenantStore, { ownerId: access.ownerId, orderId, body: draft, phase: 'prepared' }) };
      }
      if (step === 'no-effect' && draft && resolutionReason) {
        const latest = await transport.read(orderId); if (!stillCurrent()) return;
        local = { state: 'pending', intent: await prepareCounterRefundNoEffect(access.client.tenantStore,
          { ownerId: access.ownerId, orderId, body: draft, phase: 'no_effect_requested', resolutionReason }, latest) };
      }
      if (!stillCurrent()) return;
      if (local.state !== 'pending') throw Error('Reprenez la demande existante avec son auteur ou faites vérifier le dossier par un propriétaire.');
      let intent = local.intent;
      if (step === 'start') intent = await markCounterRefundIntent(access.client.tenantStore, intent, 'start_requested');
      if (step === 'withdraw') intent = await markCounterRefundIntent(access.client.tenantStore, intent, 'withdraw_requested');
      if (step === 'confirm') {
        // A fresh server read may attest start while the prepare response was
        // lost locally. The uncertainty marker still precedes confirmation.
        if (intent.phase === 'prepared') intent = await markCounterRefundIntent(access.client.tenantStore, intent, 'start_requested');
        intent = await markCounterRefundIntent(access.client.tenantStore, intent, 'confirm_requested');
      }
      if (!stillCurrent()) return;
      setPending(intent);
      const requestAt = performance.now();
      const result = await transport.send(orderId, step, { ...intent.body, clientProtocolVersion: 1, authorization: counterRefundAuthorization(access.role === 'owner' && access.ownerId.includes(':user:') ? 'owner' : 'staff', secret),
        ...(step === 'confirm' ? { attestation: intent.body.tender === 'cash' ? 'cash_returned' : 'terminal_refund_confirmed' } : {}),
        ...(step === 'no-effect' ? { attestation: 'no_money_returned', resolutionReason: intent.resolutionReason } : {}) });
      if (!stillCurrent()) return;
      await accept(result.journal); if (!stillCurrent()) return;
      const recorded = result.journal.operations.find(op => op.operationId === intent.body.operationId)!;
      // Subtract the complete request/commit duration from the server's window.
      // Neither the client wall clock nor a reload may extend this permission.
      const until = requestAt + (Date.parse(recorded.disburseExpiresAt ?? '') - Date.parse(result.journal.observedAt));
      if (result.mayDisburse && Number.isFinite(until) && until > performance.now()) setPermission({ operationId: intent.body.operationId, until });
      setFeedback(recorded.state === 'confirmed' ? 'Le remboursement attesté est enregistré.'
        : recorded.state === 'withdrawn' ? 'La demande est fermée. Aucun remboursement n’est autorisé.'
          : recorded.state === 'not_executed' ? 'L’absence de remboursement est enregistrée par le propriétaire.' : null);
    } catch (cause) {
      if (current()) { setError(cause instanceof Error ? cause.message : 'La réponse reste à vérifier.');
        setProcessingWarning('Un envoi n’a pas été confirmé complètement. Le journal fait foi pour le geste ; si le dossier y est enregistré, faites vérifier son suivi administratif sans rembourser à nouveau.');
        await readLocal().catch(() => undefined); }
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  async function adopt(operationId: string) {
    if (inFlight.current || !connected()) return;
    inFlight.current = true; setBusy(true); setError(null); setPermission(null); const version = cycle.current;
    try {
      const view = await transport.read(orderId); if (!connected() || cycle.current !== version) return;
      await adoptCounterRefundIntent(access.client.tenantStore, access.ownerId, orderId, operationId, view);
      if (connected() && cycle.current === version) await accept(view);
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'La demande reste à vérifier.'); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  async function closeDecision() {
    if (!pending || inFlight.current || !connected()) return;
    inFlight.current = true; setBusy(true); const version = cycle.current;
    try {
      const view = await transport.read(orderId);
      if (!connected() || cycle.current !== version) return;
      await closeSupersededCounterRefundResolution(access.client.tenantStore, pending, view);
      if (current()) { await accept(view); setFeedback('La décision déjà enregistrée est conservée. Cette demande locale est fermée.'); }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'La décision reste à vérifier.'); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  return { journal, pending, blocked, busy, loading, offline, error, feedback, processingWarning, clearInputs,
    permission: offline || !permission || permission.until <= performance.now() ? null : permission.operationId, refresh, act, closeDecision, adopt };
}
