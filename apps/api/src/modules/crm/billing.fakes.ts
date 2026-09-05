import { Types, type Model } from 'mongoose';
import type { Counter, Invoice, InvoiceIssuance } from '@sm/db';
import type { Row } from './admin.fakes';

/** Mongo transactionless en mémoire : opérations atomiques, résultats détachés.
 * Ne remplace pas les tests sur Mongo réel ; rejette les opérateurs inconnus.
 */
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
}

const deep = (row: Row, path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
  value !== null && typeof value === 'object' ? (value as Row)[key] : undefined, row);

function equal(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) return String(a) === String(b);
  if (a instanceof Date || b instanceof Date) return Number(new Date(a as Date)) === Number(new Date(b as Date));
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or' || key === '$and') {
      const checks = (expected as Row[]).map((part) => matches(row, part));
      return key === '$or' ? checks.some(Boolean) : checks.every(Boolean);
    }
    const actual = deep(row, key);
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof Types.ObjectId)) {
      const entries = Object.entries(expected);
      if (entries.some(([operator]) => operator.startsWith('$'))) {
        return entries.every(([operator, value]) => {
          if (operator === '$in') return (value as unknown[]).some((item) => equal(actual, item));
          if (operator === '$ne') return !equal(actual, value);
          if (operator === '$exists') return (actual !== undefined) === Boolean(value);
          throw new Error(`Opérateur de filtre non simulé : ${operator}`);
        });
      }
    }
    return equal(actual, expected);
  });
}

function setPath(row: Row, path: string, value: unknown, unset = false): void {
  const parts = path.split('.');
  let target = row;
  for (const key of parts.slice(0, -1)) {
    if (target[key] === null || typeof target[key] !== 'object') {
      if (unset) return;
      target[key] = {};
    }
    target = target[key] as Row;
  }
  const key = parts[parts.length - 1]!;
  if (unset) delete target[key];
  else target[key] = clone(value);
}

type Update = { $set?: Row; $setOnInsert?: Row; $unset?: Row; $push?: Row; $inc?: Record<string, number> };
type Options = { upsert?: boolean; new?: boolean; returnDocument?: string; runValidators?: boolean; timestamps?: boolean };

function mutate(row: Row, update: Update, inserted: boolean): void {
  for (const [operator, fields] of Object.entries(update)) {
    if (operator === '$setOnInsert' && !inserted) continue;
    if (!['$set', '$setOnInsert', '$unset', '$push', '$inc'].includes(operator)) {
      throw new Error(`Opérateur d’écriture non simulé : ${operator}`);
    }
    for (const [path, value] of Object.entries(fields as Row)) {
      if (operator === '$unset') setPath(row, path, undefined, true);
      else if (operator === '$inc') setPath(row, path, Number(deep(row, path) ?? 0) + Number(value));
      else if (operator === '$push') setPath(row, path, [...(deep(row, path) as unknown[] ?? []), clone(value)]);
      else setPath(row, path, value);
    }
  }
}

/** La commande ne s’exécute qu’à await/lean, comme une Query Mongoose. */
class Result<T> implements PromiseLike<T> {
  private promise: Promise<T> | undefined;
  constructor(private readonly execute: () => T) {}
  read(_preference: string): this { return this; }
  lean(): Promise<T> {
    this.promise ??= Promise.resolve().then(() => clone(this.execute()));
    return this.promise;
  }
  then<A = T, B = never>(yes?: ((value: T) => A | PromiseLike<A>) | null, no?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.lean().then(yes, no);
  }
  catch<A = never>(no: (reason: unknown) => A | PromiseLike<A>): Promise<T | A> {
    return this.lean().catch(no);
  }
}

class ListResult extends Result<Row[]> {
  private criteria: Record<string, 1 | -1> = {};
  private take = Number.POSITIVE_INFINITY;
  constructor(read: () => Row[]) {
    super(() => [...read()].sort((a, b) => {
      for (const [path, direction] of Object.entries(this.criteria)) {
        const x = deep(a, path);
        const y = deep(b, path);
        const comparison = x instanceof Date || y instanceof Date
          ? Number(new Date(x as Date)) - Number(new Date(y as Date))
          : String(x).localeCompare(String(y));
        if (comparison !== 0) return comparison * direction;
      }
      return 0;
    }).slice(0, this.take));
  }
  sort(criteria: Record<string, 1 | -1>): this { this.criteria = criteria; return this; }
  limit(take: number): this { this.take = take; return this; }
}

class MoneyCollection<T> {
  readonly rows: Row[] = [];
  failNextCreate = false;
  /** Insert réussi côté moteur, réponse perdue côté appelant. */
  failAfterNextCreate = false;
  constructor(private readonly unique: readonly string[] = ['_id']) {}

  find(filter: Row = {}, _projection?: Row): ListResult {
    return new ListResult(() => this.rows.filter((row) => matches(row, filter)));
  }
  findOne(filter: Row): Result<Row | null> {
    return new Result(() => this.rows.find((row) => matches(row, filter)) ?? null);
  }
  findById(id: unknown): Result<Row | null> { return this.findOne({ _id: id }); }
  async countDocuments(filter: Row = {}): Promise<number> { return this.rows.filter((row) => matches(row, filter)).length; }

  private assertUnique(candidate: Row, original?: Row): void {
    for (const path of this.unique) {
      if (this.rows.some((row) => row !== original && equal(deep(row, path), deep(candidate, path)))) {
        throw Object.assign(new Error(`E11000 duplicate key ${path}`), { code: 11000, keyPattern: { [path]: 1 } });
      }
    }
  }

  private insert(row: Row): Row {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('écriture refusée par le moteur');
    }
    const created = clone({ _id: new Types.ObjectId(), ...row });
    this.assertUnique(created);
    this.rows.push(created);
    if (this.failAfterNextCreate) {
      this.failAfterNextCreate = false;
      throw new Error('réponse perdue après écriture');
    }
    return created;
  }

  private change(filter: Row, update: Update, options: Options): { before: Row | null; after: Row | null; inserted: boolean; modified: boolean } {
    const row = this.rows.find((candidate) => matches(candidate, filter));
    if (!row && !options.upsert) return { before: null, after: null, inserted: false, modified: false };
    if (!row) {
      const candidate: Row = {};
      for (const [path, value] of Object.entries(filter)) {
        if (!path.startsWith('$') && (value == null || typeof value !== 'object' || value instanceof Date || value instanceof Types.ObjectId)) setPath(candidate, path, value);
      }
      mutate(candidate, update, true);
      return { before: null, after: this.insert(candidate), inserted: true, modified: false };
    }
    const before = clone(row);
    const candidate = clone(row);
    mutate(candidate, update, false);
    this.assertUnique(candidate, row);
    const modified = !equal(before, candidate);
    for (const key of Object.keys(row)) delete row[key];
    Object.assign(row, candidate);
    return { before, after: row, inserted: false, modified };
  }

  findOneAndUpdate(filter: Row, update: Update, options: Options = {}): Result<Row | null> {
    return new Result(() => {
      const result = this.change(filter, update, options);
      return options.new || options.returnDocument === 'after' ? result.after : result.before;
    });
  }
  updateOne(filter: Row, update: Update, options: Options = {}): Result<{ acknowledged: true; matchedCount: number; modifiedCount: number; upsertedCount: number; upsertedId: unknown }> {
    return new Result(() => {
      const result = this.change(filter, update, options);
      return { acknowledged: true, matchedCount: result.before ? 1 : 0, modifiedCount: Number(result.modified), upsertedCount: Number(result.inserted), upsertedId: result.inserted ? result.after?._id : null };
    });
  }
  async create(row: Row): Promise<{ toObject: () => Row }> {
    const result = clone(this.insert(row));
    return { toObject: () => clone(result) };
  }
  asModel(): Model<T> { return this as unknown as Model<T>; }
}

export class FakeInvoices extends MoneyCollection<Invoice> {
  constructor() { super(['_id', 'number']); }
}
export class FakeIssuances extends MoneyCollection<InvoiceIssuance> {}
export class FakeCounters extends MoneyCollection<Counter> {
  seqOf(id: string): number { return Number(this.rows.find((row) => row._id === id)?.seq ?? 0); }
}
