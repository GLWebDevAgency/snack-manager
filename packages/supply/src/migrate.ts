import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createSupplyDb } from './client';
import { migrationDatabaseUrl } from './migration-url';
import {
  assertSupplyMigrationRoleSafe,
  grantSupplyRuntimeRole,
  runtimeDatabaseRole,
} from './migration-role';
import { assertSupplyMigrationConnectionEncrypted } from './migration-tls';

config({ path: resolve(__dirname, '../../../.env') });

export async function main() {
  const url = migrationDatabaseUrl(process.env);
  const runtimeRole = runtimeDatabaseRole(process.env);
  const { db, pool } = createSupplyDb(url);
  try {
    await assertSupplyMigrationConnectionEncrypted(pool, process.env);
    if (runtimeRole) await assertSupplyMigrationRoleSafe(pool, runtimeRole);
    await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
    if (runtimeRole) await grantSupplyRuntimeRole(pool, runtimeRole);
  } finally {
    await pool.end();
  }
  console.log('✓ Migrations supply appliquées');
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
