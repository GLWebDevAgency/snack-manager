import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { billingPeriod, SM_INVOICE_VAT } from '@sm/contracts';
import { MODELS, type Counter, type Invoice, type InvoiceIssuance, type InvoiceSnapshot } from '@sm/db';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { DuplicateInvoiceException, InvoiceWriterService, type InvoiceWriteInput } from './invoice-writer.service';

const DATABASE_PREFIX = 'snackmanager_billing_test_';
const RUN_ID = randomUUID().replaceAll('-', '');

/** Aucune URL distante, base ordinaire ou option de redirection n'est acceptée. */
function isolatedDatabase(raw: string): { uri: string; name: string } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('BILLING_TEST_MONGO_URL invalide.'); }
  const name = url.pathname.slice(1);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^snackmanager_billing_test_[a-z0-9_]+$/i.test(name) || name.length > 48) {
    throw new Error('BILLING_TEST_MONGO_URL doit cibler une base snackmanager_billing_test_ locale sans options ni identifiants.');
  }
  const isolatedName = `${name}_${RUN_ID.slice(0, 12)}`;
  url.pathname = `/${isolatedName}`;
  return { uri: url.toString(), name: isolatedName };
}

const requestedUrl = process.env.BILLING_TEST_MONGO_URL;
// Une URL présente mais dangereuse fait ÉCHOUER la suite avant toute connexion.
const database = requestedUrl ? isolatedDatabase(requestedUrl) : null;
const integration = database ? describe : describe.skip;

describe('garde-fous de la base Mongo de recette facturation', () => {
  it.each([
    'mongodb://example.com/snackmanager_billing_test_ci',
    'mongodb://127.0.0.1/snackmanager',
    'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_billing_test_',
    'mongodb://localhost/snackmanager_billing_test_ci?replicaSet=production',
    'mongodb://user:password@localhost/snackmanager_billing_test_ci',
    'mongodb+srv://localhost/snackmanager_billing_test_ci',
    'mongodb://localhost,example.com/snackmanager_billing_test_ci',
  ])('refuse la cible non isolée %s avant tout I/O', (url) => {
    expect(() => isolatedDatabase(url)).toThrow('BILLING_TEST_MONGO_URL');
  });

  it.each(['127.0.0.1', 'localhost'])('isole chaque run sur %s sans réutiliser la base fournie', (host) => {
    const isolated = isolatedDatabase(`mongodb://${host}:27029/snackmanager_billing_test_local`);
    expect(isolated.name).toMatch(/^snackmanager_billing_test_local_[a-f0-9]{12}$/);
    expect(new URL(isolated.uri).hostname).toBe(host);
    expect(isolated.name).not.toBe('snackmanager_billing_test_local');
  });
});

type Models = { invoices: Model<Invoice>; counters: Model<Counter>; issuances: Model<InvoiceIssuance> };

function models(connection: Connection): Models {
  return {
    invoices: connection.model<Invoice>(MODELS.Invoice.name, MODELS.Invoice.schema, MODELS.Invoice.collection),
    counters: connection.model<Counter>(MODELS.Counter.name, MODELS.Counter.schema, MODELS.Counter.collection),
    issuances: connection.model<InvoiceIssuance>(MODELS.InvoiceIssuance.name, MODELS.InvoiceIssuance.schema, MODELS.InvoiceIssuance.collection),
  };
}

function writer(db: Models): InvoiceWriterService {
  return new InvoiceWriterService(db.invoices, db.issuances, new InvoiceNumberingService(db.invoices, db.counters));
}

function input(overrides: Partial<InvoiceWriteInput> = {}): InvoiceWriteInput {
  const period = billingPeriod('2026-09');
  return {
    tenantId: new Types.ObjectId('507f1f77bcf86cd799439011'), kind: 'abonnement',
    label: 'Abonnement de recette uniquement', period: { start: period.start, end: period.end },
    amountCents: 14900, status: 'brouillon', issuedAt: null, dueAt: new Date('2026-09-15T00:00:00Z'),
    ...overrides,
  };
}

function snapshot(overrides: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return { ...input(), _id: new Types.ObjectId(), vat: { ...SM_INVOICE_VAT }, paidAt: null, method: null, ...overrides };
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

type QueryHook = (args: unknown[], result?: unknown) => Promise<void>;

/** Seules les coupures sont simulées : chaque opération atteint vraiment Mongo. */
function hookedModel<T>(model: Model<T>, method: 'updateOne' | 'findOneAndUpdate', hooks: { before?: QueryHook; after?: QueryHook }): Model<T> {
  return new Proxy(model, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== method) return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => {
        const query = Reflect.apply(value, target, args) as Query<unknown, T>;
        const execute = query.exec.bind(query);
        query.exec = async () => {
          await hooks.before?.(args);
          const result = await execute();
          await hooks.after?.(args, result);
          return result;
        };
        return query;
      };
    },
  });
}

function crashAfter<T>(model: Model<T>, method: 'updateOne' | 'findOneAndUpdate', matches: (args: unknown[], result: unknown) => boolean, message: string): Model<T> {
  let armed = true;
  return hookedModel(model, method, {
    after: async (args, result) => {
      if (armed && matches(args, result)) { armed = false; throw new Error(message); }
    },
  });
}

function isAllocated(args: unknown[], result: unknown): boolean {
  return (args[1] as { $inc?: { seq?: number } })?.$inc?.seq === 1
    && (result as { modifiedCount?: number })?.modifiedCount === 1;
}

integration('émission de factures sur un vrai Mongo standalone', () => {
  let firstConnection: Connection;
  let secondConnection: Connection;
  let first: Models;
  let second: Models;
  let ownsDatabase = false;

  async function assertOwnedDatabase(): Promise<void> {
    if (!database || !ownsDatabase || firstConnection.name !== database.name
      || !database.name.startsWith(DATABASE_PREFIX) || !database.name.endsWith(RUN_ID.slice(0, 12))) {
      throw new Error('Nettoyage interdit : base de recette non possédée par ce run.');
    }
    const marker = await firstConnection.db!.collection('_test_run').findOne({ runId: RUN_ID });
    if (!marker) throw new Error('Nettoyage interdit : preuve de propriété de la base absente.');
  }

  beforeAll(async () => {
    if (!database) throw new Error('Base de recette absente.');
    firstConnection = await mongoose.createConnection(database.uri, {
      autoCreate: false, autoIndex: false, family: 4, serverSelectionTimeoutMS: 5000,
    }).asPromise();
    const hello = await firstConnection.db!.admin().command({ hello: 1 });
    expect(hello.setName).toBeUndefined();
    expect(hello.msg).not.toBe('isdbgrid');
    expect(await firstConnection.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await firstConnection.db!.collection('_test_run').insertOne({ runId: RUN_ID });
    ownsDatabase = true;
    first = models(firstConnection);
    for (const model of Object.values(first)) {
      await model.createCollection();
      await model.createIndexes();
    }
    secondConnection = await mongoose.createConnection(database.uri, {
      autoCreate: false, autoIndex: false, family: 4, serverSelectionTimeoutMS: 5000,
    }).asPromise();
    second = models(secondConnection);
  }, 20_000);

  beforeEach(async () => {
    await assertOwnedDatabase();
    await Promise.all([
      first.invoices.deleteMany({}), first.counters.deleteMany({}), first.issuances.deleteMany({}),
    ]);
  });

  afterAll(async () => {
    try {
      if (ownsDatabase) {
        await assertOwnedDatabase();
        await firstConnection.dropDatabase();
      }
    } finally {
      await Promise.all([firstConnection?.close(), secondConnection?.close()]);
    }
  });

  it.each([2026, 2027])('deux instances sur la même période, échéance concurrente %i : une seule facture et un seul numéro', async (otherYear) => {
    const results = await Promise.allSettled([
      writer(first).write(input()),
      writer(second).write(input({ dueAt: new Date(`${otherYear}-09-15T00:00:00Z`) })),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(DuplicateInvoiceException);
    const invoices = await first.invoices.find().lean();
    expect(invoices).toHaveLength(1);
    const counters = await first.counters.find().lean();
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({ seq: 1, pendingInvoice: null });
    expect(invoices[0]!.number).toBe(`SM-${invoices[0]!.dueAt.getUTCFullYear()}-0001`);
    expect(await first.issuances.countDocuments()).toBe(1);
  });

  it('deux établissements et deux options partagent une séquence globale sans bloquer les options multiples', async () => {
    const otherTenant = new Types.ObjectId('507f1f77bcf86cd799439012');
    await Promise.all([
      writer(first).write(input()), writer(second).write(input({ tenantId: otherTenant })),
      writer(first).write(input({ kind: 'option', label: 'Option 1' })),
      writer(second).write(input({ kind: 'option', label: 'Option 2' })),
    ]);
    const invoices = await first.invoices.find().sort({ number: 1 }).lean();
    expect(invoices.map((invoice) => invoice.number)).toEqual(['SM-2026-0001', 'SM-2026-0002', 'SM-2026-0003', 'SM-2026-0004']);
    expect(await first.issuances.countDocuments()).toBe(2);
    expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 4, pendingInvoice: null });
  });

  it('après annulation, deux remplacements concurrents créent une seule nouvelle pièce sans réécrire l’ancienne', async () => {
    const initial = await writer(first).write(input());
    await first.invoices.updateOne({ _id: initial._id }, { $set: { status: 'annulee', cancelledAt: new Date(), cancelReason: 'Correction de recette' } });
    const cancelled = await first.invoices.findById(initial._id).lean();
    const results = await Promise.allSettled([writer(first).write(input()), writer(second).write(input())]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(DuplicateInvoiceException);
    expect(await first.invoices.countDocuments()).toBe(2);
    expect(await first.invoices.countDocuments({ status: { $ne: 'annulee' } })).toBe(1);
    expect(await first.invoices.findById(initial._id).lean()).toEqual(cancelled);
    expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 2, pendingInvoice: null });
  });

  it.each([1, 2])('%i facture(s) historique(s) active(s) : refus sans réécriture ni allocation', async (count) => {
    const legacy = Array.from({ length: count }, (_, index) => {
      const row = snapshot();
      // Le VAT absent reproduit un ancien document : aucun backfill implicite.
      const { vat: _vat, ...withoutVat } = row;
      return { ...withoutVat, number: `SM-2026-000${index + 1}` };
    });
    await first.invoices.collection.insertMany(legacy as never);
    const before = await first.invoices.collection.find().sort({ number: 1 }).toArray();
    await expect(writer(first).write(input())).rejects.toBeInstanceOf(count === 1 ? DuplicateInvoiceException : ServiceUnavailableException);
    expect(await first.invoices.collection.find().sort({ number: 1 }).toArray()).toEqual(before);
    expect(await first.issuances.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
  });

  it('reprend après le claim de période avec le même ID et l’échéance figée, malgré un nouvel input', async () => {
    const broken = { ...first, issuances: crashAfter(first.issuances, 'findOneAndUpdate', () => true, 'claim response lost') };
    await expect(writer(broken).write(input())).rejects.toThrow('claim response lost');
    const claim = await first.issuances.findOne().lean();
    expect(claim).toBeTruthy();
    expect(await first.invoices.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
    await expect(writer(second).write(input({ dueAt: new Date('2027-09-15'), amountCents: 1 }))).rejects.toBeInstanceOf(DuplicateInvoiceException);
    expect(await first.invoices.findById(claim!.snapshot._id).lean()).toMatchObject({ number: 'SM-2026-0001', amountCents: 14900 });
    expect(await first.counters.find().lean()).toMatchObject([{ _id: 'invoice:2026', seq: 1, pendingInvoice: null }]);
  });

  it('reprend un CAS de compteur réussi dont la réponse est perdue, sans trou de numérotation', async () => {
    const broken = { ...first, counters: crashAfter(first.counters, 'updateOne', isAllocated, 'counter response lost') };
    await expect(writer(broken).write(input())).rejects.toThrow('counter response lost');
    const pending = await first.counters.findById('invoice:2026').lean();
    expect(pending).toMatchObject({ seq: 1, pendingInvoice: { number: 'SM-2026-0001' } });
    expect(await first.invoices.countDocuments()).toBe(0);
    await expect(writer(second).write(input())).rejects.toBeInstanceOf(DuplicateInvoiceException);
    expect(await first.invoices.findById(pending!.pendingInvoice!.snapshot._id).lean()).toMatchObject({ number: 'SM-2026-0001' });
    expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 1, pendingInvoice: null });
  });

  it('une insertion réussie suivie d’une réponse perdue ne produit pas de nouvelle facture au rejeu', async () => {
    const broken = { ...first, invoices: crashAfter(first.invoices, 'updateOne', (_args, result) => (result as { upsertedCount?: number }).upsertedCount === 1, 'invoice response lost') };
    await expect(writer(broken).write(input())).rejects.toThrow('invoice response lost');
    const inserted = await first.invoices.findOne().lean();
    expect(inserted).toMatchObject({ number: 'SM-2026-0001' });
    await expect(writer(second).write(input())).rejects.toBeInstanceOf(DuplicateInvoiceException);
    expect(await first.invoices.findOne().lean()).toEqual(inserted);
    expect(await first.invoices.countDocuments()).toBe(1);
    // La prochaine émission aide le pending existant avant d'allouer le n° 2.
    expect(await writer(second).write(input({ kind: 'option' }))).toMatchObject({ number: 'SM-2026-0002' });
    expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 2, pendingInvoice: null });
  });

  it.each(['annulee', 'payee'] as const)('un helper tardif préserve l’état terminal %s et n’efface pas la réservation suivante', async (status) => {
    const original = snapshot({ kind: 'option' });
    const counters = crashAfter(first.counters, 'updateOne', isAllocated, 'counter response lost');
    await expect(new InvoiceNumberingService(first.invoices, counters).write(original)).rejects.toThrow('counter response lost');
    const entered = latch();
    const resume = latch();
    let once = true;
    const pausedInvoices = hookedModel(first.invoices, 'updateOne', {
      before: async () => { if (once) { once = false; entered.release(); await resume.promise; } },
    });
    const late = new InvoiceNumberingService(pausedInvoices, first.counters).write(original);
    // Raccrocher immédiatement une erreur évite un rejet non observé au diagnostic.
    const outcome = late.then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await Promise.race([
        entered.promise,
        outcome.then((result) => {
          if ('error' in result) throw result.error;
          throw new Error('Le helper n’a pas atteint le point de pause attendu.');
        }),
      ]);
      await new InvoiceNumberingService(second.invoices, second.counters).write(original);
      await second.invoices.updateOne({ _id: original._id }, { $set: {
        status, ...(status === 'annulee'
          ? { cancelledAt: new Date(), cancelReason: 'Correction de recette' }
          : { paidAt: new Date(), method: 'virement' }),
      } });
      const terminal = await first.invoices.findById(original._id).lean();
      const following = snapshot({ kind: 'option' });
      const nextCounters = crashAfter(second.counters, 'updateOne', isAllocated, 'next response lost');
      await expect(new InvoiceNumberingService(second.invoices, nextCounters).write(following)).rejects.toThrow('next response lost');
      resume.release();
      expect(await outcome).toMatchObject({ value: { status } });
      expect(await first.invoices.findById(original._id).lean()).toEqual(terminal);
      expect(await first.invoices.findById(following._id).lean()).toMatchObject({ number: 'SM-2026-0002' });
      expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 2, pendingInvoice: null });
    } finally { resume.release(); await outcome; }
  }, 15_000);

  it('un instantané divergent sur le même ID ne réécrit ni pièce ni compteur', async () => {
    const original = snapshot({ kind: 'option' });
    const numbering = new InvoiceNumberingService(first.invoices, first.counters);
    await numbering.write(original);
    const before = await first.invoices.findById(original._id).lean();
    await expect(new InvoiceNumberingService(second.invoices, second.counters).write({ ...original, amountCents: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(await first.invoices.findById(original._id).lean()).toEqual(before);
    expect(await first.counters.findById('invoice:2026').lean()).toMatchObject({ seq: 1, pendingInvoice: null });
  });
});
