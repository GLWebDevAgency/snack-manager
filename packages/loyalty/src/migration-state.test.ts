import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { assertLoyaltyMigrationState } from './migration-state';

const expected = [
  { hash: 'hash-a', folderMillis: 101 },
  { hash: 'hash-b', folderMillis: 202 },
];

function poolWith(rows: Array<Record<string, unknown>>): Pick<Pool, 'query'> {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: rows.length, rows }),
  } as unknown as Pick<Pool, 'query'>;
}

describe('état des migrations fidélité', () => {
  it('accepte uniquement le journal exact et ordonné', async () => {
    await expect(
      assertLoyaltyMigrationState(
        poolWith([
          { hash: 'hash-a', created_at: '101' },
          { hash: 'hash-b', created_at: '202' },
        ]),
        expected,
      ),
    ).resolves.toBeUndefined();
  });

  it('refuse une migration manquante', async () => {
    await expect(
      assertLoyaltyMigrationState(poolWith([{ hash: 'hash-a', created_at: '101' }]), expected),
    ).rejects.toThrow(/ne correspond pas/);
  });

  it('tolère une migration future pour préserver le rollback code', async () => {
    await expect(
      assertLoyaltyMigrationState(
        poolWith([
          { hash: 'hash-a', created_at: '101' },
          { hash: 'hash-b', created_at: '202' },
          { hash: 'hash-c', created_at: '303' },
        ]),
        expected,
      ),
    ).resolves.toBeUndefined();
  });

  it('refuse un hash ou un horodatage incohérent', async () => {
    await expect(
      assertLoyaltyMigrationState(
        poolWith([
          { hash: 'altéré', created_at: '101' },
          { hash: 'hash-b', created_at: '202' },
        ]),
        expected,
      ),
    ).rejects.toThrow(/incohérent/);
  });
});
