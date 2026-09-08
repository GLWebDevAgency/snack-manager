import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { CustomerScope } from './port';

export class CustomerRepositoryError extends Error {
  constructor(readonly reason: 'invalid_input' | 'unavailable') {
    super('Identité client indisponible.');
    this.name = 'CustomerRepositoryError';
  }
}

/** SQL migrations are authoritative; the repository deliberately exposes no ORM rows. */
export const customerDb = (pool: Pool) => drizzle(pool);

export async function withCustomerScope<T>(pool: Pick<Pool, 'connect'>, scope: CustomerScope,
  work: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(scope.tenantRef) || !/^[a-zA-Z0-9_-]{1,160}$/.test(scope.parentRef)) {
    throw new CustomerRepositoryError('invalid_input');
  }
  let client: PoolClient | undefined;
  let destroy = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query('SET LOCAL synchronous_commit = on');
    await client.query("SELECT set_config('app.tenant_ref', $1, true), set_config('app.customer_parent_ref', $2, true)", [scope.tenantRef, scope.parentRef]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch {
    await client?.query('ROLLBACK').catch(() => { destroy = true; });
    throw new CustomerRepositoryError('unavailable');
  } finally { client?.release(destroy); }
}
