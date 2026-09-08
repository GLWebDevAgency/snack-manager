import { CustomerAccountBrowserRequests, CustomerBrowserPreparationSchema, type CustomerBrowserPreparation } from '@sm/contracts';
import { customerAccountRequest, type CustomerAccountRequest } from './client';
import { customerBrowserJournal, type CustomerBrowserJournal, type CustomerBrowserJournalStore } from './browser-journal';

export type CustomerBrowserPreparationResult = { kind: 'ready' | 'expired'; preparation: CustomerBrowserPreparation }
  | { kind: 'absent' | 'uncertain' | 'blocked' };
type Port = {
  journal: CustomerBrowserJournalStore;
  request: CustomerAccountRequest;
  lock?: (work: () => Promise<CustomerBrowserPreparationResult>) => Promise<CustomerBrowserPreparationResult>;
  uuid: () => string;
  changed?: () => void;
};

/** No mounting side effect, SMS, OTP, session recovery or private projection.
 * `begin` and `restartExpired` are explicit user intentions. After uncertainty,
 * resume only rereads the same preparation and confirms the cookie actually
 * received; it NEVER repeats issue, invents a new reference or infers absence
 * from an HTTP error. Guest-intent closure is a separate, still closed flow. */
export function createCustomerBrowserPreparation(port: Port) {
  async function restoreMissingJournal(): Promise<CustomerBrowserPreparationResult> {
    if (!port.lock) return { kind: 'blocked' };
    try {
      return await port.lock(async () => {
        // Never replace an existing selector or repair corrupt storage. This
        // explicit operation restores only browser metadata, not a publication.
        if (await port.journal.read() !== null) return { kind: 'blocked' };
        const request = CustomerAccountBrowserRequests.browser.parse({ step: 'restore' });
        const preparation = CustomerBrowserPreparationSchema.parse(await port.request('browser', request));
        if (await port.journal.read() !== null) return { kind: 'uncertain' };
        const now = Date.now();
        if (preparation.state !== 'confirmed' || preparation.expiresAt <= now
          || preparation.expiresAt > now + 604_800_000 || preparation.admissionExpiresAt > now + 600_000) {
          return { kind: 'uncertain' };
        }
        // The strict transaction checks null again, including uncoordinated
        // writes made after the last read. No verification/session is adopted.
        await port.journal.write({ version: 1, browserRef: preparation.browserRef, phase: 'ready' }, null);
        port.changed?.();
        // Committing IndexedDB may itself cross expiry. Keep the committed
        // selector for explicit resumption, but never advertise it as usable.
        if (preparation.expiresAt <= Date.now()) return { kind: 'uncertain' };
        return { kind: 'ready', preparation };
      });
    } catch { return { kind: 'uncertain' }; }
  }
  async function readServer(record: CustomerBrowserJournal, step: 'prepare' | 'issue' | 'confirm') {
    const input = CustomerAccountBrowserRequests.browser.parse({ step, browserRef: record.browserRef });
    const view = CustomerBrowserPreparationSchema.parse(await port.request('browser', input));
    if (view.browserRef !== record.browserRef) throw new Error('Preparation changed');
    if (JSON.stringify(await port.journal.read()) !== JSON.stringify(record)) throw new Error('Journal changed');
    return view;
  }
  async function move(record: CustomerBrowserJournal, phase: CustomerBrowserJournal['phase']) {
    const next = { ...record, phase };
    await port.journal.write(next, record); port.changed?.(); return next;
  }
  async function advance(initial: CustomerBrowserJournal): Promise<CustomerBrowserPreparationResult> {
    let record = initial;
    let view = await readServer(record, 'prepare');
    if (view.state === 'expired') return { kind: 'expired', preparation: view };
    if (view.state === 'prepared') {
      // This phase is durable BEFORE issue. An issuing phase + prepared server
      // state can describe a still-delayed request, not permission to resend it.
      if (record.phase !== 'preparing') return { kind: 'uncertain' };
      record = await move(record, 'issuing');
      view = await readServer(record, 'issue');
      if (view.state === 'expired') return { kind: 'expired', preparation: view };
      if (view.state !== 'issued' && view.state !== 'confirmed') return { kind: 'uncertain' };
    }
    record = await move(record, 'confirming');
    view = await readServer(record, 'confirm');
    if (view.state === 'expired') return { kind: 'expired', preparation: view };
    if (view.state !== 'confirmed') return { kind: 'uncertain' };
    await move(record, 'ready');
    return { kind: 'ready', preparation: view };
  }
  async function run(mode: 'begin' | 'resume' | 'restart'): Promise<CustomerBrowserPreparationResult> {
    if (!port.lock) return { kind: 'blocked' };
    try {
      return await port.lock(async () => {
        let record = await port.journal.read();
        if (mode === 'restart') {
          if (!record) return { kind: 'absent' };
          // A new reference is allowed only after the old admission is durably
          // terminal. No timeout, absent receipt or HTTP404 can prove that.
          const previous = await readServer(record, 'prepare');
          if (previous.state !== 'expired') return { kind: 'uncertain' };
          const next: CustomerBrowserJournal = { version: 1, browserRef: port.uuid(), phase: 'preparing' };
          await port.journal.write(next, record); port.changed?.(); record = next;
        } else if (!record) {
          if (mode === 'resume') return { kind: 'absent' };
          record = { version: 1, browserRef: port.uuid(), phase: 'preparing' };
          await port.journal.write(record, null);
          port.changed?.();
        }
        return advance(record);
      });
    } catch { return { kind: 'uncertain' }; }
  }
  return { begin: () => run('begin'), resume: () => run('resume'), restartExpired: () => run('restart'), restoreMissingJournal };
}

/** Same native lock as profile/logout, independent from checkout's journal. */
export function customerBrowserPreparation(slug: string, changed = () => notifyCustomerAccountChanged(slug)) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return createCustomerBrowserPreparation({ journal: customerBrowserJournal(slug), request: customerAccountRequest(slug),
    uuid: () => crypto.randomUUID(),
    changed,
    lock: locks ? async work => await locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, work) : undefined,
  });
}

export function notifyCustomerAccountChanged(slug: string) {
  const key = `sm:customer:invalidate:${slug}`; const nonce = crypto.randomUUID(); let sent = false;
  try { const channel = new BroadcastChannel(key); channel.postMessage(nonce); channel.close(); sent = true; } catch { /* Try storage. */ }
  try { localStorage.setItem(key, nonce); sent = true; } catch { /* BroadcastChannel may suffice. */ }
  window.dispatchEvent(new Event(key));
  if (!sent) throw new Error('Cross-tab invalidation unavailable');
}
