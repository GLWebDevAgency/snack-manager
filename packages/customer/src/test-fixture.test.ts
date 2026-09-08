import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { Pool, type ClientBase } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackCustomerTestPool } from './test-fixture';

// The installed pg-pool is real. Only the connection transport is held, without
// opening a socket or inspecting/patching any pool internals.
function fixture(holdConnect = false) {
  const clients: HeldClient[] = [];
  class HeldClient extends EventEmitter {
    _queryable = true;
    endCallback: (() => void) | undefined;
    connectCallback: (() => void) | undefined;
    ended = false;
    constructor() { super(); clients.push(this); }
    connect(callback: () => void) { if (holdConnect) this.connectCallback = callback; else callback(); }
    end(callback: () => void) { this.endCallback = callback; }
    finish() {
      this.endCallback?.(); // pg's connection callback/remove precedes client end.
      this.ended = true;
      this.emit('end');
    }
  }
  const pool = new Pool({ Client: HeldClient as unknown as new () => ClientBase, idleTimeoutMillis: 0 });
  return { pool, clients };
}

afterEach(() => vi.useRealTimers());

describe('disposable customer pool drainage', () => {
  it('proves the installed pool.end can resolve before the client end callback', async () => {
    const f = fixture();
    const client = await f.pool.connect(); client.release();
    await f.pool.end();
    expect(f.pool.totalCount).toBe(0);
    expect(f.clients[0]!.ended).toBe(false);
    f.clients[0]!.finish();
  });

  it('does not permit destructive cleanup until every client has actually ended', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const clients = await Promise.all([f.pool.connect(), f.pool.connect()]);
    clients.forEach(client => client.release());
    const cleanup = vi.fn(); const closing = drain().then(cleanup);
    try {
      await setImmediate();
      expect(f.pool.ended).toBe(true);
      expect(cleanup).not.toHaveBeenCalled();
      f.clients[0]!.finish(); await setImmediate();
      expect(cleanup).not.toHaveBeenCalled();
      f.clients[1]!.finish(); await closing;
      expect(cleanup).toHaveBeenCalledOnce();
    } finally { f.clients.filter(client => !client.ended).forEach(client => client.finish()); await closing; }
  });

  it('does not mistake remove for the later client end event', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const client = await f.pool.connect(); client.release();
    const cleanup = vi.fn(); const closing = drain().then(cleanup);
    try {
      f.clients[0]!.endCallback?.();
      await setImmediate(); expect(cleanup).not.toHaveBeenCalled();
      f.clients[0]!.ended = true; f.clients[0]!.emit('end');
      await closing; expect(cleanup).toHaveBeenCalledOnce();
    } finally { if (!f.clients[0]!.ended) f.clients[0]!.finish(); await closing; }
  });

  it('tracks clients already removed by release(true) before pool.end', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const client = await f.pool.connect(); client.release(true);
    const cleanup = vi.fn(); const closing = drain().then(cleanup);
    try {
      await setImmediate(); expect(f.pool.totalCount).toBe(0); expect(cleanup).not.toHaveBeenCalled();
      f.clients[0]!.finish(); await closing;
    } finally { if (!f.clients[0]!.ended) f.clients[0]!.finish(); await closing; }
  });

  it('fails closed when a client never ends, without authorizing cleanup on timeout', async () => {
    vi.useFakeTimers();
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const client = await f.pool.connect(); client.release();
    const cleanup = vi.fn();
    const result = drain().then(() => { cleanup(); return null; }, error => error);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeInstanceOf(Error);
    expect(cleanup).not.toHaveBeenCalled();
    f.clients[0]!.finish();
  });

  it('does not swallow client errors including 57P01', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const client = await f.pool.connect();
    const failure = Object.assign(new Error('synthetic connection failure'), { code: '57P01' });
    expect(() => client.emit('error', failure)).toThrow(failure);
    expect(() => f.pool.emit('error', failure, client)).toThrow(failure);
    client.release(); const closing = drain(); f.clients[0]!.finish(); await closing;
  });

  it('also tracks a connect already in flight when drainage starts', async () => {
    const f = fixture(true); const drain = trackCustomerTestPool(f.pool);
    const connecting = f.pool.connect();
    const cleanup = vi.fn(); const closing = drain().then(cleanup);
    await setImmediate(); expect(cleanup).not.toHaveBeenCalled();
    f.clients[0]!.connectCallback?.();
    const client = await connecting; client.release();
    await setImmediate(); expect(cleanup).not.toHaveBeenCalled();
    f.clients[0]!.finish(); await closing; expect(cleanup).toHaveBeenCalledOnce();
  });

  it('waits for a checked-out client to be released and ended', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const client = await f.pool.connect();
    const cleanup = vi.fn(); const closing = drain().then(cleanup);
    await setImmediate(); expect(cleanup).not.toHaveBeenCalled();
    client.release();
    await setImmediate(); expect(cleanup).not.toHaveBeenCalled();
    f.clients[0]!.finish(); await closing; expect(cleanup).toHaveBeenCalledOnce();
  });

  it('propagates pool.end rejection instead of authorizing cleanup', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const failure = new Error('synthetic pool shutdown failure');
    vi.spyOn(f.pool, 'end').mockRejectedValueOnce(failure);
    const cleanup = vi.fn();
    await expect(drain().then(cleanup)).rejects.toBe(failure);
    expect(cleanup).not.toHaveBeenCalled();
    await f.pool.end();
  });

  it('closes an unused pool and reuses the same completion on repeated calls', async () => {
    const f = fixture(); const drain = trackCustomerTestPool(f.pool);
    const first = drain(); const second = drain();
    // Attach both rejection handlers before asserting identity on the old code.
    const finished = Promise.allSettled([first, second]);
    expect(first).toBe(second);
    expect((await finished).every(result => result.status === 'fulfilled')).toBe(true);
  });
});
