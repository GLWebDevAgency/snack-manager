import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  assertSupplyMigrationRoleSafe,
  grantSupplyRuntimeRole,
  runtimeDatabaseRole,
} from './migration-role';

function safeProbe() {
  return {
    role_name: 'snackmanager_staging_app',
    migration_role: 'snackmanager_staging_migrator',
    migration_rolsuper: false,
    migration_rolbypassrls: false,
    migration_rolcreaterole: false,
    migration_rolcreatedb: false,
    migration_rolreplication: false,
    migration_has_role_membership: false,
    migration_search_path: 'public, pg_catalog',
    database_name: 'railway',
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

describe('rôle runtime des migrations supply', () => {
  it('est obligatoire en production et validé comme identifiant', () => {
    expect(() => runtimeDatabaseRole({ NODE_ENV: 'production' })).toThrow(/manquant/);
    expect(runtimeDatabaseRole({ NODE_ENV: 'development' })).toBeNull();
    expect(() => runtimeDatabaseRole({ DATABASE_RUNTIME_ROLE: 'app;drop' })).toThrow(/invalide/);
  });

  it('sonde le rôle puis accorde uniquement le CRUD public', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [safeProbe()],
      })
      .mockResolvedValueOnce({ rowCount: null, rows: [] });
    const pool = { query } as unknown as Pick<Pool, 'query'>;

    await grantSupplyRuntimeRole(pool, 'snackmanager_staging_app');

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(['snackmanager_staging_app']);
    const grants = String(query.mock.calls[1]?.[0]);
    expect(grants).toMatch(/GRANT USAGE ON SCHEMA public/);
    expect(grants).toMatch(/GRANT CONNECT ON DATABASE "railway"/);
    expect(grants).toMatch(/drizzle\.__drizzle_migrations/);
    expect(grants).toMatch(/ALTER DEFAULT PRIVILEGES/);
    expect(grants).not.toMatch(/SUPERUSER|BYPASSRLS|GRANT CREATE/);
  });

  it('refuse un rôle privilégié avant tout GRANT', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ ...safeProbe(), rolbypassrls: true }],
    });
    const pool = { query } as unknown as Pick<Pool, 'query'>;
    await expect(grantSupplyRuntimeRole(pool, 'snackmanager_staging_app')).rejects.toThrow(
      /absents ou privilégiés/,
    );
    expect(query).toHaveBeenCalledOnce();
  });

  it('refuse le superuser comme identité de migration avant tout DDL', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ ...safeProbe(), migration_role: 'postgres', migration_rolsuper: true }],
    });
    const pool = { query } as unknown as Pick<Pool, 'query'>;
    await expect(
      assertSupplyMigrationRoleSafe(pool, 'snackmanager_staging_app'),
    ).rejects.toThrow(/absents ou privilégiés/);
    expect(query).toHaveBeenCalledOnce();
  });

  it.each(['"$user", public', 'public, attacker, pg_catalog', 'pg_catalog, public'])(
    'refuse un search_path migrateur non cloisonné : %s',
    async (migrationSearchPath) => {
      const query = vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ ...safeProbe(), migration_search_path: migrationSearchPath }],
      });
      const pool = { query } as unknown as Pick<Pool, 'query'>;

      await expect(
        assertSupplyMigrationRoleSafe(pool, 'snackmanager_staging_app'),
      ).rejects.toThrow(/absents ou privilégiés/);
      expect(query).toHaveBeenCalledOnce();
    },
  );

  it('active aussi le garde sur Railway staging', () => {
    expect(() => runtimeDatabaseRole({ RAILWAY_ENVIRONMENT_ID: 'env_staging' })).toThrow(/manquant/);
  });
});
