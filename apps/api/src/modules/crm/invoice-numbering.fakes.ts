import { Types } from 'mongoose';
import type { InvoiceSnapshot } from '@sm/db';
import { vi } from 'vitest';

export type Row = Record<string, unknown>;

export function copy<T>(value: T): T {
  if (value instanceof Date) return new Date(value) as T;
  if (value instanceof Types.ObjectId) return new Types.ObjectId(value.toHexString()) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
  }
  return value;
}

function field(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((item, key) =>
    item && typeof item === 'object' ? (item as Row)[key] : undefined, row);
}

function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = field(row, key);
    if (expected === null) return actual === null || actual === undefined;
    return actual instanceof Types.ObjectId || expected instanceof Types.ObjectId
      ? String(actual) === String(expected) : actual === expected;
  });
}

export function invoiceSnapshot(id = '507f1f77bcf86cd799439012'): InvoiceSnapshot {
  return {
    _id: new Types.ObjectId(id), tenantId: new Types.ObjectId('507f1f77bcf86cd799439011'),
    kind: 'abonnement', label: 'Abonnement septembre',
    period: { start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z') },
    amountCents: 14900, vat: { ratePercent: 20, amountsAre: 'ht' },
    status: 'envoyee', issuedAt: new Date('2026-09-01T00:00:00Z'),
    dueAt: new Date('2026-09-01T00:00:00Z'), paidAt: null, method: null,
  };
}

export function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

type FakeRead<T> = { read(preference: string): FakeRead<T>; lean(): Promise<T> };
function query<T>(read: () => Promise<T>, preferences: string[]): FakeRead<T> {
  const chain: FakeRead<T> = { read: (preference) => { preferences.push(preference); return chain; }, lean: read };
  return chain;
}

/** Uniquement primitives Mongo utilisées par la numérotation, avec captures isolées. */
export function numberingStore() {
  const state = { counter: null as Row | null, invoices: new Map<string, Row>() };
  const readPreferences: string[] = [];
  const hooks: {
    afterCounterRead?: (row: Row | null) => Promise<void>;
    afterInvoiceRead?: (row: Row | null) => Promise<void>;
    beforeInvoiceInsert?: (row: Row) => Promise<void>;
    afterInvoiceInsert?: (row: Row) => Promise<void>;
    afterClaim?: () => Promise<void>;
    afterClear?: () => Promise<void>;
    loseEveryClaim?: boolean;
    duplicateOnInit?: boolean;
  } = {};
  const counters = {
    findById: vi.fn((_id: string) => query(async () => {
      const captured = copy(state.counter?._id === _id ? state.counter : null);
      await hooks.afterCounterRead?.(captured);
      return captured;
    }, readPreferences)),
    updateOne: vi.fn(async (query: Row, update: Row, options?: Row) => {
      if (update.$setOnInsert) {
        if (!state.counter) {
          state.counter = copy(update.$setOnInsert as Row);
          if (hooks.duplicateOnInit) throw Object.assign(new Error('duplicate _id'), { code: 11000 });
        }
        return { matchedCount: 1, modifiedCount: 0 };
      }
      if (!state.counter || !matches(state.counter, query) || (update.$inc && hooks.loseEveryClaim)) {
        return { matchedCount: 0, modifiedCount: 0 };
      }
      if (options?.upsert) throw new Error('Only counter initialization may upsert');
      Object.assign(state.counter, copy(update.$set as Row));
      if (update.$inc) {
        for (const [key, amount] of Object.entries(update.$inc as Row)) {
          state.counter[key] = Number(state.counter[key]) + Number(amount);
        }
        await hooks.afterClaim?.();
      }
      if ((update.$set as Row)?.pendingInvoice === null) await hooks.afterClear?.();
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
  const invoices = {
    findById: vi.fn((id: unknown) => query(async () => {
      const captured = copy(state.invoices.get(String(id)) ?? null);
      await hooks.afterInvoiceRead?.(captured);
      return captured;
    }, readPreferences)),
    updateOne: vi.fn(async (query: Row, update: Row, options: Row) => {
      if (Object.keys(update).some((key) => key !== '$setOnInsert') || options.timestamps !== false) {
        throw new Error('Materialization must not update existing invoices or timestamps');
      }
      const insert = copy(update.$setOnInsert as Row);
      await hooks.beforeInvoiceInsert?.(insert);
      const id = String(query._id);
      if (state.invoices.has(id)) return { matchedCount: 1, modifiedCount: 0 };
      if ([...state.invoices.values()].some((row) => row.number === insert.number)) {
        throw Object.assign(new Error('duplicate number'), { code: 11000 });
      }
      state.invoices.set(id, insert);
      await hooks.afterInvoiceInsert?.(insert);
      return { matchedCount: 0, modifiedCount: 0, upsertedId: query._id };
    }),
  };
  return { state, hooks, counters, invoices, readPreferences };
}
