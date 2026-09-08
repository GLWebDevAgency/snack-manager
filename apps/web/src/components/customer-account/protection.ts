import { CustomerProtectionPublicResponseSchema, CustomerProtectionRequestSchema,
  type CustomerEnrollment, type CustomerProtectionPublicResponse, type CustomerProtectionRequest } from '@sm/contracts';
import { customerBrowserJournal, type CustomerBrowserJournal, type CustomerBrowserJournalStore,
  type CustomerProtectionJournal, type CustomerVerificationJournal } from './browser-journal';
import { customerAccountRequest, type CustomerAccountRequest } from './client';
import { notifyCustomerAccountChanged } from './browser-preparation';
import { customerPasskeyBrowser } from './passkey-browser';

export type CustomerProtectionOutcome = { kind: 'enrollment'; enrollment: CustomerEnrollment }
  | { kind: 'recovery-code'; enrollment: CustomerEnrollment; code: string | null }
  | { kind: 'authenticated' | 'uncertain' | 'blocked' | 'paused' | 'cancelled' | 'unavailable' | 'invalid' };
type Port = { journal: CustomerBrowserJournalStore; request: CustomerAccountRequest;
  passkeys: ReturnType<typeof customerPasskeyBrowser>; uuid: () => string;
  lock?: (work: () => Promise<CustomerProtectionOutcome>) => Promise<CustomerProtectionOutcome>;
  active?: () => boolean; changed?: () => void };
type Record = CustomerBrowserJournal & { verification: CustomerVerificationJournal & { checkId: string; protection: CustomerProtectionJournal } };

/** Only public selectors survive reload. No ceremony result, phone, OTP or
 * recovery code is retained. A panel pause never closes this server intention.
 * Options and attempts reuse their durable IDs; only the server's monotone
 * stage or exact activation receipt establishes what actually committed. */
export function createCustomerProtection(port: Port) {
  let generation = 0;
  const active = () => port.active?.() !== false;
  const current = (run: number) => generation === run && active();
  async function unchanged(record: Record, run: number) {
    if (!current(run)) throw new Error('Paused');
    const next = await port.journal.read();
    if (!current(run) || JSON.stringify(next) !== JSON.stringify(record)) throw new Error('Selection changed');
  }
  async function move(record: Record, patch: Partial<CustomerProtectionJournal>, run: number,
    metadata?: Partial<CustomerVerificationJournal>): Promise<Record> {
    await unchanged(record, run);
    const next = { ...record, verification: { ...record.verification, ...metadata,
      protection: { ...record.verification.protection, ...patch } } } as Record;
    await port.journal.write(next, record); port.changed?.(); return next;
  }
  const binding = (record: Record) => ({ operationId: record.verification.operationId, checkId: record.verification.checkId });
  async function request(record: Record, body: CustomerProtectionRequest, run: number) {
    const input = CustomerProtectionRequestSchema.parse(body);
    await unchanged(record, run);
    const result = CustomerProtectionPublicResponseSchema.parse(await port.request('protection', input));
    await unchanged(record, run);
    if (result.state === 'authenticated') {
      if ((body.step !== 'activate' && body.step !== 'activation-result') || result.operationId !== body.operationId
        || result.activationId !== body.activationId || result.view.expiresAt <= Date.now()
        || result.view.expiresAt > Date.now() + 7 * 86_400_000) throw new Error('Invalid activation receipt');
    } else if (result.enrollment.operationId !== body.operationId || result.enrollment.checkId !== body.checkId
      || result.enrollment.expiresAt <= Date.now() || result.enrollment.expiresAt > Date.now() + 600_000) throw new Error('Enrollment changed');
    return result;
  }
  async function accept(record: Record, result: CustomerProtectionPublicResponse, run: number,
    definitive = false): Promise<CustomerProtectionOutcome> {
    if (result.state === 'authenticated') {
      await move(record, { pending: null }, run, { phase: 'completed' });
      return { kind: 'authenticated' };
    }
    const old = record.verification.protection, enrollment = result.enrollment;
    const stages = ['registration_required', 'assertion_required', 'recovery_required'];
    if (stages.indexOf(enrollment.stage) < stages.indexOf(old.stage) || enrollment.recoveryVersion < old.recoveryVersion) throw new Error('Enrollment regressed');
    const advanced = enrollment.stage !== old.stage || enrollment.recoveryVersion > old.recoveryVersion;
    const pending = definitive || advanced ? null : old.pending;
    await move(record, { stage: enrollment.stage, recoveryVersion: enrollment.recoveryVersion, pending }, run,
      { expiresAt: enrollment.expiresAt });
    if (pending) return { kind: 'uncertain' };
    return result.state === 'recovery-code' ? { kind: 'recovery-code', enrollment, code: result.code } : { kind: 'enrollment', enrollment };
  }
  async function run(work: (record: Record, run: number) => Promise<CustomerProtectionOutcome>): Promise<CustomerProtectionOutcome> {
    if (!port.lock) return { kind: 'blocked' };
    if (!active()) return { kind: 'paused' };
    const version = generation;
    try { return await port.lock(async () => {
      if (!current(version)) return { kind: 'paused' };
      const record = await port.journal.read();
      if (record?.phase !== 'ready' || record.access || record.verification?.phase !== 'protecting'
        || !record.verification.checkId || !record.verification.protection) return { kind: 'blocked' };
      return work(record as Record, version);
    }); } catch { return { kind: current(version) ? 'uncertain' : 'paused' }; }
  }
  async function ceremony(record: Record, run: number, kind: 'register' | 'assert'): Promise<CustomerProtectionOutcome> {
    const old = record.verification.protection, registering = kind === 'register';
    if (old.stage !== (registering ? 'registration_required' : 'assertion_required')
      || (old.pending !== null && ![kind, registering ? 'registration-options' : 'assertion-options'].includes(old.pending))) return { kind: 'blocked' };
    const id = (registering ? old.registrationId : old.assertionId) ?? port.uuid();
    record = await move(record, registering ? { registrationId: id, pending: 'registration-options' }
      : { assertionId: id, pending: 'assertion-options' }, run);
    const options = await request(record, registering ? { ...binding(record), step: 'registration-options', registrationId: id }
      : { ...binding(record), step: 'assertion-options', assertionId: id }, run);
    if (options.state === 'enrollment') return accept(record, options, run);
    if ((registering && (options.state !== 'registration-options' || options.registrationId !== id))
      || (!registering && (options.state !== 'assertion-options' || options.assertionId !== id))) throw new Error('Options changed');
    await unchanged(record, run);
    const response = options.state === 'registration-options' ? await port.passkeys.register(options.options)
      : options.state === 'assertion-options' ? await port.passkeys.authenticate(options.options) : null;
    await unchanged(record, run);
    if (!response || response.kind !== 'completed') {
      await move(record, { pending: null }, run);
      return { kind: response?.kind === 'cancelled' ? 'cancelled' : 'unavailable' };
    }
    const body = CustomerProtectionRequestSchema.parse(registering
      ? { ...binding(record), step: 'register', registrationId: id, response: response.response }
      : { ...binding(record), step: 'assert', assertionId: id, response: response.response });
    record = await move(record, { pending: kind }, run);
    return accept(record, await request(record, body, run), run);
  }
  return {
    pause() { generation++; port.passkeys.cancel(); },
    register: () => run((record, version) => ceremony(record, version, 'register')),
    assert: () => run((record, version) => ceremony(record, version, 'assert')),
    resume: () => run(async (record, version) => {
      const p = record.verification.protection;
      return accept(record, await request(record, p.pending === 'activate' && p.activationId
        ? { ...binding(record), step: 'activation-result', activationId: p.activationId }
        : { ...binding(record), step: 'state' }, version), version);
    }),
    recoveryCode: () => run(async (record, version) => {
      const p = record.verification.protection;
      if (p.stage !== 'recovery_required' || p.pending !== null || p.recoveryVersion >= 3) return { kind: 'blocked' };
      const rotationId = port.uuid(); record = await move(record, { rotationId, pending: 'recovery-code' }, version);
      const result = await request(record, { ...binding(record), step: 'recovery-code', rotationId, expectedVersion: p.recoveryVersion }, version);
      if (result.state !== 'recovery-code' || result.enrollment.recoveryVersion !== p.recoveryVersion + 1) throw new Error('Rotation unconfirmed');
      return accept(record, result, version, true);
    }),
    activate: (code: string) => run(async (record, version) => {
      const p = record.verification.protection;
      if (p.stage !== 'recovery_required' || (p.pending !== null && p.pending !== 'activate') || p.recoveryVersion < 1) return { kind: 'blocked' };
      const activationId = p.activationId ?? port.uuid();
      const body = CustomerProtectionRequestSchema.safeParse({ ...binding(record), step: 'activate', activationId, recoveryVersion: p.recoveryVersion, code });
      if (!body.success) return { kind: 'invalid' };
      record = await move(record, { activationId, pending: 'activate' }, version);
      return accept(record, await request(record, body.data, version), version);
    }),
  };
}

export function customerProtection(slug: string, active: () => boolean, changed = () => notifyCustomerAccountChanged(slug)) {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return createCustomerProtection({ journal: customerBrowserJournal(slug), request: customerAccountRequest(slug),
    passkeys: customerPasskeyBrowser(active), uuid: () => crypto.randomUUID(), active,
    changed,
    lock: locks ? async work => await locks.request(`sm:customer:${slug}`, { mode: 'exclusive', signal: AbortSignal.timeout(15_000) }, work) : undefined });
}
