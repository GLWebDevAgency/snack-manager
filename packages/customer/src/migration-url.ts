export type MigrationEnvironment = Record<string, string | undefined>;

function isDeployedEnvironment(env: MigrationEnvironment): boolean {
  return (
    env.NODE_ENV === 'production' ||
    Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim()) ||
    Boolean(env.RAILWAY_ENVIRONMENT_ID?.trim())
  );
}

function assertEncryptedMigrationUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_MIGRATION_URL doit être une URL PostgreSQL valide');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_MIGRATION_URL doit utiliser PostgreSQL');
  }

  const allowed = new Set(['sslmode', 'uselibpqcompat', 'sslrootcert']);
  const keys = [...url.searchParams.keys()];
  if (
    keys.some((key) => !allowed.has(key)) ||
    [...allowed].some((key) => url.searchParams.getAll(key).length > 1)
  ) {
    throw new Error('DATABASE_MIGRATION_URL contient des paramètres TLS ambigus');
  }

  const sslMode = url.searchParams.get('sslmode');
  const verifyFull =
    sslMode === 'verify-full' &&
    url.searchParams.get('uselibpqcompat') === null &&
    url.searchParams.get('sslrootcert') === null;
  const verifyCa =
    sslMode === 'verify-ca' &&
    url.searchParams.get('uselibpqcompat') === 'true' &&
    Boolean(url.searchParams.get('sslrootcert')) &&
    keys.length === 3;

  if (!verifyFull && !verifyCa) {
    throw new Error(
      'DATABASE_MIGRATION_URL doit authentifier PostgreSQL avec sslmode=verify-full ou verify-ca',
    );
  }
}

/**
 * Sépare l'identité DDL des migrations de l'identité applicative soumise RLS.
 * En production, retomber sur DATABASE_URL rendrait le choix de sécurité
 * invisible : soit l'API serait super-utilisateur, soit les migrations
 * manqueraient de droits. Le repli ne reste permis qu'en développement/test.
 */
export function migrationDatabaseUrl(env: MigrationEnvironment): string {
  const privileged = env.DATABASE_MIGRATION_URL?.trim();
  if (privileged) {
    if (isDeployedEnvironment(env)) assertEncryptedMigrationUrl(privileged);
    return privileged;
  }

  if (isDeployedEnvironment(env)) {
    throw new Error('DATABASE_MIGRATION_URL manquant dans un environnement déployé');
  }

  const runtime = env.DATABASE_URL?.trim();
  if (runtime) return runtime;
  throw new Error('DATABASE_MIGRATION_URL ou DATABASE_URL manquant');
}

