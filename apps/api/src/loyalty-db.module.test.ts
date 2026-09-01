import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  assertDeployedPostgresReady,
  assertLoyaltyPostgresRoleIsRlsSafe,
} from './loyalty-db.module';

type RoleProbeResult = {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
};

function safeRole(roleName = 'snackmanager_app'): Record<string, unknown> {
  return {
    role_name: roleName,
    rolsuper: false,
    rolbypassrls: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    has_role_membership: false,
    can_create_database_objects: false,
    can_create_public_schema: false,
    can_create_loyalty_schema: false,
    owns_application_objects: false,
  };
}

function poolReturning(result: RoleProbeResult): {
  pool: Pick<Pool, 'query'>;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn().mockResolvedValue(result);
  return { pool: { query } as unknown as Pick<Pool, 'query'>, query };
}

describe('rôle PostgreSQL du module fidélité', () => {
  it('ne sonde pas PostgreSQL hors production', async () => {
    const query = vi.fn().mockRejectedValue(new Error('ne doit pas être appelée'));
    const pool = { query } as unknown as Pick<Pool, 'query'>;

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, { NODE_ENV: 'test' }),
    ).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('autorise en production un rôle ordinaire confirmé par PostgreSQL', async () => {
    const { pool, query } = poolReturning({
      rowCount: 1,
      rows: [safeRole()],
    });

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: 'snackmanager_app',
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toMatch(/pg_catalog\.pg_roles/);
    expect(query.mock.calls[0]?.[0]).toMatch(/current_user/);
  });

  it.each([
    ['SUPERUSER', 'postgres', { ...safeRole('postgres'), rolsuper: true }],
    ['BYPASSRLS', 'unsafe_app', { ...safeRole('unsafe_app'), rolbypassrls: true }],
  ])('refuse un rôle %s même si la sonde réussit', async (_label, roleName, role) => {
    const { pool } = poolReturning({ rowCount: 1, rows: [role] });

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: roleName,
      }),
    ).rejects.toThrow(/privilèges incompatibles/);
  });

  it.each([
    ['aucun rôle', { rowCount: 0, rows: [] }],
    [
      'plusieurs rôles',
      {
        rowCount: 2,
        rows: [
          { role_name: 'app_a', rolsuper: false, rolbypassrls: false },
          { role_name: 'app_b', rolsuper: false, rolbypassrls: false },
        ],
      },
    ],
    [
      'attribut manquant',
      { rowCount: 1, rows: [{ role_name: 'app', rolsuper: false }] },
    ],
    [
      'attribut non booléen',
      {
        rowCount: 1,
        rows: [{ role_name: 'app', rolsuper: 'false', rolbypassrls: false }],
      },
    ],
  ] satisfies Array<[string, RoleProbeResult]>)('échoue fermé si la sonde renvoie %s', async (
    _label,
    result,
  ) => {
    const { pool } = poolReturning(result);

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: 'snackmanager_app',
      }),
    ).rejects.toThrow(/Impossible de confirmer le rôle PostgreSQL/);
  });

  it('propage une erreur de sonde et bloque donc le démarrage', async () => {
    const failure = new Error('PostgreSQL indisponible');
    const query = vi.fn().mockRejectedValue(failure);
    const pool = { query } as unknown as Pick<Pool, 'query'>;

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: 'snackmanager_app',
      }),
    ).rejects.toBe(failure);
  });

  it('active la sonde sur Railway staging même sans NODE_ENV production', async () => {
    const { pool, query } = poolReturning({
      rowCount: 1,
      rows: [safeRole('snackmanager_staging_app')],
    });

    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'development',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        DATABASE_RUNTIME_ROLE: 'snackmanager_staging_app',
      }),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
  });

  it('refuse un rôle sûr mais différent de celui déclaré', async () => {
    const { pool } = poolReturning({
      rowCount: 1,
      rows: [safeRole('autre_app')],
    });
    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, {
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: 'snackmanager_app',
      }),
    ).rejects.toThrow(/n utilise pas DATABASE_RUNTIME_ROLE/);
  });

  it('refuse un déploiement sans nom de rôle attendu avant la sonde', async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pick<Pool, 'query'>;
    await expect(
      assertLoyaltyPostgresRoleIsRlsSafe(pool, { RAILWAY_ENVIRONMENT_ID: 'env_123' }),
    ).rejects.toThrow(/DATABASE_RUNTIME_ROLE/);
    expect(query).not.toHaveBeenCalled();
  });

  it('vérifie les deux journaux de migration après le rôle déployé', async () => {
    const { pool } = poolReturning({
      rowCount: 1,
      rows: [safeRole()],
    });
    const supply = vi.fn().mockResolvedValue(undefined);
    const loyalty = vi.fn().mockResolvedValue(undefined);

    await expect(
      assertDeployedPostgresReady(
        pool,
        { NODE_ENV: 'production', DATABASE_RUNTIME_ROLE: 'snackmanager_app' },
        { supply, loyalty },
      ),
    ).resolves.toBeUndefined();
    expect(supply).toHaveBeenCalledOnce();
    expect(loyalty).toHaveBeenCalledOnce();
  });

  it('bloque le démarrage si le schéma runtime n est pas à jour', async () => {
    const { pool } = poolReturning({
      rowCount: 1,
      rows: [safeRole()],
    });
    const failure = new Error('schéma supply en retard');

    await expect(
      assertDeployedPostgresReady(
        pool,
        { RAILWAY_ENVIRONMENT_NAME: 'staging', DATABASE_RUNTIME_ROLE: 'snackmanager_app' },
        {
          supply: vi.fn().mockRejectedValue(failure),
          loyalty: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);
  });
});
