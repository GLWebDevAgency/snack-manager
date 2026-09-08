import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { CustomerRepositoryError, withCustomerScope } from './client';

describe('customer scoped transaction', () => {
  function fixture(rollbackFails = false) {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'ROLLBACK' && rollbackFails) throw new Error('private driver details');
      return { rows: [], rowCount: 0 };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }) as unknown as PoolClient);
    return { query, release, connect, pool: { connect } as unknown as Pool };
  }
  it('sets both transaction-local scopes and commits before releasing', async () => {
    const f = fixture();
    expect(await withCustomerScope(f.pool, { tenantRef: 'tenant', parentRef: 'parent' }, async () => 3)).toBe(3);
    expect(f.query.mock.calls[0]).toEqual(['BEGIN']);
    expect(f.query.mock.calls.at(-1)).toEqual(['COMMIT']);
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_ref'"), ['tenant', 'parent']);
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it.each([false, true])('rolls back failures and destroys the connection if rollback fails (%s)', async broken => {
    const f = fixture(broken);
    const result = await withCustomerScope(f.pool, { tenantRef: 'tenant', parentRef: 'parent' }, async () => {
      throw new Error('private driver details');
    }).catch(error => error as Error);
    expect(result).toBeInstanceOf(CustomerRepositoryError);
    expect(JSON.stringify(result).includes('private driver details')).toBe(false);
    expect(result.cause).toBeUndefined();
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledWith(broken);
  });
  it('rejects invalid scopes before acquiring a connection', async () => {
    const f = fixture();
    await expect(withCustomerScope(f.pool, { tenantRef: 'x;unsafe', parentRef: 'parent' }, async () => 1)).rejects.toBeInstanceOf(CustomerRepositoryError);
    expect(f.connect).not.toHaveBeenCalled();
  });
});
