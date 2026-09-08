import { spawnSync } from 'node:child_process';
import { assertCustomerTestTarget } from './test-fixture';

assertCustomerTestTarget(process.env.CUSTOMER_TEST_DATABASE_URL);
const result = spawnSync(process.execPath, [require.resolve('vitest/vitest.mjs'), 'run',
  'src/repository.integration.test.ts', 'src/orchestration.integration.test.ts',
  '--maxWorkers=1', '--no-file-parallelism'], { stdio: 'inherit', timeout: 120_000 });
process.exitCode = result.status === 0 && !result.error && !result.signal ? 0 : 1;
