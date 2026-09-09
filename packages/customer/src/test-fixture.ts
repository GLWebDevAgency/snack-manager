import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NodePgDriver } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { migrateCustomer } from './migration';

export function trackCustomerTestPool(pool: Pool): () => Promise<void> {
  // Attach immediately after construction, before any connect/query. pg-pool
  // may resolve end() after removing a client from its inventory but BEFORE
  // that client's end callback/event. Even pool.remove is not a client end.
  const clients = new Set<PoolClient>();
  let changed: (() => void) | undefined;
  let closing: Promise<void> | undefined;
  const connected = (client: PoolClient) => {
    clients.add(client);
    client.once('end', () => { clients.delete(client); changed?.(); });
  };
  pool.on('connect', connected);
  return () => closing ??= (async () => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          await pool.end();
          while (clients.size) await new Promise<void>(resolve => { changed = resolve; });
        })(),
        new Promise<never>((_resolve, reject) => {
          // A failure deadline, never a delay that permits destructive cleanup.
          deadline = setTimeout(() => reject(new Error('Fermeture PostgreSQL de test non confirmée')), 5000);
        }),
      ]);
      pool.removeListener('connect', connected);
    } finally {
      clearTimeout(deadline);
    }
  })();
}

export function assertCustomerTestTarget(raw: unknown): string {
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error('Base PostgreSQL de test locale requise'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.search || url.hash || !/^\/(?:postgres|snackmanager_[a-z0-9_]+_test_ci)$/.test(url.pathname)
    || (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))) {
    throw new Error('Base PostgreSQL de test locale requise, sans options ni cible applicative');
  }
  return url.toString();
}

export async function customerTestFixture(raw: unknown, options: {
  beforeUpgrade?: (admin: Pool) => Promise<void>;
  beforeUpgradeMigrations?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
} = {}) {
  const base = new URL(assertCustomerTestTarget(raw));
  const suffix = randomUUID().replaceAll('-', '');
  const database = `snackmanager_customer_test_${suffix}`;
  const role = `customer_test_${suffix}`;
  const password = randomUUID();
  const root = new Pool({ connectionString: base.toString(), max: 1, connectionTimeoutMillis: 3000 });
  const closeRoot = trackCustomerTestPool(root);
  let admin: Pool | undefined;
  let app: Pool | undefined;
  let closeAdmin: (() => Promise<void>) | undefined;
  let closeApp: (() => Promise<void>) | undefined;
  let databaseCreated = false;
  let roleCreated = false;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    try {
      await Promise.all([closeApp?.(), closeAdmin?.()]);
      if (databaseCreated) {
        await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
        await root.query(`DROP DATABASE "${database}"`);
      }
      if (roleCreated) await root.query(`DROP ROLE "${role}"`);
    } finally {
      await closeRoot();
    }
  })();
  try {
    await root.query(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    await root.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    roleCreated = true;
    base.pathname = `/${database}`;
    admin = new Pool({ connectionString: base.toString(), max: 4, connectionTimeoutMillis: 3000 });
    closeAdmin = trackCustomerTestPool(admin);
    // The additive customer bridge references loyalty: exercise its genuine
    // journal first, without silently changing the production customer migrator.
    const loyaltyConfig = { migrationsFolder: resolve(__dirname, '../../loyalty/drizzle'), migrationsTable: '__drizzle_loyalty_migrations' };
    const loyaltyDialect = new PgDialect();
    const loyaltyDriver = new NodePgDriver(admin, loyaltyDialect);
    await loyaltyDialect.migrate(readMigrationFiles(loyaltyConfig), loyaltyDriver.createSession(undefined), loyaltyConfig);
    if (options.beforeUpgrade) {
      // Real Drizzle migrator, original SQL/hash unchanged; seed historical rows
      // before applying the remaining migration through the production entrypoint.
      const config = { migrationsFolder: resolve(__dirname, '../drizzle'), migrationsTable: '__drizzle_customer_migrations' };
      const dialect = new PgDialect();
      const driver = new NodePgDriver(admin, dialect);
      await dialect.migrate(readMigrationFiles(config).slice(0, options.beforeUpgradeMigrations ?? 1), driver.createSession(undefined), config);
      await options.beforeUpgrade(admin);
    }
    await migrateCustomer(admin);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}";
      GRANT USAGE ON SCHEMA customer,drizzle TO "${role}";
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA customer TO "${role}";
      GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO "${role}";`);
    base.username = role;
    base.password = password;
    app = new Pool({ connectionString: base.toString(), max: 8, connectionTimeoutMillis: 3000 });
    closeApp = trackCustomerTestPool(app);
    return { app, admin, close, database, role };
  } catch (error) { await close(); throw error; }
}
