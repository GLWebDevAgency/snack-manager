"use client";

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { customerBrowserJournal, type CustomerBrowserJournal } from './browser-journal';
import { customerBrowserPreparation } from './browser-preparation';
import { customerVerification } from './verification';
import { customerProtection } from './protection';
import { customerAccess } from './access';

type Snapshot = { record: CustomerBrowserJournal | null; loading: boolean; busy: boolean;
  message: string | null; code: string | null; clearInputs: number; outcome: string | null; storageError: boolean };
const EMPTY: Snapshot = { record: null, loading: true, busy: false, message: null, code: null, clearInputs: 0, outcome: null, storageError: false };
const messages: Record<string, string> = {
  uncertain: 'Cette étape n’est pas confirmée. Vérifiez son résultat avant de continuer. Aucun SMS ne sera renvoyé automatiquement.',
  blocked: 'Cette action ne peut pas être sécurisée pour le moment. Vérifiez l’étape en cours et utilisez un navigateur à jour.',
  invalid: 'Vérifiez votre saisie avant de continuer.', cancelled: 'La demande de clé a été annulée. Vous pouvez la relancer explicitement.',
  unavailable: 'La clé d’accès n’est pas disponible sur ce navigateur. Essayez un navigateur récent sur ce même domaine.',
  incorrect: 'Le code n’est pas correct. Vous pouvez saisir à nouveau les six chiffres reçus.',
  expired: 'Cette préparation a expiré. Aucun compte n’a été activé par cette étape.',
  closed: 'Cette tentative a été fermée. Vous pouvez continuer en invité ou préparer une nouvelle inscription.',
  failed: 'Cette vérification ne peut pas aboutir. Fermez cette tentative avant de recommencer.',
  paused: 'La démarche est en pause. Son résultat devra être vérifié à votre retour.',
};

/** A mounted panel reads only its public journal. All HTTP mutations and
 * WebAuthn prompts are reached exclusively from explicit UI actions. */
function runtime(slug: string) {
  let state = EMPTY, mounted = false, generation = 0, ownNotification = false;
  let channel: BroadcastChannel | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const journal = customerBrowserJournal(slug), key = `sm:customer:invalidate:${slug}`;
  const active = () => mounted && document.visibilityState !== 'hidden' && navigator.onLine !== false;
  const publish = (patch: Partial<Snapshot>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
  const announce = () => {
    const nonce = crypto.randomUUID(); let sent = false;
    try { if (channel) { channel.postMessage(nonce); sent = true; } } catch { /* Storage also signals other tabs. */ }
    try { localStorage.setItem(key, nonce); sent = true; } catch { /* BroadcastChannel may suffice. */ }
    ownNotification = true; try { window.dispatchEvent(new Event(key)); } finally { ownNotification = false; }
    if (!sent) throw new Error('Cross-tab invalidation unavailable');
  };
  const preparation = customerBrowserPreparation(slug, announce);
  const verification = customerVerification(slug, active, announce);
  const protection = customerProtection(slug, active, announce);
  const access = customerAccess(slug, active, announce);
  async function read(version = generation) {
    try {
      const record = await journal.read();
      if (mounted && generation === version) {
        const selected = record?.access ?? record?.verification;
        // A final logout notification may reach the newly mounted guest form.
        // Rereading public terminal/absent state can unlock its initial choices;
        // it neither restores a private view nor resumes an unfinished action.
        const idleAgain = state.outcome === 'paused' && active()
          && (!selected || ['completed', 'closed', 'expired'].includes(selected.phase));
        publish({ record, loading: false, storageError: false, ...(idleAgain ? { outcome: null, message: null } : {}) }); clearTimeout(expiry);
        const until = selected?.expiresAt;
        if (until && selected?.phase !== 'completed' && until > Date.now()) expiry = setTimeout(pause, until - Date.now());
      }
      return record;
    } catch {
      if (mounted && generation === version) publish({ record: null, loading: false, storageError: true,
        message: 'Le journal de cet accès est indisponible. Il ne sera pas remplacé automatiquement.' });
      throw new Error('Journal unavailable');
    }
  }
  function pause() {
    generation++; verification.pause(); protection.pause(); access.pause();
    publish({ code: null, clearInputs: state.clearInputs + 1, outcome: 'paused', message: messages.paused!, loading: false });
  }
  const incoming = () => { if (!ownNotification) { pause(); void read().catch(() => undefined); } };
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) incoming(); };
  const visibility = () => { if (!active()) pause(); else void read().catch(() => undefined); };
  async function action(work: () => Promise<{ kind: string; code?: string | null; message?: string }>) {
    if (state.busy || !active()) return;
    const version = generation;
    publish({ busy: true, message: null, code: null, outcome: null });
    try {
      const result = await work();
      if (active() && generation === version) {
        await read(version);
        const accessMessages: Record<string, string> = {
          uncertain: 'Cette connexion n’est pas confirmée. Vérifiez son résultat avant de continuer.',
          failed: 'Cette tentative a été refusée définitivement. Vous pouvez en préparer une nouvelle.',
          closed: 'Cette démarche a été fermée. Aucun autre accès n’a été déconnecté.',
        };
        if (active() && generation === version) publish({ outcome: result.kind, message: result.message ?? (state.record?.access ? accessMessages[result.kind] : undefined) ?? messages[result.kind] ?? null,
          code: result.kind === 'recovery-code' ? result.code ?? null : null });
      }
    } catch { if (active() && generation === version) publish({ outcome: 'uncertain', message: messages.uncertain! }); }
    finally { publish({ busy: false }); }
  }
  return {
    getSnapshot: () => state, getServerSnapshot: () => EMPTY,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    retain() {
      mounted = true;
      try { channel = new BroadcastChannel(key); channel.addEventListener('message', incoming); } catch { channel = null; }
      window.addEventListener(key, incoming); window.addEventListener('storage', storage);
      window.addEventListener('offline', pause); window.addEventListener('pagehide', pause);
      window.addEventListener('online', visibility); document.addEventListener('visibilitychange', visibility);
      void read().catch(() => undefined);
      return () => { mounted = false; generation++; clearTimeout(expiry); verification.pause(); protection.pause(); access.pause();
        // No secret survives closing the panel, even if this runtime is retained
        // briefly by React while the sheet's exit animation completes.
        state = { ...state, code: null, clearInputs: state.clearInputs + 1 };
        channel?.close(); channel = null; window.removeEventListener(key, incoming); window.removeEventListener('storage', storage);
        window.removeEventListener('offline', pause); window.removeEventListener('pagehide', pause);
        window.removeEventListener('online', visibility); document.removeEventListener('visibilitychange', visibility); };
    },
    begin: () => action(async () => {
      const record = await journal.read();
      if (record?.phase !== 'ready') {
        const ready = await preparation.begin();
        if (ready.kind !== 'ready') return ready;
        if (!active()) return { kind: 'paused' };
      }
      return verification.begin();
    }),
    restore: () => action(async () => {
      const result = await preparation.restoreMissingJournal();
      return { ...result, message: result.kind === 'ready'
        ? 'Cet appareil est reconnu. Aucun compte personnel n’a été reconnecté.'
        : 'Cet appareil n’a pas pu être repris. Vous pouvez réessayer ou commencer une inscription. Aucun compte n’a été reconnecté.' };
    }),
    beginAccess: (method: 'passkey' | 'recovery') => action(async () => {
      const record = await journal.read();
      if (record?.phase !== 'ready') {
        const ready = await preparation.begin();
        if (ready.kind !== 'ready') return ready;
        if (!active()) return { kind: 'paused' };
      }
      const prepared = await access.begin(method);
      return prepared.kind === 'prepared' && method === 'passkey' && active() ? access.login() : prepared;
    }),
    login: () => action(() => access.login()),
    recoverAccess: (code: string) => action(() => access.recover(code)),
    retryAccess: () => action(() => access.retry()),
    restartBrowser: () => action(() => preparation.restartExpired()),
    resume: () => action(async () => {
      const record = await journal.read();
      if (record?.phase !== 'ready') return preparation.resume();
      if (record.access) return access.resume();
      return record.verification?.phase === 'protecting' ? protection.resume() : verification.resume();
    }),
    start: (phone: string, human: string) => action(() => verification.start(phone, human)),
    check: (code: string) => action(() => verification.check(code)),
    register: () => action(async () => (await journal.read())?.access ? access.register() : protection.register()),
    assert: () => action(async () => (await journal.read())?.access ? access.assert() : protection.assert()),
    recoveryCode: () => action(async () => (await journal.read())?.access ? access.recoveryCode() : protection.recoveryCode()),
    activate: (code: string) => action(async () => (await journal.read())?.access ? access.activate(code) : protection.activate(code)),
    close: () => action(async () => (await journal.read())?.access ? access.close() : verification.close()),
    hideCode: () => publish({ code: null }),
  };
}
export function useCustomerEnrollment(slug: string) {
  const flow = useMemo(() => typeof window === 'undefined' ? null : runtime(slug), [slug]);
  const state = useSyncExternalStore(flow?.subscribe ?? (() => () => undefined), flow?.getSnapshot ?? (() => EMPTY), () => EMPTY);
  useEffect(() => flow?.retain(), [flow]);
  return { state, flow };
}
