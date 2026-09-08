import { CustomerAccountBrowserRequests, CustomerAccountResponses, CustomerVerificationIntentSchema,
  CustomerVerificationPublicResultSchema } from '@sm/contracts';
import { customerBrowserJournal, type CustomerBrowserJournal, type CustomerBrowserJournalStore,
  type CustomerVerificationJournal } from './browser-journal';
import { notifyCustomerAccountChanged } from './browser-preparation';
import { customerAccountRequest, type CustomerAccountRequest } from './client';

export type CustomerVerificationOutcome = {
  kind: 'prepared' | 'code_required' | 'incorrect' | 'approved' | 'closed' | 'expired' | 'failed'
    | 'uncertain' | 'absent' | 'blocked' | 'paused' | 'invalid';
};
type Port = {
  journal: CustomerBrowserJournalStore; request: CustomerAccountRequest; uuid: () => string;
  lock?: (work: () => Promise<CustomerVerificationOutcome>) => Promise<CustomerVerificationOutcome>;
  changed?: () => void; active?: () => boolean;
};
type PreparedRecord = CustomerBrowserJournal & { verification: CustomerVerificationJournal };

/** No mounting side effect. Inputs live only in a single call; the journal has
 * public selectors/phases, never phone, OTP, proof, session or private profile.
 * Close is an explicit durable command; panel dismissal only pauses. */
export function createCustomerVerification(port: Port) {
  let generation = 0;
  const active = () => port.active?.() !== false;
  const current = (run: number) => run === generation && active();
  async function selected() {
    const record = await port.journal.read();
    if (record?.phase !== 'ready') throw new Error('Browser preparation required');
    return record;
  }
  async function unchanged(record: CustomerBrowserJournal, run: number) {
    if (!current(run)) throw new Error('Selection changed');
    const latest = await port.journal.read();
    if (!current(run) || JSON.stringify(latest) !== JSON.stringify(record)) throw new Error('Selection changed');
  }
  async function move(record: PreparedRecord, patch: Partial<CustomerVerificationJournal>, run: number): Promise<PreparedRecord> {
    await unchanged(record, run);
    const next = { ...record, verification: { ...record.verification, ...patch } };
    await port.journal.write(next, record); port.changed?.(); return next;
  }
  async function request(record: PreparedRecord, action: Parameters<CustomerAccountRequest>[0], body: unknown, run: number) {
    await unchanged(record, run);
    if (!current(run)) throw new Error('Selection changed');
    const output = await port.request(action, body);
    await unchanged(record, run);
    return output;
  }
  async function close(record: PreparedRecord, run: number): Promise<CustomerVerificationOutcome> {
    record = await move(record, { phase: 'closing' }, run);
    const view = CustomerVerificationIntentSchema.parse(await request(record, 'intent',
      { step: 'close', operationId: record.verification.operationId }, run));
    if (view.operationId !== record.verification.operationId || !['closed', 'expired'].includes(view.state)) throw new Error('Closure unconfirmed');
    await move(record, { phase: 'closed', expiresAt: view.expiresAt }, run);
    return { kind: 'closed' };
  }
  async function result(record: PreparedRecord, run: number): Promise<CustomerVerificationOutcome> {
    const choice = record.verification;
    const view = CustomerVerificationPublicResultSchema.parse(await request(record, 'recover',
      { operationId: choice.operationId, checkId: choice.checkId }, run));
    // A terminal receipt can omit a challenge that no longer grants any
    // authority. A different challenge, or an approved mismatch, never can.
    const terminalWithoutChallenge = view.challengeId === null && ['closed', 'expired'].includes(view.state);
    if (view.operationId !== choice.operationId || view.checkId !== choice.checkId
      || (choice.challengeId !== null && view.challengeId !== choice.challengeId && !terminalWithoutChallenge)) throw new Error('Result changed');
    const metadata = { expiresAt: view.expiresAt, challengeId: view.challengeId };
    if (view.state === 'unresolved') {
      // This journal phase proves no start was sent by the controller. A start
      // writes `starting` durably first. Never make the same inference there.
      if (['preparing', 'prepared'].includes(choice.phase) && view.challengeId === null && view.checkId === null) {
        await move(record, { ...metadata, phase: 'prepared' }, run); return { kind: 'prepared' };
      }
      return { kind: 'uncertain' };
    }
    const phase = view.state === 'approved' ? 'completed' : view.state === 'code_required' ? 'code' : view.state;
    await move(record, { ...metadata, phase }, run);
    // The private profile is validated but not published here. The normal
    // account client must read its fresh session using the received cookie.
    return { kind: view.state };
  }
  async function run(work: (record: CustomerBrowserJournal, version: number) => Promise<CustomerVerificationOutcome>) {
    if (!port.lock) return { kind: 'blocked' } as const;
    if (!active()) return { kind: 'paused' } as const;
    const version = generation;
    try { return await port.lock(async () => {
      if (!current(version)) return { kind: 'paused' };
      return work(await selected(), version);
    }); } catch { return { kind: current(version) ? 'uncertain' : 'paused' } as const; }
  }
  return {
    pause() { generation++; },
    begin: () => run(async (record, version) => {
      if (record.verification && !['closed', 'expired', 'failed'].includes(record.verification.phase)) return { kind: 'uncertain' };
      const next: PreparedRecord = { ...record, verification: { operationId: port.uuid(), phase: 'preparing', challengeId: null, checkId: null, expiresAt: null } };
      await port.journal.write(next, record); port.changed?.();
      const view = CustomerVerificationIntentSchema.parse(await request(next, 'intent', { step: 'prepare', operationId: next.verification.operationId }, version));
      if (view.operationId !== next.verification.operationId || view.state !== 'open') throw new Error('Intent unconfirmed');
      await move(next, { phase: 'prepared', expiresAt: view.expiresAt }, version);
      return { kind: 'prepared' };
    }),
    start: (phone: string, turnstileToken: string) => run(async (record, version) => {
      if (record.verification?.phase !== 'prepared') return { kind: 'blocked' };
      const body = CustomerAccountBrowserRequests.start.safeParse({ phone, turnstileToken, operationId: record.verification.operationId });
      if (!body.success) return { kind: 'invalid' };
      const next = await move(record as PreparedRecord, { phase: 'starting' }, version);
      const view = CustomerAccountResponses.start.parse(await request(next, 'start', body.data, version));
      await move(next, { phase: 'code', challengeId: view.challengeId, expiresAt: view.expiresAt }, version);
      return { kind: 'code_required' };
    }),
    check: (code: string) => run(async (record, version) => {
      const choice = record.verification;
      if (!choice || !['code', 'incorrect'].includes(choice.phase) || !choice.challengeId) return { kind: 'blocked' };
      const body = CustomerAccountBrowserRequests.check.safeParse({ operationId: choice.operationId,
        challengeId: choice.challengeId, checkId: port.uuid(), code });
      if (!body.success) return { kind: 'invalid' };
      const next = await move(record as PreparedRecord, { phase: 'checking', checkId: body.data.checkId }, version);
      try { await request(next, 'check', body.data, version); } catch { /* Read the durable result, never retry an OTP. */ }
      return result(next, version);
    }),
    resume: () => run(async (record, version) => {
      if (!record.verification) return { kind: 'absent' };
      if (record.verification.phase === 'closing') return close(record as PreparedRecord, version);
      if (['closed', 'expired', 'failed'].includes(record.verification.phase)) return { kind: record.verification.phase as 'closed' | 'expired' | 'failed' };
      return result(record as PreparedRecord, version);
    }),
    close: () => run(async (record, version) => record.verification ? close(record as PreparedRecord, version) : { kind: 'absent' }),
  };
}

export function customerVerification(slug: string, active?: () => boolean) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return createCustomerVerification({ journal: customerBrowserJournal(slug), request: customerAccountRequest(slug),
    uuid: () => crypto.randomUUID(), active, changed: () => notifyCustomerAccountChanged(slug),
    lock: locks ? async work => await locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, work) : undefined,
  });
}
