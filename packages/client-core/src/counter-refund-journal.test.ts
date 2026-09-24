import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CounterRefundJournal } from '@sm/contracts';
import { COUNTER_REFUND_STORAGE_KEY, adoptCounterRefundIntent, assertCounterRefundsSettled, closeSupersededCounterRefundResolution, markCounterRefundIntent, prepareCounterRefundIntent,
  prepareCounterRefundNoEffect, readCounterRefundIntent, readCounterRefundIntents, reconcileCounterRefundJournal, type CounterRefundLocalIntent } from './counter-refund-journal';
import type { KeyValueStore } from './storage';
const ownerId = `${'a'.repeat(24)}:staff:${'b'.repeat(24)}`, manager = `${'a'.repeat(24)}:user:${'c'.repeat(24)}`, orderId = 'd'.repeat(24);
const intent = (): CounterRefundLocalIntent => ({ ownerId, orderId, phase: 'prepared', body: { operationId: randomUUID(), amountCents: 150,
  reason: 'Article manquant', tender: 'cash', allocation: { version: 1, merchandiseCents: 100, deliveryCents: 50 } } });
function fixture() {
  const disk = new Map<string, string>();
  const store = (): KeyValueStore => ({ getItem: async key => disk.get(key) ?? null, setItem: async (key, value) => { disk.set(key, value); }, removeItem: async key => { disk.delete(key); } });
  return { disk, store: store(), reload: store };
}
const journal = (local: CounterRefundLocalIntent, state: CounterRefundJournal['operations'][number]['state']): CounterRefundJournal => ({
  orderId, enabled: true, available: true, unavailableReason: null, observedAt: '2026-09-21T10:10:00.000Z', tender: 'cash', originalPaidCents: 500, refundedCents: state === 'confirmed' ? 150 : 0,
  pendingRefundCents: ['prepared', 'started'].includes(state) ? 150 : 0, remainingCents: ['withdrawn', 'not_executed'].includes(state) ? 500 : 350,
  basis: { merchandiseCents: 400, deliveryCents: 100 }, remaining: ['withdrawn', 'not_executed'].includes(state)
    ? { merchandiseCents: 400, deliveryCents: 100 } : { merchandiseCents: 300, deliveryCents: 50 }, canResolveNoEffect: true,
  operations: [{ ...structuredClone(local.body), state, preparedAt: '2026-09-21T10:00:00.000Z', startedAt: ['prepared', 'withdrawn'].includes(state) ? null : '2026-09-21T10:01:00.000Z',
    disburseExpiresAt: ['prepared', 'withdrawn'].includes(state) ? null : '2026-09-21T10:06:00.000Z',
    confirmedAt: state === 'confirmed' ? '2026-09-21T10:02:00.000Z' : null, resolvedAt: ['withdrawn', 'not_executed'].includes(state) ? '2026-09-21T10:10:00.000Z' : null,
    resolutionReason: state === 'not_executed' ? 'Aucun geste effectué' : null, canResume: ['prepared', 'started'].includes(state) }],
});
describe('counter refund durable journal', () => {
  it('survives fresh store/controller instances without credentials or permission to repeat cash', async () => {
    const f = fixture(), local = intent(); await prepareCounterRefundIntent(f.store, local);
    const started = await markCounterRefundIntent(f.reload(), local, 'start_requested');
    expect(await readCounterRefundIntent(f.reload(), ownerId, orderId)).toEqual({ state: 'pending', intent: started });
    expect([...f.disk.values()].join()).not.toMatch(/password|pin|token|mayDisburse/);
    await expect(assertCounterRefundsSettled(f.store)).rejects.toThrow();
  });
  it.each(['prepared', 'started'] as const)('adopts an exact resumable server %s on a new store without any permission', async state => {
    const f = fixture(), local = intent();
    const adopted = await adoptCounterRefundIntent(f.store, ownerId, orderId, local.body.operationId, journal(local, state));
    expect(adopted).toEqual({ ...local, phase: state === 'started' ? 'start_requested' : 'prepared' });
    expect(await readCounterRefundIntent(f.reload(), ownerId, orderId)).toEqual({ state: 'pending', intent: adopted });
    expect([...f.disk.values()].join()).not.toMatch(/mayDisburse|disburseExpiresAt|authorization/);
  });
  it('refuses another author or a terminal server operation and never rolls back a local confirmation', async () => {
    const f = fixture(), local = intent(), view = journal(local, 'started');
    await expect(adoptCounterRefundIntent(f.store, ownerId, orderId, local.body.operationId, { ...view, operations: [{ ...view.operations[0]!, canResume: false }] })).rejects.toThrow();
    await expect(adoptCounterRefundIntent(f.store, ownerId, orderId, local.body.operationId, journal(local, 'confirmed'))).rejects.toThrow();
    await prepareCounterRefundIntent(f.store, local); const started = await markCounterRefundIntent(f.store, local, 'start_requested');
    const confirming = await markCounterRefundIntent(f.store, started, 'confirm_requested');
    expect(await adoptCounterRefundIntent(f.store, ownerId, orderId, local.body.operationId, view)).toEqual(confirming);
    await expect(adoptCounterRefundIntent(f.store, manager, orderId, local.body.operationId, view)).rejects.toThrow();
  });
  it('serializes two authors and refuses a competing immutable body for the same order', async () => {
    const f = fixture(), a = intent(), b = { ...intent(), ownerId: manager };
    const results = await Promise.allSettled([prepareCounterRefundIntent(f.store, a), prepareCounterRefundIntent(f.reload(), b)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await readCounterRefundIntent(f.store, manager, orderId)).toEqual({ state: 'blocked' });
    expect(await readCounterRefundIntents(f.store, manager)).toEqual([]);
    await expect(prepareCounterRefundIntent(f.store, { ...a, body: { ...a.body, amountCents: 100, allocation: { version: 1, merchandiseCents: 100, deliveryCents: 0 } } })).rejects.toThrow();
  });
  it('keeps unknown, prepared and started requests until an exact terminal receipt', async () => {
    const f = fixture(), local = intent(); await prepareCounterRefundIntent(f.store, local);
    for (const view of [{ ...journal(local, 'prepared'), operations: [] }, journal(local, 'prepared'), journal(local, 'started')]) {
      await reconcileCounterRefundJournal(f.store, orderId, view);
      expect(await readCounterRefundIntent(f.store, ownerId, orderId)).toMatchObject({ state: 'pending' });
    }
    await reconcileCounterRefundJournal(f.store, orderId, journal(local, 'confirmed'));
    expect(await readCounterRefundIntent(f.store, ownerId, orderId)).toEqual({ state: 'none' });
    await expect(assertCounterRefundsSettled(f.store)).resolves.toBeUndefined();
  });
  it.each(['order', 'amount', 'reason', 'raw reason', 'allocation', 'operation', 'tender'])('refuses counterfeit %s proof without deletion', async field => {
    const f = fixture(), local = intent(); await prepareCounterRefundIntent(f.store, local);
    const view = journal(local, 'confirmed'), op = view.operations[0]!;
    if (field === 'order') view.orderId = 'e'.repeat(24);
    if (field === 'amount') { op.amountCents++; op.allocation.merchandiseCents++; }
    if (field === 'reason') op.reason = 'Autre raison';
    if (field === 'raw reason') op.reason += ' ';
    if (field === 'allocation') { op.allocation.merchandiseCents--; op.allocation.deliveryCents++; }
    if (field === 'operation') op.operationId = randomUUID();
    if (field === 'tender') op.tender = 'card';
    await reconcileCounterRefundJournal(f.store, orderId, view).catch(() => undefined);
    expect(await readCounterRefundIntent(f.store, ownerId, orderId)).toMatchObject({ state: 'pending' });
  });
  it('records a responsible resolution without transferring the original author, and clears both only on exact terminal proof', async () => {
    const f = fixture(), local = intent(); await prepareCounterRefundIntent(f.store, local);
    await markCounterRefundIntent(f.store, local, 'start_requested');
    const decision: CounterRefundLocalIntent = { ...local, ownerId: manager, phase: 'no_effect_requested', resolutionReason: 'Aucun geste effectué' };
    await prepareCounterRefundNoEffect(f.store, decision, journal(local, 'started'));
    expect(await readCounterRefundIntent(f.store, ownerId, orderId)).toMatchObject({ intent: { ownerId, phase: 'start_requested' } });
    expect(await readCounterRefundIntent(f.store, manager, orderId)).toEqual({ state: 'pending', intent: decision });
    await reconcileCounterRefundJournal(f.store, orderId, journal(local, 'not_executed'));
    await expect(assertCounterRefundsSettled(f.store)).resolves.toBeUndefined();
  });
  it('cannot move a confirmation backwards or destroy a newer request with an older receipt', async () => {
    const f = fixture(), first = intent(); await prepareCounterRefundIntent(f.store, first);
    const started = await markCounterRefundIntent(f.store, first, 'start_requested');
    const confirming = await markCounterRefundIntent(f.store, started, 'confirm_requested');
    await expect(markCounterRefundIntent(f.store, confirming, 'start_requested')).rejects.toThrow();
    await reconcileCounterRefundJournal(f.store, orderId, journal(first, 'confirmed'));
    const next = intent(); await prepareCounterRefundIntent(f.store, next);
    await reconcileCounterRefundJournal(f.store, orderId, journal(first, 'confirmed'));
    expect(await readCounterRefundIntent(f.store, ownerId, orderId)).toEqual({ state: 'pending', intent: next });
  });
  it('fails closed for corrupt or denied durable storage, including purge', async () => {
    const f = fixture(); f.disk.set(COUNTER_REFUND_STORAGE_KEY, '{');
    await expect(readCounterRefundIntents(f.store, ownerId)).rejects.toThrow();
    await expect(prepareCounterRefundIntent(f.store, intent())).rejects.toThrow();
    await expect(assertCounterRefundsSettled(f.store)).rejects.toThrow();
    f.disk.clear(); f.store.setItem = async () => { throw Error('quota'); };
    await expect(prepareCounterRefundIntent(f.store, intent())).rejects.toThrow();
    expect(f.disk.size).toBe(0);
  });
  it('does not fall back to a single-context browser lock', async () => {
    const f = fixture(); vi.stubGlobal('document', {}); vi.stubGlobal('navigator', {});
    try { await expect(prepareCounterRefundIntent(f.store, intent())).rejects.toThrow(); expect(f.disk.size).toBe(0); }
    finally { vi.unstubAllGlobals(); }
  });
  it('acknowledges only the exact owner decision, with explicit closure if another definitive decision won', async () => {
    const f = fixture(), local = intent(); await prepareCounterRefundIntent(f.store, local);
    const decision: CounterRefundLocalIntent = { ...local, ownerId: manager, phase: 'no_effect_requested', resolutionReason: 'Décision locale en attente' };
    await prepareCounterRefundNoEffect(f.store, decision, journal(local, 'started'));
    await reconcileCounterRefundJournal(f.store, orderId, journal(local, 'not_executed'));
    expect(await readCounterRefundIntent(f.store, manager, orderId)).toEqual({ state: 'pending', intent: decision });
    await expect(closeSupersededCounterRefundResolution(f.store, decision, journal(local, 'started'))).rejects.toThrow();
    await closeSupersededCounterRefundResolution(f.store, decision, journal(local, 'not_executed'));
    await expect(assertCounterRefundsSettled(f.store)).resolves.toBeUndefined();
  });
  it.each([{ password: 'never' }, { mayDisburse: true }, { authorization: { kind: 'manager_pin', pin: '0000' } }])('rejects persistence of secret or transient authority %j', async addition => {
    const f = fixture(); await expect(prepareCounterRefundIntent(f.store, { ...intent(), ...addition })).rejects.toThrow(); expect(f.disk.size).toBe(0);
  });
});
