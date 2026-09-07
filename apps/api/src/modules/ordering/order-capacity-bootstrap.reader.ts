import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { mongo } from 'mongoose';
import { MODELS, type OrderCapacityControl } from '@sm/db';
import { planCapacityBootstrap } from './order-capacity-bootstrap';
import type { CapacityBootstrapInput, CapacityBootstrapReport } from './order-capacity-bootstrap.types';
import { CAPACITY_BOOTSTRAP_PROJECTIONS, bootstrapAdmissionProjection, bootstrapDayProjection, bootstrapOrderProjection } from './order-capacity-bootstrap.projection';
import { validateControl, type Control } from './order-capacity-control';
import { formatDay, parisYmd, parseDay } from './paris-time';

type Document = Record<string, unknown>;
type Source = 'tenant' | 'orders' | 'admissions' | 'days' | 'tenant_recheck' | 'analysis';
type Code = 'read_failed' | 'document_limit' | 'byte_limit' | 'day_limit' | 'deadline_exceeded'
  | 'invalid_tenant' | 'tenant_changed' | 'tenant_not_found';
type Limits = { maxDocuments: number; maxBytes: number; maxDays: number; maxDurationMs: number };
export type CapacityBootstrapReadInput = Readonly<{ tenantId: string; cutoverAt: Date; limits?: Partial<Limits> }>;
export type CapacityBootstrapReadResult = Readonly<{
  mode: 'read_only_analysis'; canActivate: false; requiresExclusiveRescan: true;
  scan: { complete: boolean; consistency: 'non_atomic'; counts: { orders: number; admissions: number; days: number }; bytes: number; limits: Limits };
  issues: readonly { code: Code; source: Source }[];
  report: CapacityBootstrapReport | null;
}>;
const DEFAULTS: Limits = { maxDocuments: 10_000, maxBytes: 8 * 1024 * 1024, maxDays: 90, maxDurationMs: 30_000 };
const MAXIMUMS: Limits = { maxDocuments: 100_000, maxBytes: 64 * 1024 * 1024, maxDays: 366, maxDurationMs: 120_000 };
const ID = /^[a-f0-9]{24}$/i;
function record(value: unknown): value is Document {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function day(value: unknown): string | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  const result = formatDay(parisYmd(value));
  return parseDay(result) ? result : null;
}
export class InvalidCapacityBootstrapReadInput extends Error {
  readonly code = 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT';
  constructor() { super('Contexte de lecture historique invalide.'); this.name = 'InvalidCapacityBootstrapReadInput'; }
}
class Incomplete extends Error {
  constructor(readonly code: Code) { super(code); }
}

/** Lecteur interne de maintenance, PAS un endpoint, un provider ou un applicateur.
 * Le propriétaire fournit une connexion native déjà ouverte, idéalement read-only.
 * Aucun model()/init(), helper de reprise, index, collection ou write créé ici.
 * Le scan tenant complet évite les trous d'un filtre par date/état/canal.
 * complete = curseurs épuisés + contrôle relu, jamais snapshot intercollections.
 */
export class OrderCapacityBootstrapReader {
  constructor(private readonly db: mongo.Db) {}

  async read(input: CapacityBootstrapReadInput): Promise<CapacityBootstrapReadResult> {
    if (!record(input) || Object.keys(input).some((key) => !['tenantId', 'cutoverAt', 'limits'].includes(key))
      || typeof input.tenantId !== 'string' || !ID.test(input.tenantId) || !day(input.cutoverAt)
      || (input.limits !== undefined && !record(input.limits))) throw new InvalidCapacityBootstrapReadInput();
    const limits = { ...DEFAULTS, ...input.limits };
    if (Object.keys(limits).some((key) => !Object.hasOwn(MAXIMUMS, key))
      || (Object.keys(MAXIMUMS) as (keyof Limits)[]).some((key) => !Number.isSafeInteger(limits[key])
        || limits[key] < 1 || limits[key] > MAXIMUMS[key])) throw new InvalidCapacityBootstrapReadInput();
    // Détacher les paramètres avant le premier await.
    const tenantId = input.tenantId.toLowerCase(); const cutoverAt = new Date(input.cutoverAt);
    const firstDay = day(cutoverAt)!;
    const deadline = performance.now() + limits.maxDurationMs;
    const scan: CapacityBootstrapReadResult['scan'] = {
      complete: false, consistency: 'non_atomic', counts: { orders: 0, admissions: 0, days: 0 }, bytes: 0, limits,
    };
    const observedDays = new Set([firstDay]);
    let source: Source = 'tenant';
    const remaining = () => {
      const value = Math.ceil(deadline - performance.now());
      if (value <= 0) throw new Incomplete('deadline_exceeded');
      return Math.min(value, 10_000);
    };
    const budget = (row: Document) => {
      scan.bytes += mongo.BSON.calculateObjectSize(row);
      if (scan.bytes > limits.maxBytes) throw new Incomplete('byte_limit');
      remaining();
    };
    const remember = (value: unknown, civil = false) => {
      const key = civil && typeof value === 'string' && parseDay(value) ? value : day(value);
      if (key && key >= firstDay) observedDays.add(key);
      if (observedDays.size > limits.maxDays) throw new Incomplete('day_limit');
    };
    const nativeId = new mongo.ObjectId(tenantId);
    // Inclure également les références texte/array associables à cet ID afin
    // de signaler leur BSON invalide, sans parcourir les autres restaurants.
    const match = (field: string) => ({ $or: [{ [field]: nativeId }, { [field]: { $regex: `^${tenantId}$`, $options: 'i' } }] });
    const readRows = async (collection: string, filter: Document, projection: Document, limit: number, consume: (row: Document) => void) => {
      const timeout = remaining();
      const cursor = this.db.collection(collection).aggregate<Document>([
        { $match: filter }, { $sort: { _id: 1 } }, { $limit: limit }, { $project: projection },
      ], { readPreference: 'primary', readConcern: { level: 'majority' }, allowDiskUse: false,
        batchSize: 64, maxTimeMS: timeout, timeoutMS: timeout });
      try {
        for (;;) {
          remaining();
          const row = await cursor.next();
          if (row === null) break;
          budget(row); consume(row);
        }
      } finally { await cursor.close(); }
    };
    const tenant = async () => {
      const rows: Document[] = [];
      await readRows(MODELS.Tenant.collection, match('_id'), CAPACITY_BOOTSTRAP_PROJECTIONS.tenant, 2, (row) => rows.push(row));
      if (rows.length === 0) throw new Incomplete('tenant_not_found');
      const value = rows[0]!;
      if (rows.length !== 1 || !(value._id instanceof mongo.ObjectId) || value._id.toHexString() !== tenantId
        || ['settings', 'delivery'].some((key) => value[key] != null && !record(value[key]))
        || ['hours', 'closures'].some((key) => value[key] != null && !Array.isArray(value[key]))) throw new Incomplete('invalid_tenant');
      if (Object.hasOwn(value, 'capacityControl')) {
        try {
          validateControl(value.capacityControl as OrderCapacityControl);
          if ((value.capacityControl as OrderCapacityControl).cutoverAt.getTime() !== cutoverAt.getTime()) throw new Error('cutover');
        } catch { throw new Incomplete('invalid_tenant'); }
      }
      return value;
    };
    try {
      const initial = await tenant();
      const control = initial.capacityControl as Control | undefined;
      remember(control?.dayIntent?.day, true);
      const context: CapacityBootstrapInput = { tenantId, cutoverAt, sourceRevision: control?.configRevision ?? 0,
        settings: initial, orders: [], admissions: [], frozenDays: [], dayIntent: control?.dayIntent };
      const orders: CapacityBootstrapInput['orders'][number][] = [];
      const admissions: CapacityBootstrapInput['admissions'][number][] = [];
      const days: NonNullable<CapacityBootstrapInput['frozenDays']>[number][] = [];
      for (const kind of ['orders', 'admissions', 'days'] as const) {
        source = kind;
        const collection = kind === 'orders' ? MODELS.Order.collection : kind === 'admissions' ? MODELS.PublicOrderAdmission.collection : MODELS.OrderCapacityDay.collection;
        const total = () => scan.counts.orders + scan.counts.admissions + scan.counts.days;
        await readRows(collection, match('tenantId'), CAPACITY_BOOTSTRAP_PROJECTIONS[kind], limits.maxDocuments - total() + 1, (row) => {
          scan.counts[kind] += 1;
          if (total() > limits.maxDocuments) throw new Incomplete('document_limit');
          if (kind === 'orders') {
            const value = bootstrapOrderProjection(row); orders.push(value); remember(value.slot);
          } else if (kind === 'admissions') {
            const value = bootstrapAdmissionProjection(row); admissions.push(value); remember(value.slot);
            remember(value.snapshot?.slot); remember(value.capacity?.slot);
          } else {
            const value = bootstrapDayProjection(row); days.push(value); remember(value.day, true);
          }
        });
      }
      source = 'tenant_recheck';
      if (!isDeepStrictEqual(initial, await tenant())) throw new Incomplete('tenant_changed');
      source = 'analysis'; remaining();
      const report = planCapacityBootstrap({ ...context, orders, admissions, frozenDays: days });
      remaining(); scan.complete = true;
      return { mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true, scan, issues: [], report };
    } catch (error) {
      // Aucun message/cause driver, URI, document ou preuve privée ne sort.
      return { mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true, scan,
        issues: [{ code: error instanceof Incomplete ? error.code : 'read_failed', source }], report: null };
    }
  }
}
