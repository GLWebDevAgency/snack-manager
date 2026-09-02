import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { assertSupplyMigrationState } from './migration-state';

const expected = [
  { hash: 'hash-a', folderMillis: 101 },
  { hash: 'hash-b', folderMillis: 202 },
];

function poolWith(rows: Array<Record<string, unknown>>): Pick<Pool, 'query'> {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
  } as unknown as Pick<Pool, 'query'>;
}

describe('état des migrations supply', () => {
  it('accepte uniquement le journal exact et ordonné', async () => {
    await expect(
      assertSupplyMigrationState(
        poolWith([
          { hash: 'hash-a', created_at: '101' },
          { hash: 'hash-b', created_at: '202' },
        ]),
        expected,
      ),
    ).resolves.toBeUndefined();
  });

  it('refuse une migration absente ou altérée', async () => {
    await expect(
      assertSupplyMigrationState(poolWith([{ hash: 'hash-a', created_at: '101' }]), expected),
    ).rejects.toThrow(/ne correspond pas/);
    await expect(
      assertSupplyMigrationState(
        poolWith([
          { hash: 'hash-a', created_at: '101' },
          { hash: 'altéré', created_at: '202' },
        ]),
        expected,
      ),
    ).rejects.toThrow(/incohérent/);
  });
});
