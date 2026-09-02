import { resolve } from 'node:path';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

type MigrationRow = { hash: unknown; created_at: unknown };
type ExpectedMigration = Pick<MigrationMeta, 'hash' | 'folderMillis'>;

/**
 * Refuse une base absente, en retard ou dont le journal attendu a été altéré.
 * Les migrations futures restent permises pour conserver un rollback code
 * compatible avec une évolution de schéma additive.
 * Le rôle applicatif ne reçoit qu'un SELECT sur ce journal.
 */
export async function assertLoyaltyMigrationState(
  pool: Pick<Pool, 'query'>,
  expected: readonly ExpectedMigration[],
): Promise<void> {
  const result = await pool.query<MigrationRow>(`
    SELECT hash, created_at::text AS created_at
      FROM drizzle.__drizzle_loyalty_migrations
     ORDER BY created_at ASC
  `);

  if (result.rows.length < expected.length) {
    throw new Error('Le schéma fidélité ne correspond pas aux migrations attendues');
  }

  for (const [index, migration] of expected.entries()) {
    const row = result.rows[index];
    if (
      typeof row?.hash !== 'string' ||
      row.hash !== migration.hash ||
      row.created_at !== String(migration.folderMillis)
    ) {
      throw new Error('Le journal des migrations fidélité est incohérent');
    }
  }
}

export async function assertLoyaltyMigrationsCurrent(
  pool: Pick<Pool, 'query'>,
): Promise<void> {
  const expected = readMigrationFiles({
    migrationsFolder: resolve(__dirname, '../drizzle'),
    migrationsTable: '__drizzle_loyalty_migrations',
  });
  await assertLoyaltyMigrationState(pool, expected);
}
