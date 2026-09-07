import { afterEach, describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { mongo } from 'mongoose';
import { MODELS } from '@sm/db';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { orderCapacityCalendarPlanHash } from './order-capacity-control';
import { InvalidCapacityBootstrapReadInput, OrderCapacityBootstrapReader } from './order-capacity-bootstrap.reader';

const TENANT = '507f1f77bcf86cd799439011';
const CUTOVER = '2030-05-02T16:00:00.000Z';
const SLOT = '2030-05-02T09:00:00.000Z';
const DAY = '2030-05-02';
type ReadInput = Parameters<OrderCapacityBootstrapReader['read']>[0];
type Document = Record<string, unknown>;
type Source = 'tenant' | 'orders' | 'admissions' | 'days' | 'tenant_recheck';
const COLLECTIONS = { tenant: MODELS.Tenant.collection, orders: MODELS.Order.collection,
  admissions: MODELS.PublicOrderAdmission.collection, days: MODELS.OrderCapacityDay.collection };

function tenant(overrides: Document = {}): Document {
  return { _id: new mongo.ObjectId(TENANT),
    settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 },
    hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, lunch: { open: '11:00', close: '12:00' }, dinner: null })),
    closures: [], ...overrides };
}
function order(number = 1, overrides: Document = {}): Document {
  return { _id: new mongo.ObjectId(number.toString(16).padStart(24, '0')), tenantId: new mongo.ObjectId(TENANT),
    clientId: `legacy-ticket-${number}`, channel: 'online', type: 'pickup', status: 'new',
    pickup: { slot: new Date(SLOT) }, ...overrides };
}
function admission(overrides: Document = {}): Document {
  return { _id: orderAdmissionId(TENANT, 'pending-ticket'), tenantId: new mongo.ObjectId(TENANT), clientId: 'pending-ticket',
    version: 1, state: 'validating', kind: 'public', channel: 'online', slot: new Date(SLOT),
    proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), ...overrides };
}
function frozenDay(overrides: Document = {}): Document {
  return { _id: new mongo.ObjectId('000000000000000000000099'), tenantId: new mongo.ObjectId(TENANT), day: DAY,
    state: 'ready', sourceRevision: 0, closedReason: null,
    slots: [{ at: new Date(SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }], ...overrides };
}
function capacityControl(overrides: Document = {}): Document {
  return { version: 1, state: 'active', bootstrapId: '00000000-0000-4000-8000-000000000001',
    cutoverAt: new Date(CUTOVER), configRevision: 7, ...overrides };
}

/** Documents here are outputs of the native projection, not a fake Mongo parser. */
function nativePort(rows: Partial<Record<Source, Document[]>> = {}, options: {
  onNext?: Partial<Record<Source, (index: number) => void | Promise<void>>>;
  closeFailure?: Source;
} = {}) {
  const fixtures: Record<Source, Document[]> = { tenant: [tenant()], orders: [], admissions: [], days: [],
    ...rows, tenant_recheck: rows.tenant_recheck ?? rows.tenant ?? [tenant()] };
  const cursors: { source: Source; pipeline: Document[]; options: Document;
    next: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
  let tenantReads = 0;
  const collection = vi.fn((name: string) => {
    const kind = (Object.keys(COLLECTIONS) as (keyof typeof COLLECTIONS)[]).find((key) => COLLECTIONS[key] === name);
    if (!kind) throw new Error('Unexpected collection in read-only port');
    const source: Source = kind === 'tenant' && tenantReads++ > 0 ? 'tenant_recheck' : kind;
    return { aggregate: vi.fn((pipeline: Document[], aggregateOptions: Document) => {
      let index = 0;
      const next = vi.fn(async () => {
        await options.onNext?.[source]?.(index);
        return fixtures[source][index++] ?? null;
      });
      const close = vi.fn(async () => {
        if (options.closeFailure === source) throw new Error('private close detail');
      });
      cursors.push({ source, pipeline, options: aggregateOptions, next, close });
      return { next, close };
    }) };
  });
  return { db: { collection } as unknown as mongo.Db, collection, cursors, fixtures };
}

function expectIncomplete(result: Awaited<ReturnType<OrderCapacityBootstrapReader['read']>>, code: string, source?: Source) {
  expect(result).toMatchObject({ mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true,
    scan: { complete: false, consistency: 'non_atomic' }, report: null });
  expect(result.issues).toEqual([expect.objectContaining({ code, ...(source ? { source } : {}) })]);
}

function input(overrides: Partial<ReadInput> = {}): ReadInput {
  return { tenantId: TENANT, cutoverAt: new Date(CUTOVER), ...overrides };
}

/** Only the I/O port is doubled: validation and the analysis planner remain real. */
function unavailableDb() {
  const collection = vi.fn(() => { throw new Error('unexpected database access'); });
  return { db: { collection } as unknown as mongo.Db, collection };
}

function failedReadDb(kind: 'aggregate' | 'next') {
  const next = vi.fn(async () => { throw new Error('private backend failure detail'); });
  const close = vi.fn(async () => undefined);
  const aggregate = vi.fn(() => {
    if (kind === 'aggregate') throw new Error('private aggregate failure detail');
    return { next, close };
  });
  const collection = vi.fn(() => ({ aggregate }));
  return { db: { collection } as unknown as mongo.Db, collection, aggregate, next, close };
}

afterEach(() => vi.restoreAllMocks());

describe('OrderCapacityBootstrapReader — arguments invalides avant tout accès DB', () => {
  it.each([null, undefined, [], 'tenant'])('refuse un contexte non structuré %j sans I/O', async (value) => {
    const port = unavailableDb();
    await expect(new OrderCapacityBootstrapReader(port.db).read(value as unknown as ReadInput))
      .rejects.toBeInstanceOf(InvalidCapacityBootstrapReadInput);
    expect(port.collection).not.toHaveBeenCalled();
  });

  it.each(['', 'not-an-id', '507f1f77bcf86cd79943901', '507f1f77bcf86cd7994390110', ` ${TENANT}`, `${TENANT} `])(
    'refuse le tenantId non canonique %j sans I/O', async (tenantId) => {
      const port = unavailableDb();
      await expect(new OrderCapacityBootstrapReader(port.db).read(input({ tenantId })))
        .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
      expect(port.collection).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, CUTOVER, new Date(NaN)])('refuse une date de bascule invalide %j sans I/O', async (cutoverAt) => {
    const port = unavailableDb();
    await expect(new OrderCapacityBootstrapReader(port.db).read(input({ cutoverAt: cutoverAt as Date })))
      .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
    expect(port.collection).not.toHaveBeenCalled();
  });

  it.each(['maxDocuments', 'maxBytes', 'maxDays', 'maxDurationMs'] as const)(
    'refuse une borne %s nulle, négative, fractionnaire ou non finie sans I/O', async (key) => {
      for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const port = unavailableDb();
        await expect(new OrderCapacityBootstrapReader(port.db).read(input({ limits: { [key]: value } })))
          .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
        expect(port.collection).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { maxDocuments: 100_001 }, { maxBytes: 64 * 1024 * 1024 + 1 }, { maxDays: 367 }, { maxDurationMs: 120_001 },
    { unexpected: 1 }, { maxDocuments: null }, { maxBytes: undefined }, { maxDays: '1' },
  ])('refuse les plafonds hors contrat %j sans I/O', async (limits) => {
    const port = unavailableDb();
    await expect(new OrderCapacityBootstrapReader(port.db).read(input({ limits: limits as ReadInput['limits'] })))
      .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
    expect(port.collection).not.toHaveBeenCalled();
  });

  it.each([null, [], 'limits', new Date(CUTOVER)])('refuse des limites non structurées %j sans I/O', async (limits) => {
    const port = unavailableDb();
    await expect(new OrderCapacityBootstrapReader(port.db).read(input({ limits: limits as ReadInput['limits'] })))
      .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
    expect(port.collection).not.toHaveBeenCalled();
  });

  it('refuse une option de lecture inconnue sans I/O', async () => {
    const port = unavailableDb();
    const value = { ...input(), activate: true };
    await expect(new OrderCapacityBootstrapReader(port.db).read(value))
      .rejects.toMatchObject({ code: 'INVALID_CAPACITY_BOOTSTRAP_READ_INPUT' });
    expect(port.collection).not.toHaveBeenCalled();
  });
});

describe('OrderCapacityBootstrapReader — panne de lecture, aucune analyse partielle exploitable', () => {
  it('une impossibilité de choisir une collection ne devient pas un inventaire vide', async () => {
    const port = unavailableDb();
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true,
      scan: { complete: false, consistency: 'non_atomic' }, report: null });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'read_failed' })]));
  });

  it.each(['aggregate', 'next'] as const)('une erreur %s reste bloquante et ne divulgue pas le message du driver', async (kind) => {
    const port = failedReadDb(kind);
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ scan: { complete: false, consistency: 'non_atomic' }, report: null });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'read_failed' })]));
    expect(JSON.stringify(result)).not.toContain('private');
    expect(port.aggregate).toHaveBeenCalledTimes(1);
    if (kind === 'next') expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('une erreur de fermeture du premier curseur interdit tout rapport', async () => {
    const close = vi.fn(async () => { throw new Error('private close failure detail'); });
    const aggregate = vi.fn(() => ({ next: vi.fn(async () => null), close }));
    const db = { collection: vi.fn(() => ({ aggregate })) } as unknown as mongo.Db;
    const result = await new OrderCapacityBootstrapReader(db).read(input());
    expect(result).toMatchObject({ scan: { complete: false }, report: null });
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'read_failed' })]));
    expect(close).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});

describe('OrderCapacityBootstrapReader — inventaire lu, jamais une activation ou un snapshot atomique', () => {
  it('analyse un inventaire vide seulement après épuisement et fermeture des cinq curseurs', async () => {
    const port = nativePort();
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ mode: 'read_only_analysis', canActivate: false, requiresExclusiveRescan: true,
      scan: { complete: true, consistency: 'non_atomic', counts: { orders: 0, admissions: 0, days: 0 },
        limits: { maxDocuments: 10_000, maxBytes: 8 * 1024 * 1024, maxDays: 90, maxDurationMs: 30_000 } },
      issues: [], report: { mode: 'analysis_only', canActivate: false, status: 'reviewed', occupants: [] } });
    expect(port.cursors.map((cursor) => cursor.source)).toEqual(['tenant', 'orders', 'admissions', 'days', 'tenant_recheck']);
    for (const cursor of port.cursors) expect(cursor.close).toHaveBeenCalledTimes(1);
    expect(result.scan.bytes).toBe(2 * mongo.BSON.calculateObjectSize(tenant()));
  });

  it('garde les empreintes historiques de tous canaux, états et dates pour le vrai planificateur', async () => {
    const port = nativePort({ orders: [order(), order(2, { channel: 'phone', type: 'delivery', status: 'delivered' }),
      order(3, { channel: 'pos', status: 'cancelled', pickup: { slot: new Date('2040-05-02T09:00:00.000Z') } }),
      order(4, { channel: 'pos', type: 'surplace', pickup: null })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 4, admissions: 0, days: 0 } });
    expect(result.report?.issues).toEqual([]);
    expect(result.report?.occupants).toHaveLength(2);
    expect(result.report?.days.map((day) => day.day)).toEqual([DAY, '2040-05-02']);
    expect(result.report?.days[0]!.slots[0]).toMatchObject({ kitchenUsed: 2, deliveryUsed: 1 });
  });

  it('distingue un scan complet d’une anomalie métier bloquante dans le rapport', async () => {
    const port = nativePort({ admissions: [admission()] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ scan: { complete: true }, issues: [], report: { status: 'blocked' } });
    expect(result.report?.issues).toEqual([expect.objectContaining({ code: 'pending_validation' })]);
    for (const text of ['pending-ticket', 'proofHash', 'payloadHash', 'a'.repeat(64), 'b'.repeat(64)]) {
      expect(JSON.stringify(result)).not.toContain(text);
    }
  });

  it('ne masque pas un mauvais type BSON en le convertissant comme Mongoose', async () => {
    const port = nativePort({ orders: [order(1, { _id: '000000000000000000000001' })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ scan: { complete: true }, report: { status: 'blocked' } });
    expect(result.report?.issues).toEqual([expect.objectContaining({ code: 'invalid_order' })]);
    expect(result.report?.occupants).toEqual([]);
  });

  it('ne demande que des agrégations tenant-scopées, projetées, en lecture primaire majoritaire', async () => {
    const port = nativePort();
    await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDocuments: 5, maxDurationMs: 500 } }));
    for (const cursor of port.cursors) {
      const field = cursor.source.startsWith('tenant') ? '_id' : 'tenantId';
      expect(cursor.pipeline[0]).toEqual({ $match: { $or: [
        { [field]: new mongo.ObjectId(TENANT) }, { [field]: { $regex: `^${TENANT}$`, $options: 'i' } },
      ] } });
      expect(cursor.pipeline.map((stage) => Object.keys(stage)[0])).toEqual(['$match', '$sort', '$limit', '$project']);
      expect(cursor.options).toMatchObject({ readPreference: 'primary', readConcern: { level: 'majority' },
        allowDiskUse: false });
      expect(cursor.options.timeoutMS).toBeGreaterThan(0);
      expect(cursor.options.timeoutMS).toBeLessThanOrEqual(500);
      expect(cursor.options.maxTimeMS).toBe(cursor.options.timeoutMS);
      for (const privateField of ['trackingToken', 'phone', 'customer', 'lines', 'totalCents', 'address']) {
        expect(JSON.stringify(cursor.pipeline)).not.toContain(privateField);
      }
    }
  });

  it('détache tenantId, date et plafonds avant la première attente', async () => {
    const args = input({ limits: { maxDocuments: 1 } });
    const port = nativePort({ orders: [order()] }, { onNext: { tenant: (index) => {
      if (index !== 0) return;
      args.cutoverAt.setUTCFullYear(2040);
      args.limits!.maxDocuments = 0;
      Object.assign(args, { tenantId: '507f1f77bcf86cd799439022' });
    } } });
    const result = await new OrderCapacityBootstrapReader(port.db).read(args);
    expect(result).toMatchObject({ scan: { complete: true, limits: { maxDocuments: 1 } },
      report: { tenantId: TENANT, cutoverAt: CUTOVER } });
    expect(result.report?.occupants).toHaveLength(1);
  });
});

describe('OrderCapacityBootstrapReader — plafonds exacts et résultats incomplets', () => {
  it('accepte exactement N documents seulement après le next null final', async () => {
    const port = nativePort({ orders: [order(), order(2)] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDocuments: 2 } }));
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 2, admissions: 0, days: 0 } });
    expect(port.cursors.find((cursor) => cursor.source === 'orders')!.next).toHaveBeenCalledTimes(3);
  });

  it('observe et compte N+1 puis ferme immédiatement sans continuer les autres collections', async () => {
    const port = nativePort({ orders: [order(), order(2), order(3), order(4)] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDocuments: 2 } }));
    expectIncomplete(result, 'document_limit', 'orders');
    expect(result.scan.counts).toEqual({ orders: 3, admissions: 0, days: 0 });
    expect(port.cursors.map((cursor) => cursor.source)).toEqual(['tenant', 'orders']);
    expect(port.cursors[1]!.next).toHaveBeenCalledTimes(3);
    expect(port.cursors[1]!.close).toHaveBeenCalledTimes(1);
  });

  it('partage le plafond global entre les trois collections, sans compter les deux lectures Tenant', async () => {
    const port = nativePort({ orders: [order()], admissions: [admission()], days: [frozenDay()] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDocuments: 2 } }));
    expectIncomplete(result, 'document_limit', 'days');
    expect(result.scan.counts).toEqual({ orders: 1, admissions: 1, days: 1 });
    expect(port.cursors.find((cursor) => cursor.source === 'days')!.pipeline[2]).toEqual({ $limit: 1 });
  });

  it('compte les tailles BSON natives, deux Tenant inclus, et accepte le budget exact', async () => {
    const tenantRow = tenant(); const orderRow = order();
    const maxBytes = 2 * mongo.BSON.calculateObjectSize(tenantRow) + mongo.BSON.calculateObjectSize(orderRow);
    const port = nativePort({ tenant: [tenantRow], orders: [orderRow] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxBytes } }));
    expect(result.scan).toMatchObject({ complete: true, bytes: maxBytes });
  });

  it('un octet de moins invalide le résultat lors de la relecture Tenant, sans rendre le rapport déjà possible', async () => {
    const tenantRow = tenant(); const orderRow = order();
    const bytes = 2 * mongo.BSON.calculateObjectSize(tenantRow) + mongo.BSON.calculateObjectSize(orderRow);
    const port = nativePort({ tenant: [tenantRow], orders: [orderRow] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxBytes: bytes - 1 } }));
    expectIncomplete(result, 'byte_limit', 'tenant_recheck');
    expect(result.scan.bytes).toBe(bytes);
    expect(port.cursors.at(-1)!.close).toHaveBeenCalledTimes(1);
  });

  it('un document Tenant seul trop gros ferme le curseur et empêche tout scan Orders', async () => {
    const port = nativePort();
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxBytes: 1 } }));
    expectIncomplete(result, 'byte_limit', 'tenant');
    expect(port.cursors).toHaveLength(1);
    expect(port.cursors[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('le jour de cutover compte dans le plafond de jours, même sans occupation', async () => {
    const port = nativePort({ orders: [order(1, { pickup: { slot: new Date('2040-05-02T09:00:00.000Z') } })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDays: 1 } }));
    expectIncomplete(result, 'day_limit', 'orders');
    expect(result.scan.counts.orders).toBe(1);
  });

  it('plusieurs créneaux d’un même jour ne consomment qu’une journée et le passé n’en consomme pas', async () => {
    const port = nativePort({ orders: [order(), order(2, { pickup: { slot: new Date('2030-05-02T09:30:00.000Z') } }),
      order(3, { pickup: { slot: new Date('2029-05-02T09:00:00.000Z') } })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDays: 1 } }));
    expect(result.scan.complete).toBe(true);
    expect(result.report?.days).toHaveLength(1);
    expect(result.report?.occupants).toHaveLength(2);
  });

  it.each(['slot', 'snapshot', 'capacity'] as const)('le jour futur de admission.%s participe au plafond', async (field) => {
    const future = new Date('2040-05-02T09:00:00.000Z');
    const patch = field === 'slot' ? { slot: future }
      : field === 'snapshot' ? { snapshot: order(1, { pickup: { slot: future } }) }
        : { capacity: { slot: future, kitchenSeat: 0 } };
    const port = nativePort({ admissions: [admission(patch)] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDays: 1 } }));
    expectIncomplete(result, 'day_limit', 'admissions');
    expect(port.cursors.at(-1)!.close).toHaveBeenCalledTimes(1);
  });

  it('un calendrier futur sans commande participe au plafond de jours', async () => {
    const port = nativePort({ days: [frozenDay({ day: '2040-05-02',
      slots: [{ at: new Date('2040-05-02T09:00:00.000Z'), kitchenCapacity: 4, deliveryCapacity: 2 }] })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDays: 1 } }));
    expectIncomplete(result, 'day_limit', 'days');
  });

  it('une intention future bien hashée participe au plafond avant de scanner les commandes', async () => {
    const plan = { day: '2040-05-02', sourceRevision: 7, closedReason: null,
      slots: [{ at: new Date('2040-05-02T09:00:00.000Z'), kitchenCapacity: 4, deliveryCapacity: 2 }] };
    const control = capacityControl({ dayIntent: { ...plan, operationId: '00000000-0000-4000-8000-000000000002',
      planHash: orderCapacityCalendarPlanHash(plan) } });
    const port = nativePort({ tenant: [tenant({ capacityControl: control })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDays: 1 } }));
    expectIncomplete(result, 'day_limit', 'tenant');
    expect(port.cursors).toHaveLength(1);
  });

  it('l’échéance monotone dépassée pendant next ferme le curseur et interdit la suite', async () => {
    let now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const port = nativePort({ orders: [order()] }, { onNext: { orders: () => { now = 151; } } });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input({ limits: { maxDurationMs: 50 } }));
    expectIncomplete(result, 'deadline_exceeded', 'orders');
    expect(port.cursors.map((cursor) => cursor.source)).toEqual(['tenant', 'orders']);
    expect(port.cursors[1]!.close).toHaveBeenCalledTimes(1);
  });
});

describe('OrderCapacityBootstrapReader — établissement absent, corrompu ou modifié pendant le scan', () => {
  it.each(['active', 'seeding', 'blocked'])('permet l’analyse d’un contrôle %s valide sans l’activer', async (state) => {
    const port = nativePort({ tenant: [tenant({ capacityControl: capacityControl({ state }) })], orders: [order()],
      days: [frozenDay({ sourceRevision: 3 })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expect(result).toMatchObject({ canActivate: false, scan: { complete: true }, issues: [], report: { status: 'reviewed' } });
    expect(result.report?.days[0]).toMatchObject({ sourceRevision: 3, frozen: true });
  });

  it('un établissement absent n’est pas un rapport vide valide', async () => {
    const port = nativePort({ tenant: [] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'tenant_not_found', 'tenant');
    expect(port.cursors).toHaveLength(1);
  });

  it.each([
    { _id: TENANT }, { _id: new mongo.ObjectId('507f1f77bcf86cd799439022') },
    { settings: 'corrupt' }, { delivery: [] }, { hours: {} }, { closures: 'corrupt' },
    { capacityControl: null }, { capacityControl: {} },
    { capacityControl: capacityControl({ cutoverAt: new Date('2030-05-02T16:00:00.001Z') }) },
  ])('un établissement projeté corrompu %j bloque avant lecture des ventes', async (patch) => {
    const port = nativePort({ tenant: [tenant(patch)] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'invalid_tenant', 'tenant');
    expect(port.cursors).toHaveLength(1);
  });

  it('des références Tenant BSON et texte concurrentes ne sont pas dédupliquées arbitrairement', async () => {
    const port = nativePort({ tenant: [tenant(), tenant({ _id: TENANT })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'invalid_tenant', 'tenant');
    expect(port.cursors[0]!.pipeline[2]).toEqual({ $limit: 2 });
  });

  it('une modification de capacité à la relecture invalide tout le scan', async () => {
    const port = nativePort({ orders: [order()], tenant_recheck: [tenant({ settings: { slotIntervalMin: 30, slotCapacity: 8 } })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'tenant_changed', 'tenant_recheck');
    expect(result.scan.counts.orders).toBe(1);
    expect(port.cursors).toHaveLength(5);
    for (const cursor of port.cursors) expect(cursor.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    { configRevision: 8 }, { state: 'blocked' }, { bootstrapId: '00000000-0000-4000-8000-000000000003' },
  ])('une modification du contrôle %j invalide le scan même si les capacités n’ont pas changé', async (patch) => {
    const port = nativePort({ tenant: [tenant({ capacityControl: capacityControl() })],
      tenant_recheck: [tenant({ capacityControl: capacityControl(patch) })] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'tenant_changed', 'tenant_recheck');
  });

  it('une disparition à la relecture ne livre pas l’ancien rapport', async () => {
    const port = nativePort({ orders: [order()], tenant_recheck: [] });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'tenant_not_found', 'tenant_recheck');
  });

  it('une fermeture en échec après lecture complète des ventes ne certifie pas le scan', async () => {
    const port = nativePort({ orders: [order()] }, { closeFailure: 'orders' });
    const result = await new OrderCapacityBootstrapReader(port.db).read(input());
    expectIncomplete(result, 'read_failed', 'orders');
    expect(result.scan.counts.orders).toBe(1);
    expect(port.cursors[1]!.next).toHaveBeenCalledTimes(2);
    expect(port.cursors[1]!.close).toHaveBeenCalledTimes(1);
  });
});
