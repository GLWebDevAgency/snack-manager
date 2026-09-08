import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { NodePgDriver } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrateCustomer } from './migration';

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

export async function customerTestFixture(raw: unknown, options: { beforeUpgrade?: (admin: Pool) => Promise<void> } = {}) {
  const base = new URL(assertCustomerTestTarget(raw));
  const suffix = randomUUID().replaceAll('-', '');
  const database = `snackmanager_customer_test_${suffix}`;
  const role = `customer_test_${suffix}`;
  const password = randomUUID();
  const root = new Pool({ connectionString: base.toString(), max: 1, connectionTimeoutMillis: 3000 });
  let admin: Pool | undefined;
  let app: Pool | undefined;
  let databaseCreated = false;
  let roleCreated = false;
  const close = async () => {
    await app?.end();
    await admin?.end();
    if (databaseCreated) {
      await root.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [database]);
      await root.query(`DROP DATABASE "${database}"`);
    }
    if (roleCreated) await root.query(`DROP ROLE "${role}"`);
    await root.end();
  };
  try {
    await root.query(`CREATE DATABASE "${database}"`);
    databaseCreated = true;
    await root.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`);
    roleCreated = true;
    base.pathname = `/${database}`;
    admin = new Pool({ connectionString: base.toString(), max: 4, connectionTimeoutMillis: 3000 });
    if (options.beforeUpgrade) {
      // Real Drizzle migrator, original SQL/hash unchanged; seed historical rows
      // before applying the remaining migration through the production entrypoint.
      const config = { migrationsFolder: resolve(__dirname, '../drizzle'), migrationsTable: '__drizzle_customer_migrations' };
      const dialect = new PgDialect();
      const driver = new NodePgDriver(admin, dialect);
      await dialect.migrate(readMigrationFiles(config).slice(0, 1), driver.createSession(undefined), config);
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
    return { app, admin, close, database, role };
  } catch (error) { await close(); throw error; }
}
