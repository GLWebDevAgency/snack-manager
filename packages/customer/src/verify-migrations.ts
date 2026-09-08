import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { assertCustomerMigrationsCurrent } from './migration-state';

export async function main(): Promise<void> {
  config({ path: resolve(__dirname, '../../../.env'), quiet: true });
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('Configuration identité client absente.');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  try { await assertCustomerMigrationsCurrent(pool); } finally { await pool.end(); }
  process.stdout.write('Schéma identité client vérifié.\n');
}
if (require.main === module) void main().catch(() => {
  process.stderr.write('Vérification identité client indisponible.\n');
  process.exitCode = 1;
});
