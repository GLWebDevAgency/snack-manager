import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerBrowserJournalSchema, customerPublicationOf, type CustomerBrowserJournal } from './browser-journal';
import { createCustomerAccess } from './access';
import type { CustomerAccountRequest } from './client';

const secret = () => randomBytes(32).toString('base64url');
function fixture() {
  const expiresAt = Date.now() + 300_000;
  let stored: CustomerBrowserJournal | null = { version: 1, phase: 'ready', browserRef: randomUUID(), verification: {
    operationId: randomUUID(), challengeId: randomUUID(), checkId: randomUUID(), expiresAt, phase: 'completed' } };
  let active = true, broken = false, stage = 'registration_required', recoveryVersion = 0;
  const journal = { read: async () => structuredClone(stored), write: async (next: CustomerBrowserJournal, expected: CustomerBrowserJournal | null) => {
    if (broken || JSON.stringify(expected) !== JSON.stringify(stored)) throw new Error('CAS refused');
    stored = CustomerBrowserJournalSchema.parse(structuredClone(next));
  } };
  const assertion = { id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {}, response: {
    clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ', userHandle: secret() } };
  const registration = { ...assertion, response: { clientDataJSON: 'AQ', attestationObject: 'AQ' } };
  const passkeys = { register: vi.fn(async () => ({ kind: 'completed' as const, response: registration })),
    authenticate: vi.fn(async () => ({ kind: 'completed' as const, response: assertion })), cancel: vi.fn() };
  const code = `SM1-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
  const request = vi.fn<CustomerAccountRequest>(async (action, input) => {
    const b = input as Record<string, string>;
    if (action === 'intent') return { operationId: b.operationId, state: b.step === 'close' ? 'closed' : 'open', expiresAt };
    const binding = { operationId: b.operationId, attemptId: b.attemptId, expiresAt };
    const view = { expiresAt: Date.now() + 60_000, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } };
    const auth = () => ({ state: 'authenticated', operationId: b.operationId, publicationId: action === 'passkey' ? b.attemptId : b.activationId, view });
    const options = { challenge: secret(), rpId: 'example.test', timeout: 60_000, userVerification: 'required', allowCredentials: [] };
    if (action === 'passkey') return b.step === 'options' ? { state: 'options', ...binding, options } : auth();
    if (action !== 'recovery') throw new Error('Unexpected provider action');
    if (b.step === 'register') stage = 'assertion_required';
    if (b.step === 'assert') stage = 'recovery_required';
    if (b.step === 'recovery-code') recoveryVersion++;
    const recovery = { ...binding, stage, recoveryVersion };
    if (b.step === 'registration-options') return { state: 'registration-options', recovery, registrationId: b.registrationId,
      options: { challenge: secret(), rp: { id: 'example.test', name: 'Restaurant' }, user: { id: secret(), name: 'opaque', displayName: 'opaque' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000, attestation: 'none', excludeCredentials: [],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, extensions: { credProps: true } } };
    if (b.step === 'assertion-options') return { state: 'assertion-options', recovery, assertionId: b.assertionId, options };
    if (b.step === 'recovery-code') return { state: 'recovery-code', recovery, code };
    if (b.step === 'activate' || b.step === 'activation-result') return auth();
    return { state: 'recovery', recovery };
  });
  let queue = Promise.resolve();
  const lock = async <T,>(work: () => Promise<T>) => { const prior = queue; let release!: () => void;
    queue = new Promise(resolve => { release = resolve; }); await prior; try { return await work(); } finally { release(); } };
  const port = { journal, request, passkeys, uuid: randomUUID, lock, active: () => active };
  return { client: createCustomerAccess(port), port, request, passkeys, code, stored: () => structuredClone(stored)!,
    setStored: (next: CustomerBrowserJournal | null) => { stored = next; }, breakStorage: () => { broken = true; },
    inactive: () => { active = false; }, newClient: () => createCustomerAccess(port) };
}
describe('durable credential access controller', () => {
  it('preserves the legacy publication until an explicit access intention masks it', async () => {
    const f = fixture(), old = f.stored().verification!;
    expect(customerPublicationOf(f.stored())).toEqual({ expectedOperationId: old.operationId, expectedCheckId: old.checkId });
    expect((await f.client.begin('passkey')).kind).toBe('prepared');
    expect(f.stored().verification).toEqual(old); expect(customerPublicationOf(f.stored())).toBeNull();
    await f.client.close(); expect(customerPublicationOf(f.stored())).toBeNull();
  });
  it('requires strict durable writes and a Web Lock before network or native credentials', async () => {
    const f = fixture(); expect((await createCustomerAccess({ ...f.port, lock: undefined }).begin('passkey')).kind).toBe('blocked');
    f.breakStorage(); expect((await f.client.begin('passkey')).kind).toBe('uncertain');
    expect(f.request).not.toHaveBeenCalled(); expect(f.passkeys.authenticate).not.toHaveBeenCalled();
  });
  it('signs in with a discoverable key and selects its exact attempt receipt, without any OTP', async () => {
    const f = fixture(); await f.client.begin('passkey'); expect((await f.client.login()).kind).toBe('authenticated');
    const access = f.stored().access!;
    expect(customerPublicationOf(f.stored())).toEqual({ expectedOperationId: access.operationId, expectedCheckId: access.attemptId });
    expect(f.request.mock.calls.map(([action]) => action)).toEqual(['intent', 'passkey', 'passkey']);
    expect(JSON.stringify(f.stored())).not.toMatch(/clientDataJSON|userHandle|phoneE164|options|token/);
  });
  it('retains the same attempt and only reads result after a lost assertion response', async () => {
    const f = fixture(); await f.client.begin('passkey'); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (action, body) => { if (action === 'passkey' && (body as { step: string }).step === 'assert') throw new Error('lost'); return original(action, body); });
    expect((await f.client.login()).kind).toBe('uncertain'); const access = f.stored().access!; f.request.mockClear();
    expect((await f.newClient().resume()).kind).toBe('authenticated');
    expect(f.request).toHaveBeenCalledExactlyOnceWith('passkey', { step: 'result', operationId: access.operationId, attemptId: access.attemptId });
    expect(f.passkeys.authenticate).toHaveBeenCalledTimes(1);
  });
  it('unresolved does not authorize another attempt or another ceremony', async () => {
    const f = fixture(); await f.client.begin('passkey'); f.request.mockRejectedValueOnce(new Error('lost options'));
    await f.client.login(); const old = f.stored().access!;
    f.request.mockResolvedValue({ state: 'unresolved', operationId: old.operationId, attemptId: old.attemptId, expiresAt: old.expiresAt });
    expect((await f.client.resume()).kind).toBe('uncertain'); expect((await f.client.begin('passkey')).kind).toBe('blocked');
    expect(f.stored().access!.attemptId).toBe(old.attemptId);
  });
  it('a durable failed receipt permits only an explicit new attempt under the same intention', async () => {
    const f = fixture(); await f.client.begin('passkey'); const old = f.stored().access!;
    f.request.mockResolvedValueOnce({ state: 'failed', operationId: old.operationId, attemptId: old.attemptId, expiresAt: old.expiresAt });
    expect((await f.client.resume()).kind).toBe('failed'); expect(f.stored().access!.attemptId).toBe(old.attemptId);
    expect((await f.client.retry()).kind).toBe('prepared');
    expect(f.stored().access!.attemptId).not.toBe(old.attemptId); expect(f.stored().access!.operationId).toBe(old.operationId);
  });
  it('recovers an existing account only after new key possession and new saved code activation', async () => {
    const f = fixture(); await f.client.begin('recovery'); expect((await f.client.recover(f.code)).kind).toBe('recovery');
    expect(customerPublicationOf(f.stored())).toBeNull(); await f.client.register(); await f.client.assert();
    expect(await f.client.recoveryCode()).toMatchObject({ kind: 'recovery-code', code: f.code });
    expect(customerPublicationOf(f.stored())).toBeNull(); expect((await f.client.activate(f.code)).kind).toBe('authenticated');
    const a = f.stored().access!;
    if (a.method !== 'recovery') throw new Error('Expected recovery fixture');
    expect(customerPublicationOf(f.stored())).toEqual({ expectedOperationId: a.operationId, expectedCheckId: a.protection!.activationId });
    expect(JSON.stringify(f.stored())).not.toContain(f.code);
    expect(f.request.mock.calls.every(([action]) => ['intent', 'recovery'].includes(action))).toBe(true);
  });
  it('resumes an uncertain grant without sending its code again', async () => {
    const f = fixture(); await f.client.begin('recovery'); f.request.mockRejectedValueOnce(new Error('lost grant'));
    expect((await f.client.recover(f.code)).kind).toBe('uncertain'); const a = f.stored().access!; f.request.mockClear();
    expect((await f.newClient().resume()).kind).toBe('recovery');
    expect(f.request).toHaveBeenCalledExactlyOnceWith('recovery', { step: 'state', operationId: a.operationId, attemptId: a.attemptId });
  });
  it('keeps activationId and version after uncertain final response; result never contains the secret', async () => {
    const f = fixture(); await f.client.begin('recovery'); await f.client.recover(f.code); await f.client.register(); await f.client.assert(); await f.client.recoveryCode();
    f.request.mockRejectedValueOnce(new Error('lost activation')); await f.client.activate(f.code);
    const a = f.stored().access!; if (a.method !== 'recovery') throw new Error('Expected recovery fixture'); f.request.mockClear();
    expect((await f.newClient().resume()).kind).toBe('authenticated');
    expect(f.request).toHaveBeenCalledExactlyOnceWith('recovery', { step: 'activation-result', operationId: a.operationId, attemptId: a.attemptId, activationId: a.protection!.activationId });
  });
  it('pauses native ceremonies and never publishes a late A after the journal selected B', async () => {
    const f = fixture(); await f.client.begin('passkey'); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (action, body) => {
      const out = await original(action, body);
      if (action === 'passkey' && (body as { step: string }).step === 'assert') f.setStored({ ...f.stored(), access: { ...f.stored().access!, attemptId: randomUUID() } });
      return out;
    });
    expect((await f.client.login()).kind).toBe('uncertain'); expect(customerPublicationOf(f.stored())).toBeNull();
    f.client.pause(); expect(f.passkeys.cancel).toHaveBeenCalled();
  });
  it('closing is durable; a lost close is retried by ID, never mistaken for panel pause', async () => {
    const f = fixture(); await f.client.begin('recovery'); f.request.mockRejectedValueOnce(new Error('lost close'));
    expect((await f.client.close()).kind).toBe('uncertain'); expect(f.stored().access!.phase).toBe('closing');
    expect((await f.newClient().resume()).kind).toBe('closed'); expect(customerPublicationOf(f.stored())).toBeNull();
  });
  it.each(['passkey', 'recovery'] as const)('restores preparing %s only after an unresolved result attests the received proof cookie', async method => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('body lost, cookie received'));
    expect((await f.client.begin(method)).kind).toBe('uncertain'); const a = f.stored().access!;
    f.request.mockResolvedValueOnce({ state: 'unresolved', operationId: a.operationId, attemptId: a.attemptId, expiresAt: Date.now() + 60_000 });
    expect((await f.newClient().resume()).kind).toBe('prepared'); expect(f.stored().access!.phase).toBe('prepared');
    expect(f.passkeys.authenticate).not.toHaveBeenCalled();
    expect(f.request.mock.calls.map(([action]) => action)).toEqual(['intent', method]);
  });
  it('missing one-shot cookie cannot be manufactured by retrying prepare', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('headers lost')); await f.client.begin('passkey');
    f.request.mockRejectedValueOnce(new Error('proof cookie absent'));
    expect((await f.newClient().resume()).kind).toBe('uncertain'); expect(f.stored().access!.phase).toBe('preparing');
    expect(f.request.mock.calls.filter(([action]) => action === 'intent')).toHaveLength(1);
    expect((await f.client.close()).kind).toBe('closed');
  });
  it('rejects method-incompatible phases and recovery completion without its activation receipt', async () => {
    const f = fixture(); await f.client.begin('passkey'); const record = f.stored();
    expect(CustomerBrowserJournalSchema.safeParse({ ...record, access: { ...record.access, phase: 'protecting' } }).success).toBe(false);
    expect(CustomerBrowserJournalSchema.safeParse({ ...record, access: { ...record.access, method: 'recovery', phase: 'completed' } }).success).toBe(false);
  });
  it('does not accept a reply which renews an admitted attempt expiry', async () => {
    const f = fixture(); await f.client.begin('passkey'); const a = f.stored().access!;
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (action, body) => ({ ...(await original(action, body) as object), expiresAt: a.expiresAt! + 1_000 }));
    expect((await f.client.login()).kind).toBe('uncertain'); expect(f.stored().access!.expiresAt).toBe(a.expiresAt);
    expect(f.passkeys.authenticate).not.toHaveBeenCalled();
  });
  it('refuses a recovery code reply with a nonconsecutive version rather than clearing pending', async () => {
    const f = fixture(); await f.client.begin('recovery'); await f.client.recover(f.code); await f.client.register(); await f.client.assert();
    const a = f.stored().access!;
    f.request.mockResolvedValueOnce({ state: 'recovery-code', recovery: { operationId: a.operationId, attemptId: a.attemptId,
      expiresAt: a.expiresAt, stage: 'recovery_required', recoveryVersion: 2 }, code: f.code });
    expect((await f.client.recoveryCode()).kind).toBe('uncertain');
    expect(f.stored().access).toMatchObject({ protection: { recoveryVersion: 0, pending: 'recovery-code' } });
  });
  it.each(['code', 'token', 'options', 'response', 'phone'])('refuses secret-bearing access journal field %s', async field => {
    const f = fixture(); await f.client.begin('passkey'); const record = f.stored();
    expect(CustomerBrowserJournalSchema.safeParse({ ...record, access: { ...record.access, [field]: 'private' } }).success).toBe(false);
  });
});
