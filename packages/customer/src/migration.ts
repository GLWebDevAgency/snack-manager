import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { customerDb } from './client';

export async function migrateCustomer(pool: Pool): Promise<void> {
  await migrate(customerDb(pool), { migrationsFolder: resolve(__dirname, '../drizzle'),
    migrationsTable: '__drizzle_customer_migrations' });
}
