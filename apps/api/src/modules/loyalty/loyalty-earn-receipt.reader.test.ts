import { randomUUID } from 'node:crypto';
import type { LoyaltyDb } from '@sm/loyalty';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readLoyaltyEarnReceipt } from './loyalty-earn-receipt.reader';

const scoped = vi.hoisted(() => ({ execute: vi.fn(), tenant: vi.fn() }));
vi.mock('@sm/loyalty', async importOriginal => ({
  ...await importOriginal<typeof import('@sm/loyalty')>(),
  withLoyaltyTenant: (db: unknown, tenant: string, work: (tx: { execute: typeof scoped.execute }) => unknown) => {
    scoped.tenant(db, tenant);
    return work({ execute: scoped.execute });
  },
}));

const db = {} as LoyaltyDb;
const input = { tenantRef: 'tenant', clientId: randomUUID(), memberId: randomUUID(), operationId: randomUUID() };

describe('earn receipt reader trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scoped.execute.mockResolvedValue({ rows: [{ proof: { receipts: [], operations: [], ledger: [] } }] });
  });

  it.each([
    null, {}, { ...input, tenantRef: '' }, { ...input, tenantRef: ' tenant ' },
    { ...input, tenantRef: 't'.repeat(161) }, { ...input, clientId: 'invalid' },
    { ...input, clientId: `${input.clientId}\n` }, { ...input, memberId: `${input.memberId}\n` },
    { ...input, operationId: `${input.operationId}\n` }, { ...input, operationId: 1 },
    { ...input, privateField: 'never-forward' },
  ])('rejects invalid input before opening a scoped transaction %#', async invalid => {
    await expect(readLoyaltyEarnReceipt(db, invalid as typeof input)).rejects.toThrow('Invalid loyalty earn receipt observation');
    expect(scoped.tenant).not.toHaveBeenCalled();
    expect(scoped.execute).not.toHaveBeenCalled();
  });

  it('uses one evidence statement under the required tenant scope', async () => {
    expect(await readLoyaltyEarnReceipt(db, input)).toEqual({ kind: 'not_observed' });
    expect(scoped.tenant).toHaveBeenCalledExactlyOnceWith(db, input.tenantRef);
    expect(scoped.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates database failures instead of calling them missing proof', async () => {
    const failure = new Error('Fixture transport failure');
    scoped.execute.mockRejectedValue(failure);
    await expect(readLoyaltyEarnReceipt(db, input)).rejects.toBe(failure);
  });

  it.each([null, {}, { receipts: [], operations: [] }, { receipts: [], operations: [], ledger: [], unexpected: true }])(
    'refuses unreadable evidence without leaking the raw snapshot %#', async proof => {
      scoped.execute.mockResolvedValue({ rows: [{ proof }] });
      expect(await readLoyaltyEarnReceipt(db, input)).toEqual({ kind: 'conflict' });
    },
  );

  it.each([{ rows: [] }, { rows: [{ proof: {} }, { proof: {} }] }])('refuses a missing or duplicated snapshot row %#', async ({ rows }) => {
    scoped.execute.mockResolvedValue({ rows });
    expect(await readLoyaltyEarnReceipt(db, input)).toEqual({ kind: 'conflict' });
  });
});
