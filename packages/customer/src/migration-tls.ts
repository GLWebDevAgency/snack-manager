import type { Pool } from 'pg';

type Environment = Record<string, string | undefined>;
type TlsProbe = { ssl: unknown; version: unknown; cipher: unknown };

function isDeployedEnvironment(env: Environment): boolean {
  return (
    env.NODE_ENV === 'production' ||
    Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim()) ||
    Boolean(env.RAILWAY_ENVIRONMENT_ID?.trim())
  );
}

function isTls12OrNewer(version: string): boolean {
  const match = /^TLSv(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 2);
}

/** Bloque tout DDL identité client avant la première requête non chiffrée. */
export async function assertCustomerMigrationConnectionEncrypted(
  pool: Pick<Pool, 'query'>,
  env: Environment,
): Promise<void> {
  if (!isDeployedEnvironment(env)) return;

  const result = await pool.query<TlsProbe>(`
    SELECT ssl, version, cipher
      FROM pg_catalog.pg_stat_ssl
     WHERE pid = pg_backend_pid()
  `);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    row?.ssl !== true ||
    typeof row.version !== 'string' ||
    !isTls12OrNewer(row.version) ||
    typeof row.cipher !== 'string' ||
    row.cipher.length === 0
  ) {
    throw new Error('La connexion DDL identité client doit utiliser TLS 1.2 ou supérieur');
  }
}

