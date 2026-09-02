import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { assertLoyaltyMigrationsCurrent } from './migration-state';

config({ path: resolve(__dirname, '../../../.env') });

export async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('DATABASE_URL runtime manquant');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await assertLoyaltyMigrationsCurrent(pool);
  } finally {
    await pool.end();
  }
  process.stdout.write('✓ Schéma fidélité vérifié\n');
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}
