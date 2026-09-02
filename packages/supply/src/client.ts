import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type SupplyDb = NodePgDatabase<typeof schema>;

/** Branche Supply sur un pool possédé par l'application hôte. */
export function supplyDb(pool: Pool): SupplyDb {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

/**
 * Taille du pool PostgreSQL — configurable SANS redéploiement de code.
 *
 * Les 10 connexions codées en dur étaient un plafond d'exploitation caché :
 * quand le GROUP BY de stock_movements s'allonge (l'historique, pas la
 * concurrence) et que le veilleur passe toutes les 5 minutes, les requêtes
 * des gérants font la queue derrière. `SM_PG_POOL_MAX` se pose sur Railway
 * (workflow « Variable Railway ») le jour où ça se voit — 10 reste le défaut,
 * et une valeur illisible retombe dessus au lieu de casser le démarrage.
 */
function taillePool(): number {
  const brut = Number(process.env.SM_PG_POOL_MAX);
  return Number.isInteger(brut) && brut >= 1 && brut <= 100 ? brut : 10;
}

export function createSupplyDb(url: string): { db: SupplyDb; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: taillePool() });
  return { db: supplyDb(pool), pool };
}
