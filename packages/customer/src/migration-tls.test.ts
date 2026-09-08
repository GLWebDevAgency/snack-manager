import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { assertCustomerMigrationConnectionEncrypted } from './migration-tls';

describe('transport des migrations identité client', () => {
  it('n impose pas TLS aux bases locales de développement', async () => {
    const query = vi.fn();
    await expect(
      assertCustomerMigrationConnectionEncrypted(
        { query } as unknown as Pick<Pool, 'query'>,
        { NODE_ENV: 'test' },
      ),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('accepte une connexion Railway TLS 1.3', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }],
    });
    await expect(
      assertCustomerMigrationConnectionEncrypted(
        { query } as unknown as Pick<Pool, 'query'>,
        { RAILWAY_ENVIRONMENT_ID: 'env_staging' },
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    { rowCount: 1, rows: [{ ssl: false, version: null, cipher: null }] },
    { rowCount: 1, rows: [{ ssl: true, version: 'TLSv1.1', cipher: 'ancien' }] },
    { rowCount: 0, rows: [] },
  ])('refuse une sonde déployée non sûre', async (result) => {
    const query = vi.fn().mockResolvedValue(result);
    await expect(
      assertCustomerMigrationConnectionEncrypted(
        { query } as unknown as Pick<Pool, 'query'>,
        { NODE_ENV: 'production' },
      ),
    ).rejects.toThrow(/TLS 1\.2/);
  });
});

