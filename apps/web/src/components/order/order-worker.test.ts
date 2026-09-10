import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderWorkerScope, registerOrderWorker, vapidBytes, waitForOrderWorker } from './order-worker';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('installation dans le seul scope du restaurant', () => {
  it('attend la registration explicite depuis /t sans accéder au ready global', async () => {
    const worker = new EventTarget() as EventTarget & { state: string }; worker.state = 'installing';
    const registration = { active: null, installing: worker };
    const register = vi.fn(async () => registration);
    vi.stubGlobal('navigator', { serviceWorker: { register, get ready() { throw Error('wrong global ready'); } } });
    let resolved = false; const promise = registerOrderWorker('scope-test').then(() => { resolved = true; });
    await Promise.resolve(); expect(resolved).toBe(false);
    worker.state = 'activated'; worker.dispatchEvent(new Event('statechange')); await promise;
    expect(register).toHaveBeenCalledExactlyOnceWith('/r/scope-test/sw.js', { scope: '/r/scope-test/' });
    await registerOrderWorker('scope-test'); expect(register).toHaveBeenCalledTimes(1);
  });
  it('borne une installation bloquée et permet de réessayer après échec', async () => {
    const register = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ active: {} });
    vi.stubGlobal('navigator', { serviceWorker: { register } });
    await expect(registerOrderWorker('retry-test')).rejects.toThrow('offline'); await registerOrderWorker('retry-test'); expect(register).toHaveBeenCalledTimes(2);
    vi.useFakeTimers(); const worker = new EventTarget();
    const waiting = expect(waitForOrderWorker({ installing: worker } as ServiceWorkerRegistration)).rejects.toThrow('trop longue');
    await vi.advanceTimersByTimeAsync(12_000); await waiting;
  });
  it('refuse tout scope libre et transforme la clé publique sans accès DOM', () => {
    expect(() => orderWorkerScope('../admin')).toThrow(); expect(() => orderWorkerScope('a/b')).toThrow();
    expect([...vapidBytes('AAH_')]).toEqual([0, 1, 255]);
  });
});
