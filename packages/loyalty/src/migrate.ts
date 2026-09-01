import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createLoyaltyDb } from './client';

config({ path: resolve(__dirname, '../../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');
  const { db, pool } = createLoyaltyDb(url);
  await migrate(db, {
    migrationsFolder: resolve(__dirname, '../drizzle'),
    // Les migrations Supply possèdent leur propre journal dans la même base.
    migrationsTable: '__drizzle_loyalty_migrations',
  });
  await pool.end();
  console.log('✓ Migrations fidélité appliquées');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
