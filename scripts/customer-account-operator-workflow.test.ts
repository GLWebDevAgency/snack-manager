import { afterAll, describe, expect, it, vi } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rootCertificates } from 'node:tls';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { customerAccountOperator } from './customer-account-operator';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = readFileSync(join(root, '.github/workflows/customer-account-operator.yml'), 'utf8');
function block(name: string, definition = workflow) {
  const source = definition.split(`// BEGIN ${name}\n`)[1]?.split(`// END ${name}`)[0];
  if (!source) throw new Error(`Missing executable workflow block: ${name}`);
  return source.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
}
const directory = mkdtempSync(join(tmpdir(), 'customer-operator-workflow-test-'));
const runnerFile = join(directory, 'runner.mjs');
writeFileSync(runnerFile, block('CUSTOMER_OPERATOR_RUNNER'));
const runner = await import(/* @vite-ignore */ pathToFileURL(runnerFile).href);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

type Env = Record<string, string | undefined>;
function databaseUrl(options: { environment?: string; username?: string; hostname?: string; port?: string;
  pathname?: string; search?: string; hash?: string } = {}) {
  const environment = options.environment ?? 'staging';
  const url = new URL('postgresql://database.example/railway');
  url.username = options.username ?? `snackmanager_${environment}_migrator`;
  url.password = randomUUID();
  url.hostname = options.hostname ?? (environment === 'staging' ? 'zephyr.proxy.rlwy.net' : 'production.example');
  url.port = options.port ?? (environment === 'staging' ? '34641' : '15432');
  url.pathname = options.pathname ?? '/railway';
  url.search = options.search ?? '';
  url.hash = options.hash ?? '';
  return url.toString();
}
function fixture(environment = 'staging') {
  const target = { version: 1, environment, railwayProjectId: '11111111-1111-4111-8111-111111111111',
    railwayEnvironmentId: '22222222-2222-4222-8222-222222222222', tenantRef: 'a'.repeat(24), slug: 'operator-fixture',
    verifyAccountSid: `AC${'b'.repeat(32)}`, verifyServiceSid: `VA${'c'.repeat(32)}`,
    origins: ['https://restaurant.example'], apiOrigin: 'https://api.example' };
  const request = { action: 'authorize-budget', target, input: { parentRef: target.verifyAccountSid, tenantRef: target.tenantRef,
    authorizationRef: 'budget-reviewed-fixture', serviceSid: target.verifyServiceSid, currency: 'USD',
    authorizedSpendMicrousd: 1_000_000, reservePerSendMicrousd: 100_000, maxSendReservations: 10,
    costEvidenceReference: 'cost-reviewed-fixture', notBefore: 1_800_000_000_000, expiresAt: 1_800_086_400_000 } };
  const env: Env = { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: directory, GITHUB_WORKSPACE: root,
    GITHUB_REPOSITORY: 'GLWebDevAgency/snack-manager', GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: `refs/heads/${environment === 'staging' ? 'develop' : 'main'}`, GITHUB_SHA: 'a'.repeat(40),
    INPUT_EXPECTED_SHA: 'a'.repeat(40), INPUT_ENVIRONMENT: environment, INPUT_REQUEST: JSON.stringify(request), INPUT_APPLY: 'false',
    OPERATOR_PHASE: 'validate', GH_TOKEN: 'PRIVATE_GITHUB_TOKEN', RAILWAY_TOKEN: 'PRIVATE_RAILWAY_TOKEN',
    DATABASE_MIGRATION_URL_RAW: databaseUrl({ environment }),
    DATABASE_MIGRATION_ROOT_CA_B64: Buffer.from(rootCertificates[0]!).toString('base64'),
    EXPECTED_MIGRATION_HOST_PRODUCTION: 'production.example', EXPECTED_MIGRATION_PORT_PRODUCTION: '15432' };
  const native = { RAILWAY_PROJECT_ID: target.railwayProjectId, RAILWAY_ENVIRONMENT_ID: target.railwayEnvironmentId,
    RAILWAY_ENVIRONMENT_NAME: environment };
  return { env, request, native };
}
function harness(f = fixture()) {
  const state = { head: f.env.GITHUB_SHA, native: { ...f.native }, calls: [] as { apply: boolean; env: Env }[],
    cliError: false, cleanupError: false, afterNative: undefined as undefined | (() => void) };
  const emit = vi.fn(); const writeFile = vi.fn();
  const execute = vi.fn((command: string, args: string[], options: { env: Env }) => {
    if (command === 'gh') {
      expect(args).toEqual(['api', `repos/GLWebDevAgency/snack-manager/git/ref/heads/${f.env.INPUT_ENVIRONMENT === 'staging' ? 'develop' : 'main'}`]);
      expect(Object.keys(options.env)).not.toContain('RAILWAY_TOKEN');
      return JSON.stringify({ ref: f.env.GITHUB_REF, object: { type: 'commit', sha: state.head } });
    }
    expect(command).toBe('railway');
    expect(args).toEqual(['variables', '--environment', f.env.INPUT_ENVIRONMENT, '--service', 'api', '--json']);
    expect(Object.keys(options.env)).not.toContain('DATABASE_MIGRATION_URL_RAW');
    state.afterNative?.();
    return JSON.stringify({ ...state.native, DATABASE_URL: 'PRIVATE_RUNTIME_URL', SOME_SECRET: 'PRIVATE_PROVIDER_SECRET' });
  });
  const invokeCli = vi.fn(async (apply: boolean, env: Env) => {
    state.calls.push({ apply, env });
    if (apply && state.cliError) throw new Error('PRIVATE_FAILED_COMMIT_PASSWORD');
    // Strict production schema and dry-run, not a duplicate workflow schema.
    const planned = await customerAccountOperator(JSON.parse(f.env.INPUT_REQUEST!));
    return apply ? { ...planned, mode: 'apply', outcome: 'applied', code: 'operation_applied' } : planned;
  });
  const removeFile = vi.fn(() => { if (state.cleanupError) throw new Error('PRIVATE_CLEANUP'); });
  return { state, emit, writeFile, execute, invokeCli, removeFile, io: { emit, writeFile, execute, invokeCli, removeFile } };
}
function apply(f: ReturnType<typeof fixture>) { f.env.OPERATOR_PHASE = 'apply'; f.env.INPUT_APPLY = 'true'; }

describe('workflow opérateur : autorité et séparation des secrets', () => {
  it('est découvert par le glob @sm/scripts, sans déclenchement automatique ni identifiants avant validation', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^  (push|pull_request|workflow_run|schedule):/m);
    expect(workflow).toContain('group: deploiement-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('default: false');
    const secretBoundary = workflow.indexOf('      - name: Appliquer avec');
    expect(secretBoundary).toBeGreaterThan(workflow.indexOf('      - name: Valider strictement'));
    expect(workflow.slice(0, secretBoundary)).not.toContain('${{ secrets.');
    expect(workflow.slice(0, secretBoundary)).not.toMatch(/\$\{\{[^\n]*secrets\./);
    for (const line of workflow.split('\n').filter(line => line.includes('${{ inputs.request }}'))) {
      expect(line.trim()).toBe('INPUT_REQUEST: ${{ inputs.request }}');
    }
    expect(workflow).not.toMatch(/migrate:postgres|bootstrap:repair|railway variables[^\n]*--set|CREATE ROLE|GRANT /);
  });
  it.each(['staging', 'production'])('accepte seulement le dry-run %s épinglé, sans aucun secret transmis au CLI', async environment => {
    const f = fixture(environment); const h = harness(f);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(0);
    expect(h.state.calls.map(call => call.apply)).toEqual([false]);
    expect(Object.keys(h.state.calls[0]!.env).sort()).toEqual(['CI', 'HOME', 'NODE_ENV', 'PATH', 'TMPDIR']);
    expect(h.execute.mock.calls.map(call => call[0])).toEqual(['gh']);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'dry-run', outcome: 'planned' }));
  });
  it.each([
    { GITHUB_REPOSITORY: 'fork/snack-manager' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REF: 'refs/heads/main' }, { INPUT_EXPECTED_SHA: 'a599cd6' }, { GITHUB_SHA: 'b'.repeat(40) },
    { INPUT_ENVIRONMENT: 'other' }, { INPUT_APPLY: 'yes' }, { INPUT_REQUEST: 'x'.repeat(65537) },
    { INPUT_REQUEST: '{"broken"' }, { INPUT_REQUEST: '{"target":{"environment":"production"}}' },
  ])('refuse avant tout I/O la cible/révision/entrée invalide %#', async changes => {
    const f = fixture(); Object.assign(f.env, changes); const h = harness(f);
    const early = { env: f.env, stdout: { write: vi.fn() }, exitCode: 0 };
    runInNewContext(block('CUSTOMER_OPERATOR_EARLY_GUARD'), { process: early, Buffer });
    expect(early.exitCode).toBe(2);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(2);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.invokeCli).not.toHaveBeenCalled();
    expect(JSON.stringify(h.emit.mock.calls)).not.toContain('PRIVATE');
  });
  it('refuse les champs secrets inconnus avec le vrai schéma avant toute lecture de cible ou connexion', async () => {
    const f = fixture(); apply(f);
    f.env.INPUT_REQUEST = JSON.stringify({ ...f.request, password: 'PRIVATE_INJECTION_$(touch should-not-exist)' });
    const h = harness(f);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(2);
    expect(h.execute).not.toHaveBeenCalled(); expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.state.calls.map(call => call.apply)).toEqual([false]);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid_input', code: 'input_invalid' }));
    expect(JSON.stringify(h.emit.mock.calls)).not.toContain('PRIVATE');
  });
  it('exécute aussi le vrai CLI tsx via stdin, avec un dry-run hermétique', async () => {
    const f = fixture(); const h = harness(f);
    const { invokeCli: _unused, ...io } = h.io;
    expect(await runner.runOperatorWorkflow(f.env, io)).toBe(0);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ code: 'validated_only', outcome: 'planned' }));
  });
  it.each(['staging', 'production'])('applique %s uniquement avec cible native et migrateur épinglés, sans autre secret', async environment => {
    const f = fixture(environment); apply(f); const h = harness(f);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(0);
    expect(h.state.calls.map(call => call.apply)).toEqual([false, true]);
    expect(h.execute.mock.calls.map(call => call[0])).toEqual(['gh', 'railway', 'gh']);
    const actual = h.state.calls[1]!.env;
    expect(actual).toMatchObject({ ...f.native, SM_ENV: environment,
      DATABASE_MIGRATION_ROLE: `snackmanager_${environment}_migrator`, DATABASE_RUNTIME_ROLE: `snackmanager_${environment}_app` });
    const url = new URL(actual.DATABASE_MIGRATION_URL!);
    expect(url.searchParams.get('sslmode')).toBe('verify-ca');
    expect(url.searchParams.get('uselibpqcompat')).toBe('true');
    expect(url.searchParams.get('sslrootcert')).toBe(join(directory, 'customer-operator-root-ca.pem'));
    expect(h.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), { mode: 0o600 });
    expect(h.removeFile).toHaveBeenCalledOnce();
    for (const absent of ['GH_TOKEN', 'RAILWAY_TOKEN', 'DATABASE_URL', 'SOME_SECRET', 'INPUT_REQUEST', 'DATABASE_MIGRATION_URL_RAW']) {
      expect(actual[absent]).toBeUndefined();
    }
    expect(JSON.stringify(h.emit.mock.calls)).not.toMatch(/PRIVATE|postgres|railwayProjectId|verifyAccountSid/);
  });
  it.each(['activate-budget', 'revoke-budget', 'authorize-admissions'])('conserve le contrat et la projection de %s', async action => {
    const f = fixture(); apply(f);
    const scope = { parentRef: f.request.input.parentRef, tenantRef: f.request.input.tenantRef };
    const input = action === 'authorize-admissions' ? { ...scope, policyRef: 'admissions-reviewed-fixture', windowMs: 86_400_000,
      browserSourceLimit: 10, browserTenantLimit: 100, browserParentLimit: 100, intentBrowserLimit: 4,
      intentSourceLimit: 10, intentTenantLimit: 100, intentParentLimit: 100 }
      : { ...scope, authorizationRef: f.request.input.authorizationRef,
        ...(action === 'activate-budget' ? { expectedActiveAuthorizationRef: 'previous-budget-reviewed' } : {}) };
    f.env.INPUT_REQUEST = JSON.stringify({ action, target: f.request.target, input });
    const h = harness(f);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(0);
    const expected = await customerAccountOperator(JSON.parse(f.env.INPUT_REQUEST));
    expect(h.emit).toHaveBeenCalledWith({ ...expected, mode: 'apply', outcome: 'applied', code: 'operation_applied' });
    expect(h.state.calls.map(call => call.apply)).toEqual([false, true]);
    expect(JSON.stringify(h.emit.mock.calls)).not.toContain('PRIVATE');
  });
  it.each(['before', 'after-native'])('refuse une branche avancée %s sans application', async phase => {
    const f = fixture(); apply(f); const h = harness(f);
    if (phase === 'before') h.state.head = 'b'.repeat(40);
    else h.state.afterNative = () => { h.state.head = 'b'.repeat(40); };
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(2);
    expect(h.state.calls.map(call => call.apply)).toEqual([false]);
  });
  it.each(['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_ENVIRONMENT_NAME'])('refuse la cible native %s différente du document', async field => {
    const f = fixture(); apply(f); const h = harness(f);
    h.state.native[field as keyof typeof h.state.native] = 'different';
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(2);
    expect(h.state.calls.map(call => call.apply)).toEqual([false]);
    expect(h.writeFile).not.toHaveBeenCalled();
  });
  it.each([
    { INPUT_APPLY: 'false' }, { RAILWAY_TOKEN: '' }, { DATABASE_MIGRATION_URL_RAW: databaseUrl({ username: 'wrong' }) },
    { DATABASE_MIGRATION_URL_RAW: databaseUrl({ hostname: 'evil.example' }) },
    { DATABASE_MIGRATION_URL_RAW: databaseUrl({ port: '34642' }) },
    { DATABASE_MIGRATION_URL_RAW: databaseUrl({ pathname: '/another' }) },
    { DATABASE_MIGRATION_URL_RAW: databaseUrl({ search: '?sslmode=disable' }) },
    { DATABASE_MIGRATION_URL_RAW: databaseUrl({ hash: '#fragment' }) },
    { DATABASE_MIGRATION_ROOT_CA_B64: '' }, { DATABASE_MIGRATION_ROOT_CA_B64: 'noncanonical' },
    { DATABASE_MIGRATION_ROOT_CA_B64: Buffer.from('not a certificate').toString('base64') },
  ])('refuse une autorisation/connexion/CA invalide %# sans exposer la configuration', async changes => {
    const f = fixture(); apply(f); Object.assign(f.env, changes); const h = harness(f);
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(2);
    expect(h.state.calls.map(call => call.apply)).toEqual([false]);
    expect(JSON.stringify(h.emit.mock.calls)).not.toMatch(/PRIVATE|postgres|certificate/);
  });
  it('ne traite jamais une réponse perdue après apply comme une opération refusée et ne la relance pas', async () => {
    const f = fixture(); apply(f); const h = harness(f); h.state.cliError = true;
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(1);
    expect(h.state.calls.map(call => call.apply)).toEqual([false, true]);
    expect(h.emit).toHaveBeenCalledWith({ schemaVersion: 1, mode: 'apply', outcome: 'unconfirmed', code: 'operation_unconfirmed' });
    expect(JSON.stringify(h.emit.mock.calls)).not.toContain('PRIVATE');
  });
  it.each([
    ['conflict', 'active_reference_conflict', 2], ['not_found', 'authorization_not_found', 2],
    ['blocked', 'runtime_operator_acl_unsafe', 2], ['unconfirmed', 'operation_unconfirmed', 1],
  ] as const)('conserve le résultat %s du CLI et son code de sortie sans retry', async (outcome, code, expectedExit) => {
    const f = fixture(); apply(f); const h = harness(f);
    h.io.invokeCli = vi.fn(async (apply: boolean) => {
      const plan = await customerAccountOperator(f.request);
      return apply ? { ...plan, mode: 'apply', outcome, code } : plan;
    });
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(expectedExit);
    expect(h.io.invokeCli.mock.calls.map(call => call[0])).toEqual([false, true]);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'apply', outcome, code }));
  });
  it('conserve l’ACK même si le nettoyage du certificat échoue', async () => {
    const f = fixture(); apply(f); const h = harness(f); h.state.cleanupError = true;
    expect(await runner.runOperatorWorkflow(f.env, h.io)).toBe(0);
    expect(h.emit).toHaveBeenCalledOnce();
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'applied' }));
  });
  it('ne publie que les champs opérateur connus et refuse un code arbitraire', async () => {
    const plan = await customerAccountOperator(fixture().request);
    expect(runner.projectReport({ ...plan, secret: 'PRIVATE', target: { ...plan.target, password: 'PRIVATE' },
      details: { ...plan.details, databaseUrl: 'PRIVATE' } })).toEqual(plan);
    expect(() => runner.projectReport({ ...plan, code: 'PRIVATE_UNKNOWN_CODE' })).toThrow('operator_report_invalid');
  });
});


const dispatcher = readFileSync(join(root, '.github/workflows/e2e.yml'), 'utf8');
type Workflow = {
  on: Record<string, { inputs?: Record<string, { default?: unknown }>; secrets?: Record<string, unknown> }>;
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, { if: string; needs?: string | string[]; uses?: string; with?: Record<string, unknown>;
    secrets?: Record<string, string>; steps?: { env?: Record<string, string> }[] }>;
};
const caller = parse(dispatcher) as Workflow;
const called = parse(workflow) as Workflow;
const operatorSeries = 'operateur-compte-staging';
const operatorJob = caller.jobs[operatorSeries]!;
const guardJob = caller.jobs['operateur-garde']!;
function bridgeFixture() {
  const f = fixture();
  f.env.GITHUB_WORKFLOW_REF = 'GLWebDevAgency/snack-manager/.github/workflows/e2e.yml@refs/heads/develop';
  const inputs = { environnement: 'staging', serie: operatorSeries, expected_sha: f.env.GITHUB_SHA!, request: f.env.INPUT_REQUEST!, apply: false };
  return { ...f, inputs };
}
/** Execute the actual YAML input mappings, not a second bridge implementation. */
function expressionValue(value: unknown, inputs: Record<string, unknown>) {
  if (typeof value !== 'string') return value;
  const match = /^\$\{\{ inputs\.([a-z_]+) \}\}$/.exec(value);
  return match ? inputs[match[1]!] : value;
}
function bridgeGuard(f: ReturnType<typeof bridgeFixture>) {
  const bindings = guardJob.steps![0]!.env!;
  const env = { ...f.env, ...Object.fromEntries(Object.entries(bindings).map(([name, value]) => [name, String(expressionValue(value, f.inputs))])) };
  const process = { env, exitCode: 0, stdout: { write: vi.fn() } };
  runInNewContext(block('CUSTOMER_OPERATOR_STAGING_BRIDGE_GUARD', dispatcher), { process, Buffer });
  return process;
}
function childEnvironment(f: ReturnType<typeof bridgeFixture>): Env {
  const inputs = Object.fromEntries(Object.entries(operatorJob.with!).map(([name, value]) => [name, expressionValue(value, f.inputs)]));
  return { ...f.env, INPUT_ENVIRONMENT: String(inputs.environment), INPUT_EXPECTED_SHA: String(inputs.expected_sha),
    INPUT_REQUEST: String(inputs.request), INPUT_APPLY: String(inputs.apply) };
}
function jobAllowed(name: string, serie?: string, guardResult = 'success') {
  // The repository-owned expressions below use only these simple GH operators.
  // A malformed or broadened expression fails this executable test.
  const expression = caller.jobs[name]!.if.replaceAll('needs.operateur-garde', 'needs["operateur-garde"]');
  return runInNewContext(expression, {
    github: { repository: 'GLWebDevAgency/snack-manager' }, inputs: { serie }, always: () => true,
    needs: { 'operateur-garde': { result: guardResult }, cible: { outputs: { jouable: 'oui', environnement: 'staging', serie } }, demonstrations: { result: 'success' } },
  });
}

describe('pont opérateur staging : dispatcher E2E enregistré, sans promotion main', () => {
  it('appelle le même commit avec trois secrets staging nommés, après une garde sans identifiants', () => {
    expect(operatorJob.uses).toBe('./.github/workflows/customer-account-operator.yml');
    expect(operatorJob.needs).toBe('operateur-garde');
    expect(operatorJob.with?.environment).toBe('staging');
    expect(operatorJob.secrets).toEqual({
      RAILWAY_TOKEN_STAGING: '${{ secrets.RAILWAY_TOKEN_STAGING }}',
      SM_DATABASE_MIGRATION_URL_STAGING: '${{ secrets.SM_DATABASE_MIGRATION_URL_STAGING }}',
      SM_DATABASE_ROOT_CA_STAGING: '${{ secrets.SM_DATABASE_ROOT_CA_STAGING }}',
    });
    for (const name of Object.keys(operatorJob.secrets!)) {
      expect(called.on.workflow_call!.secrets![name]).toEqual({ required: false });
      expect(caller.on.workflow_call!.secrets![name]).toEqual({ required: false });
    }
    // The child's direct production mode still needs declarations for GH's
    // reusable-workflow type checker, but the staging caller never passes them.
    for (const name of ['RAILWAY_TOKEN_PRODUCTION', 'SM_DATABASE_MIGRATION_URL_PRODUCTION', 'SM_DATABASE_ROOT_CA_PRODUCTION']) {
      expect(called.on.workflow_call!.secrets![name]).toEqual({ required: false });
      expect(operatorJob.secrets).not.toHaveProperty(name);
      expect(caller.on.workflow_call!.secrets).not.toHaveProperty(name);
    }
    expect(JSON.stringify(guardJob)).not.toContain('secrets.');
    expect(caller.on.workflow_dispatch!.inputs!.apply!.default).toBe(false);
    expect(called.on.workflow_call!.inputs!.apply!.default).toBe(false);
    expect(caller.permissions).toEqual({ contents: 'read' }); expect(called.permissions).toEqual({ contents: 'read' });
    expect(caller.concurrency.group).toBe('bout-en-bout-${{ inputs.environnement || github.event.workflow_run.head_branch || github.ref }}');
    expect(called.concurrency.group).toBe('deploiement-${{ github.ref }}');
    expect(caller.concurrency['cancel-in-progress']).toBe(false); expect(called.concurrency['cancel-in-progress']).toBe(false);
  });
  it('exclut tous les parcours E2E lors de l’opération, même si leurs autres prérequis sont verts', () => {
    expect(jobAllowed('operateur-garde', operatorSeries)).toBe(true);
    expect(jobAllowed(operatorSeries, operatorSeries)).toBe(true);
    for (const job of ['cible', 'demonstrations', 'parc-reel']) expect(jobAllowed(job, operatorSeries), job).toBe(false);
    for (const result of ['failure', 'cancelled', 'skipped']) expect(jobAllowed(operatorSeries, operatorSeries, result)).toBe(false);
  });
  it.each(['tout', 'demo', 'reel', undefined])('ne déclenche aucune opération pour la série normale/automatique %s', serie => {
    expect(jobAllowed('operateur-garde', serie)).toBe(false); expect(jobAllowed(operatorSeries, serie)).toBe(false);
    expect(jobAllowed('cible', serie)).toBe(true);
    expect(jobAllowed('demonstrations', serie)).toBe(serie !== 'reel');
    expect(jobAllowed('parc-reel', serie)).toBe(serie !== 'demo');
  });
  it.each([
    { GITHUB_REPOSITORY: 'fork/snack-manager' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'workflow_run' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'schedule' },
    { GITHUB_REF: 'refs/heads/main' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REF: 'refs/tags/staging' },
    { GITHUB_WORKFLOW_REF: 'GLWebDevAgency/snack-manager/.github/workflows/e2e.yml@refs/heads/main' },
    { GITHUB_WORKFLOW_REF: 'GLWebDevAgency/snack-manager/.github/workflows/other.yml@refs/heads/develop' },
    { GITHUB_SHA: 'b'.repeat(40) },
  ])('refuse réellement la provenance native invalide %# sans divulgation', changes => {
    const f = bridgeFixture(); Object.assign(f.env, changes);
    const guard = bridgeGuard(f); expect(guard.exitCode).toBe(2);
    expect(guard.stdout.write.mock.calls).toEqual([['operator_staging_dispatch_invalid\n']]);
  });
  it.each([
    { environnement: 'production' }, { environnement: '' }, { serie: 'tout' }, { expected_sha: '4d85256' },
    { expected_sha: 'a'.repeat(39) + 'G' }, { expected_sha: 'b'.repeat(40) }, { apply: 'yes' }, { apply: undefined },
    { request: '{"broken"' }, { request: 'null' }, { request: '{"target":{"environment":"production"}}' },
    { request: JSON.stringify({ target: { environment: 'staging' }, padding: 'é'.repeat(33000) }) },
  ])('refuse réellement l’entrée staging ambiguë %#', changes => {
    const f = bridgeFixture(); Object.assign(f.inputs, changes); expect(bridgeGuard(f).exitCode).toBe(2);
  });
  it.each([false, true])('transmet au vrai runner la demande staging relue (apply=%s)', async applyRequested => {
    const f = bridgeFixture(); f.inputs.apply = applyRequested;
    expect(bridgeGuard(f).exitCode).toBe(0);
    const h = harness(f), env = childEnvironment(f);
    env.OPERATOR_PHASE = applyRequested ? 'apply' : 'validate';
    expect(await runner.runOperatorWorkflow(env, h.io)).toBe(0);
    expect(h.state.calls.map(call => call.apply)).toEqual(applyRequested ? [false, true] : [false]);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ target: { environment: 'staging', slug: 'operator-fixture', tenantRef: f.request.target.tenantRef } }));
    if (!applyRequested) { expect(h.writeFile).not.toHaveBeenCalled(); expect(h.execute.mock.calls.map(call => call[0])).toEqual(['gh']); }
  });
  it('exécute le CLI réel en dry-run via la demande transmise et refuse un schéma secret inconnu avant toute lecture distante', async () => {
    const f = bridgeFixture(); expect(bridgeGuard(f).exitCode).toBe(0);
    const h = harness(f); const { invokeCli: _unused, ...io } = h.io;
    expect(await runner.runOperatorWorkflow(childEnvironment(f), io)).toBe(0);
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'planned', code: 'validated_only' }));
    f.inputs.request = JSON.stringify({ ...f.request, password: 'PRIVATE_REJECTED_FIELD' });
    f.inputs.apply = true; expect(bridgeGuard(f).exitCode).toBe(0);
    const refused = harness(f), env = childEnvironment(f); env.OPERATOR_PHASE = 'apply';
    const { invokeCli: _unusedRefused, ...refusedIo } = refused.io;
    expect(await runner.runOperatorWorkflow(env, refusedIo)).toBe(2);
    expect(refused.execute).not.toHaveBeenCalled(); expect(refused.writeFile).not.toHaveBeenCalled();
    expect(refused.emit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'invalid_input', code: 'input_invalid' }));
    expect(JSON.stringify(refused.emit.mock.calls)).not.toContain('PRIVATE');
  });
});
