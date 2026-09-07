/** Opérateur explicite, jamais importé par AppModule ; aucun effet à l'import. */
import 'reflect-metadata';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import { MODELS } from '@sm/db';
import { OrderAdmissionJournal } from '../modules/orders/order-admission-journal';
import { OrderCapacityBootstrapReader, InvalidCapacityBootstrapReadInput, type CapacityBootstrapReadInput,
  type CapacityBootstrapReadResult } from '../modules/ordering/order-capacity-bootstrap.reader';
import { CapacityBootstrapBlocked, OrderCapacityBootstrapStore, type CapacityBootstrapApplyInput } from '../modules/ordering/order-capacity-bootstrap.store';
import { parisWallToUtc, parseDay } from '../modules/ordering/paris-time';

type Environment = Readonly<Record<string, string | undefined>>;
type Arguments = { mode: 'help' } | { mode: 'read'; input: CapacityBootstrapReadInput }
  | { mode: 'apply'; input: CapacityBootstrapApplyInput };
type ApplyResult = Awaited<ReturnType<OrderCapacityBootstrapStore['apply']>>;
type Notifications = { attempted: number; failed: number };
type ReadSession = { read(input: CapacityBootstrapReadInput): Promise<CapacityBootstrapReadResult>; close(): Promise<void> };
type ApplySession = { apply(input: CapacityBootstrapApplyInput): Promise<ApplyResult>;
  close(): Promise<void>; notifications(): Notifications };
export type CapacityBootstrapCliPorts = {
  openRead(uri: string): Promise<ReadSession>;
  openApply(mongoUri: string, redisUri: string): Promise<ApplySession>;
};
type CliInput = { argv: readonly string[]; env: Environment; nodeVersion?: string;
  stdout?: (line: string) => void; stderr?: (line: string) => void; ports?: CapacityBootstrapCliPorts };
const ID = /^[a-f0-9]{24}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const LIMITS = {
  '--max-documents': ['maxDocuments', 100_000], '--max-bytes': ['maxBytes', 64 * 1024 * 1024],
  '--max-days': ['maxDays', 366], '--max-duration-ms': ['maxDurationMs', 120_000],
} as const;
const SILENT_MONGO = { mongodbLogComponentSeverities: { default: 'off', command: 'off', topology: 'off',
  serverSelection: 'off', connection: 'off', client: 'off' } } as const;
const HELP = `Analyse de capacité — aucune écriture par défaut (Node >=24.12).
node apps/api/dist/maintenance/order-capacity-bootstrap.cli.js --tenant HEX24 --from-day YYYY-MM-DD
  [--max-documents 10000] [--max-bytes 8388608] [--max-days 90] [--max-duration-ms 30000]
Application staging uniquement : ajouter --apply --bootstrap-id UUIDv4 --writer-revision SHA40 --writers-stopped
Environnement injecté : MONGO_URL ; application : REDIS_URL et RAILWAY_ENVIRONMENT_NAME=staging.
Le jour est inclusif à minuit Europe/Paris. Le scan couvre TOUT le tenant, sans date de fin tronquante.
Les bornes arrêtent l'opération en cas de dépassement ; elles ne filtrent jamais des commandes.
Arrêt des anciens écrivains, vidage des files hors ligne et SHA servi : attestations opérateur, non vérifiées par cette CLI.
Nouveau tenant existant en DB : même opération explicite ; aucun tenant n'est créé automatiquement.
Après panne apply, garder tenant/jour/UUID/SHA identiques : une écriture peut déjà avoir eu lieu.
`;
class InvalidOperatorInput extends Error {
  constructor(readonly reason: 'INVALID_ARGUMENTS' | 'NODE_24_12_REQUIRED' | 'STAGING_REQUIRED' | 'INVALID_MONGO_CONFIGURATION'
    | 'INVALID_REDIS_CONFIGURATION' | 'DEBUG_LOGGING_FORBIDDEN') { super(reason); }
}
function invalid(reason: InvalidOperatorInput['reason'] = 'INVALID_ARGUMENTS'): never { throw new InvalidOperatorInput(reason); }

/** Parsing pur : aucune connexion, aucun fichier .env, aucun service Nest. */
export function parseCapacityBootstrapArguments(argv: readonly string[], env: Environment, nodeVersion: string): Arguments {
  const version = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/.exec(nodeVersion);
  if (!version || Number(version[1]) < 24 || (Number(version[1]) === 24 && Number(version[2]) < 12)) invalid('NODE_24_12_REQUIRED');
  if (argv.length === 1 && argv[0] === '--help') return { mode: 'help' };
  // Driver debug logging may contain connection parameters or publish payloads.
  if (['DEBUG', 'NODE_DEBUG', 'NODE_DEBUG_NATIVE'].some((key) => env[key]?.trim())) invalid('DEBUG_LOGGING_FORBIDDEN');
  const values = new Map<string, string>(); const flags = new Set<string>();
  const valued = new Set(['--tenant', '--from-day', '--bootstrap-id', '--writer-revision', ...Object.keys(LIMITS)]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]!;
    if (values.has(key) || flags.has(key)) invalid();
    if (['--apply', '--writers-stopped'].includes(key)) { flags.add(key); continue; }
    if (!valued.has(key)) invalid();
    const value = argv[++index];
    if (value === undefined || value === '' || value.startsWith('--')) invalid();
    values.set(key, value);
  }
  const tenantId = values.get('--tenant'); const from = values.get('--from-day'); const day = from ? parseDay(from) : null;
  if (!tenantId || !ID.test(tenantId) || !day) invalid();
  const limits: NonNullable<CapacityBootstrapReadInput['limits']> = {};
  for (const [flag, [key, maximum]] of Object.entries(LIMITS)) {
    const raw = values.get(flag);
    if (raw === undefined) continue;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > maximum) invalid();
    limits[key] = Number(raw);
  }
  const input: CapacityBootstrapReadInput = { tenantId: tenantId.toLowerCase(), cutoverAt: parisWallToUtc(day),
    ...(Object.keys(limits).length ? { limits } : {}) };
  if (!flags.has('--apply')) {
    if (flags.size || values.has('--bootstrap-id') || values.has('--writer-revision')) invalid();
    return { mode: 'read', input };
  }
  if (env.RAILWAY_ENVIRONMENT_NAME?.trim().toLowerCase() !== 'staging') invalid('STAGING_REQUIRED');
  const bootstrapId = values.get('--bootstrap-id'); const writerRevision = values.get('--writer-revision');
  if (!flags.has('--writers-stopped') || !bootstrapId || !UUID.test(bootstrapId)
    || !writerRevision || !/^[a-f0-9]{40}$/.test(writerRevision)) invalid();
  return { mode: 'apply', input: { ...input, bootstrapId: bootstrapId.toLowerCase(), writerRevision, writersStopped: true } };
}

function mongoConfiguration(value: string | undefined): string {
  if (!value || !/^mongodb(?:\+srv)?:\/\//.test(value)) invalid('INVALID_MONGO_CONFIGURATION');
  try {
    // Constructor parses synchronously, never connects. Refuse driver's implicit
    // `test` database and administrative databases before selecting any tenant.
    const parsed = new mongoose.mongo.MongoClient(value, SILENT_MONGO);
    if (!parsed.options.dbName || ['test', 'admin', 'config', 'local'].includes(parsed.options.dbName.toLowerCase())) invalid('INVALID_MONGO_CONFIGURATION');
  } catch { invalid('INVALID_MONGO_CONFIGURATION'); }
  return value;
}
function redisConfiguration(value: string | undefined): string {
  if (!value) invalid('INVALID_REDIS_CONFIGURATION');
  try {
    const parsed = new URL(value);
    if (!['redis:', 'rediss:'].includes(parsed.protocol) || !parsed.hostname || parsed.search || parsed.hash
      || (parsed.pathname && parsed.pathname !== '/' && !/^\/\d+$/.test(parsed.pathname))) invalid('INVALID_REDIS_CONFIGURATION');
    // ioredis decodes credentials when constructing its connection. Validate
    // them before starting Mongo, and forbid URL query overrides of timeouts.
    decodeURIComponent(parsed.username); decodeURIComponent(parsed.password);
  }
  catch { invalid('INVALID_REDIS_CONFIGURATION'); }
  return value;
}

/** Real connections created ONLY after all flags and environment guards pass. */
export const capacityBootstrapCliPorts: CapacityBootstrapCliPorts = {
  async openRead(uri) {
    const client = new mongoose.mongo.MongoClient(uri, { ...SILENT_MONGO, appName: 'sm-capacity-bootstrap-read',
      serverSelectionTimeoutMS: 10_000, socketTimeoutMS: 15_000, maxPoolSize: 2,
      readPreference: 'primary', readConcern: { level: 'majority' } });
    try {
      await client.connect(); const reader = new OrderCapacityBootstrapReader(client.db());
      return { read: (input) => reader.read(input), close: () => client.close() };
    } catch (error) { await client.close().catch(() => undefined); throw error; }
  },
  async openApply(mongoUri, redisUri) {
    // Own isolated ODM instance; no model/init/index side effects during reads.
    const odm = new mongoose.Mongoose();
    const connection = odm.createConnection();
    const redis = new Redis(redisUri, { lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 1,
      retryStrategy: () => null, connectTimeout: 10_000, commandTimeout: 10_000 });
    // Neither emitter may write raw error/URI details to the operator terminal.
    connection.on('error', () => undefined); redis.on('error', () => undefined);
    const notifications: Notifications = { attempted: 0, failed: 0 };
    const pending = new Set<Promise<unknown>>();
    const publisher = new Proxy(redis, { get(target, key) {
      if (key === 'publish') return (channel: string, payload: string) => {
        notifications.attempted += 1;
        const operation = target.publish(channel, payload);
        const settled = operation.then(() => undefined, () => { notifications.failed += 1; });
        pending.add(settled); void settled.then(() => pending.delete(settled));
        return operation;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const close = async () => {
      // Journal broadcasts are intentionally fire-and-forget. Drain the actual
      // publish promises before quit, without claiming subscribers consumed them.
      await Promise.allSettled([...pending]);
      try { if (redis.status === 'ready') await redis.quit(); }
      finally { redis.disconnect(); await connection.close(); }
    };
    try {
      await connection.openUri(mongoUri, { ...SILENT_MONGO, autoCreate: false, autoIndex: false, bufferCommands: false,
        appName: 'sm-capacity-bootstrap-apply', serverSelectionTimeoutMS: 10_000, socketTimeoutMS: 15_000,
        maxPoolSize: 2, readPreference: 'primary', readConcern: { level: 'majority' } });
      await redis.connect();
      const tenants = connection.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
      const days = connection.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
      const admissions = connection.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
      const orders = connection.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
      const store = new OrderCapacityBootstrapStore(tenants, days, admissions, orders,
        new OrderCapacityBootstrapReader(connection.db!), new OrderAdmissionJournal(admissions, orders, publisher));
      return { apply: (input) => store.apply(input), close, notifications: () => ({ ...notifications }) };
    } catch (error) { await close().catch(() => undefined); throw error; }
  },
};

const BLOCKED_REASONS = new Set(['activation_not_confirmed', 'admission_byte_limit', 'admission_changed', 'admission_limit',
  'bootstrap_owner_changed', 'calendar_plan_changed', 'calendar_without_control', 'cancelled_capacity_not_reconciled',
  'capacity_exceeded', 'control_not_resumable', 'different_bootstrap', 'historical_conflict', 'import_contention',
  'import_not_confirmed', 'import_uncertain', 'incomplete_scan', 'invalid_input', 'invalid_report', 'missing_public_admission',
  'missing_slot', 'order_changed', 'slot_inventory_limit', 'tenant_missing', 'unimported_order', 'validation_not_closed']);

function readOutput(result: CapacityBootstrapReadResult) {
  const report = result.report;
  return { mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true,
    scan: { complete: result.scan.complete, consistency: result.scan.consistency, counts: { ...result.scan.counts },
      bytes: result.scan.bytes, limits: { ...result.scan.limits } },
    issues: result.issues.map(({ code, source }) => ({ code, source })),
    report: !report ? null : { status: report.status, tenantId: report.tenantId, cutoverAt: report.cutoverAt, fromInclusive: report.fromInclusive,
      days: report.days.map((day) => ({ day: day.day, frozen: day.frozen, sourceRevision: day.sourceRevision,
        slots: day.slots.length, closedReason: day.closedReason })), occupants: report.occupants.length,
      issueCount: report.issues.length, issuesTruncated: report.issues.length > 100,
      issues: report.issues.slice(0, 100).map((issue) => ({ code: issue.code, source: issue.source,
        ...(issue.orderId && ID.test(issue.orderId) ? { orderId: issue.orderId } : {}),
        ...(issue.day && parseDay(issue.day) ? { day: issue.day } : {}),
        ...(issue.dimension ? { dimension: issue.dimension } : {}) })) } };
}

/** Exit 0 receipt/reviewed; 2 invalid flags/config; 3 blocked/incomplete; 1 I/O unknown.
 * A failed apply NEVER means nothing was written. Reuse the exact operation.
 */
export async function runCapacityBootstrapCli({ argv, env, nodeVersion = process.versions.node,
  stdout = (line) => { process.stdout.write(`${line}\n`); }, stderr = (line) => { process.stderr.write(`${line}\n`); },
  ports = capacityBootstrapCliPorts }: CliInput): Promise<number> {
  let args: Arguments | undefined; let session: ReadSession | ApplySession | undefined;
  let result: Record<string, unknown> | undefined; let failure: Record<string, unknown> | undefined;
  let applyStarted = false; let exitCode = 0; let cleanupWarning = false;
  try {
    args = parseCapacityBootstrapArguments(argv, env, nodeVersion);
    if (args.mode === 'help') { stdout(HELP); return 0; }
    const mongoUri = mongoConfiguration(env.MONGO_URL);
    if (args.mode === 'read') {
      const reader = await ports.openRead(mongoUri); session = reader;
      const observed = await reader.read(args.input); result = readOutput(observed);
      if (!observed.scan.complete || !observed.report || observed.report.status !== 'reviewed' || observed.issues.length) exitCode = 3;
    } else {
      const redisUri = redisConfiguration(env.REDIS_URL);
      const writer = await ports.openApply(mongoUri, redisUri); session = writer;
      applyStarted = true; const receipt = await writer.apply(args.input);
      result = { mode: 'apply', environmentAttestation: 'staging', rolloutVerifiedByCli: false,
        writerRevision: args.input.writerRevision, tenantId: receipt.tenantId, bootstrapId: receipt.bootstrapId, state: receipt.state,
        ...(receipt.state === 'active' ? { days: receipt.days, orders: receipt.orders } : {}),
        reloadOperationalScreens: true };
    }
  } catch (error) {
    if (error instanceof InvalidOperatorInput || error instanceof InvalidCapacityBootstrapReadInput) {
      exitCode = 2; failure = { code: 'CAPACITY_BOOTSTRAP_OPERATOR_INVALID',
        reason: error instanceof InvalidOperatorInput ? error.reason : 'INVALID_ARGUMENTS' };
    } else if (error instanceof CapacityBootstrapBlocked) {
      exitCode = 3; failure = { code: error.code, reason: BLOCKED_REASONS.has(error.reason) ? error.reason : 'blocked' };
    } else { exitCode = 1; failure = { code: 'CAPACITY_BOOTSTRAP_OPERATOR_FAILED' }; }
    if (args?.mode === 'apply') failure = { ...failure, bootstrapId: args.input.bootstrapId,
      operationMayHaveApplied: applyStarted, retry: 'same_bootstrap_id' };
  } finally {
    if (session) try { await session.close(); } catch { cleanupWarning = true; }
  }
  if (failure) stderr(JSON.stringify({ ...failure, ...(cleanupWarning ? { cleanupWarning } : {}) }));
  if (result) stdout(JSON.stringify({ ...result, ...(session && 'notifications' in session ? { notificationsBestEffort: session.notifications() } : {}),
    ...(cleanupWarning ? { cleanupWarning } : {}) }));
  return exitCode;
}

// No .env autoload, no NestFactory, no global exception logger or raw cause.
if (require.main === module) {
  void runCapacityBootstrapCli({ argv: process.argv.slice(2), env: process.env })
    .then((code) => { process.exitCode = code; }, () => {
      process.stderr.write('{"code":"CAPACITY_BOOTSTRAP_OPERATOR_FAILED"}\n'); process.exitCode = 1;
    });
}
