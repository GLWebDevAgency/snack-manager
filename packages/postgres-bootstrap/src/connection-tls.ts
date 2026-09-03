import type { PoolClient } from 'pg';

type TlsProbe = Readonly<{
  ssl: unknown;
  version: unknown;
  cipher: unknown;
}>;

type QueryClient = Pick<PoolClient, 'query'>;

const TLS_PROBE_QUERY = `
SELECT ssl, version, cipher
 FROM pg_catalog.pg_stat_ssl
 WHERE pid OPERATOR(pg_catalog.=) pg_catalog.pg_backend_pid()
`;

function isTls12OrNewer(version: string): boolean {
  const match = /^TLSv(\d+)\.(\d+)$/.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 2);
}

/**
 * Prouve le transport de la session réellement établie. La validation de
 * l'URL protège la négociation ; cette sonde empêche une régression du client
 * ou du serveur avant toute lecture de catalogue ou mutation bootstrap.
 */
export async function assertPostgresConnectionEncrypted(client: QueryClient): Promise<void> {
  const result = await client.query<TlsProbe>(TLS_PROBE_QUERY);
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    result.rows.length !== 1 ||
    row?.ssl !== true ||
    typeof row.version !== 'string' ||
    !isTls12OrNewer(row.version) ||
    typeof row.cipher !== 'string' ||
    row.cipher.trim().length === 0
  ) {
    throw new Error('Le bootstrap PostgreSQL exige une session TLS 1.2 ou supérieure');
  }
}

export const connectionTlsSqlForTests = TLS_PROBE_QUERY;
