import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertCustomerTestTarget } from './test-fixture';

const sqlFiles = [
  'src/production.integration.test.ts', 'src/production-migration.integration.test.ts',
  'src/repository.integration.test.ts', 'src/orchestration.integration.test.ts', 'src/paid-reservation.integration.test.ts',
  'src/paid-migration.integration.test.ts', 'src/browser-continuity.integration.test.ts', 'src/browser-preparation.integration.test.ts',
  'src/verification-intents.integration.test.ts', 'src/session-publications.integration.test.ts',
  'src/session-publication-migration.integration.test.ts',
  'src/enrollment.integration.test.ts', 'src/enrollment-adversarial.integration.test.ts',
  'src/protected-access.integration.test.ts', 'src/passkey-login.integration.test.ts', 'src/account-recovery.integration.test.ts',
  'src/access-quota.integration.test.ts', 'src/access-migration.integration.test.ts',
  'src/protected-principal.integration.test.ts',
  'src/protected-session.integration.test.ts',
  'src/loyalty-memberships.integration.test.ts',
];

type Group = 'sql' | 'http';
const safeErrorCodes = new Set(['ETIMEDOUT', 'ENOENT', 'EACCES', 'EINVAL', 'EIO', 'ENOMEM']);

/** The SQL group includes 21 serial suites, each creating/migrating isolated
 * databases. Its aggregate CI budget is separate from individual test limits. */
export function runCustomerIntegrationSuites(
  run: typeof spawnSync = spawnSync,
  report: (message: string) => void = message => { process.stderr.write(`${message}\n`); },
): 0 | 1 {
  // Reject a remote/application target before starting either child process.
  assertCustomerTestTarget(process.env.CUSTOMER_TEST_DATABASE_URL);

  function group(name: Group, files: string[], timeout: number, cwd?: string): boolean {
    let result: Pick<ReturnType<typeof spawnSync>, 'status' | 'signal' | 'error'>;
    try {
      result = run(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run', ...files,
        '--maxWorkers=1', '--no-file-parallelism'], { stdio: 'inherit', timeout, ...(cwd ? { cwd } : {}) });
    } catch (error) {
      result = { status: null, signal: null, error: error instanceof Error ? error : new Error() };
    }
    if (result.status === 0 && !result.error && !result.signal) return true;
    const code = (result.error as NodeJS.ErrnoException | undefined)?.code;
    // Never print a child error message, spawn arguments, environment or URL.
    report(JSON.stringify({
      event: 'customer_integration_group_failed', group: name, timeoutMs: timeout,
      status: Number.isInteger(result.status) ? result.status : null,
      signal: typeof result.signal === 'string' && /^SIG[A-Z0-9]{1,15}$/.test(result.signal) ? result.signal : null,
      errorCode: result.error ? typeof code === 'string' && safeErrorCodes.has(code) ? code : 'UNKNOWN' : null,
    }));
    return false;
  }

  if (!group('sql', sqlFiles, 300_000)) return 1;
  // The same guarded disposable PostgreSQL target also exercises the actual
  // signed HTTP/Nest boundary. No provider or remote datastore is used.
  return group('http', [
    'src/modules/customer-identity/customer-verification.http.integration.test.ts',
    'src/modules/customer-identity/customer-loyalty.store.integration.test.ts',
  ], 120_000, resolve(__dirname, '../../../apps/api')) ? 0 : 1;
}

if (require.main === module) process.exitCode = runCustomerIntegrationSuites();
