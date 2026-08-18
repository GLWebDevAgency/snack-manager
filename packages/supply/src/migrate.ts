import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createSupplyDb } from './client';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const { db, pool } = createSupplyDb(url);
  await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
  await pool.end();
  console.log('✓ Migrations supply appliquées');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
