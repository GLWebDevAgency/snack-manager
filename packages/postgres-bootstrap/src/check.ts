import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { checkPostgresBootstrap } from './bootstrap';
import { authenticatedPostgresUrl } from './connection-url';

config({ path: resolve(__dirname, '../../../.env') });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} manquant`);
  return value;
}

export async function main(): Promise<void> {
  const migrationRole = requiredEnvironment('DATABASE_MIGRATION_ROLE');
  const pool = new Pool({
    connectionString: authenticatedPostgresUrl(process.env.DATABASE_MIGRATION_URL, {
      variableName: 'DATABASE_MIGRATION_URL',
      expectedDatabase: 'railway',
      expectedRole: migrationRole,
    }),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const report = await checkPostgresBootstrap(pool, {
      migrationRole,
      runtimeRole: requiredEnvironment('DATABASE_RUNTIME_ROLE'),
    });
    process.stdout.write(
      `✓ Bootstrap PostgreSQL vérifié en lecture seule — ${report.objects.length} objets gérés\n`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}
