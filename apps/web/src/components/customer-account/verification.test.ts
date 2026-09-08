import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerBrowserJournalSchema, type CustomerBrowserJournal } from './browser-journal';
import { createCustomerVerification } from './verification';
import type { CustomerAccountRequest } from './client';

function fixture() {
  let stored: CustomerBrowserJournal | null = { version: 1, browserRef: randomUUID(), phase: 'ready' };
  let active = true, broken = false;
  const calls: [string, unknown][] = [];
  const challengeId = randomUUID(), expiresAt = Date.now() + 300_000;
  let resultState = 'unresolved';
  const journal = { read: async () => structuredClone(stored), write: async (value: CustomerBrowserJournal, expected: CustomerBrowserJournal | null) => {
    if (broken || JSON.stringify(expected) !== JSON.stringify(stored)) throw new Error('journal refused');
    stored = CustomerBrowserJournalSchema.parse(structuredClone(value));
  } };
  const request = vi.fn<CustomerAccountRequest>(async (action, raw) => {
    calls.push([action, raw]); const body = raw as Record<string, unknown>;
    if (action === 'intent') return { operationId: body.operationId, state: body.step === 'close' ? 'closed' : 'open', expiresAt };
    if (action === 'start') { expect(stored!.verification!.phase).toBe('starting'); resultState = 'code_required'; return { challengeId, expiresAt }; }
    if (action === 'check') { expect(stored!.verification!.phase).toBe('checking'); resultState = 'approved'; return {}; }
    if (action === 'recover') return { operationId: body.operationId, checkId: body.checkId,
      challengeId: resultState === 'unresolved' ? null : challengeId, expiresAt, state: resultState,
      ...(resultState === 'approved' ? { view: { expiresAt: Date.now() + 60_000,
        profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } } } : {}) };
    throw new Error('unexpected');
  });
  let queue = Promise.resolve();
  const lock = async <T,>(work: () => Promise<T>) => {
    const previous = queue; let release!: () => void; queue = new Promise(resolve => { release = resolve; });
    await previous; try { return await work(); } finally { release(); }
  };
  const port = { journal, request, lock, uuid: randomUUID, active: () => active };
  return { client: createCustomerVerification(port), newClient: () => createCustomerVerification(port), port, calls, request,
    stored: () => structuredClone(stored), reset: (value: CustomerBrowserJournal | null) => { stored = value; },
    breakStorage: () => { broken = true; }, state: (value: string) => { resultState = value; }, deactivate: () => { active = false; } };
}

describe('durable customer verification controller', () => {
  it('requires browser preparation and a durable lock before creating any intention', async () => {
    const f = fixture(); expect(await createCustomerVerification({ ...f.port, lock: undefined }).begin()).toEqual({ kind: 'blocked' });
    f.reset(null); expect(await f.client.begin()).toEqual({ kind: 'uncertain' });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('persists before every mutation and never stores phone, OTP, profile or proof', async () => {
    const f = fixture(); expect(await f.client.begin()).toEqual({ kind: 'prepared' });
    expect(await f.client.start('+33600000000', 'human-proof')).toEqual({ kind: 'code_required' });
    expect(await f.client.check('123456')).toEqual({ kind: 'approved' });
    expect(f.calls.map(call => call[0])).toEqual(['intent', 'start', 'check', 'recover']);
    const journal = JSON.stringify(f.stored());
    for (const secret of ['33600000000', '123456', 'human-proof', 'phone', 'profile', 'token']) expect(journal).not.toContain(secret);
    expect(f.stored()?.verification?.phase).toBe('completed');
  });
  it('does not send when the preceding durable transaction fails', async () => {
    const f = fixture(); await f.client.begin(); f.request.mockClear(); f.breakStorage();
    expect(await f.client.start('+33600000000', 'human')).toEqual({ kind: 'uncertain' });
    expect(f.request).not.toHaveBeenCalled();
  });
  it('two controllers sharing the same journal never create a second intention or send twice', async () => {
    const f = fixture(), second = f.newClient();
    await Promise.all([f.client.begin(), second.begin()]);
    expect(f.calls.filter(([action]) => action === 'intent')).toHaveLength(1);
    await Promise.all([f.client.start('+33600000000', 'human'), second.start('+33600000000', 'human')]);
    expect(f.calls.filter(([action]) => action === 'start')).toHaveLength(1);
  });
  it('a lost start response is read by the same operation, never resent after reload', async () => {
    const f = fixture(); await f.client.begin();
    f.request.mockImplementationOnce(async () => { f.state('code_required'); throw new Error('lost after send'); });
    expect(await f.client.start('+33600000000', 'human')).toEqual({ kind: 'uncertain' });
    const operationId = f.stored()!.verification!.operationId; f.request.mockClear();
    expect(await f.newClient().resume()).toEqual({ kind: 'code_required' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('recover', { operationId, checkId: null });
  });
  it('an unresolved delayed start cannot be repeated or replaced by a fresh operation', async () => {
    const f = fixture(); await f.client.begin(); f.request.mockRejectedValueOnce(new Error('delayed admission'));
    await f.client.start('+33600000000', 'human');
    const before = f.stored(); expect(await f.client.resume()).toEqual({ kind: 'uncertain' });
    expect(await f.client.start('+33600000000', 'human')).toEqual({ kind: 'blocked' });
    expect(await f.client.begin()).toEqual({ kind: 'uncertain' }); expect(f.stored()).toEqual(before);
  });
  it('loss of the preparation body can confirm a received proof without issuing it again', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('body lost but cookie received'));
    await f.client.begin(); f.request.mockClear();
    expect(await f.newClient().resume()).toEqual({ kind: 'prepared' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('recover', { operationId: f.stored()!.verification!.operationId, checkId: null });
  });
  it('loss of the proof cookie stays uncertain until explicit closure, never reconstructs a proof', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('headers lost')); await f.client.begin();
    f.request.mockRejectedValueOnce(new Error('no proof')); expect(await f.newClient().resume()).toEqual({ kind: 'uncertain' });
    expect(await f.client.close()).toEqual({ kind: 'closed' });
    expect(f.stored()?.verification?.phase).toBe('closed');
    expect(await f.client.begin()).toEqual({ kind: 'prepared' });
  });
  it('an incorrect check response lost in transit is recovered without a second provider check', async () => {
    const f = fixture(); await f.client.begin(); await f.client.start('+33600000000', 'human');
    f.request.mockImplementationOnce(async () => { f.state('incorrect'); throw new Error('lost bad-code response'); });
    expect(await f.client.check('000000')).toEqual({ kind: 'incorrect' });
    const previous = f.stored()!.verification!.checkId; f.request.mockClear();
    expect(await f.newClient().resume()).toEqual({ kind: 'incorrect' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('recover', { operationId: f.stored()!.verification!.operationId, checkId: previous });
    expect(await f.client.check('123456')).toEqual({ kind: 'approved' });
    expect(f.stored()!.verification!.checkId).not.toBe(previous);
  });
  it('an unresolved check never permits another check or an implicit new ID', async () => {
    const f = fixture(); await f.client.begin(); await f.client.start('+33600000000', 'human');
    f.request.mockRejectedValueOnce(new Error('check delayed'));
    f.request.mockImplementationOnce(async (_action, raw) => ({ state: 'unresolved', ...(raw as object), challengeId: f.stored()!.verification!.challengeId, expiresAt: Date.now() + 60_000 }));
    expect(await f.client.check('123456')).toEqual({ kind: 'uncertain' });
    const previous = f.stored(); expect(await f.client.check('123456')).toEqual({ kind: 'blocked' }); expect(f.stored()).toEqual(previous);
  });
  it('an unconfirmed close remains durable and is the only command retried on resume', async () => {
    const f = fixture(); await f.client.begin(); f.request.mockRejectedValueOnce(new Error('close reply lost'));
    expect(await f.client.close()).toEqual({ kind: 'uncertain' }); expect(f.stored()?.verification?.phase).toBe('closing');
    f.request.mockClear(); expect(await f.newClient().resume()).toEqual({ kind: 'closed' });
    expect(f.request).toHaveBeenCalledExactlyOnceWith('intent', { step: 'close', operationId: f.stored()!.verification!.operationId });
  });
  it.each(['closed', 'expired'] as const)('accepts a terminal %s receipt without resurrecting its old challenge', async state => {
    const f = fixture(); await f.client.begin(); await f.client.start('+33600000000', 'human');
    f.request.mockImplementationOnce(async (_action, raw) => ({ ...(raw as object), state, challengeId: null, expiresAt: Date.now() - 1_000 }));
    expect(await f.newClient().resume()).toEqual({ kind: state });
    expect(f.stored()?.verification?.phase).toBe(state);
  });
  it.each(['closed', 'expired'] as const)('rejects a terminal %s receipt naming a different challenge', async state => {
    const f = fixture(); await f.client.begin(); await f.client.start('+33600000000', 'human');
    const before = f.stored();
    f.request.mockImplementationOnce(async (_action, raw) => ({ ...(raw as object), state, challengeId: randomUUID(), expiresAt: Date.now() - 1_000 }));
    expect(await f.newClient().resume()).toEqual({ kind: 'uncertain' });
    expect(f.stored()).toEqual(before);
  });
  it('does not send when paused during the final asynchronous journal read before POST', async () => {
    const f = fixture(); await f.client.begin(); f.request.mockClear();
    const originalRead = f.port.journal.read;
    let release!: () => void, reached!: () => void, reads = 0;
    const held = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    vi.spyOn(f.port.journal, 'read').mockImplementation(async () => {
      const record = await originalRead();
      if (++reads === 3) { reached(); await held; }
      return record;
    });
    const pending = f.client.start('+33600000000', 'human');
    await waiting; f.client.pause(); release();
    expect(await pending).toEqual({ kind: 'paused' });
    expect(f.request).not.toHaveBeenCalled();
    expect(f.stored()?.verification?.phase).toBe('starting');
  });
  it('pause does not cancel a code attempt, while inactive resume sends nothing', async () => {
    const f = fixture(); await f.client.begin(); await f.client.start('+33600000000', 'human');
    const before = f.stored(); f.client.pause(); f.deactivate(); f.request.mockClear();
    expect(await f.client.resume()).toEqual({ kind: 'paused' }); expect(f.stored()).toEqual(before); expect(f.request).not.toHaveBeenCalled();
  });
  it('a late response cannot replace a different durable selection', async () => {
    const f = fixture(); await f.client.begin();
    f.request.mockImplementationOnce(async () => {
      f.reset({ ...f.stored()!, verification: { ...f.stored()!.verification!, operationId: randomUUID() } });
      return { challengeId: randomUUID(), expiresAt: Date.now() + 60_000 };
    });
    expect(await f.client.start('+33600000000', 'human')).toEqual({ kind: 'uncertain' });
    expect(f.stored()?.verification?.phase).toBe('starting'); expect(f.stored()?.verification?.challengeId).toBeNull();
  });
  it('invalid phone/code stays local and never advances a durable phase', async () => {
    const f = fixture(); await f.client.begin(); f.request.mockClear();
    expect(await f.client.start('wrong', 'human')).toEqual({ kind: 'invalid' }); expect(f.request).not.toHaveBeenCalled();
    await f.client.start('+33600000000', 'human'); f.request.mockClear();
    expect(await f.client.check('bad')).toEqual({ kind: 'invalid' }); expect(f.request).not.toHaveBeenCalled();
  });
});
