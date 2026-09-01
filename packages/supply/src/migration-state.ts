import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

type MigrationRow = { hash: unknown; created_at: unknown };
type ExpectedMigration = Pick<MigrationMeta, 'hash' | 'folderMillis'>;

export async function assertSupplyMigrationState(
  pool: Pick<Pool, 'query'>,
  expected: readonly ExpectedMigration[],
): Promise<void> {
  const result = await pool.query<MigrationRow>(`
    SELECT hash, created_at::text AS created_at
      FROM drizzle.__drizzle_migrations
     ORDER BY created_at ASC
  `);

  // Une migration future additive ne doit pas interdire le rollback du code.
  if (result.rows.length < expected.length) {
    throw new Error('Le schéma supply ne correspond pas aux migrations attendues');
  }

  for (const [index, migration] of expected.entries()) {
    const row = result.rows[index];
    if (
      typeof row?.hash !== 'string' ||
      row.hash !== migration.hash ||
      row.created_at !== String(migration.folderMillis)
    ) {
      throw new Error('Le journal des migrations supply est incohérent');
    }
  }
}

export async function assertSupplyMigrationsCurrent(pool: Pick<Pool, 'query'>): Promise<void> {
  const expected = readMigrationFiles({
    migrationsFolder: resolve(__dirname, '../drizzle'),
  });
  await assertSupplyMigrationState(pool, expected);
}
