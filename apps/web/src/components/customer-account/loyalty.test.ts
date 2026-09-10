import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_LOYALTY_NOTICE_VERSION } from '@sm/contracts';
import { customerAccountRequest, CustomerAccountHttpError, type CustomerAccountAccess, type CustomerAccountRequest } from './client';
import { createCustomerLoyaltyClient } from './loyalty';

const program = { id: randomUUID(), version: 1, name: 'Les habitués', mechanism: 'points', termsSummary: 'Conditions du restaurant.', unitLabelSingular: 'point', unitLabelPlural: 'points' };
const member = { id: randomUUID(), joinedAt: '2026-09-09T12:00:00.000Z', qrGeneration: 1, balanceUnits: 25, unitLabelSingular: 'point', unitLabelPlural: 'points' };
function fixture() {
  const access: CustomerAccountAccess = { selection: { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } }, expiresAt: Date.now() + 60_000 };
  let current: CustomerAccountAccess | null = structuredClone(access), active = true, now = Date.now();
  const request = Object.assign(vi.fn<CustomerAccountRequest>(), { selection: vi.fn(async () => current?.selection ?? null) });
  const available = { state: 'available', expiresAt: access.expiresAt, program, profileReady: true };
  request.mockResolvedValue(available);
  const client = createCustomerLoyaltyClient({ access, request, currentAccess: () => current, active: () => active,
    lock: async job => { await job(); }, now: () => now, uuid: randomUUID });
  return { client, request, access, available, setCurrent: (value: CustomerAccountAccess | null) => { current = value; },
    pause: () => { active = false; client.invalidate(); }, expire: () => { now = access.expiresAt; } };
}
afterEach(() => vi.unstubAllGlobals());
describe('volatile account loyalty controller', () => {
  it('attaches only after explicit consent and accepts a nameless verified account without exposing the QR', async () => {
    const f = fixture(); f.request.mockResolvedValue({ ...f.available, profileReady: false }); await f.client.load();
    await f.client.attach('A'.repeat(43), false); await f.client.attach('not-a-card', true);
    await f.client.attach('A'.repeat(42) + 'B', true); expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt });
    await f.client.attach('A'.repeat(43), true);
    expect(f.request.mock.calls[1]?.[1]).toMatchObject({ step: 'attach', qrToken: 'A'.repeat(43), programId: program.id,
      rulesVersion: 1, termsNoticeVersion: 'customer-loyalty-attach-2026-09', termsAccepted: true });
    expect(f.client.getSnapshot().response?.state).toBe('member');
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain('A'.repeat(43));
  });
  it('keeps an uncertain attachment only in memory and retries its identical secret, operation and consent', async () => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValueOnce(new Error('lost'));
    await f.client.attach('A'.repeat(43), true); const sent = structuredClone(f.request.mock.calls[1]?.[1]);
    expect(f.client.getSnapshot().pendingAttachment).toBe(true);
    expect(f.client.getSnapshot().message).toContain('rattachement');
    expect(JSON.stringify(f.client.getSnapshot())).not.toContain('A'.repeat(43));
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt }); await f.client.retry();
    expect(f.request.mock.calls[2]?.[1]).toEqual(sent); expect(f.client.getSnapshot().pendingAttachment).toBe(false);
  });
  it.each([401, 409])('erases an attachment proof after authority refusal %i instead of retrying it', async status => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValueOnce(new CustomerAccountHttpError(status));
    await f.client.attach('A'.repeat(43), true); expect(f.client.getSnapshot().pendingAttachment).toBe(false);
    f.request.mockResolvedValue(f.available); await f.client.retry();
    expect(f.request.mock.calls[2]?.[1]).toEqual({ step: 'view' });
  });
  it('discards an old attachment response and proof when the selected identity changes', async () => {
    const f = fixture(); await f.client.load(); let release!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.client.attach('A'.repeat(43), true); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    await f.client.attach('Q'.repeat(42) + 'A', true); expect(f.request).toHaveBeenCalledTimes(2);
    f.setCurrent(null); release({ state: 'member', member, expiresAt: f.access.expiresAt }); await pending;
    expect(f.client.getSnapshot().response).toBeNull(); expect(f.client.getSnapshot().pendingAttachment).toBe(false);
  });
  it.each(['paused', 'expired', 'identity'] as const)('never resends a retained attachment after %s', async reason => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValueOnce(new Error('lost'));
    await f.client.attach('A'.repeat(43), true); expect(f.client.getSnapshot().pendingAttachment).toBe(true);
    if (reason === 'paused') f.pause(); else if (reason === 'expired') f.expire(); else f.setCurrent(null);
    await f.client.retry(); expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.client.getSnapshot().pendingAttachment).toBe(false); expect(f.client.getSnapshot().response).toBeNull();
  });
  it('keeps attachment throttling and uncertainty visible without another automatic request', async () => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValue(new CustomerAccountHttpError(429));
    await f.client.attach('A'.repeat(43), true);
    expect(f.client.getSnapshot().message).toContain('rattachement n’est pas confirmée'); expect(f.client.getSnapshot().message).toContain('Patientez');
    expect(f.client.getSnapshot().pendingAttachment).toBe(true); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('erases the attachment proof on changed terms and requires a fresh explicit consent and ID', async () => {
    const f = fixture(); await f.client.load();
    f.request.mockResolvedValue({ ...f.available, state: 'terms_changed', program: { ...program, version: 2 } });
    await f.client.attach('A'.repeat(43), true); const first = structuredClone(f.request.mock.calls[1]?.[1]);
    expect(f.client.getSnapshot().pendingAttachment).toBe(false); await f.client.attach('A'.repeat(43), false);
    expect(f.request).toHaveBeenCalledTimes(2);
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt }); await f.client.attach('A'.repeat(43), true);
    expect(f.request.mock.calls[2]?.[1]).toMatchObject({ rulesVersion: 2 }); expect(f.request.mock.calls[2]?.[1]).not.toEqual(first);
  });
  it('starts with a read, requires explicit acceptance and reads the QR separately', async () => {
    const f = fixture(); await f.client.load();
    expect(f.request).toHaveBeenCalledWith('loyalty', { step: 'view' }, f.access.selection);
    await f.client.join(false); expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt }); await f.client.join(true);
    expect(f.request.mock.calls[1]?.[1]).toMatchObject({ step: 'join', programId: program.id, rulesVersion: 1, termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true });
    expect(f.client.getSnapshot().response?.state).toBe('member'); expect(f.request).toHaveBeenCalledTimes(2);
    f.request.mockResolvedValue({ state: 'card', member, qrToken: 'A'.repeat(43), expiresAt: f.access.expiresAt }); await f.client.card();
    expect(f.client.getSnapshot().response?.state).toBe('card');
  });
  it('retries only the identical lost join body and ID, with no automatic resend', async () => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValueOnce(new Error('lost'));
    await f.client.join(true); const sent = structuredClone(f.request.mock.calls[1]?.[1]);
    expect(f.client.getSnapshot().pendingJoin).toBe(true); expect(f.client.getSnapshot().message).toContain('pas confirmée');
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt }); await f.client.retry();
    expect(f.request.mock.calls[2]?.[1]).toEqual(sent); expect(f.client.getSnapshot().pendingJoin).toBe(false);
  });
  it('new terms need a new explicit acceptance, never an automatic rewritten retry', async () => {
    const f = fixture(); await f.client.load();
    f.request.mockResolvedValue({ ...f.available, state: 'terms_changed', program: { ...program, version: 2 } });
    await f.client.join(true); const first = f.request.mock.calls[1]?.[1] as { operationId: string };
    expect(f.client.getSnapshot().response?.state).toBe('terms_changed'); expect(f.client.getSnapshot().pendingJoin).toBe(false);
    await f.client.join(false); expect(f.request).toHaveBeenCalledTimes(2);
    f.request.mockResolvedValue({ state: 'member', member, expiresAt: f.access.expiresAt }); await f.client.join(true);
    expect(f.request.mock.calls[2]?.[1]).toMatchObject({ rulesVersion: 2 }); expect((f.request.mock.calls[2]?.[1] as { operationId: string }).operationId).not.toBe(first.operationId);
  });
  it('does not join when the name is absent or while a request is already in flight', async () => {
    const f = fixture(); f.request.mockResolvedValue({ ...f.available, profileReady: false }); await f.client.load(); await f.client.join(true);
    expect(f.request).toHaveBeenCalledTimes(1);
    f.request.mockResolvedValue(f.available); await f.client.load();
    let release!: (value: unknown) => void; f.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.client.join(true); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(3));
    await f.client.join(true); expect(f.request).toHaveBeenCalledTimes(3);
    release({ state: 'member', member, expiresAt: f.access.expiresAt }); await pending;
  });
  it.each(['inactive', 'identity', 'expired'] as const)('drops a late private response after %s', async reason => {
    const f = fixture(); let release!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const pending = f.client.load(); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    if (reason === 'inactive') f.pause(); else if (reason === 'identity') f.setCurrent(null); else f.expire();
    release({ state: 'member', member, expiresAt: f.access.expiresAt }); await pending;
    expect(f.client.getSnapshot().response).toBeNull();
  });
  it('checks the durable publication again after the reply', async () => {
    const f = fixture(); f.request.mockImplementation(async () => {
      (f.request.selection as ReturnType<typeof vi.fn>).mockResolvedValue({ ...f.access.selection, publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } });
      return { state: 'member', member, expiresAt: f.access.expiresAt };
    }); await f.client.load(); expect(f.client.getSnapshot().response).toBeNull(); expect(f.client.getSnapshot().message).toContain('accès');
  });
  it.each(['extra', 'unsolicited-card', 'expired', 'future'] as const)('rejects %s response without private data', async reason => {
    const f = fixture(); f.request.mockResolvedValue(reason === 'unsolicited-card' ? { state: 'card', member, qrToken: 'A'.repeat(43), expiresAt: f.access.expiresAt }
      : { state: 'member', member, expiresAt: reason === 'expired' ? 1 : f.access.expiresAt + (reason === 'future' ? 1 : 0), ...(reason === 'extra' ? { phone: '+33123456789' } : {}) });
    await f.client.load(); expect(f.client.getSnapshot().response).toBeNull();
  });
  it('reports throttling distinctly, with no retry', async () => {
    const f = fixture(); f.request.mockRejectedValue(new CustomerAccountHttpError(429)); await f.client.load();
    expect(f.client.getSnapshot().message).toContain('Patientez'); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('keeps throttling and uncertainty visible together after a join', async () => {
    const f = fixture(); await f.client.load(); f.request.mockRejectedValue(new CustomerAccountHttpError(429)); await f.client.join(true);
    expect(f.client.getSnapshot().message).toContain('pas confirmée'); expect(f.client.getSnapshot().message).toContain('Patientez');
    expect(f.client.getSnapshot().pendingJoin).toBe(true); expect(f.request).toHaveBeenCalledTimes(2);
  });
});
describe('loyalty shared transport', () => {
  it('pins the published selection, uses POST and accepts bounded long terms', async () => {
    const f = fixture(), fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...f.available, program: { ...program, termsSummary: 'é'.repeat(6000) } }));
    vi.stubGlobal('fetch', fetcher);
    const request = customerAccountRequest('classfood', async () => f.access.selection.browserRef, async () => f.access.selection.publication);
    await expect(request('loyalty', { step: 'view' })).rejects.toMatchObject({ status: 409 }); expect(fetcher).not.toHaveBeenCalled();
    await expect(request('loyalty', { step: 'view' }, f.access.selection)).resolves.toHaveProperty('state', 'available');
    expect(fetcher.mock.calls[0]?.[0]).toBe('/r/classfood/compte/fidelite');
  });
});
