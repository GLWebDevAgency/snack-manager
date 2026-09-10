import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NodePgSession } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';

export function assertCanonicalSaleTestTarget(raw: unknown): string {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error('Local isolated PostgreSQL test target required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.search || url.hash || !/^\/(?:postgres|snackmanager_[a-z0-9_]+_test_ci)$/.test(url.pathname)
    || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error('Local isolated PostgreSQL test target required');
  }
  return url.toString();
}

// pool.end() can resolve before a removed client's socket actually ends.
// Do not drop the generated database/role until every owned socket is closed.
function closeTrackedPool(pool: Pool) {
  const clients = new Set<PoolClient>();
  let changed: (() => void) | undefined;
  pool.on('connect', client => {
    clients.add(client);
    client.once('end', () => { clients.delete(client); changed?.(); });
  });
  let closing: Promise<void> | undefined;
  return () => closing ??= (async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await pool.end();
          while (clients.size) await new Promise<void>(resolve => { changed = resolve; });
        })(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Test PostgreSQL closure not confirmed')), 5000);
        }),
      ]);
    } finally { clearTimeout(deadline); }
  })();
}

export async function canonicalSaleTestFixture(raw: unknown, through?: number) {
  const target = new URL(assertCanonicalSaleTestTarget(raw));
  const suffix = randomUUID().replaceAll('-', '');
  const database = `snackmanager_loyalty_test_${suffix}`;
  const role = `loyalty_owner_${suffix}`;
  const password = randomUUID();
  const root = new Pool({ connectionString: target.toString(), max: 1, connectionTimeoutMillis: 3000 });
  const closeRoot = closeTrackedPool(root);
  let pool: Pool | undefined;
  let closePool: (() => Promise<void>) | undefined;
  let databaseCreated = false; let roleCreated = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await closePool?.();
      if (databaseCreated) await root.query(`DROP DATABASE "${database}"`);
      if (roleCreated) await root.query(`DROP ROLE "${role}"`);
    } finally { await closeRoot(); }
  })();
  try {
    await root.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    roleCreated = true;
    await root.query(`CREATE DATABASE "${database}" OWNER "${role}"`);
    databaseCreated = true;
    target.pathname = `/${database}`; target.username = role; target.password = password;
    pool = new Pool({ connectionString: target.toString(), max: 4, connectionTimeoutMillis: 3000 });
    closePool = closeTrackedPool(pool);
    const migratedPool = pool;
    const upgrade = async (count?: number) => {
      const config = { migrationsFolder: resolve(__dirname, '../drizzle'), migrationsTable: '__drizzle_loyalty_migrations' };
      const dialect = new PgDialect();
      const session = new NodePgSession<Record<string, never>, Record<string, never>>(migratedPool, dialect, undefined);
      const migrations = readMigrationFiles(config);
      await dialect.migrate(count === undefined ? migrations : migrations.slice(0, count), session, config);
    };
    await upgrade(through);
    return { pool, role, database, upgrade, close };
  } catch (error) { await close(); throw error; }
}

export async function inCanonicalSaleTenant<T>(pool: Pool, tenant: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_ref', $1, true)", [tenant]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
