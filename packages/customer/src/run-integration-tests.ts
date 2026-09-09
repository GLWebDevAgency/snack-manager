import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { assertCustomerTestTarget } from './test-fixture';

assertCustomerTestTarget(process.env.CUSTOMER_TEST_DATABASE_URL);
const result = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run',
  'src/repository.integration.test.ts', 'src/orchestration.integration.test.ts', 'src/paid-reservation.integration.test.ts',
  'src/paid-migration.integration.test.ts', 'src/browser-continuity.integration.test.ts', 'src/browser-preparation.integration.test.ts',
  'src/verification-intents.integration.test.ts', 'src/session-publications.integration.test.ts',
  'src/session-publication-migration.integration.test.ts',
  'src/enrollment.integration.test.ts', 'src/enrollment-adversarial.integration.test.ts',
  'src/protected-access.integration.test.ts', 'src/passkey-login.integration.test.ts', 'src/account-recovery.integration.test.ts',
  'src/access-quota.integration.test.ts', 'src/access-migration.integration.test.ts',
  'src/protected-principal.integration.test.ts',
  '--maxWorkers=1', '--no-file-parallelism'], { stdio: 'inherit', timeout: 120_000 });
if (result.status !== 0 || result.error || result.signal) process.exitCode = 1;
else {
  // The same guarded disposable PostgreSQL target also exercises the actual
  // signed HTTP/Nest boundary. No provider or remote datastore is used.
  const http = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run',
    'src/modules/customer-identity/customer-verification.http.integration.test.ts',
    '--maxWorkers=1', '--no-file-parallelism'], {
    cwd: resolve(__dirname, '../../../apps/api'), stdio: 'inherit', timeout: 120_000,
  });
  process.exitCode = http.status === 0 && !http.error && !http.signal ? 0 : 1;
}
