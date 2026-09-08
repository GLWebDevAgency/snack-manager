import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerBrowserJournalSchema, type CustomerBrowserJournal } from './browser-journal';
import { createCustomerProtection } from './protection';
import type { CustomerAccountRequest } from './client';

const secret = () => randomBytes(32).toString('base64url');
const recoveryCode = () => `SM1-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
function fixture() {
  const operationId = randomUUID(), checkId = randomUUID(), expiresAt = Date.now() + 300_000;
  let enrollment = { operationId, checkId, expiresAt, stage: 'registration_required' as 'registration_required' | 'assertion_required' | 'recovery_required', recoveryVersion: 0 };
  let stored: CustomerBrowserJournal | null = CustomerBrowserJournalSchema.parse({ version: 1, phase: 'ready', browserRef: randomUUID(),
    verification: { operationId, checkId, challengeId: randomUUID(), expiresAt, phase: 'protecting', protection: {
      stage: enrollment.stage, recoveryVersion: 0, pending: null } } });
  let active = true, broken = false;
  const journal = { read: async () => structuredClone(stored), write: async (value: CustomerBrowserJournal, expected: CustomerBrowserJournal | null) => {
    if (broken || JSON.stringify(stored) !== JSON.stringify(expected)) throw new Error('Storage unavailable');
    stored = CustomerBrowserJournalSchema.parse(structuredClone(value));
  } };
  const credential = { id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: 'AQ', attestationObject: 'AQ' } };
  const assertion = { ...credential, response: { clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ', userHandle: secret() } };
  const passkeys = { register: vi.fn(async () => ({ kind: 'completed' as const, response: credential })),
    authenticate: vi.fn(async () => ({ kind: 'completed' as const, response: assertion })), cancel: vi.fn() };
  const code = recoveryCode();
  const request = vi.fn<CustomerAccountRequest>(async (action, raw) => {
    expect(action).toBe('protection'); const body = raw as Record<string, unknown>;
    if (body.step === 'registration-options') return { state: 'registration-options', enrollment, registrationId: body.registrationId,
      options: { challenge: secret(), rp: { id: 'example.test', name: 'Restaurant' }, user: { id: secret(), name: 'opaque', displayName: 'opaque' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000, attestation: 'none', excludeCredentials: [],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, extensions: { credProps: true } } };
    if (body.step === 'register') enrollment = { ...enrollment, stage: 'assertion_required' };
    if (body.step === 'assertion-options') return { state: 'assertion-options', enrollment, assertionId: body.assertionId,
      options: { challenge: secret(), rpId: 'example.test', timeout: 60_000, userVerification: 'required', allowCredentials: [] } };
    if (body.step === 'assert') enrollment = { ...enrollment, stage: 'recovery_required' };
    if (body.step === 'recovery-code') { enrollment = { ...enrollment, recoveryVersion: enrollment.recoveryVersion + 1 }; return { state: 'recovery-code', enrollment, code }; }
    if (body.step === 'activate' || body.step === 'activation-result') return { state: 'authenticated', operationId, activationId: body.activationId,
      view: { expiresAt: Date.now() + 60_000, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } } };
    return { state: 'enrollment', enrollment };
  });
  let queue = Promise.resolve();
  const lock = async <T,>(work: () => Promise<T>) => { const previous = queue; let release!: () => void;
    queue = new Promise(resolve => { release = resolve; }); await previous; try { return await work(); } finally { release(); } };
  const port = { journal, request, passkeys, uuid: randomUUID, lock, active: () => active };
  return { client: createCustomerProtection(port), port, request, passkeys, code, stored: () => structuredClone(stored),
    setStored: (value: CustomerBrowserJournal | null) => { stored = value; }, setStage: (stage: typeof enrollment.stage) => { enrollment = { ...enrollment, stage }; },
    newClient: () => createCustomerProtection(port), breakStorage: () => { broken = true; }, inactive: () => { active = false; } };
}
describe('protected enrollment controller — public journal, private ephemeral ceremonies', () => {
  it('requires durable storage and Web Locks before invoking the browser or network', async () => {
    const f = fixture(); expect((await createCustomerProtection({ ...f.port, lock: undefined }).register()).kind).toBe('blocked');
    f.breakStorage(); expect((await f.client.register()).kind).toBe('uncertain');
    expect(f.request).not.toHaveBeenCalled(); expect(f.passkeys.register).not.toHaveBeenCalled();
  });
  it('registers then proves possession and only exact activation completes the publication', async () => {
    const f = fixture();
    expect((await f.client.register()).kind).toBe('enrollment'); expect(f.stored()!.verification!.phase).toBe('protecting');
    expect((await f.client.assert()).kind).toBe('enrollment');
    const shown = await f.client.recoveryCode(); expect(shown).toMatchObject({ kind: 'recovery-code', code: f.code });
    expect(f.stored()!.verification!.phase).toBe('protecting');
    expect((await f.client.activate(f.code)).kind).toBe('authenticated');
    expect(f.stored()!.verification!.phase).toBe('completed');
    expect(f.stored()!.verification!.protection!.activationId).toBeTruthy();
    const serialized = JSON.stringify(f.stored());
    for (const privateField of [f.code, 'phoneE164', 'clientDataJSON', 'attestationObject', 'options', 'token']) expect(serialized).not.toContain(privateField);
  });
  it('retries uncertain options only by an explicit gesture with the same durable registration ID', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { throw new Error('options response lost'); });
    expect((await f.client.register()).kind).toBe('uncertain');
    const registrationId = f.stored()!.verification!.protection!.registrationId; f.request.mockClear();
    expect((await f.client.register()).kind).toBe('enrollment');
    expect(f.request.mock.calls.map(([, body]) => (body as { registrationId: string }).registrationId)).toEqual([registrationId, registrationId]);
  });
  it('a lost registration response is reconciled only when server stage advances', async () => {
    const f = fixture(); const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (action, body) => { if ((body as { step: string }).step === 'register') {
      f.setStage('assertion_required'); throw new Error('response lost'); } return original(action, body); });
    expect((await f.client.register()).kind).toBe('uncertain');
    expect((await f.newClient().resume()).kind).toBe('enrollment');
    expect(f.stored()!.verification!.protection!.stage).toBe('assertion_required');
    expect(f.passkeys.register).toHaveBeenCalledTimes(1);
  });
  it('an unchanged state does not settle an uncertain registration', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('late options'));
    await f.client.register(); expect((await f.client.resume()).kind).toBe('uncertain');
  });
  it('browser cancellation before credential submission permits an explicit new gesture only', async () => {
    const f = fixture(); f.passkeys.register.mockResolvedValueOnce({ kind: 'cancelled' } as never);
    expect((await f.client.register()).kind).toBe('cancelled');
    expect(f.request.mock.calls.map(([, body]) => (body as { step: string }).step)).toEqual(['registration-options']);
    expect(f.stored()!.verification!.protection!.pending).toBeNull();
  });
  it('a lost recovery-code display is never reconstructed or automatically rotated', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert(); await f.client.recoveryCode(); f.request.mockClear();
    expect(await f.newClient().resume()).toMatchObject({ kind: 'enrollment' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('protection', expect.objectContaining({ step: 'state' }));
    expect(JSON.stringify(f.stored())).not.toContain(f.code);
    expect((await f.newClient().recoveryCode()).kind).toBe('recovery-code');
    expect(f.stored()!.verification!.protection!.recoveryVersion).toBe(2);
  });
  it('bounds explicit code rotations to three and never sends a fourth', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert();
    await f.client.recoveryCode(); await f.client.recoveryCode(); await f.client.recoveryCode(); f.request.mockClear();
    expect((await f.client.recoveryCode()).kind).toBe('blocked'); expect(f.request).not.toHaveBeenCalled();
  });
  it('recovers a lost activation by exact activationId without resending the secret', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert(); await f.client.recoveryCode();
    f.request.mockRejectedValueOnce(new Error('activation response lost')); expect((await f.client.activate(f.code)).kind).toBe('uncertain');
    const activationId = f.stored()!.verification!.protection!.activationId; f.request.mockClear();
    expect((await f.newClient().resume()).kind).toBe('authenticated');
    expect(f.request).toHaveBeenCalledExactlyOnceWith('protection', expect.objectContaining({ step: 'activation-result', activationId }));
    expect(JSON.stringify(f.request.mock.calls)).not.toContain(f.code);
  });
  it('cannot accept authenticated publication for a different activation', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert(); await f.client.recoveryCode();
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(async (action, body) => ({ ...(await original(action, body) as object), activationId: randomUUID() }));
    expect((await f.client.activate(f.code)).kind).toBe('uncertain'); expect(f.stored()!.verification!.phase).toBe('protecting');
  });
  it('an explicit corrected recovery entry retains the one activation ID and version', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert(); await f.client.recoveryCode();
    f.request.mockRejectedValueOnce(new Error('incorrect entry or response unavailable'));
    expect((await f.client.activate('incorrect')).kind).toBe('uncertain');
    const selected = f.stored()!.verification!.protection!; f.request.mockClear();
    expect((await f.client.activate(f.code)).kind).toBe('authenticated');
    expect(f.request).toHaveBeenCalledExactlyOnceWith('protection', expect.objectContaining({ step: 'activate',
      activationId: selected.activationId, recoveryVersion: selected.recoveryVersion, code: f.code }));
  });
  it('rejects secret-bearing or invented protection journals rather than silently cleaning them', () => {
    const f = fixture(), stored = f.stored()!;
    for (const field of ['code', 'options', 'response', 'token', 'phone']) {
      const candidate = { ...stored, verification: { ...stored.verification, protection: { ...stored.verification!.protection, [field]: 'private' } } };
      expect(CustomerBrowserJournalSchema.safeParse(candidate).success).toBe(false);
    }
  });
  it('pause cancels native UI and never publishes a late answer or secret', async () => {
    const f = fixture(); await f.client.register(); await f.client.assert();
    f.request.mockImplementationOnce(async () => { f.client.pause(); return { state: 'recovery-code', code: f.code,
      enrollment: { operationId: f.stored()!.verification!.operationId, checkId: f.stored()!.verification!.checkId,
        expiresAt: Date.now() + 60_000, stage: 'recovery_required', recoveryVersion: 1 } }; });
    expect(await f.client.recoveryCode()).toEqual({ kind: 'paused' }); expect(f.passkeys.cancel).toHaveBeenCalled();
    expect(JSON.stringify(f.stored())).not.toContain(f.code);
  });
  it('discarding the journal while a response waits cannot recreate it', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => { f.setStored(null); throw new Error('late'); });
    expect((await f.client.register()).kind).toBe('uncertain'); expect(f.stored()).toBeNull();
  });
});
