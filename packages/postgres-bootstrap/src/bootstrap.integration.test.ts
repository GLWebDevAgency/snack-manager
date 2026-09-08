import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle, NodePgDriver } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { grantCustomerRuntimeRole } from '../../customer/src/migration-role';
import {
  PostgresBootstrapError,
  checkPostgresBootstrap,
  repairPostgresBootstrap,
} from './bootstrap';

const adminUrl = process.env.POSTGRES_BOOTSTRAP_TEST_DATABASE_URL;
const integration = adminUrl ? describe : describe.skip;
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const databaseName = `snackmanager_bootstrap_test_${suffix}`;
const freshDatabaseName = `snackmanager_bootstrap_fresh_${suffix}`;
const migrationRole = `bootstrap_mig_${suffix}`;
const runtimeRole = `bootstrap_app_${suffix}`;
const legacyRole = `bootstrap_legacy_${suffix}`;
const migrationPassword = randomUUID();
const runtimePassword = randomUUID();

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(value)) throw new Error('Identifiant de test invalide');
  return `"${value}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseUrl(raw: string, database: string, role?: string, password?: string): string {
  const url = new URL(raw);
  url.pathname = `/${database}`;
  if (role) url.username = role;
  if (password) url.password = password;
  return url.toString();
}

/**
 * Le PostgreSQL Homebrew local n'expose pas TLS. La sonde elle-même est
 * couverte séparément ; ce proxy ne neutralise que pg_stat_ssl afin que le
 * scénario catalogue/transactions reste un vrai test PostgreSQL.
 */
function bootstrapPool(pool: Pool): Pick<Pool, 'connect'> {
  return {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (async (...args: unknown[]) => {
          if (String(args[0]).includes('FROM pg_catalog.pg_stat_ssl')) {
            return {
              command: 'SELECT',
              rowCount: 1,
              oid: 0,
              fields: [],
              rows: [
                { ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' },
              ],
            } as QueryResult;
          }
          return await (
            client.query as unknown as (...queryArgs: unknown[]) => Promise<QueryResult>
          ).apply(client, args);
        }) as PoolClient['query'],
        release: () => client.release(),
      } as PoolClient;
    },
  } as Pick<Pool, 'connect'>;
}

integration('bootstrap PostgreSQL — base réelle', () => {
  let rootPool: Pool | undefined;
  let adminPool: Pool | undefined;
  let migrationPool: Pool | undefined;
  let runtimePool: Pool | undefined;
  let freshAdminPool: Pool | undefined;
  let freshMigrationPool: Pool | undefined;

  afterAll(async () => {
    await runtimePool?.end();
    await migrationPool?.end();
    await adminPool?.end();
    await freshMigrationPool?.end();
    await freshAdminPool?.end();
    if (!rootPool) return;
    for (const database of [databaseName, freshDatabaseName]) {
      await rootPool.query(
        `SELECT pg_catalog.pg_terminate_backend(pid)
           FROM pg_catalog.pg_stat_activity
          WHERE datname = $1 AND pid <> pg_catalog.pg_backend_pid()`,
        [database],
      );
      await rootPool.query(`DROP DATABASE IF EXISTS ${identifier(database)}`);
    }
    for (const role of [migrationRole, runtimeRole, legacyRole]) {
      await rootPool.query(`DROP ROLE IF EXISTS ${identifier(role)}`);
    }
    await rootPool.end();
  });

  it(
    'répare le legs, ne touche pas le hors-périmètre et devient idempotent',
    async () => {
      const base = new URL(adminUrl!);
      if (!['127.0.0.1', 'localhost'].includes(base.hostname)) {
        throw new Error('Le test bootstrap réel refuse toute base PostgreSQL distante');
      }

      rootPool = new Pool({ connectionString: adminUrl, max: 1 });
      await rootPool.query(
        `CREATE ROLE ${identifier(migrationRole)} LOGIN PASSWORD ${literal(migrationPassword)}
           NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      await rootPool.query(
        `CREATE ROLE ${identifier(runtimeRole)} LOGIN PASSWORD ${literal(runtimePassword)}
           NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      await rootPool.query(
        `CREATE ROLE ${identifier(legacyRole)} NOLOGIN
           NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      await rootPool.query(`CREATE DATABASE ${identifier(databaseName)}`);
      await rootPool.query(`CREATE DATABASE ${identifier(freshDatabaseName)}`);

      freshAdminPool = new Pool({
        connectionString: databaseUrl(adminUrl!, freshDatabaseName),
        max: 1,
      });
      await freshAdminPool.query(
        `GRANT CONNECT, CREATE ON DATABASE ${identifier(freshDatabaseName)}
           TO ${identifier(migrationRole)};
         GRANT USAGE, CREATE ON SCHEMA public TO ${identifier(migrationRole)};
         REVOKE CREATE ON DATABASE ${identifier(freshDatabaseName)} FROM ${identifier(runtimeRole)};
         REVOKE CREATE ON SCHEMA public FROM ${identifier(runtimeRole)};`,
      );
      const freshVirginRepair = await repairPostgresBootstrap(bootstrapPool(freshAdminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: freshDatabaseName,
      });
      expect(freshVirginRepair.changed).toContain(
        `search_path:${migrationRole}:${freshDatabaseName}`,
      );
      expect(freshVirginRepair.changed).toContain(
        `search_path:${runtimeRole}:${freshDatabaseName}`,
      );
      freshMigrationPool = new Pool({
        connectionString: databaseUrl(
          adminUrl!,
          freshDatabaseName,
          migrationRole,
          migrationPassword,
        ),
        max: 1,
      });
      await freshAdminPool.query(
        `CREATE VIEW public.ingredients AS SELECT 1::integer AS id`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
          migrationRole,
          runtimeRole,
        }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'public.ingredients',
            }),
          ]),
        },
      });
      await freshAdminPool.query(`DROP VIEW public.ingredients`);
      await migrate(drizzle(freshMigrationPool), {
        migrationsFolder: resolve(__dirname, '../../supply/drizzle'),
      });
      await migrate(drizzle(freshMigrationPool), {
        migrationsFolder: resolve(__dirname, '../../loyalty/drizzle'),
        migrationsTable: '__drizzle_loyalty_migrations',
      });
      // Couvre aussi le déploiement additif : les deux contextes historiques
      // sont sains, customer n'existe pas encore, et le préflight reste passant.
      await repairPostgresBootstrap(bootstrapPool(freshAdminPool), {
        migrationRole, runtimeRole, expectedDatabase: freshDatabaseName,
      });
      await expect(checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
        migrationRole, runtimeRole,
      })).resolves.toMatchObject({ issues: [] });
      const customerMigrationConfig = {
        migrationsFolder: resolve(__dirname, '../../customer/drizzle'),
        migrationsTable: '__drizzle_customer_migrations',
      };
      const customerMigrations = readMigrationFiles(customerMigrationConfig);
      expect(customerMigrations).toHaveLength(5);
      const customerDialect = new PgDialect();
      const customerDriver = new NodePgDriver(freshMigrationPool, customerDialect);
      // Rejoue les trois SQL historiques inchangés avec le vrai migrateur :
      // la préparation navigateur n'existe pas encore avant l'upgrade 0003.
      await customerDialect.migrate(
        customerMigrations.slice(0, 3),
        customerDriver.createSession(undefined),
        customerMigrationConfig,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
          migrationRole,
          runtimeRole,
        }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'application_privilege_missing' }),
          ]),
        },
      });
      // C'est le helper réellement appelé par le CLI customer qui complète
      // les droits. Aucun administrateur ni repair n'est requis après ce DDL.
      await grantCustomerRuntimeRole(freshMigrationPool, runtimeRole);
      await expect(checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
        migrationRole, runtimeRole,
      })).resolves.toMatchObject({ issues: [] });
      const beforePreparation = await freshMigrationPool.query<{ hash: string; created_at: string }>(
        'SELECT hash, created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at',
      );
      expect(beforePreparation.rows).toHaveLength(3);
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.to_regclass('customer.browser_preparations') AS preparation,
                pg_catalog.to_regprocedure('customer.preserve_browser_preparation()') AS guard`,
      )).resolves.toMatchObject({ rows: [{ preparation: null, guard: null }] });
      await customerDialect.migrate(
        customerMigrations.slice(0, 4),
        customerDriver.createSession(undefined),
        customerMigrationConfig,
      );
      await grantCustomerRuntimeRole(freshMigrationPool, runtimeRole);
      await expect(checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
        migrationRole, runtimeRole,
      })).resolves.toMatchObject({ issues: [] });
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                c.relrowsecurity AS rls, c.relforcerowsecurity AS forced_rls
           FROM pg_catalog.pg_class c
          WHERE c.oid = 'customer.browser_preparations'::regclass`,
      )).resolves.toMatchObject({ rows: [{ owner: migrationRole, rls: true, forced_rls: true }] });
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner
           FROM pg_catalog.pg_proc p
          WHERE p.oid = 'customer.preserve_browser_preparation()'::regprocedure`,
      )).resolves.toMatchObject({ rows: [{ owner: migrationRole }] });
      const afterPreparation = await freshMigrationPool.query<{ hash: string; created_at: string }>(
        'SELECT hash, created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at',
      );
      expect(afterPreparation.rows).toHaveLength(4);
      expect(afterPreparation.rows.slice(0, 3)).toEqual(beforePreparation.rows);
      await customerDialect.migrate(
        customerMigrations.slice(0, 4),
        customerDriver.createSession(undefined),
        customerMigrationConfig,
      );
      expect((await freshMigrationPool.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at',
      )).rows).toEqual(afterPreparation.rows);

      // 0003 demeure un palier valide : les intentions ne sont pas requises
      // avant leur propre entrée de journal, puis deviennent obligatoires.
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.to_regclass('customer.verification_intents') AS intentions,
                pg_catalog.to_regprocedure('customer.preserve_verification_intent()') AS guard`,
      )).resolves.toMatchObject({ rows: [{ intentions: null, guard: null }] });
      await expect(checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
        migrationRole, runtimeRole,
      })).resolves.toMatchObject({ issues: [] });
      await migrate(drizzle(freshMigrationPool), customerMigrationConfig);
      await grantCustomerRuntimeRole(freshMigrationPool, runtimeRole);
      await expect(checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
        migrationRole, runtimeRole,
      })).resolves.toMatchObject({ issues: [] });
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                c.relrowsecurity AS rls, c.relforcerowsecurity AS forced_rls
           FROM pg_catalog.pg_class c
          WHERE c.oid = 'customer.verification_intents'::regclass`,
      )).resolves.toMatchObject({ rows: [{ owner: migrationRole, rls: true, forced_rls: true }] });
      await expect(freshMigrationPool.query(
        `SELECT pg_catalog.pg_get_userbyid(p.proowner) AS owner
           FROM pg_catalog.pg_proc p
          WHERE p.oid = 'customer.preserve_verification_intent()'::regprocedure`,
      )).resolves.toMatchObject({ rows: [{ owner: migrationRole }] });
      const afterIntentions = await freshMigrationPool.query<{ hash: string; created_at: string }>(
        'SELECT hash, created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at',
      );
      expect(afterIntentions.rows).toHaveLength(5);
      expect(afterIntentions.rows.slice(0, 4)).toEqual(afterPreparation.rows);
      expect(afterIntentions.rows[4]).toEqual({
        hash: customerMigrations[4]!.hash,
        created_at: '1788901200000',
      });
      await migrate(drizzle(freshMigrationPool), customerMigrationConfig);
      expect((await freshMigrationPool.query(
        'SELECT hash, created_at FROM drizzle.__drizzle_customer_migrations ORDER BY created_at',
      )).rows).toEqual(afterIntentions.rows);
      const freshPostMigrationRepair = await repairPostgresBootstrap(
        bootstrapPool(freshAdminPool),
        { migrationRole, runtimeRole, expectedDatabase: freshDatabaseName },
      );
      expect(freshPostMigrationRepair.changed).toEqual([]);
      await expect(
        checkPostgresBootstrap(bootstrapPool(freshMigrationPool), {
          migrationRole,
          runtimeRole,
        }),
      ).resolves.toMatchObject({ issues: [] });
      const freshSecondRepair = await repairPostgresBootstrap(bootstrapPool(freshAdminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: freshDatabaseName,
      });
      expect(freshSecondRepair.changed).toEqual([]);

      adminPool = new Pool({
        connectionString: databaseUrl(adminUrl!, databaseName),
        max: 1,
      });
      await adminPool.query(
        `GRANT CONNECT, CREATE ON DATABASE ${identifier(databaseName)}
           TO ${identifier(migrationRole)};
         GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(legacyRole)};
         GRANT USAGE, CREATE ON SCHEMA public
           TO ${identifier(migrationRole)};
         REVOKE CREATE ON DATABASE ${identifier(databaseName)} FROM ${identifier(runtimeRole)};
         REVOKE CREATE ON SCHEMA public FROM ${identifier(runtimeRole)};`,
      );

      const virginRepair = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(virginRepair.changed).toContain(
        `search_path:${migrationRole}:${databaseName}`,
      );
      expect(virginRepair.changed).toContain(
        `search_path:${runtimeRole}:${databaseName}`,
      );
      migrationPool = new Pool({
        connectionString: databaseUrl(
          adminUrl!,
          databaseName,
          migrationRole,
          migrationPassword,
        ),
        max: 1,
      });
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).resolves.toMatchObject({ issues: [], objects: expect.any(Array) });
      await adminPool.query(
        `GRANT CREATE ON DATABASE ${identifier(databaseName)} TO ${identifier(legacyRole)};
         GRANT USAGE, CREATE ON SCHEMA public TO ${identifier(legacyRole)}`,
      );

      // Reproduit le legs réel : les trois contextes et leurs journaux sont
      // créés avec l'ancien propriétaire, jamais avec le migrateur dédié.
      await adminPool.query(`SET ROLE ${identifier(legacyRole)}`);
      const legacyDb = drizzle(adminPool);
      await migrate(legacyDb, {
        migrationsFolder: resolve(__dirname, '../../supply/drizzle'),
      });
      await migrate(legacyDb, {
        migrationsFolder: resolve(__dirname, '../../loyalty/drizzle'),
        migrationsTable: '__drizzle_loyalty_migrations',
      });
      await migrate(legacyDb, {
        migrationsFolder: resolve(__dirname, '../../customer/drizzle'),
        migrationsTable: '__drizzle_customer_migrations',
      });
      await adminPool.query('RESET ROLE');
      await adminPool.query(
        `REVOKE CREATE ON DATABASE ${identifier(databaseName)} FROM ${identifier(legacyRole)};
         REVOKE CREATE ON SCHEMA public FROM ${identifier(legacyRole)}`,
      );
      await adminPool.query(
        `CREATE TABLE public.bootstrap_sentinel (id integer PRIMARY KEY);
         INSERT INTO public.bootstrap_sentinel (id) VALUES (7);
         ALTER TABLE public.bootstrap_sentinel OWNER TO ${identifier(legacyRole)};`,
      );

      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([expect.objectContaining({ code: 'wrong_owner' })]),
        },
      });

      const repaired = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(repaired.changed.some((change) => change.startsWith('owner:'))).toBe(true);
      // ALTER ROLE ... IN DATABASE s'applique aux nouvelles sessions. La
      // connexion qui a constaté le legs est donc fermée, comme le seraient
      // deux commandes opérateur distinctes en staging/production.
      await migrationPool.end();
      migrationPool = new Pool({
        connectionString: databaseUrl(
          adminUrl!,
          databaseName,
          migrationRole,
          migrationPassword,
        ),
        max: 1,
      });
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).resolves.toMatchObject({ issues: [] });

      runtimePool = new Pool({
        connectionString: databaseUrl(adminUrl!, databaseName, runtimeRole, runtimePassword),
        max: 1,
      });
      await expect(
        runtimePool.query<{ search_path: string }>(
          `SELECT pg_catalog.current_setting('search_path') AS search_path`,
        ),
      ).resolves.toMatchObject({ rows: [{ search_path: 'pg_catalog, public' }] });
      await expect(
        runtimePool.query('CREATE TABLE public.runtime_must_not_create (id integer)'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtimePool.query('CREATE TABLE customer.runtime_must_not_create (id integer)'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtimePool.query('SELECT count(*)::integer AS count FROM customer.accounts'),
      ).resolves.toMatchObject({ rows: [{ count: 0 }] });
      await expect(
        runtimePool.query('SELECT count(*)::integer AS count FROM drizzle.__drizzle_customer_migrations'),
      ).resolves.toMatchObject({ rows: [{ count: 5 }] });

      // C'est bien l'identité de migration qui peut rejouer les migrateurs
      // réels : les journaux les rendent sans effet mais leurs catalogues sont
      // désormais modifiables par le bon rôle.
      await migrate(drizzle(migrationPool), {
        migrationsFolder: resolve(__dirname, '../../supply/drizzle'),
      });
      await migrate(drizzle(migrationPool), {
        migrationsFolder: resolve(__dirname, '../../loyalty/drizzle'),
        migrationsTable: '__drizzle_loyalty_migrations',
      });
      await migrate(drizzle(migrationPool), {
        migrationsFolder: resolve(__dirname, '../../customer/drizzle'),
        migrationsTable: '__drizzle_customer_migrations',
      });

      // Le troisième journal doit être aussi strictement lecture seule pour
      // le runtime : l'ajout d'un contexte ne lui accorde aucun pouvoir DDL.
      await adminPool.query(
        `GRANT UPDATE ON TABLE drizzle.__drizzle_customer_migrations TO ${identifier(runtimeRole)}`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({ report: { issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'journal_privilege_excessive', target: 'drizzle.__drizzle_customer_migrations',
        }),
      ]) } });
      const customerAclRepaired = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole, runtimeRole, expectedDatabase: databaseName,
      });
      expect(customerAclRepaired.changed).toContain(
        `revoke:drizzle.__drizzle_customer_migrations:WRITE:${runtimeRole}`,
      );
      await expect(runtimePool.query(
        'UPDATE drizzle.__drizzle_customer_migrations SET hash = hash WHERE false',
      )).rejects.toMatchObject({ code: '42501' });

      await adminPool.query('GRANT CREATE ON SCHEMA customer TO PUBLIC');
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({ report: { issues: expect.arrayContaining([
        expect.objectContaining({ code: 'managed_schema_unsafe', target: 'schema:customer' }),
      ]) } });
      await expect(repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole, runtimeRole, expectedDatabase: databaseName,
      })).rejects.toThrow(/schéma géré/);
      await adminPool.query('REVOKE CREATE ON SCHEMA customer FROM PUBLIC');

      await adminPool.query(
        `GRANT INSERT, UPDATE, DELETE, TRUNCATE
           ON TABLE drizzle.__drizzle_migrations TO ${identifier(runtimeRole)};
         GRANT SELECT ON TABLE drizzle.__drizzle_migrations
           TO ${identifier(runtimeRole)} WITH GRANT OPTION;
         GRANT UPDATE (hash) ON TABLE drizzle.__drizzle_migrations
           TO ${identifier(runtimeRole)};
         GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO PUBLIC;
         GRANT SELECT (hash) ON TABLE drizzle.__drizzle_migrations TO PUBLIC;`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'journal_privilege_excessive' }),
          ]),
        },
      });
      const aclRepaired = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(aclRepaired.changed).toEqual(
        expect.arrayContaining([
          `revoke:drizzle.__drizzle_migrations:ALL:PUBLIC`,
          `revoke:drizzle.__drizzle_migrations:COLUMNS:PUBLIC`,
          `revoke:drizzle.__drizzle_migrations:WRITE:${runtimeRole}`,
          `revoke:drizzle.__drizzle_migrations:COLUMNS:${runtimeRole}`,
          `revoke:drizzle.__drizzle_migrations:SELECT_GRANT_OPTION:${runtimeRole}`,
        ]),
      );
      await expect(
        runtimePool.query('DELETE FROM drizzle.__drizzle_migrations WHERE false'),
      ).rejects.toMatchObject({ code: '42501' });
      const columnAcl = await adminPool.query<{ allowed: boolean }>(
        `SELECT pg_catalog.has_column_privilege(
                  $1,
                  'drizzle.__drizzle_migrations',
                  'hash',
                  'UPDATE'
                ) AS allowed`,
        [runtimeRole],
      );
      expect(columnAcl.rows[0]?.allowed).toBe(false);

      await adminPool.query(
        `REVOKE USAGE, SELECT, UPDATE ON SEQUENCE drizzle.__drizzle_migrations_id_seq
           FROM ${identifier(runtimeRole)};
         GRANT USAGE, SELECT, UPDATE ON SEQUENCE drizzle.__drizzle_migrations_id_seq TO PUBLIC;`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'sequence_privilege_excessive' }),
          ]),
        },
      });
      const sequenceAclRepaired = await repairPostgresBootstrap(
        bootstrapPool(adminPool),
        { migrationRole, runtimeRole, expectedDatabase: databaseName },
      );
      expect(sequenceAclRepaired.changed).toEqual(
        expect.arrayContaining([
          'revoke:drizzle.__drizzle_migrations_id_seq:ALL:PUBLIC',
        ]),
      );
      expect(sequenceAclRepaired.changed).not.toContain(
        `revoke:drizzle.__drizzle_migrations_id_seq:ALL:${runtimeRole}`,
      );

      const second = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(second.changed).toEqual([]);

      await adminPool.query(
        `REVOKE CONNECT ON DATABASE ${identifier(databaseName)} FROM PUBLIC;
         REVOKE CONNECT ON DATABASE ${identifier(databaseName)} FROM ${identifier(runtimeRole)};`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'runtime_privilege_missing',
              target: 'database:CONNECT',
            }),
          ]),
        },
      });
      const connectRepaired = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(connectRepaired.changed).toContain(
        `grant:${databaseName}:CONNECT:${runtimeRole}`,
      );

      await adminPool.query(
        `GRANT CREATE ON DATABASE ${identifier(databaseName)} TO ${identifier(legacyRole)}`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'database_privilege_excessive' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/base accorde CREATE/);
      await adminPool.query(
        `REVOKE CREATE ON DATABASE ${identifier(databaseName)} FROM ${identifier(legacyRole)}`,
      );
      await adminPool.query(`SET ROLE ${identifier(legacyRole)}`);
      try {
        await expect(
          adminPool.query(`CREATE SCHEMA ${identifier(runtimeRole)}`),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await adminPool.query('RESET ROLE');
      }
      await adminPool.query(
        `CREATE SCHEMA ${identifier(runtimeRole)} AUTHORIZATION ${identifier(runtimeRole)}`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({
              code: 'runtime_privilege_excessive',
              target: 'application:OWNER',
            }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toBeInstanceOf(PostgresBootstrapError);
      await adminPool.query(`DROP SCHEMA ${identifier(runtimeRole)}`);

      // Un rôle tiers qui hérite du migrateur peut contourner la séparation
      // des identités même si les attributs du migrateur restent sains.
      await adminPool.query(
        `GRANT ${identifier(migrationRole)} TO ${identifier(legacyRole)}`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'migration_role_unsafe' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/rôle de migration/);
      await adminPool.query(
        `REVOKE ${identifier(migrationRole)} FROM ${identifier(legacyRole)}`,
      );

      // Les réglages GUC hérités au login sont aussi des privilèges : replica
      // désactive effectivement les triggers sur une nouvelle connexion.
      await adminPool.query(
        `ALTER ROLE ${identifier(runtimeRole)} SET session_replication_role = replica`,
      );
      const configuredRuntimePool = new Pool({
        connectionString: databaseUrl(
          adminUrl!,
          databaseName,
          runtimeRole,
          runtimePassword,
        ),
        max: 1,
      });
      await expect(
        configuredRuntimePool.query<{ value: string }>(
          `SELECT pg_catalog.current_setting('session_replication_role') AS value`,
        ),
      ).resolves.toMatchObject({ rows: [{ value: 'replica' }] });
      await configuredRuntimePool.end();
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'role_configuration_unsafe' }),
          ]),
        },
      });
      await adminPool.query(
        `ALTER ROLE ${identifier(runtimeRole)} RESET session_replication_role`,
      );

      await adminPool.query(
        `ALTER ROLE ${identifier(runtimeRole)} IN DATABASE ${identifier(databaseName)}
           SET session_replication_role = replica`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'role_configuration_unsafe' }),
          ]),
        },
      });
      await adminPool.query(
        `ALTER ROLE ${identifier(runtimeRole)} IN DATABASE ${identifier(databaseName)}
           RESET session_replication_role`,
      );

      await adminPool.query(
        `ALTER DATABASE ${identifier(databaseName)} SET session_replication_role = replica`,
      );
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/administrateur directe/);
      await adminPool.query(
        `ALTER DATABASE ${identifier(databaseName)} RESET session_replication_role`,
      );

      await adminPool.query(
        `GRANT SET ON PARAMETER session_replication_role TO ${identifier(runtimeRole)}`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'parameter_privilege_excessive' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/rôle runtime/);
      await adminPool.query(
        `REVOKE SET ON PARAMETER session_replication_role FROM ${identifier(runtimeRole)}`,
      );

      await adminPool.query(
        `GRANT CREATE ON SCHEMA loyalty TO PUBLIC`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'managed_schema_unsafe' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/schéma géré/);
      await adminPool.query(`REVOKE CREATE ON SCHEMA loyalty FROM PUBLIC`);

      await adminPool.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(migrationRole)} IN SCHEMA loyalty
           GRANT TRUNCATE ON TABLES TO PUBLIC`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'default_privilege_excessive' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/Privilège par défaut hors allowlist/);
      await adminPool.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(migrationRole)} IN SCHEMA loyalty
           REVOKE TRUNCATE ON TABLES FROM PUBLIC`,
      );

      await adminPool.query(
        `GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO ${identifier(legacyRole)};
         GRANT UPDATE (hash) ON TABLE drizzle.__drizzle_migrations TO ${identifier(legacyRole)};`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'journal_privilege_excessive' }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toThrow(/rôle hors allowlist/);
      await adminPool.query(
        `REVOKE SELECT ON TABLE drizzle.__drizzle_migrations FROM ${identifier(legacyRole)};
         REVOKE UPDATE (hash) ON TABLE drizzle.__drizzle_migrations FROM ${identifier(legacyRole)};`,
      );

      await adminPool.query(
        `REVOKE USAGE ON SCHEMA drizzle FROM ${identifier(runtimeRole)}`,
      );
      await expect(
        runtimePool.query('SELECT count(*) FROM drizzle.__drizzle_migrations'),
      ).rejects.toMatchObject({ code: '42501' });
      const usageRepaired = await repairPostgresBootstrap(bootstrapPool(adminPool), {
        migrationRole,
        runtimeRole,
        expectedDatabase: databaseName,
      });
      expect(usageRepaired.changed).toContain(`grant:drizzle:USAGE:${runtimeRole}`);

      await adminPool.query(
        `REVOKE SELECT ON TABLE loyalty.ledger_entries FROM ${identifier(runtimeRole)};
         GRANT MAINTAIN ON TABLE loyalty.ledger_entries TO ${identifier(runtimeRole)};
         GRANT SELECT ON TABLE loyalty.ledger_entries TO PUBLIC;`,
      );
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'application_privilege_excessive' }),
          ]),
        },
      });
      const applicationAclRepaired = await repairPostgresBootstrap(
        bootstrapPool(adminPool),
        { migrationRole, runtimeRole, expectedDatabase: databaseName },
      );
      expect(applicationAclRepaired.changed).toEqual(
        expect.arrayContaining([
          `revoke:loyalty.ledger_entries:ALL:PUBLIC`,
          `revoke:loyalty.ledger_entries:EXCESSIVE:${runtimeRole}`,
          `grant:loyalty.ledger_entries:DML:${runtimeRole}`,
        ]),
      );
      const repairedApplicationAcl = await adminPool.query<{
        runtime_maintain: boolean;
        runtime_select: boolean;
        public_select: boolean;
      }>(
        `SELECT pg_catalog.has_table_privilege($1, 'loyalty.ledger_entries', 'MAINTAIN') AS runtime_maintain,
                pg_catalog.has_table_privilege($1, 'loyalty.ledger_entries', 'SELECT') AS runtime_select,
                pg_catalog.has_table_privilege('public', 'loyalty.ledger_entries', 'SELECT') AS public_select`,
        [runtimeRole],
      );
      expect(repairedApplicationAcl.rows[0]).toEqual({
        runtime_maintain: false,
        runtime_select: true,
        public_select: false,
      });
      const publicFallbackSecondRepair = await repairPostgresBootstrap(
        bootstrapPool(adminPool),
        { migrationRole, runtimeRole, expectedDatabase: databaseName },
      );
      expect(publicFallbackSecondRepair.changed).toEqual([]);

      await expect(
        adminPool.query<{ owner: string; value: number }>(
          `SELECT pg_catalog.pg_get_userbyid(class.relowner)::text AS owner, sentinel.id AS value
             FROM public.bootstrap_sentinel sentinel
             JOIN pg_catalog.pg_class class ON class.oid = 'public.bootstrap_sentinel'::regclass`,
        ),
      ).resolves.toMatchObject({
        rows: [{ owner: legacyRole, value: 7 }],
      });

      await adminPool.query(
        `ALTER TABLE loyalty.members OWNER TO ${identifier(legacyRole)};
         CREATE TABLE loyalty.bootstrap_rogue (id integer PRIMARY KEY);
         CREATE TABLE customer.bootstrap_rogue (id integer PRIMARY KEY);
         CREATE VIEW loyalty.bootstrap_rogue_view AS SELECT 1 AS value;
         CREATE PROCEDURE loyalty.bootstrap_rogue_procedure()
           LANGUAGE SQL AS 'SELECT 1';
         CREATE DOMAIN loyalty.bootstrap_rogue_domain AS integer;
         CREATE FUNCTION public.bootstrap_rogue_function()
           RETURNS integer LANGUAGE SQL IMMUTABLE AS 'SELECT 1';
         CREATE DOMAIN public.bootstrap_rogue_domain AS integer;
         CREATE FUNCTION public.bootstrap_rogue_operator_fn(integer, integer)
           RETURNS boolean LANGUAGE SQL IMMUTABLE AS 'SELECT $1 = $2';
         CREATE OPERATOR public.#=# (
           LEFTARG = integer,
           RIGHTARG = integer,
           FUNCTION = public.bootstrap_rogue_operator_fn
         );
         CREATE FUNCTION public.bootstrap_hostile_eq(integer, integer)
           RETURNS boolean LANGUAGE SQL IMMUTABLE AS 'SELECT false';
         CREATE OPERATOR public.= (
           LEFTARG = integer,
           RIGHTARG = integer,
           FUNCTION = public.bootstrap_hostile_eq
         );`,
      );
      await expect(migrationPool.query<{ compromised: boolean }>('SELECT 1 = 1 AS compromised'))
        .resolves.toMatchObject({ rows: [{ compromised: false }] });
      await expect(
        checkPostgresBootstrap(bootstrapPool(migrationPool), { migrationRole, runtimeRole }),
      ).rejects.toMatchObject({
        report: {
          issues: expect.arrayContaining([
            expect.objectContaining({ code: 'unexpected_object', target: 'loyalty.bootstrap_rogue' }),
            expect.objectContaining({ code: 'unexpected_object', target: 'customer.bootstrap_rogue' }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'loyalty.bootstrap_rogue_view',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'loyalty.bootstrap_rogue_procedure()',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'loyalty.bootstrap_rogue_domain',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'public.bootstrap_rogue_function()',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'public.bootstrap_rogue_domain',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'public.#=#(integer, integer)',
            }),
            expect.objectContaining({
              code: 'unexpected_object',
              target: 'public.=(integer, integer)',
            }),
          ]),
        },
      });
      await expect(
        repairPostgresBootstrap(bootstrapPool(adminPool), {
          migrationRole,
          runtimeRole,
          expectedDatabase: databaseName,
        }),
      ).rejects.toBeInstanceOf(PostgresBootstrapError);
      const rollbackOwners = await adminPool.query<{ name: string; owner: string }>(
        `SELECT class.relname::text AS name,
                pg_catalog.pg_get_userbyid(class.relowner)::text AS owner
           FROM pg_catalog.pg_class class
          WHERE class.oid IN (
            'loyalty.bootstrap_rogue'::regclass,
            'loyalty.members'::regclass
          )
          ORDER BY class.relname`,
      );
      expect(rollbackOwners.rows.find((row) => row.name === 'bootstrap_rogue')?.owner).not.toBe(
        migrationRole,
      );
      expect(rollbackOwners.rows.find((row) => row.name === 'members')?.owner).toBe(legacyRole);
      const publicRogueOwners = await adminPool.query<{ name: string; owner: string }>(
        `SELECT procedure.proname::text AS name,
                pg_catalog.pg_get_userbyid(procedure.proowner)::text AS owner
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'public'
            AND procedure.proname = 'bootstrap_rogue_function'
         UNION ALL
         SELECT data_type.typname::text AS name,
                pg_catalog.pg_get_userbyid(data_type.typowner)::text AS owner
           FROM pg_catalog.pg_type data_type
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = data_type.typnamespace
          WHERE namespace.nspname = 'public'
            AND data_type.typname = 'bootstrap_rogue_domain'`,
      );
      expect(publicRogueOwners.rows).toHaveLength(2);
      expect(publicRogueOwners.rows.every((row) => row.owner !== migrationRole)).toBe(true);
    },
    60_000,
  );
});
