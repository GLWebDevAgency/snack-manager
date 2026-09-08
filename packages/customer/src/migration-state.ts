import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

export async function assertCustomerMigrationState(pool: Pick<Pool, 'query'>,
  expected: readonly Pick<MigrationMeta, 'hash' | 'folderMillis'>[]): Promise<void> {
  const result = await pool.query<{ hash: unknown; created_at: unknown }>(
    'SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at ASC');
  if (result.rows.length < expected.length || expected.some((migration, index) => {
    const row = result.rows[index];
    return row?.hash !== migration.hash || row?.created_at !== String(migration.folderMillis);
  })) throw new Error('Le schéma identité client ne correspond pas aux migrations attendues');
}

export async function assertCustomerMigrationsCurrent(pool: Pick<Pool, 'query'>): Promise<void> {
  await assertCustomerMigrationState(pool, readMigrationFiles({
    migrationsFolder: resolve(__dirname, '../drizzle'), migrationsTable: '__drizzle_customer_migrations',
  }));
}
