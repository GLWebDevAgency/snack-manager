import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { migrateCustomer } from './migration';
import { migrationDatabaseUrl } from './migration-url';
import { assertCustomerMigrationRoleSafe, grantCustomerRuntimeRole, runtimeDatabaseRole } from './migration-role';
import { assertCustomerMigrationConnectionEncrypted } from './migration-tls';

export async function main(): Promise<void> {
  config({ path: resolve(__dirname, '../../../.env'), quiet: true });
  const connectionString = migrationDatabaseUrl(process.env);
  const runtimeRole = runtimeDatabaseRole(process.env);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try {
    await assertCustomerMigrationConnectionEncrypted(pool, process.env);
    if (runtimeRole) await assertCustomerMigrationRoleSafe(pool, runtimeRole);
    await migrateCustomer(pool);
    if (runtimeRole) await grantCustomerRuntimeRole(pool, runtimeRole);
  } finally { await pool.end(); }
  process.stdout.write('Migrations identité client appliquées.\n');
}
if (require.main === module) void main().catch(() => {
  process.stderr.write('Migration identité client indisponible.\n');
  process.exitCode = 1;
});
