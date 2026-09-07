import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./reprise-mongo.sh', import.meta.url));

/** Real Bash, but no Railway, credentials, pnpm task or database is invoked. */
function run(args, confirmation = '') {
  const dir = mkdtempSync(join(tmpdir(), 'sm-reprise-guard-'));
  const calls = join(dir, 'calls');
  const fixtureCredential = randomUUID();
  const shim = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const tool = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SM_TEST_CALLS, JSON.stringify({tool,args}) + '\\n');
if (tool === 'railway' && args[0] === 'variables') {
  process.stdout.write('MONGOUSER=fixture\\nMONGOPASSWORD=' + process.env.SM_TEST_AUTH_VALUE + '\\nRAILWAY_TCP_PROXY_DOMAIN=unused.invalid\\nRAILWAY_TCP_PROXY_PORT=1\\n');
}
`;
  for (const tool of ['railway', 'pnpm']) writeFileSync(join(dir, tool), shim, { mode: 0o700 });
  try {
    const result = spawnSync('/bin/bash', [SCRIPT, ...args], { encoding: 'utf8', input: confirmation, timeout: 10_000,
      env: { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, SM_TEST_CALLS: calls, SM_TEST_AUTH_VALUE: fixtureCredential } });
    let observed = [];
    try { observed = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map((row) => JSON.parse(row)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { ...result, calls: observed, fixtureCredential };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('reprise Mongo Railway — liste positive avant tout accès', () => {
  it.each(['seed', 'seed:orders', 'exec', 'admin', 'create:admin', 'copy-database', '--help', 'unknown'])(
    'refuse la tâche %s avant Railway et avant pnpm', (task) => {
      const result = run(['staging', task]);
      expect(result.status).toBe(2);
      expect(result.calls).toEqual([]);
    },
  );

  it('tracking exige --appliquer avant même la lecture des accès', () => {
    const result = run(['staging', 'backfill:tracking']);
    expect(result.status).toBe(2);
    expect(result.calls).toEqual([]);
    expect(result.stderr).toContain('--appliquer');
  });

  it.each(['backfill:founder', 'backfill:contact', 'backfill:brand', 'backfill:medias'])(
    'conserve la lecture seule de %s', (task) => {
      const result = run(['staging', task]);
      expect(result.status).toBe(0);
      expect(result.calls.filter((call) => call.tool === 'pnpm')).toEqual([{ tool: 'pnpm', args: ['--filter', '@sm/db', task] }]);
    },
  );

  it('conserve le cycle appliquer puis contrôler pour une reprise à mode lecture', () => {
    const result = run(['staging', 'backfill:brand', '--appliquer', '--reparer']);
    expect(result.status).toBe(0);
    expect(result.calls.filter((call) => call.tool === 'pnpm').map((call) => call.args)).toEqual([
      ['--filter', '@sm/db', 'backfill:brand', '--', '--appliquer', '--reparer'],
      ['--filter', '@sm/db', 'backfill:brand', '--', '--exiger-zero'],
    ]);
  });

  it('ne relance pas automatiquement le writer tracking sous couvert de contrôle', () => {
    const result = run(['staging', 'backfill:tracking', '--appliquer']);
    expect(result.status).toBe(0);
    expect(result.calls.filter((call) => call.tool === 'pnpm')).toHaveLength(1);
    expect(result.stdout).not.toContain(result.fixtureCredential);
    expect(result.stderr).not.toContain(result.fixtureCredential);
  });

  it('la production demande encore une confirmation et ne lance pas la tâche si elle manque', () => {
    const result = run(['production', 'backfill:brand'], 'non\n');
    expect(result.status).toBe(1);
    expect(result.calls.filter((call) => call.tool === 'pnpm')).toEqual([]);
  });
});
