import { useCallback, useEffect, useRef, useState } from 'react';
import { SlotsResponseSchema, type SlotsResponse } from '@sm/contracts';
import { requireCrossContextStoreLock, SmApiError, TransportUnreachable, type SmClient } from '@sm/client-core';
import { createPhoneOrderFlow, withPhoneOrderDeadline } from './phone-order-flow';
import { PHONE_ORDER_ATTEMPT_KEY, readPhoneOrderJournal, type PhoneOrderAttempt,
  type PhoneOrderReceipt, type ReceivedPhoneOrderAttempt } from './phone-order-attempt';
import type { SaleInFlightGate } from './pos-safety';

export function phoneServiceDay(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  return ['year', 'month', 'day'].map((name) => parts.find((part) => part.type === name)?.value).join('-');
}
const STATE_EVENT = 'sm:phone-order-state';
const messageOf = (cause: unknown) => cause instanceof TransportUnreachable
  ? 'Connexion interrompue. La tentative est conservée ; reprenez sa confirmation sans créer un autre ticket.'
  : cause instanceof Error ? cause.message : 'La commande téléphone reste à vérifier.';

export interface PhoneTicketControls {
  date: string;
  slots: SlotsResponse | null;
  slotsBusy: boolean;
  slotsError: string | null;
  unavailable: string | null;
  canSubmit: boolean;
  onDate: (date: string) => void;
  onRefresh: () => void;
  onSubmit: () => void;
}

interface Options {
  client: SmClient;
  enabled: boolean;
  ready: boolean;
  slug: string;
  isCurrentPairing: () => boolean;
  gate: SaleInFlightGate;
  onBusy: (busy: boolean) => void;
  onUnauthorized: () => void;
  repair: (attempt: ReceivedPhoneOrderAttempt) => Promise<void>;
}

/** Observable state; submission/repair remain explicit events, not effects. */
export function usePhoneOrder(options: Options) {
  const latest = useRef(options); latest.current = options;
  const [attempt, setAttempt] = useState<PhoneOrderAttempt | null>(null);
  const [confirmed, setConfirmed] = useState<PhoneOrderReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(() => phoneServiceDay());
  const [slots, setSlots] = useState<SlotsResponse | null>(null);
  const [slotsBusy, setSlotsBusy] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const tenant = useRef<string | null>(null);
  const slotGeneration = useRef(0);
  const stateGeneration = useRef(0);
  let unsupported: string | null = null;
  try { requireCrossContextStoreLock(); } catch (cause) { unsupported = messageOf(cause); }

  const refresh = useCallback(async () => {
    const generation = ++stateGeneration.current;
    try {
      const file = await readPhoneOrderJournal(latest.current.client.tenantStore);
      if (!alive.current || generation !== stateGeneration.current) return;
      if (file && tenant.current && file.tenantId !== tenant.current) throw new Error('La reprise appartient à un autre établissement. Aucune nouvelle commande autorisée.');
      if (file) tenant.current = file.tenantId;
      setAttempt(file?.active ?? null); setStorageError(null); setLoaded(true);
    } catch (cause) {
      if (alive.current && generation === stateGeneration.current) { setStorageError(messageOf(cause)); setLoaded(false); }
    }
  }, []);

  const loadSlots = useCallback(async () => {
    const generation = ++slotGeneration.current;
    if (alive.current) { setSlotsBusy(true); setSlotsError(null); }
    try {
      const context = latest.current;
      if (!context.isCurrentPairing()) throw new Error('Reconnectez ce poste à son établissement.');
      if (globalThis.navigator?.onLine === false) throw new Error('Connexion requise pour proposer un créneau confirmé par le restaurant.');
      const response = await withPhoneOrderDeadline(context.client.get<unknown>(`/orders/slots?date=${encodeURIComponent(date)}`));
      if (!response || typeof response !== 'object' || !('tenantId' in response) || typeof response.tenantId !== 'string'
        || !/^[a-f0-9]{24}$/i.test(response.tenantId)) throw new Error('Les créneaux reçus ne permettent pas de vérifier l’établissement.');
      const parsed = SlotsResponseSchema.safeParse(response);
      if (!parsed.success || parsed.data.date !== date) throw new Error('Les créneaux reçus sont illisibles. Actualisez avant de confirmer.');
      if (tenant.current && tenant.current !== response.tenantId) throw new Error('Le restaurant de cette reprise ne correspond pas à la session.');
      if (!alive.current || generation !== slotGeneration.current || !context.isCurrentPairing()) return;
      tenant.current = response.tenantId; setSlots(parsed.data);
    } catch (cause) {
      if (alive.current && generation === slotGeneration.current) { setSlots(null); setSlotsError(messageOf(cause)); }
      if (cause instanceof SmApiError && cause.status === 401) latest.current.onUnauthorized();
    } finally { if (alive.current && generation === slotGeneration.current) setSlotsBusy(false); }
  }, [date]);

  useEffect(() => {
    alive.current = true;
    const change = (event?: Event) => {
      if (event?.type === 'storage' && (event as StorageEvent).key !== PHONE_ORDER_ATTEMPT_KEY) return;
      void refresh();
    };
    void refresh();
    globalThis.addEventListener?.('storage', change);
    globalThis.addEventListener?.(STATE_EVENT, change);
    globalThis.addEventListener?.('focus', change);
    return () => {
      alive.current = false; stateGeneration.current++; slotGeneration.current++;
      globalThis.removeEventListener?.('storage', change);
      globalThis.removeEventListener?.(STATE_EVENT, change);
      globalThis.removeEventListener?.('focus', change);
    };
  }, [refresh, options.slug]);

  useEffect(() => {
    if (!options.enabled) return;
    void loadSlots();
    const onOnline = () => { void loadSlots(); void refresh(); };
    globalThis.addEventListener?.('online', onOnline);
    return () => globalThis.removeEventListener?.('online', onOnline);
  }, [loadSlots, refresh, options.enabled]);

  const run = useCallback(async (action: 'submit' | 'resume' | 'abandon' | 'release' | 'finish', body?: unknown, draftId?: string) => {
    const context = latest.current;
    if (inFlight.current || !context.ready || !context.gate.tryStart()) return;
    inFlight.current = true;
    setBusy(true); context.onBusy(true); setError(null);
    try {
      requireCrossContextStoreLock();
      if (!context.isCurrentPairing()) throw new Error('L’appairage du poste a changé. Aucune nouvelle commande autorisée.');
      const file = await readPhoneOrderJournal(context.client.tenantStore);
      const tenantId = file?.tenantId ?? tenant.current;
      if (!tenantId || (tenant.current && tenant.current !== tenantId)) throw new Error('Vérifiez les créneaux du restaurant avant de confirmer.');
      const flow = createPhoneOrderFlow({ store: context.client.tenantStore, tenantId,
        request: (path, requestBody) => context.client.direct('POST', path, requestBody),
        assertReady: () => {
          if (!alive.current || !context.isCurrentPairing()) throw new Error('Session ou établissement modifié. La tentative est conservée.');
          if (globalThis.navigator?.onLine === false) throw new Error('Connexion requise. La tentative est conservée sans nouvelle vente.');
        } });
      let observed: PhoneOrderAttempt | undefined;
      if (action === 'submit') observed = await flow.submit(body, draftId!);
      else if (action === 'resume') observed = await flow.resume();
      else if (action === 'abandon') observed = await flow.abandon();
      else if (action === 'release') { await flow.releaseRejected(); void loadSlots(); }
      // Un clic « confirmer B » qui découvre A n'est pas un consentement à
      // terminer/encaisser A. Montrer sa reprise, puis attendre un geste nommé.
      if ((observed?.state === 'received' && (action !== 'submit' || observed.draftId === draftId)) || action === 'finish') {
        const receipt = await flow.finish(context.repair);
        if (alive.current) setConfirmed(receipt);
      }
    } catch (cause) {
      if (alive.current) setError(messageOf(cause));
      if (cause instanceof SmApiError && cause.status === 401) context.onUnauthorized();
    } finally {
      await refresh();
      if (typeof Event === 'function') globalThis.dispatchEvent?.(new Event(STATE_EVENT));
      if (alive.current) { setBusy(false); context.onBusy(false); }
      inFlight.current = false; context.gate.finish();
    }
  }, [loadSlots, refresh]);

  return { attempt, confirmed, error, busy, loaded, date, slots, slotsBusy, slotsError,
    unavailable: unsupported ?? storageError,
    setDate, refreshSlots: () => { void loadSlots(); }, clearConfirmed: () => setConfirmed(null),
    submit: (body: unknown, draftId: string) => { void run('submit', body, draftId); },
    resume: () => { void run('resume'); }, abandon: () => { void run('abandon'); },
    release: () => { void run('release'); }, finish: () => { void run('finish'); } };
}
