import { describe, expect, it, vi } from 'vitest';
import { createCustomerBrowserPreparation } from './browser-preparation';
import { CustomerBrowserJournalSchema, type CustomerBrowserJournal } from './browser-journal';

const ref = '10000000-0000-4000-8000-000000000001';
const other = '20000000-0000-4000-8000-000000000002';
function fixture() {
  let record: CustomerBrowserJournal | null = null;
  let state: 'prepared' | 'issued' | 'confirmed' | 'expired' = 'prepared';
  const events: string[] = [];
  const view = () => ({ browserRef: ref, state, admissionExpiresAt: Date.now() + 600_000, expiresAt: Date.now() + 604_800_000 });
  const journal = {
    read: vi.fn(async () => record),
    write: vi.fn(async (value: CustomerBrowserJournal, expected: CustomerBrowserJournal | null) => {
      if (JSON.stringify(record) !== JSON.stringify(expected)) throw Error('Conflict');
      record = CustomerBrowserJournalSchema.parse(value); events.push(`saved:${record.phase}`);
    }),
  };
  const request = vi.fn(async (_action: string, raw?: unknown) => {
    const input = raw as { step: string; browserRef: string }; events.push(input.step);
    if (input.step === 'issue') state = 'issued';
    if (input.step === 'confirm' && state === 'issued') state = 'confirmed';
    return { ...view(), browserRef: input.browserRef };
  });
  const uuid = vi.fn(() => ref);
  const port = { journal, request, uuid, lock: async <T>(work: () => Promise<T>) => work() };
  return { client: createCustomerBrowserPreparation(port), port, request, journal, uuid, events, view,
    get record() { return record; }, set record(value) { record = value; },
    set state(value: typeof state) { state = value; }, get state() { return state; } };
}

describe('Customer browser preparation — explicit, journaled, no provider', () => {
  it('commits each uncertainty phase before network and keeps only a public selector', async () => {
    const f = fixture(); expect(await f.client.begin()).toMatchObject({ kind: 'ready' });
    expect(f.events).toEqual(['saved:preparing', 'prepare', 'saved:issuing', 'issue', 'saved:confirming', 'confirm', 'saved:ready']);
    expect(f.record).toEqual({ version: 1, browserRef: ref, phase: 'ready' });
    expect(f.request.mock.calls.every(call => call[0] === 'browser')).toBe(true);
    expect(JSON.stringify(f.record)).not.toMatch(/phone|code|token|name|cookie|expiresAt/i);
  });
  it('resume without a journal is absent, not implicit enrollment or cookie adoption', async () => {
    const f = fixture(); expect(await f.client.resume()).toEqual({ kind: 'absent' });
    expect(f.request).not.toHaveBeenCalled(); expect(f.uuid).not.toHaveBeenCalled();
  });
  it('refuses work without native exclusion', async () => {
    const f = fixture(); const client = createCustomerBrowserPreparation({ ...f.port, lock: undefined });
    expect(await client.begin()).toEqual({ kind: 'blocked' }); expect(f.request).not.toHaveBeenCalled();
  });
  it('storage read or commit failure prevents any HTTP call', async () => {
    for (const failure of ['read', 'write'] as const) {
      const f = fixture(); f.journal[failure].mockRejectedValue(new Error('Storage blocked'));
      expect(await f.client.begin()).toEqual({ kind: 'uncertain' }); expect(f.request).not.toHaveBeenCalled();
    }
  });
  it('a lost public prepare response resumes with exactly the same reference', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('Lost prepare'));
    expect(await f.client.begin()).toEqual({ kind: 'uncertain' }); expect(f.record?.phase).toBe('preparing');
    expect(await f.client.resume()).toMatchObject({ kind: 'ready' }); expect(f.uuid).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls.map(call => (call[1] as { browserRef: string }).browserRef)).toEqual([ref, ref, ref, ref]);
  });
  it('an issuing journal and prepared server state never authorize another issue', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'issuing' };
    expect(await f.client.resume()).toEqual({ kind: 'uncertain' });
    expect(f.events).toEqual(['prepare']); expect(f.uuid).not.toHaveBeenCalled();
  });
  it('a lost issue body with a received cookie resumes through confirmation, never reissue', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'issuing' }; f.state = 'issued';
    expect(await f.client.resume()).toMatchObject({ kind: 'ready' });
    expect(f.events).toEqual(['prepare', 'saved:confirming', 'confirm', 'saved:ready']);
  });
  it('a lost cookie remains uncertain on failed confirmation and is never replaced automatically', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'issuing' }; f.state = 'issued';
    f.request.mockImplementation(async (_action, raw) => {
      if ((raw as { step: string }).step === 'confirm') throw Error('Cookie absent'); return f.view();
    });
    expect(await f.client.resume()).toEqual({ kind: 'uncertain' });
    expect(await f.client.begin()).toEqual({ kind: 'uncertain' });
    expect(f.uuid).not.toHaveBeenCalled(); expect(f.request.mock.calls.some(call => (call[1] as { step: string }).step === 'issue')).toBe(false);
  });
  it('a lost confirmation body rereads the same confirmed preparation, no new cookie', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'confirming' }; f.state = 'confirmed';
    expect(await f.client.resume()).toMatchObject({ kind: 'ready' });
    expect(f.events).toEqual(['prepare', 'saved:confirming', 'confirm', 'saved:ready']);
  });
  it('refuses selector changes and unknown private fields in the response', async () => {
    for (const bad of [{ browserRef: other }, { token: 'never accepted' }]) {
      const f = fixture(); f.request.mockResolvedValue({ ...f.view(), ...bad });
      expect(await f.client.begin()).toEqual({ kind: 'uncertain' }); expect(f.record?.phase).toBe('preparing');
    }
  });
  it('a changed journal while waiting cannot be overwritten by a late response', async () => {
    const f = fixture(); f.request.mockImplementationOnce(async () => {
      f.record = { version: 1, browserRef: other, phase: 'preparing' }; return f.view();
    });
    expect(await f.client.begin()).toEqual({ kind: 'uncertain' }); expect(f.record?.browserRef).toBe(other);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('explicit restart requires confirmed expiry, not a timeout or a missing receipt', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'issuing' };
    expect(await f.client.restartExpired()).toEqual({ kind: 'uncertain' }); expect(f.uuid).not.toHaveBeenCalled();
    f.request.mockRejectedValueOnce(new Error('Timeout'));
    expect(await f.client.restartExpired()).toEqual({ kind: 'uncertain' }); expect(f.uuid).not.toHaveBeenCalled();
    f.state = 'expired';
    expect(await f.client.resume()).toMatchObject({ kind: 'expired' }); expect(f.uuid).not.toHaveBeenCalled();
  });
  it('only an explicit restart journals a new reference after the prior admission is terminal', async () => {
    const f = fixture(); f.record = { version: 1, browserRef: ref, phase: 'issuing' }; f.state = 'expired'; f.uuid.mockReturnValue(other);
    f.request.mockImplementation(async (_action, raw) => {
      const input = raw as { browserRef: string; step: string };
      return { ...f.view(), browserRef: input.browserRef, state: input.browserRef === ref ? 'expired'
        : input.step === 'prepare' ? 'prepared' : input.step === 'issue' ? 'issued' : 'confirmed' };
    });
    expect(await f.client.restartExpired()).toMatchObject({ kind: 'ready' }); expect(f.record?.browserRef).toBe(other);
    expect(f.uuid).toHaveBeenCalledTimes(1);
  });
  it('strict journal refuses PII, malformed selectors and invented phases', () => {
    const valid = { version: 1, browserRef: ref, phase: 'preparing' };
    for (const bad of [{ ...valid, phone: '+33600000000' }, { ...valid, browserRef: 'bad' }, { ...valid, phase: 'authenticated' }]) {
      expect(CustomerBrowserJournalSchema.safeParse(bad).success).toBe(false);
    }
  });
});
