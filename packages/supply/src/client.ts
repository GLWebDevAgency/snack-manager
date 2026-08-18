import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type SupplyDb = NodePgDatabase<typeof schema>;

export function createSupplyDb(url: string): { db: SupplyDb; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
