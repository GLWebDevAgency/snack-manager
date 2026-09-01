import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createLoyaltyDb } from './client';
import { migrationDatabaseUrl } from './migration-url';
import {
  assertLoyaltyMigrationRoleSafe,
  grantLoyaltyRuntimeRole,
  runtimeDatabaseRole,
} from './migration-role';
import { assertLoyaltyMigrationConnectionEncrypted } from './migration-tls';

config({ path: resolve(__dirname, '../../../.env') });

export async function main() {
  const url = migrationDatabaseUrl(process.env);
  const runtimeRole = runtimeDatabaseRole(process.env);
  const { db, pool } = createLoyaltyDb(url);
  try {
    await assertLoyaltyMigrationConnectionEncrypted(pool, process.env);
    if (runtimeRole) await assertLoyaltyMigrationRoleSafe(pool, runtimeRole);
    await migrate(db, {
      migrationsFolder: resolve(__dirname, '../drizzle'),
      // Les migrations Supply possèdent leur propre journal dans la même base.
      migrationsTable: '__drizzle_loyalty_migrations',
    });
    if (runtimeRole) await grantLoyaltyRuntimeRole(pool, runtimeRole);
  } finally {
    await pool.end();
  }
  console.log('✓ Migrations fidélité appliquées');
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
