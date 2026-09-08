import { CustomerPasskeyLoginPublicResponseSchema, CustomerPasskeyLoginRequestSchema, CustomerRecoveryPublicResponseSchema,
  CustomerRecoveryRequestSchema, CustomerVerificationIntentSchema, type CustomerPasskeyLoginRequest,
  type CustomerRecoveryRequest, type CustomerRecoveryPublicResponse, type CustomerPasskeyLoginPublicResponse } from '@sm/contracts';
import { customerBrowserJournal, CustomerBrowserJournalSchema, type CustomerBrowserJournal, type CustomerBrowserJournalStore,
  type CustomerAccessJournal, type CustomerProtectionJournal } from './browser-journal';
import { customerAccountRequest, type CustomerAccountRequest } from './client';
import { customerPasskeyBrowser } from './passkey-browser';
import { notifyCustomerAccountChanged } from './browser-preparation';

export type CustomerAccessOutcome = { kind: 'recovery-code'; code: string | null } | {
  kind: 'prepared' | 'recovery' | 'authenticated' | 'failed' | 'closed' | 'uncertain' | 'blocked' | 'paused' | 'cancelled' | 'unavailable' | 'invalid' };
type Port = { journal: CustomerBrowserJournalStore; request: CustomerAccountRequest; uuid: () => string;
  passkeys: ReturnType<typeof customerPasskeyBrowser>; active?: () => boolean; changed?: () => void;
  lock?: (work: () => Promise<CustomerAccessOutcome>) => Promise<CustomerAccessOutcome> };
type Record = CustomerBrowserJournal & { access: CustomerAccessJournal };
type Result = CustomerPasskeyLoginPublicResponse | CustomerRecoveryPublicResponse;
const stages = ['registration_required', 'assertion_required', 'recovery_required'];
const binding = (record: Record) => ({ operationId: record.access.operationId, attemptId: record.access.attemptId });

/** Login and recovery are not OTP checks. Only public IDs/stages survive reload.
 * A grant never selects a private session. A durable exact final receipt does.
 * Native gestures, secret inputs and rotations are never automatically replayed. */
export function createCustomerAccess(port: Port) {
  let generation = 0;
  const active = () => port.active?.() !== false;
  const current = (run: number) => generation === run && active();
  async function unchanged(record: CustomerBrowserJournal, run: number) {
    if (!current(run)) throw new Error('Paused');
    const latest = await port.journal.read();
    if (!current(run) || JSON.stringify(latest) !== JSON.stringify(record)) throw new Error('Selection changed');
  }
  async function move(record: Record, access: CustomerAccessJournal, run: number): Promise<Record> {
    await unchanged(record, run); const next = CustomerBrowserJournalSchema.parse({ ...record, access }) as Record;
    await port.journal.write(next, record); port.changed?.(); return next;
  }
  async function intent(record: Record, step: 'prepare' | 'close', run: number) {
    await unchanged(record, run);
    const result = CustomerVerificationIntentSchema.parse(await port.request('intent', { step, operationId: record.access.operationId }));
    await unchanged(record, run);
    if (result.operationId !== record.access.operationId || result.expiresAt > Date.now() + 600_000
      || (step === 'prepare' ? result.state !== 'open' || result.expiresAt <= Date.now() : !['closed', 'expired'].includes(result.state))) throw new Error('Intent unconfirmed');
    return result;
  }
  async function request(record: Record, body: CustomerPasskeyLoginRequest | CustomerRecoveryRequest, run: number): Promise<Result> {
    const action = record.access.method;
    const input = action === 'passkey' ? CustomerPasskeyLoginRequestSchema.parse(body) : CustomerRecoveryRequestSchema.parse(body);
    await unchanged(record, run);
    const raw = await port.request(action, input);
    await unchanged(record, run);
    const result = action === 'passkey' ? CustomerPasskeyLoginPublicResponseSchema.parse(raw) : CustomerRecoveryPublicResponseSchema.parse(raw);
    if (result.state === 'authenticated') {
      const id = action === 'passkey' && (body.step === 'assert' || body.step === 'result') ? body.attemptId
        : (body.step === 'activate' || body.step === 'activation-result') ? body.activationId : null;
      if (!id || result.operationId !== body.operationId || result.publicationId !== id || result.view.expiresAt <= Date.now()
        || result.view.expiresAt > Date.now() + 604_800_000) throw new Error('Publication changed');
    } else {
      const data = 'recovery' in result ? result.recovery : result;
      if (data.operationId !== body.operationId || data.attemptId !== body.attemptId || data.expiresAt > Date.now() + 600_000
        || (record.access.expiresAt !== null && data.expiresAt > record.access.expiresAt)
        || (result.state !== 'failed' && data.expiresAt <= Date.now())) throw new Error('Attempt changed');
      if (result.state === 'recovery-code' && (body.step !== 'recovery-code' || result.recovery.recoveryVersion !== body.expectedVersion + 1)) throw new Error('Rotation changed');
    }
    return result;
  }
  async function accept(record: Record, result: Result, run: number, definitive = false): Promise<CustomerAccessOutcome> {
    if (result.state === 'authenticated') { await move(record, { ...record.access, phase: 'completed' }, run); return { kind: 'authenticated' }; }
    if (result.state === 'failed') { await move(record, { ...record.access, phase: 'failed', expiresAt: result.expiresAt }, run); return { kind: 'failed' }; }
    if (result.state === 'unresolved') {
      // This phase durably precedes every credential request. A successful
      // result attests receipt of the one-shot HttpOnly intention capability;
      // unlike a prepare replay it cannot manufacture a lost cookie.
      if (record.access.phase === 'preparing') {
        await move(record, { ...record.access, phase: 'prepared', expiresAt: result.expiresAt }, run); return { kind: 'prepared' };
      }
      return { kind: 'uncertain' };
    }
    if (result.state === 'options') return { kind: 'uncertain' };
    if (record.access.method !== 'recovery') throw new Error('Wrong flow');
    const old = record.access.protection, next = result.recovery;
    if (old && (stages.indexOf(next.stage) < stages.indexOf(old.stage) || next.recoveryVersion < old.recoveryVersion)) throw new Error('Stage regressed');
    const advanced = !old || next.stage !== old.stage || next.recoveryVersion > old.recoveryVersion;
    const pending = definitive || advanced ? null : old?.pending ?? null;
    await move(record, { ...record.access, phase: 'protecting', expiresAt: next.expiresAt,
      protection: { ...old, stage: next.stage, recoveryVersion: next.recoveryVersion, pending } }, run);
    if (pending) return { kind: 'uncertain' };
    return result.state === 'recovery-code' ? { kind: 'recovery-code', code: result.code } : { kind: 'recovery' };
  }
  async function run(work: (record: CustomerBrowserJournal, version: number) => Promise<CustomerAccessOutcome>): Promise<CustomerAccessOutcome> {
    if (!port.lock) return { kind: 'blocked' }; if (!active()) return { kind: 'paused' };
    const version = generation;
    try { return await port.lock(async () => {
      if (!current(version)) return { kind: 'paused' };
      const record = await port.journal.read();
      if (record?.phase !== 'ready') return { kind: 'blocked' };
      return work(record, version);
    }); } catch { return { kind: current(version) ? 'uncertain' : 'paused' }; }
  }
  const selected = (work: (record: Record, version: number) => Promise<CustomerAccessOutcome>) => run((record, version) =>
    record.access ? work(record as Record, version) : Promise.resolve({ kind: 'blocked' }));
  async function close(record: Record, version: number): Promise<CustomerAccessOutcome> {
    record = await move(record, { ...record.access, phase: 'closing' }, version);
    const result = await intent(record, 'close', version);
    await move(record, { ...record.access, phase: 'closed', expiresAt: result.expiresAt }, version); return { kind: 'closed' };
  }
  async function patchProtection(record: Record, patch: Partial<CustomerProtectionJournal>, version: number) {
    if (record.access.method !== 'recovery' || !record.access.protection) throw new Error('Grant required');
    return move(record, { ...record.access, protection: { ...record.access.protection, ...patch } }, version);
  }
  async function ceremony(record: Record, version: number, kind: 'register' | 'assert'): Promise<CustomerAccessOutcome> {
    if (record.access.method !== 'recovery' || record.access.phase !== 'protecting') return { kind: 'blocked' };
    const p = record.access.protection, registering = kind === 'register';
    if (!p || p.stage !== (registering ? 'registration_required' : 'assertion_required')
      || (p.pending !== null && ![kind, registering ? 'registration-options' : 'assertion-options'].includes(p.pending))) return { kind: 'blocked' };
    const id = (registering ? p.registrationId : p.assertionId) ?? port.uuid();
    record = await patchProtection(record, registering ? { pending: 'registration-options', registrationId: id }
      : { pending: 'assertion-options', assertionId: id }, version);
    const result = await request(record, registering ? { ...binding(record), step: 'registration-options', registrationId: id }
      : { ...binding(record), step: 'assertion-options', assertionId: id }, version);
    if (result.state !== 'registration-options' && result.state !== 'assertion-options') return accept(record, result, version);
    if ((registering && (result.state !== 'registration-options' || result.registrationId !== id))
      || (!registering && (result.state !== 'assertion-options' || result.assertionId !== id))) throw new Error('Options changed');
    await unchanged(record, version);
    const response = result.state === 'registration-options' ? await port.passkeys.register(result.options) : await port.passkeys.authenticate(result.options);
    await unchanged(record, version);
    if (response.kind !== 'completed') {
      await patchProtection(record, { pending: null }, version);
      return { kind: response.kind === 'cancelled' ? 'cancelled' : 'unavailable' };
    }
    record = await patchProtection(record, { pending: kind }, version);
    const body = CustomerRecoveryRequestSchema.parse(registering ? { ...binding(record), step: 'register', registrationId: id, response: response.response }
      : { ...binding(record), step: 'assert', assertionId: id, response: response.response });
    return accept(record, await request(record, body, version), version);
  }
  return {
    pause() { generation++; port.passkeys.cancel(); },
    begin: (method: 'passkey' | 'recovery') => run(async (record, version) => {
      if ((record.access && !['closed', 'expired', 'completed'].includes(record.access.phase))
        || (!record.access && record.verification && !['closed', 'expired', 'failed', 'completed'].includes(record.verification.phase))) return { kind: 'blocked' };
      const access: CustomerAccessJournal = { method, operationId: port.uuid(), attemptId: port.uuid(), phase: 'preparing', expiresAt: null };
      await unchanged(record, version); const next = CustomerBrowserJournalSchema.parse({ ...record, access }) as Record;
      await port.journal.write(next, record); port.changed?.();
      const result = await intent(next, 'prepare', version);
      await move(next, { ...access, phase: 'prepared', expiresAt: result.expiresAt }, version); return { kind: 'prepared' };
    }),
    retry: () => selected(async (record, version) => {
      if (record.access.phase !== 'failed' || !record.access.expiresAt || record.access.expiresAt <= Date.now()) return { kind: 'blocked' };
      const { method, operationId, expiresAt } = record.access;
      await move(record, { method, operationId, expiresAt, attemptId: port.uuid(), phase: 'prepared' }, version); return { kind: 'prepared' };
    }),
    login: () => selected(async (record, version) => {
      if (record.access.method !== 'passkey' || !['prepared', 'options'].includes(record.access.phase)) return { kind: 'blocked' };
      record = await move(record, { ...record.access, phase: 'options' }, version);
      const result = await request(record, { ...binding(record), step: 'options' }, version);
      if (result.state !== 'options') return accept(record, result, version);
      if (result.options.allowCredentials.length !== 0) throw new Error('Discoverable key required');
      record = await move(record, { ...record.access, phase: 'options', expiresAt: result.expiresAt } as CustomerAccessJournal, version);
      await unchanged(record, version); const response = await port.passkeys.authenticate(result.options); await unchanged(record, version);
      if (response.kind !== 'completed') return { kind: response.kind === 'cancelled' ? 'cancelled' : 'unavailable' };
      const body = CustomerPasskeyLoginRequestSchema.parse({ ...binding(record), step: 'assert', response: response.response });
      record = await move(record, { ...record.access, method: 'passkey', phase: 'asserting' }, version);
      return accept(record, await request(record, body, version), version);
    }),
    recover: (code: string) => selected(async (record, version) => {
      if (record.access.method !== 'recovery' || record.access.phase !== 'prepared') return { kind: 'blocked' };
      const body = CustomerRecoveryRequestSchema.safeParse({ ...binding(record), step: 'begin', code });
      if (!body.success) return { kind: 'invalid' };
      record = await move(record, { ...record.access, phase: 'grant' }, version);
      return accept(record, await request(record, body.data, version), version);
    }),
    register: () => selected((record, version) => ceremony(record, version, 'register')),
    assert: () => selected((record, version) => ceremony(record, version, 'assert')),
    recoveryCode: () => selected(async (record, version) => {
      const p = record.access.method === 'recovery' ? record.access.protection : undefined;
      if (record.access.phase !== 'protecting' || p?.stage !== 'recovery_required' || p.pending !== null || p.recoveryVersion >= 3) return { kind: 'blocked' };
      const rotationId = port.uuid(); record = await patchProtection(record, { rotationId, pending: 'recovery-code' }, version);
      const result = await request(record, { ...binding(record), step: 'recovery-code', rotationId, expectedVersion: p.recoveryVersion }, version);
      if (result.state !== 'recovery-code' || result.recovery.recoveryVersion !== p.recoveryVersion + 1) return accept(record, result, version);
      return accept(record, result, version, true);
    }),
    activate: (code: string) => selected(async (record, version) => {
      const p = record.access.method === 'recovery' ? record.access.protection : undefined;
      if (record.access.phase !== 'protecting' || p?.stage !== 'recovery_required' || p.recoveryVersion < 1
        || (p.pending !== null && p.pending !== 'activate')) return { kind: 'blocked' };
      const activationId = p.activationId ?? port.uuid();
      const body = CustomerRecoveryRequestSchema.safeParse({ ...binding(record), step: 'activate', activationId, recoveryVersion: p.recoveryVersion, code });
      if (!body.success) return { kind: 'invalid' };
      record = await patchProtection(record, { activationId, pending: 'activate' }, version);
      return accept(record, await request(record, body.data, version), version);
    }),
    resume: () => selected(async (record, version) => {
      const a = record.access;
      if (a.phase === 'closing') return close(record, version);
      if (['closed', 'expired', 'failed'].includes(a.phase)) return { kind: a.phase === 'failed' ? 'failed' : 'closed' };
      if (a.phase === 'completed') return { kind: 'authenticated' };
      const p = a.method === 'recovery' ? a.protection : undefined;
      const body = a.method === 'passkey' ? { ...binding(record), step: 'result' as const }
        : p?.pending === 'activate' && p.activationId ? { ...binding(record), step: 'activation-result' as const, activationId: p.activationId }
          : { ...binding(record), step: 'state' as const };
      return accept(record, await request(record, body, version), version);
    }),
    close: () => selected(close),
  };
}

export function customerAccess(slug: string, active: () => boolean, changed = () => notifyCustomerAccountChanged(slug)) {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return createCustomerAccess({ journal: customerBrowserJournal(slug), request: customerAccountRequest(slug), uuid: () => crypto.randomUUID(),
    passkeys: customerPasskeyBrowser(active), active, changed,
    lock: locks ? async work => await locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, work) : undefined });
}
