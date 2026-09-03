import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPostgresConnectionEncrypted,
  connectionTlsSqlForTests,
} from './connection-tls';

function clientWith(rows: Array<Record<string, unknown>>, rowCount = rows.length) {
  const response = {
    command: 'SELECT',
    fields: [],
    oid: 0,
    rowCount,
    rows,
  } as QueryResult<Record<string, unknown>>;
  return {
    query: vi.fn().mockResolvedValue(response),
  } as unknown as Pick<PoolClient, 'query'>;
}

describe('transport TLS PostgreSQL du bootstrap', () => {
  it('qualifie l’égalité avant toute neutralisation du search_path public-first', () => {
    expect(connectionTlsSqlForTests).toContain('OPERATOR(pg_catalog.=)');
    expect(connectionTlsSqlForTests).toContain('pg_catalog.pg_backend_pid()');
  });

  it.each(['TLSv1.2', 'TLSv1.3'])('accepte une session %s chiffrée', async (version) => {
    await expect(
      assertPostgresConnectionEncrypted(
        clientWith([{ ssl: true, version, cipher: 'TLS_AES_256_GCM_SHA384' }]),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    { label: 'sans SSL', rows: [{ ssl: false, version: null, cipher: null }], count: 1 },
    {
      label: 'TLS 1.1',
      rows: [{ ssl: true, version: 'TLSv1.1', cipher: 'ancien' }],
      count: 1,
    },
    {
      label: 'cipher vide',
      rows: [{ ssl: true, version: 'TLSv1.3', cipher: '   ' }],
      count: 1,
    },
    { label: 'ligne absente', rows: [], count: 0 },
  ])('refuse une session $label', async ({ rows, count }) => {
    await expect(assertPostgresConnectionEncrypted(clientWith(rows, count))).rejects.toThrow(
      /TLS 1\.2/,
    );
  });
});
