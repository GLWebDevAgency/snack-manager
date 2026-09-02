import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  assertLoyaltyMigrationRoleSafe,
  grantLoyaltyRuntimeRole,
  runtimeDatabaseRole,
} from './migration-role';

function safeProbe(roleName = 'snackmanager_staging_app') {
  return {
    role_name: roleName,
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

describe('rôle runtime des migrations fidélité', () => {
  it('est obligatoire en production et facultatif en local', () => {
    expect(() => runtimeDatabaseRole({ NODE_ENV: 'production' })).toThrow(/manquant/);
    expect(runtimeDatabaseRole({ NODE_ENV: 'test' })).toBeNull();
    expect(
      runtimeDatabaseRole({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_ROLE: ' snackmanager_staging_app ',
      }),
    ).toBe('snackmanager_staging_app');
  });

  it.each(['postgres;DROP DATABASE railway', 'UPPERCASE', 'ab', 'role-with-dash'])(
    'refuse un identifiant SQL non sûr : %s',
    (role) => expect(() => runtimeDatabaseRole({ DATABASE_RUNTIME_ROLE: role })).toThrow(/invalide/),
  );

  it('sonde le rôle puis accorde uniquement accès au schéma et CRUD', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [safeProbe()],
      })
      .mockResolvedValueOnce({ rowCount: null, rows: [] });
    const pool = { query } as unknown as Pick<Pool, 'query'>;

    await grantLoyaltyRuntimeRole(pool, 'snackmanager_staging_app');

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[1]).toEqual(['snackmanager_staging_app']);
    const grants = String(query.mock.calls[1]?.[0]);
    expect(grants).toMatch(/GRANT USAGE ON SCHEMA loyalty/);
    expect(grants).toMatch(/GRANT CONNECT ON DATABASE "railway"/);
    expect(grants).toMatch(/drizzle\.__drizzle_loyalty_migrations/);
    expect(grants).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/);
    expect(grants).toMatch(/ALTER DEFAULT PRIVILEGES/);
    expect(grants).not.toMatch(/SUPERUSER|BYPASSRLS|GRANT CREATE/);
  });

  it.each([
    { ...safeProbe('snackmanager_staging_app'), rolsuper: true },
    { ...safeProbe('snackmanager_staging_app'), rolbypassrls: true },
    { ...safeProbe('snackmanager_staging_app'), rolcreaterole: true },
    { ...safeProbe('snackmanager_staging_app'), has_role_membership: true },
    { ...safeProbe('snackmanager_staging_app'), migration_role: 'snackmanager_staging_app' },
  ])('refuse un rôle absent ou privilégié', async (role) => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [role] });
    const pool = { query } as unknown as Pick<Pool, 'query'>;
    await expect(grantLoyaltyRuntimeRole(pool, 'snackmanager_staging_app')).rejects.toThrow(
      /absents ou privilégiés/,
    );
  });

  it('refuse le superuser comme identité de migration avant tout DDL', async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 1,
      rows: [{ ...safeProbe(), migration_role: 'postgres', migration_rolsuper: true }],
    });
    const pool = { query } as unknown as Pick<Pool, 'query'>;
    await expect(
      assertLoyaltyMigrationRoleSafe(pool, 'snackmanager_staging_app'),
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
        assertLoyaltyMigrationRoleSafe(pool, 'snackmanager_staging_app'),
      ).rejects.toThrow(/absents ou privilégiés/);
      expect(query).toHaveBeenCalledOnce();
    },
  );

  it('active aussi le garde sur Railway staging', () => {
    expect(() => runtimeDatabaseRole({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toThrow(/manquant/);
  });
});
