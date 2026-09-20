import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const WORKFLOW = new URL('../.github/workflows/deploy.yml', import.meta.url);
const STEP = '      - name: Publier contact et protection anti-robot';
const TARGETS = {
  staging: 'https://api-staging-a5e8.up.railway.app',
  production: 'https://api-production-8949.up.railway.app',
};
// Fixtures seulement : aucun secret du processus parent n'entre dans le shell.
const FIXTURES = {
  CONTACT_INGEST_TOKEN: 'fixture-contact-token with spaces',
  TURNSTILE_SECRET: 'fixture-turnstile-secret',
  TURNSTILE_SITE_KEY: 'fixture-turnstile-site-key',
  TURNSTILE_ALLOWED_HOSTS: 'fixture.example,other.fixture.example',
};
const PROVIDER_OUTPUT = 'fixture-provider-output-must-remain-masked';

/** Exécute le bloc du workflow, pas une recopie de sa logique de sélection. */
function workflowShell() {
  const lines = readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === STEP ? [index] : []);
  assert.equal(starts.length, 1, 'L’étape de publication doit être unique');
  const start = starts[0];
  const nextStep = lines.findIndex((line, index) => index > start && /^      - name:/.test(line));
  const end = nextStep < 0 ? lines.length : nextStep;
  const run = lines.findIndex((line, index) => index > start && index < end && line === '        run: |');
  assert.ok(run > start, 'Le vrai bloc bash doit être trouvé dans l’étape');
  const shell = [];
  for (let index = run + 1; index < end; index += 1) {
    const line = lines[index];
    if (line.trim() === '') { shell.push(''); continue; }
    if (!line.startsWith('          ')) break;
    shell.push(line.slice(10));
  }
  assert.ok(shell.some((line) => line.includes('railway variables')), 'Le bloc doit publier les variables');
  return shell.join('\n');
}

function execute(environment, failService = '') {
  const directory = mkdtempSync(join(tmpdir(), 'sm-relai-web-test-'));
  try {
    const capture = join(directory, 'railway-calls.bin');
    const railway = join(directory, 'railway');
    writeFileSync(railway, `#!/bin/bash
set -euo pipefail
printf '%s\\0' "$@" >> "$SM_TEST_CALLS"
printf '\\0' >> "$SM_TEST_CALLS"
printf '%s\\n' '${PROVIDER_OUTPUT}'
printf '%s\\n' '${PROVIDER_OUTPUT}' >&2
previous=''
service=''
for argument in "$@"; do
  if [[ "$previous" == '--service' ]]; then service="$argument"; fi
  previous="$argument"
done
if [[ -n "$SM_TEST_FAIL_SERVICE" && "$service" == "$SM_TEST_FAIL_SERVICE" ]]; then exit 17; fi
`);
    chmodSync(railway, 0o700);
    const env = {
      ...FIXTURES,
      PATH: directory,
      RUNNER_TEMP: directory,
      SM_TEST_CALLS: capture,
      SM_TEST_FAIL_SERVICE: failService,
      ...(environment === undefined ? {} : { ENVIRONNEMENT: environment }),
    };
    // PATH ne contient que le stub : aucun vrai CLI Railway ni réseau.
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', workflowShell()], {
      env, cwd: directory, encoding: 'utf8', timeout: 5_000,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, 'Le script doit terminer sans interruption forcée');
    const recorded = existsSync(capture) ? readFileSync(capture, 'utf8') : '';
    const calls = recorded.split('\0\0').filter(Boolean).map((record) => record.split('\0'));
    return { status: result.status, output: result.stdout + result.stderr, calls };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function publication(args) {
  assert.equal(args[0], 'variables', 'Aucune commande Railway autre que variables n’est autorisée ici');
  const result = { environment: null, service: null, skipDeploys: false, variables: {} };
  for (let index = 1; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--skip-deploys') {
      assert.equal(result.skipDeploys, false, 'Pas de drapeau dupliqué');
      result.skipDeploys = true;
      continue;
    }
    const value = args[++index];
    assert.equal(typeof value, 'string', `Valeur manquante après ${option}`);
    if (option === '--environment' || option === '--service') {
      const field = option === '--environment' ? 'environment' : 'service';
      assert.equal(result[field], null, `Option dupliquée : ${option}`);
      result[field] = value;
    } else if (option === '--set') {
      const separator = value.indexOf('=');
      assert.ok(separator > 0, 'Une variable publiée doit avoir un nom et une valeur');
      const key = value.slice(0, separator);
      assert.equal(Object.hasOwn(result.variables, key), false, `Variable dupliquée : ${key}`);
      result.variables[key] = value.slice(separator + 1);
    } else {
      assert.fail(`Argument Railway inattendu : ${option}`);
    }
  }
  return result;
}

function masked(output) {
  assert.ok(!output.includes(PROVIDER_OUTPUT), 'La sortie Railway doit rester masquée');
  for (const value of Object.values(FIXTURES)) {
    assert.ok(!output.includes(value), 'Les valeurs configurées ne doivent pas être journalisées');
  }
}

describe('publication du relais web — vrai bloc bash du workflow, Railway simulé', () => {
  for (const [environment, apiOrigin] of Object.entries(TARGETS)) {
    it(`publie la bonne origine HTTPS et les secrets dédiés sur ${environment}, sans déploiement implicite`, () => {
      const result = execute(environment);
      assert.equal(result.status, 0, result.output);
      assert.equal(result.calls.length, 2);
      const calls = result.calls.map(publication);
      assert.deepEqual(calls.map((call) => call.service), ['api', 'web']);
      for (const call of calls) {
        assert.equal(call.environment, environment);
        assert.equal(call.skipDeploys, true);
        assert.equal(call.variables.SM_CONTACT_INGEST_TOKEN, FIXTURES.CONTACT_INGEST_TOKEN);
      }
      assert.deepEqual(calls[0].variables, {
        SM_CONTACT_INGEST_TOKEN: FIXTURES.CONTACT_INGEST_TOKEN,
        TURNSTILE_SECRET_KEY: FIXTURES.TURNSTILE_SECRET,
        TURNSTILE_ALLOWED_HOSTNAMES: FIXTURES.TURNSTILE_ALLOWED_HOSTS,
      });
      assert.deepEqual(calls[1].variables, {
        SM_CONTACT_INGEST_TOKEN: FIXTURES.CONTACT_INGEST_TOKEN,
        API_URL: apiOrigin,
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: FIXTURES.TURNSTILE_SITE_KEY,
      });
      assert.equal(new URL(calls[1].variables.API_URL).protocol, 'https:');
      masked(result.output);
    });

    for (const service of ['api', 'web']) {
      it(`interrompt ${environment} si Railway échoue sur ${service}`, () => {
        const result = execute(environment, service);
        assert.notEqual(result.status, 0, 'Un refus Railway doit faire échouer l’étape');
        assert.deepEqual(result.calls.map((call) => publication(call).service),
          service === 'api' ? ['api'] : ['api', 'web']);
        assert.ok(!result.output.includes('✓'), 'Aucun succès ne doit être annoncé après le refus');
        masked(result.output);
      });
    }
  }

  for (const [label, environment] of [['inconnu', 'preview'], ['absent', undefined], ['vide', '']]) {
    it(`rejette l’environnement ${label} avant toute mutation Railway`, () => {
      const result = execute(environment);
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.calls, []);
      assert.ok(!result.output.includes('✓'));
      masked(result.output);
    });
  }
});
