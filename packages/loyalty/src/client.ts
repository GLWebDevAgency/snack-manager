import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type LoyaltyDb = NodePgDatabase<typeof schema>;
export type LoyaltyTx = Parameters<Parameters<LoyaltyDb['transaction']>[0]>[0];

/** Branche le contexte fidélité sur le pool PostgreSQL partagé par l'API. */
export function loyaltyDb(pool: Pool): LoyaltyDb {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/** Connexion autonome réservée aux migrations et outils en ligne de commande. */
export function createLoyaltyDb(url: string): { db: LoyaltyDb; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 1 });
  return { db: loyaltyDb(pool), pool };
}

/**
 * Frontière obligatoire de toute requête métier fidélité.
 *
 * Les politiques RLS échouent fermé sans `app.tenant_ref`; le callback reçoit
 * donc uniquement une transaction déjà scellée au restaurant du JWT.
 */
export function withLoyaltyTenant<T>(
  db: LoyaltyDb,
  tenantRef: string,
  work: (tx: LoyaltyTx) => Promise<T>,
): Promise<T> {
  const scopedTenant = tenantRef.trim();
  if (!scopedTenant || scopedTenant.length > 160) {
    throw new Error('Référence établissement fidélité invalide');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_ref', ${scopedTenant}, true)`);
    return work(tx);
  });
}
