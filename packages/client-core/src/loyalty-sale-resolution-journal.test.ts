import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeSupersededLoyaltySaleResolutionIntent, completeLoyaltySaleResolutionIntent, LOYALTY_SALE_RESOLUTION_STORAGE_KEY, prepareLoyaltySaleResolutionIntent, readLoyaltySaleResolutionIntent, type LoyaltySaleResolutionLocalIntent } from './loyalty-sale-resolution-journal';
import type { KeyValueStore } from './storage';
const orderId = 'a'.repeat(24), ownerId = `${'b'.repeat(24)}:user:${'c'.repeat(24)}`;
const operationId = '11111111-1111-4111-8111-111111111111', caseId = '22222222-2222-4222-8222-222222222222';
const intent = (): LoyaltySaleResolutionLocalIntent => ({ ownerId, orderId, dueUnits: 3, request: { operationId, caseId, expectedVersion: 2, decision: 'waive_current', reason: 'Geste commercial' } });
const result = { state: 'recorded', reason: null, version: 3, initialUnits: 10, reversedUnits: 0, waivedUnits: 3, retainedUnits: 10, dueUnits: 0 };
const view = () => ({ orderId, orderNumber: 42, caseId, version: 5, state: 'reconciliation', reason: 'insufficient_balance', initialUnits: 10, reversedUnits: 0, waivedUnits: 3, retainedUnits: 10, dueUnits: 2,
  canResolve: true, canAllocate: false, resolutions: [{ request: intent().request, result, recordedAt: '2026-09-21T10:00:00.000Z' }] });
function fixture() { const values = new Map<string, string>(); const open = (): KeyValueStore => ({ async getItem(key) { return values.get(key) ?? null; }, async setItem(key, value) { values.set(key, value); }, async removeItem(key) { values.delete(key); } }); return { values, open, store: open() }; }
afterEach(() => vi.unstubAllGlobals());
describe('durable historical sale decisions', () => {
  it('survives reload, excludes secrets and acknowledges the original receipt after later refunds', async () => {
    const f = fixture(); await prepareLoyaltySaleResolutionIntent(f.store, intent());
    expect(await readLoyaltySaleResolutionIntent(f.open(), ownerId, orderId)).toEqual({ state: 'pending', intent: intent() });
    expect(f.values.get(LOYALTY_SALE_RESOLUTION_STORAGE_KEY)).not.toMatch(/password|token/);
    await completeLoyaltySaleResolutionIntent(f.open(), intent(), view()); await completeLoyaltySaleResolutionIntent(f.open(), intent(), view());
    expect(await readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).toEqual({ state: 'none' });
  });
  it('refuses two versions, decisions, reasons or authors for the same order', async () => {
    const f = fixture(); await prepareLoyaltySaleResolutionIntent(f.store, intent());
    for (const patch of [{ expectedVersion: 3 }, { decision: 'retry' as const }, { reason: 'Different reason' }, { operationId: caseId }]) {
      await expect(prepareLoyaltySaleResolutionIntent(f.store, { ...intent(), request: { ...intent().request, ...patch } })).rejects.toThrow();
    }
    expect(await readLoyaltySaleResolutionIntent(f.open(), `${'b'.repeat(24)}:user:${'d'.repeat(24)}`, orderId)).toEqual({ state: 'blocked' });
  });
  it('serializes concurrent tabs with Web Locks and never falls back to process memory', async () => {
    let tail: Promise<unknown> = Promise.resolve();
    vi.stubGlobal('document', {}); vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: unknown, work: () => unknown) => { const next = tail.then(work); tail = next.catch(() => undefined); return next; } } });
    const f = fixture(); const results = await Promise.allSettled([prepareLoyaltySaleResolutionIntent(f.store, intent()), prepareLoyaltySaleResolutionIntent(f.open(), { ...intent(), request: { ...intent().request, operationId: caseId } })]);
    expect(results.map(entry => entry.status)).toEqual(['fulfilled', 'rejected']);
    vi.stubGlobal('navigator', {}); await expect(prepareLoyaltySaleResolutionIntent(f.store, intent())).rejects.toThrow();
  });
  it('does not purge on absent, different order or counterfeit acknowledgement', async () => {
    const f = fixture(); await prepareLoyaltySaleResolutionIntent(f.store, intent());
    for (const invalid of [null, { ...view(), resolutions: [] }, { ...view(), orderId: 'f'.repeat(24) }, { ...view(), resolutions: [{ ...view().resolutions[0], request: { ...intent().request, expectedVersion: 3 } }] }]) {
      await expect(completeLoyaltySaleResolutionIntent(f.store, intent(), invalid)).rejects.toThrow();
    }
    expect((await readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).state).toBe('pending');
  });
  it('fails closed for corrupted storage or rejected durable writes', async () => {
    const f = fixture(); f.values.set(LOYALTY_SALE_RESOLUTION_STORAGE_KEY, 'broken'); await expect(readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).rejects.toThrow();
    f.values.clear(); f.store.setItem = async () => { throw new Error('quota'); }; await expect(prepareLoyaltySaleResolutionIntent(f.store, intent())).rejects.toThrow();
  });
  it('requires the exact raw receipt reason, without transport trimming', async () => {
    const f = fixture(); await prepareLoyaltySaleResolutionIntent(f.store, intent());
    const counterfeit = view(); counterfeit.resolutions[0]!.request.reason += ' ';
    await expect(completeLoyaltySaleResolutionIntent(f.store, intent(), counterfeit)).rejects.toThrow();
    expect((await readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).state).toBe('pending');
  });
  it('closes only an explicitly superseded CAS without receipt and preserves newer local decisions', async () => {
    const f = fixture(); await prepareLoyaltySaleResolutionIntent(f.store, intent());
    const superseded = { ...view(), resolutions: [] };
    for (const invalid of [{ ...superseded, version: 2 }, { ...superseded, orderId: 'f'.repeat(24) }, { ...superseded, caseId: operationId }, view()]) {
      await expect(closeSupersededLoyaltySaleResolutionIntent(f.store, intent(), invalid)).rejects.toThrow();
    }
    await closeSupersededLoyaltySaleResolutionIntent(f.store, intent(), superseded);
    expect((await readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).state).toBe('none');
    const newer = { ...intent(), dueUnits: 2, request: { ...intent().request, operationId: '33333333-3333-4333-8333-333333333333', expectedVersion: 5 } };
    await prepareLoyaltySaleResolutionIntent(f.store, newer);
    await expect(closeSupersededLoyaltySaleResolutionIntent(f.store, intent(), superseded)).rejects.toThrow();
    expect(await readLoyaltySaleResolutionIntent(f.store, ownerId, orderId)).toEqual({ state: 'pending', intent: newer });
  });
});
