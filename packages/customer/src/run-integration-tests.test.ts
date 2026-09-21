import type { SpawnSyncReturns } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCustomerIntegrationSuites } from './run-integration-tests';

function outcome(patch: Partial<SpawnSyncReturns<Buffer>> = {}): SpawnSyncReturns<Buffer> {
  return { pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null, ...patch };
}

beforeEach(() => vi.stubEnv('CUSTOMER_TEST_DATABASE_URL', 'postgresql://test@127.0.0.1:55447/postgres'));
afterEach(() => vi.unstubAllEnvs());

describe('customer native integration runner', () => {
  it('runs all 21 SQL files before both HTTP files, preserving individual test limits and serial execution', () => {
    const run = vi.fn(() => outcome()), report = vi.fn();
    expect(runCustomerIntegrationSuites(run as never, report)).toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    const calls = run.mock.calls as unknown as Array<[string, string[], Record<string, unknown>]>;
    const sql = calls[0]!, http = calls[1]!;
    expect(sql[1].filter(value => value.endsWith('.integration.test.ts'))).toEqual([
      'src/production.integration.test.ts', 'src/production-migration.integration.test.ts',
      'src/repository.integration.test.ts', 'src/orchestration.integration.test.ts', 'src/paid-reservation.integration.test.ts',
      'src/paid-migration.integration.test.ts', 'src/browser-continuity.integration.test.ts', 'src/browser-preparation.integration.test.ts',
      'src/verification-intents.integration.test.ts', 'src/session-publications.integration.test.ts',
      'src/session-publication-migration.integration.test.ts', 'src/enrollment.integration.test.ts',
      'src/enrollment-adversarial.integration.test.ts', 'src/protected-access.integration.test.ts',
      'src/passkey-login.integration.test.ts', 'src/account-recovery.integration.test.ts',
      'src/access-quota.integration.test.ts', 'src/access-migration.integration.test.ts',
      'src/protected-principal.integration.test.ts', 'src/protected-session.integration.test.ts',
      'src/loyalty-memberships.integration.test.ts',
    ]);
    expect(http[1].filter(value => value.endsWith('.integration.test.ts'))).toEqual([
      'src/modules/customer-identity/customer-verification.http.integration.test.ts',
      'src/modules/customer-identity/customer-loyalty.store.integration.test.ts',
    ]);
    expect(sql[2]).toEqual({ stdio: 'inherit', timeout: 300_000 });
    expect(http[2]).toEqual({ stdio: 'inherit', timeout: 120_000, cwd: expect.stringMatching(/\/apps\/api$/) });
    for (const [, args] of calls) {
      expect(args.slice(-2)).toEqual(['--maxWorkers=1', '--no-file-parallelism']);
      expect(args.join(' ')).not.toMatch(/testTimeout|hookTimeout|retry/);
    }
    expect(report).not.toHaveBeenCalled();
  });

  const failures = [
    { label: 'assertion failure', result: outcome({ status: 1 }), status: 1, signal: null, errorCode: null },
    { label: 'signal', result: outcome({ status: null, signal: 'SIGTERM' }), status: null, signal: 'SIGTERM', errorCode: null },
    { label: 'timeout', result: outcome({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('private URL must not escape'), { code: 'ETIMEDOUT' }) }), status: null, signal: 'SIGTERM', errorCode: 'ETIMEDOUT' },
    { label: 'error despite zero status', result: outcome({ error: Object.assign(new Error('private environment'), { code: 'PRIVATE_CREDENTIAL' }) }), status: 0, signal: null, errorCode: 'UNKNOWN' },
  ];
  it.each(failures)('fails SQL on $label, diagnoses safely and never launches HTTP', ({ result, status, signal, errorCode }) => {
    const run = vi.fn(() => result), report = vi.fn();
    expect(runCustomerIntegrationSuites(run as never, report)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: 'customer_integration_group_failed', group: 'sql', timeoutMs: 300_000, status, signal, errorCode,
    }));
    expect(report.mock.calls[0]?.[0]).not.toMatch(/private|PRIVATE_CREDENTIAL|postgresql|55447/);
  });

  it.each(failures)('propagates HTTP $label after successful SQL', ({ result, status, signal, errorCode }) => {
    const run = vi.fn().mockReturnValueOnce(outcome()).mockReturnValueOnce(result), report = vi.fn();
    expect(runCustomerIntegrationSuites(run as never, report)).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      event: 'customer_integration_group_failed', group: 'http', timeoutMs: 120_000, status, signal, errorCode,
    }));
  });

  it('rejects an unsafe target before any process is spawned', () => {
    vi.stubEnv('CUSTOMER_TEST_DATABASE_URL', 'postgresql://test@remote.invalid/app');
    const run = vi.fn(), report = vi.fn();
    expect(() => runCustomerIntegrationSuites(run as never, report)).toThrow('test locale');
    expect(run).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a thrown spawn error without printing its arguments or message', () => {
    const run = vi.fn(() => { throw Object.assign(new Error('private child command'), { code: 'EACCES' }); }), report = vi.fn();
    expect(runCustomerIntegrationSuites(run as never, report)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(JSON.parse(report.mock.calls[0]![0])).toMatchObject({ group: 'sql', errorCode: 'EACCES', status: null, signal: null });
    expect(report.mock.calls[0]?.[0]).not.toContain('private');
  });
});
