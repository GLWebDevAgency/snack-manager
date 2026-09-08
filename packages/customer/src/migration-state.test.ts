import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { assertCustomerMigrationState } from './migration-state';

describe('customer migration readiness', () => {
  const expected = [{ hash: 'first', folderMillis: 1 }, { hash: 'second', folderMillis: 2 }];
  const pool = (rows: unknown[]) => ({ query: vi.fn(async () => ({ rows })) }) as unknown as Pick<Pool, 'query'>;
  it('accepts the exact ordered journal and forward-compatible suffix', async () => {
    await expect(assertCustomerMigrationState(pool([{ hash: 'first', created_at: '1' }, { hash: 'second', created_at: '2' }]), expected)).resolves.toBeUndefined();
    await expect(assertCustomerMigrationState(pool([{ hash: 'first', created_at: '1' }, { hash: 'second', created_at: '2' },
      { hash: 'future', created_at: '3' }]), expected)).resolves.toBeUndefined();
  });
  it.each([[], [{ hash: 'first', created_at: '1' }], [{ hash: 'tampered', created_at: '1' }, { hash: 'second', created_at: '2' }],
    [{ hash: 'first', created_at: '9' }, { hash: 'second', created_at: '2' }]].map(rows => ({ rows })))('fails closed for incomplete or changed proof', async ({ rows }) => {
    await expect(assertCustomerMigrationState(pool(rows), expected)).rejects.toThrow('migrations attendues');
  });
  it('propagates database unavailability instead of claiming readiness', async () => {
    const query = vi.fn().mockRejectedValue(new Error('unavailable'));
    await expect(assertCustomerMigrationState({ query } as unknown as Pool, expected)).rejects.toThrow();
  });
});
