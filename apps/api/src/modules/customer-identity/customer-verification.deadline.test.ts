import { afterEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_VERIFICATION_TIMING } from '@sm/contracts';
import { customerVerificationDeadline, CustomerVerificationDeadline } from './customer-verification.deadline';

afterEach(() => vi.useRealTimers());
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('verification HTTP budget without a second provider operation', () => {
  it('does not put session/passkey/recovery/loyalty behind an SMS deadline', () => {
    for (const action of ['session', 'passkey', 'recovery', 'loyalty', 'status'] as const) expect(customerVerificationDeadline(action)).toBeUndefined();
  });
  it('refuses a provider POST when queued preflight resumes after its response timed out', async () => {
    vi.useFakeTimers(); const deadline = new CustomerVerificationDeadline('start'); const held = deferred<void>();
    const provider = vi.fn().mockResolvedValue('sent');
    const result = deadline.run(async () => { await held.promise; return deadline.provider(provider); }).catch(error => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatchObject({ reason: 'unavailable' });
    held.resolve(); await vi.advanceTimersByTimeAsync(1);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each(['start', 'check'] as const)('bounds %s including finalization, while retaining an already-started durable settlement', async action => {
    vi.useFakeTimers(); const deadline = new CustomerVerificationDeadline(action);
    const held = deferred<string>(), settlement = vi.fn();
    const result = deadline.run(async () => { const value = await deadline.provider(() => held.promise); settlement(value); return value; }).catch(error => error);
    await vi.advanceTimersByTimeAsync(CUSTOMER_VERIFICATION_TIMING[action].apiMs);
    expect(await result).toMatchObject({ reason: 'unavailable' });
    held.resolve('original-provider-result'); await vi.advanceTimersByTimeAsync(1);
    expect(settlement).toHaveBeenCalledExactlyOnceWith('original-provider-result');
  });
  it('does not spend after disconnect, but allows persistence after disconnect during a sent request', async () => {
    vi.useFakeTimers(); const cancelled = new CustomerVerificationDeadline('start'); const provider = vi.fn();
    cancelled.abort(); await expect(cancelled.provider(provider)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(provider).not.toHaveBeenCalled();
    const deadline = new CustomerVerificationDeadline('start'), held = deferred<string>(), settlement = vi.fn();
    const result = deadline.run(async () => { const value = await deadline.provider(() => held.promise); settlement(value); return value; }).catch(error => error);
    deadline.abort(); expect(await result).toMatchObject({ reason: 'unavailable' });
    held.resolve('ack'); await vi.advanceTimersByTimeAsync(1); expect(settlement).toHaveBeenCalledExactlyOnceWith('ack');
  });
  it('waits past the former five seconds and limits final publication to ten seconds after provider completion', async () => {
    vi.useFakeTimers(); const deadline = new CustomerVerificationDeadline('start'), sent = deferred<string>(), stored = deferred<void>();
    const result = deadline.run(async () => { const value = await deadline.provider(() => sent.promise); await stored.promise; return value; }).catch(error => error);
    await vi.advanceTimersByTimeAsync(15_000); sent.resolve('ack'); await vi.advanceTimersByTimeAsync(9_999);
    let finished = false; void result.then(() => { finished = true; }); await Promise.resolve(); expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(await result).toMatchObject({ reason: 'unavailable' });
    stored.resolve();
  });
});
