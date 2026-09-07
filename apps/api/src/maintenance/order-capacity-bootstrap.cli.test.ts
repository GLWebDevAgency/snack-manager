import { describe, expect, it, vi } from 'vitest';
import { CapacityBootstrapBlocked } from '../modules/ordering/order-capacity-bootstrap.store';
import type { CapacityBootstrapReadResult } from '../modules/ordering/order-capacity-bootstrap.reader';
import { parseCapacityBootstrapArguments, runCapacityBootstrapCli, type CapacityBootstrapCliPorts } from './order-capacity-bootstrap.cli';

const TENANT = '507f1f77bcf86cd799439011';
const UUID = '11111111-1111-4111-8111-111111111111';
const SHA = 'a'.repeat(40);
const READ = ['--tenant', TENANT, '--from-day', '2030-05-02'];
const APPLY = [...READ, '--apply', '--bootstrap-id', UUID, '--writer-revision', SHA, '--writers-stopped'];
const ENV = { MONGO_URL: 'mongodb://127.0.0.1:27037/snackmanager_cli_test_fixture',
  REDIS_URL: 'redis://127.0.0.1:6379', RAILWAY_ENVIRONMENT_NAME: 'staging' };
const SECRET = 'synthetic-private-detail-not-for-operator-output';
const empty = (): CapacityBootstrapReadResult => ({
  mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true,
  scan: { complete: true, consistency: 'non_atomic', counts: { orders: 0, admissions: 0, days: 0 }, bytes: 321,
    limits: { maxDocuments: 10_000, maxBytes: 8 * 1024 * 1024, maxDays: 90, maxDurationMs: 30_000 } },
  issues: [], report: { mode: 'analysis_only', canActivate: false, requiresExclusiveRescan: true,
    status: 'reviewed', tenantId: TENANT, cutoverAt: '2030-05-01T22:00:00.000Z', fromInclusive: '2030-05-02',
    days: [], occupants: [], issues: [] },
});
function fixture() {
  const read = vi.fn().mockResolvedValue(empty());
  const apply = vi.fn().mockResolvedValue({ state: 'active', tenantId: TENANT, bootstrapId: UUID, writerRevision: SHA, days: 1, orders: 0 });
  const closeRead = vi.fn().mockResolvedValue(undefined); const closeApply = vi.fn().mockResolvedValue(undefined);
  const openRead = vi.fn().mockResolvedValue({ read, close: closeRead });
  const openApply = vi.fn().mockResolvedValue({ apply, close: closeApply, notifications: () => ({ attempted: 0, failed: 0 }) });
  const ports: CapacityBootstrapCliPorts = { openRead, openApply };
  const stdout = vi.fn(); const stderr = vi.fn();
  const run = (argv = READ, env: NodeJS.ProcessEnv = ENV, nodeVersion = '24.20.0') =>
    runCapacityBootstrapCli({ argv, env, nodeVersion, ports, stdout, stderr });
  return { read, apply, closeRead, closeApply, openRead, openApply, stdout, stderr, run };
}

describe('bootstrap opérateur — paramètres stricts avant connexion', () => {
  it('reste en analyse par défaut et canonise minuit Paris en été', () => {
    expect(parseCapacityBootstrapArguments(READ, ENV, '24.20.0')).toEqual({ mode: 'read', input: {
      tenantId: TENANT, cutoverAt: new Date('2030-05-01T22:00:00.000Z'),
    } });
  });
  it.each([['2030-01-02', '2030-01-01T23:00:00.000Z'], ['2030-03-31', '2030-03-30T23:00:00.000Z'],
    ['2030-10-27', '2030-10-26T22:00:00.000Z']])('respecte minuit Paris %s, dont changements DST', (day, expected) => {
    const value = parseCapacityBootstrapArguments(['--tenant', TENANT, '--from-day', day!], ENV, '24.12.0');
    expect(value.mode).toBe('read');
    if (value.mode !== 'help') expect(value.input.cutoverAt.toISOString()).toBe(expected);
  });
  it.each(['23.9.0', '24.0.0', '24.11.9', 'not-node'])('refuse Node %s sans connexion', async (version) => {
    const f = fixture(); expect(await f.run(READ, ENV, version)).toBe(2);
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
  });
  it.each(['24.12.0', '24.20.0', '25.0.0'])('accepte engine %s', (version) => {
    expect(parseCapacityBootstrapArguments(READ, ENV, version).mode).toBe('read');
  });
  it.each([
    [], ['--tenant', TENANT], [...READ, '--unknown'], [...READ, '--apply=true'], [...READ, '--to-day', '2030-05-03'],
    [...READ, '--tenant', TENANT], [...READ, '--from-day', '2030-05-03'], [...READ, '--bootstrap-id', UUID],
    [...READ, '--writer-revision', SHA], [...READ, '--writers-stopped'], ['--help', '--apply'], ['--help', '--unknown'],
    ['--tenant', 'invalid', '--from-day', '2030-05-02'], ['--tenant', TENANT, '--from-day', '2030-02-30'],
    [...READ, '--max-documents', '0'], [...READ, '--max-bytes', '-1'], [...READ, '--max-days', '1.5'],
    [...READ, '--max-duration-ms', 'Infinity'], [...READ, '--max-documents', '100001'], [...READ, '--max-bytes', '67108865'],
    [...READ, '--max-days', '367'], [...READ, '--max-duration-ms', '120001'], [...READ, '--max-days', '2e1'],
    [...READ, '--max-days', '01'], [...READ, '--max-days', ''], [...READ, '--max-days', '--apply'],
    [...READ, '--max-days', '1', '--max-days', '2'], [...READ, '--mongo-url', 'mongodb://private.invalid/database'],
    [...APPLY, '--apply'], APPLY.filter((x) => x !== '--writers-stopped'),
    APPLY.map((x) => x === SHA ? 'short-revision' : x), APPLY.map((x) => x === UUID ? '11111111-1111-1111-8111-111111111111' : x),
  ].map((argv) => ({ argv })))('refuse argv invalide %# sans aucun connecteur', async ({ argv }) => {
    const f = fixture(); expect(await f.run(argv)).toBe(2);
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
  });
  it.each(['production', 'Production', 'prod', 'preview', 'development', '', undefined])('interdit --apply en environnement %s', async (name) => {
    const f = fixture(); expect(await f.run(APPLY, { ...ENV, RAILWAY_ENVIRONMENT_NAME: name })).toBe(2);
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
    expect(f.stderr).toHaveBeenCalledWith(expect.stringContaining('STAGING_REQUIRED'));
  });
  it('autorise analyse seule en production sans Redis, jamais apply', async () => {
    const f = fixture(); expect(await f.run(READ, { ...ENV, REDIS_URL: undefined, RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(0);
    expect(f.openRead).toHaveBeenCalledOnce(); expect(f.openApply).not.toHaveBeenCalled();
  });
  it.each([
    { ...ENV, MONGO_URL: undefined }, { ...ENV, MONGO_URL: 'https://private.invalid/db' },
    { ...ENV, MONGO_URL: 'mongodb://127.0.0.1' }, { ...ENV, MONGO_URL: 'mongodb://127.0.0.1/admin' },
    { ...ENV, MONGO_URL: 'mongodb://127.0.0.1/config' }, { ...ENV, MONGO_URL: 'mongodb://127.0.0.1/local' },
    { ...ENV, REDIS_URL: undefined }, { ...ENV, REDIS_URL: 'https://private.invalid/db' },
    { ...ENV, REDIS_URL: 'redis://%ZZ@localhost' }, { ...ENV, REDIS_URL: 'redis://localhost?lazyConnect=false' },
    { ...ENV, REDIS_URL: 'redis://localhost#fragment' }, { ...ENV, REDIS_URL: 'redis://localhost/not-a-db-index' },
  ])('refuse configuration apply incomplète/invalide %# sans connexion', async (env) => {
    const f = fixture(); expect(await f.run(APPLY, env)).toBe(2);
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
  });
  it('aide seule sans environnement et sans effet', async () => {
    const f = fixture(); expect(await f.run(['--help'], {})).toBe(0);
    expect(f.stdout).toHaveBeenCalledWith(expect.stringContaining('--from-day'));
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
  });
  it.each(['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'])('refuse %s qui pourrait activer des traces brutes avant connexion', async (key) => {
    const f = fixture(); expect(await f.run(APPLY, { ...ENV, [key]: '*' })).toBe(2);
    expect(f.openRead).not.toHaveBeenCalled(); expect(f.openApply).not.toHaveBeenCalled();
    expect(JSON.parse(f.stderr.mock.calls[0]![0]).reason).toBe('DEBUG_LOGGING_FORBIDDEN');
  });
  it('passe les bornes exactes au lecteur sans tronquer les jours', async () => {
    const f = fixture(); await f.run([...READ, '--max-documents', '20', '--max-bytes', '4096', '--max-days', '25', '--max-duration-ms', '5000']);
    expect(f.read).toHaveBeenCalledWith({ tenantId: TENANT, cutoverAt: new Date('2030-05-01T22:00:00.000Z'),
      limits: { maxDocuments: 20, maxBytes: 4096, maxDays: 25, maxDurationMs: 5000 } });
  });
});

describe('bootstrap opérateur — exécution bornée et sortie sans secrets', () => {
  it('analyse ne crée ni store ni modèles applicateurs et ferme le lecteur', async () => {
    const f = fixture(); expect(await f.run()).toBe(0);
    expect(f.openRead).toHaveBeenCalledWith(ENV.MONGO_URL);
    expect(f.openApply).not.toHaveBeenCalled(); expect(f.apply).not.toHaveBeenCalled(); expect(f.closeRead).toHaveBeenCalledOnce();
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ mode: 'read_only_analysis', canActivate: false,
      requiresExclusiveRescan: true, scan: { complete: true, consistency: 'non_atomic' } });
  });
  it('rapporte une analyse incomplète sans autoriser activation et ferme', async () => {
    const f = fixture(); f.read.mockResolvedValue({ ...empty(), scan: { ...empty().scan, complete: false },
      report: null, issues: [{ code: 'byte_limit', source: 'orders' }] });
    expect(await f.run()).toBe(3); expect(f.closeRead).toHaveBeenCalledOnce();
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ canActivate: false, issues: [{ code: 'byte_limit', source: 'orders' }] });
  });
  it('rapporte conflits avec références normalisées, jamais document/proof/client', async () => {
    const f = fixture(); const report = empty().report!;
    f.read.mockResolvedValue({ ...empty(), report: { ...report, status: 'blocked',
      privateSnapshot: SECRET, occupants: [{ orderId: SECRET, clientId: SECRET, proofHash: SECRET }],
      issues: [{ code: 'missing_order', source: 'admission', orderId: '507f1f77bcf86cd799439055', privateSnapshot: SECRET },
        { code: 'invalid_order', source: 'order', orderId: SECRET }] } });
    expect(await f.run()).toBe(3);
    const rendered = f.stdout.mock.calls[0]![0]; expect(rendered).not.toContain(SECRET);
    expect(rendered).toContain('507f1f77bcf86cd799439055'); expect(rendered).not.toMatch(/proofHash|privateSnapshot|clientId/);
  });
  it('applique uniquement le tenant explicite avec attestations immuables sans inventer nouveau tenant', async () => {
    const f = fixture(); expect(await f.run(APPLY)).toBe(0);
    expect(f.openApply).toHaveBeenCalledWith(ENV.MONGO_URL, ENV.REDIS_URL); expect(f.openRead).not.toHaveBeenCalled();
    expect(f.apply).toHaveBeenCalledWith({ tenantId: TENANT, cutoverAt: new Date('2030-05-01T22:00:00.000Z'),
      bootstrapId: UUID, writerRevision: SHA, writersStopped: true });
    expect(f.closeApply).toHaveBeenCalledOnce();
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ mode: 'apply', state: 'active',
      environmentAttestation: 'staging', writerRevision: SHA, rolloutVerifiedByCli: false });
  });
  it('reprise conserve le même UUID, reçu already_active et ne prétend pas réimporter', async () => {
    const f = fixture(); f.apply.mockResolvedValue({ state: 'already_active', tenantId: TENANT, bootstrapId: UUID });
    expect(await f.run(APPLY)).toBe(0);
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ state: 'already_active', bootstrapId: UUID });
  });
  it.each(['read', 'apply'] as const)('ferme %s lors erreur et ne publie ni URI ni erreur brute', async (mode) => {
    const f = fixture(); f[mode].mockRejectedValue(new Error(`${ENV.MONGO_URL} ${ENV.REDIS_URL} ${SECRET}`));
    expect(await f.run(mode === 'read' ? READ : APPLY)).toBe(1);
    expect(mode === 'read' ? f.closeRead : f.closeApply).toHaveBeenCalledOnce();
    const rendered = JSON.stringify(f.stderr.mock.calls); expect(rendered).not.toContain(SECRET);
    expect(rendered).not.toContain(ENV.MONGO_URL); expect(rendered).not.toContain(ENV.REDIS_URL);
  });
  it('panne apply garde une issue incertaine et exige reprise même UUID', async () => {
    const f = fixture(); f.apply.mockRejectedValue(new Error(SECRET)); await f.run(APPLY);
    expect(JSON.parse(f.stderr.mock.calls[0]![0])).toMatchObject({ code: 'CAPACITY_BOOTSTRAP_OPERATOR_FAILED',
      bootstrapId: UUID, operationMayHaveApplied: true, retry: 'same_bootstrap_id' });
  });
  it('blocage connu garde uniquement reason whitelist et garde reprise', async () => {
    const f = fixture(); f.apply.mockRejectedValue(new CapacityBootstrapBlocked('historical_conflict'));
    expect(await f.run(APPLY)).toBe(3);
    expect(JSON.parse(f.stderr.mock.calls[0]![0])).toMatchObject({ code: 'ORDER_CAPACITY_BOOTSTRAP_BLOCKED', reason: 'historical_conflict' });
  });
  it('raison non reconnue ne sort pas même si erreur métier typée', async () => {
    const f = fixture(); f.apply.mockRejectedValue(new CapacityBootstrapBlocked(SECRET)); await f.run(APPLY);
    expect(JSON.stringify(f.stderr.mock.calls)).not.toContain(SECRET);
  });
  it('préserve le reçu active si la fermeture échoue après commit', async () => {
    const f = fixture(); f.closeApply.mockRejectedValue(new Error(SECRET)); expect(await f.run(APPLY)).toBe(0);
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ state: 'active', cleanupWarning: true });
    expect(JSON.stringify([f.stdout.mock.calls, f.stderr.mock.calls])).not.toContain(SECRET);
  });
  it('panne connecteur ne révèle rien et ne lance pas apply', async () => {
    const f = fixture(); f.openApply.mockRejectedValue(new Error(`${ENV.MONGO_URL} ${SECRET}`));
    expect(await f.run(APPLY)).toBe(1); expect(f.apply).not.toHaveBeenCalled();
    expect(JSON.stringify(f.stderr.mock.calls)).not.toContain(SECRET);
    expect(JSON.parse(f.stderr.mock.calls[0]![0]).operationMayHaveApplied).toBe(false);
  });
});
