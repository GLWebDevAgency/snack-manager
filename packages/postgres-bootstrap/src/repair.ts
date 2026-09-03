import { Pool } from 'pg';
import { repairPostgresBootstrap } from './bootstrap';
import { authenticatedPostgresUrl } from './connection-url';

export type RepairEnvironment = 'staging' | 'production';

type RepairProcessEnvironment = Readonly<
  Partial<Record<
    | 'DATABASE_BOOTSTRAP_ADMIN_URL'
    | 'DATABASE_BOOTSTRAP_EXPECTED_HOST'
    | 'DATABASE_BOOTSTRAP_EXPECTED_PORT',
    string | undefined
  >>
>;

function requiredEnvironment(
  environment: RepairProcessEnvironment,
  name: keyof RepairProcessEnvironment,
): string {
  const value = environment[name];
  if (!value || value !== value.trim()) throw new Error(`${name} manquant ou entouré d’espaces`);
  return value;
}

export function repairConnectionUrl(
  deployment: RepairEnvironment,
  environment: RepairProcessEnvironment = process.env,
): string {
  const expectedPort = requiredEnvironment(
    environment,
    'DATABASE_BOOTSTRAP_EXPECTED_PORT',
  );
  if (
    !/^[1-9]\d{0,4}$/.test(expectedPort) ||
    Number(expectedPort) > 65_535
  ) {
    throw new Error('DATABASE_BOOTSTRAP_EXPECTED_PORT doit être un port TCP valide');
  }
  const migrationRole = `snackmanager_${deployment}_migrator`;
  const runtimeRole = `snackmanager_${deployment}_app`;
  return authenticatedPostgresUrl(environment.DATABASE_BOOTSTRAP_ADMIN_URL, {
    variableName: 'DATABASE_BOOTSTRAP_ADMIN_URL',
    expectedDatabase: 'railway',
    expectedHost: requiredEnvironment(environment, 'DATABASE_BOOTSTRAP_EXPECTED_HOST'),
    expectedPort,
    forbiddenRoles: [migrationRole, runtimeRole],
  });
}

export function parseRepairArguments(args: readonly string[]): {
  environment: RepairEnvironment;
  apply: true;
} {
  let environment: RepairEnvironment | null = null;
  let apply = false;
  let separator = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      if (separator) throw new Error('Le séparateur -- ne peut apparaître qu’une fois');
      separator = true;
      continue;
    }
    if (argument === '--apply') {
      if (apply) throw new Error('--apply ne peut apparaître qu’une fois');
      apply = true;
      continue;
    }
    if (argument === '--environment') {
      if (environment) throw new Error('--environment ne peut apparaître qu’une fois');
      const value = args[index + 1];
      if (value !== 'staging' && value !== 'production') {
        throw new Error('--environment doit valoir staging ou production');
      }
      environment = value;
      index += 1;
      continue;
    }
    throw new Error(`Argument de réparation inconnu : ${String(argument)}`);
  }
  if (!environment) throw new Error('--environment est obligatoire');
  if (!apply) {
    throw new Error(
      'Réparation refusée sans --apply explicite ; exécuter d’abord postgres:bootstrap:check:built',
    );
  }
  return { environment, apply: true };
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { environment } = parseRepairArguments(args);
  const migrationRole = `snackmanager_${environment}_migrator`;
  const runtimeRole = `snackmanager_${environment}_app`;
  const pool = new Pool({
    connectionString: repairConnectionUrl(environment),
    max: 1,
    connectionTimeoutMillis: 5_000,
  });
  try {
    const result = await repairPostgresBootstrap(pool, {
      migrationRole,
      runtimeRole,
      expectedDatabase: 'railway',
    });
    process.stdout.write(
      `✓ Bootstrap PostgreSQL réparé sur ${environment} — ${result.changed.length} changement(s) exact(s)\n`,
    );
    for (const change of result.changed) process.stdout.write(`  - ${change}\n`);
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
