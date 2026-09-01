import type { Pool } from 'pg';

type RoleProbe = {
  role_name: unknown;
  migration_role: unknown;
  migration_rolsuper: unknown;
  migration_rolbypassrls: unknown;
  migration_rolcreaterole: unknown;
  migration_rolcreatedb: unknown;
  migration_rolreplication: unknown;
  migration_has_role_membership: unknown;
  database_name: unknown;
  rolsuper: unknown;
  rolbypassrls: unknown;
  rolcreaterole: unknown;
  rolcreatedb: unknown;
  rolreplication: unknown;
  has_role_membership: unknown;
  can_create_database_objects: unknown;
  can_create_public_schema: unknown;
  can_create_loyalty_schema: unknown;
  owns_application_objects: unknown;
};
type Environment = Record<string, string | undefined>;

const ROLE_NAME = /^[a-z][a-z0-9_]{2,62}$/;

function isDeployedEnvironment(env: Environment): boolean {
  return (
    env.NODE_ENV === 'production' ||
    Boolean(env.RAILWAY_ENVIRONMENT_NAME?.trim()) ||
    Boolean(env.RAILWAY_ENVIRONMENT_ID?.trim())
  );
}

function assertRoleName(role: string): void {
  if (!ROLE_NAME.test(role)) throw new Error('DATABASE_RUNTIME_ROLE invalide');
}

export function runtimeDatabaseRole(env: Environment): string | null {
  const role = env.DATABASE_RUNTIME_ROLE?.trim();
  if (!role) {
    if (isDeployedEnvironment(env)) {
      throw new Error('DATABASE_RUNTIME_ROLE manquant dans un environnement déployé');
    }
    return null;
  }
  assertRoleName(role);
  return role;
}

/** Vérifie simultanément le migrateur limité et le rôle runtime sans DDL. */
async function assertSupplyRolesSafe(
  pool: Pick<Pool, 'query'>,
  role: string,
): Promise<string> {
  assertRoleName(role);
  const result = await pool.query<RoleProbe>(
    `SELECT r.rolname::text AS role_name,
            m.rolname::text AS migration_role,
            m.rolsuper AS migration_rolsuper,
            m.rolbypassrls AS migration_rolbypassrls,
            m.rolcreaterole AS migration_rolcreaterole,
            m.rolcreatedb AS migration_rolcreatedb,
            m.rolreplication AS migration_rolreplication,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles parent
               WHERE parent.oid <> m.oid AND pg_has_role(m.oid, parent.oid, 'MEMBER')
            ) AS migration_has_role_membership,
            current_database()::text AS database_name,
            r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles parent
               WHERE parent.oid <> r.oid AND pg_has_role(r.oid, parent.oid, 'MEMBER')
            ) AS has_role_membership,
            has_database_privilege(r.oid, current_database(), 'CREATE') AS can_create_database_objects,
            has_schema_privilege(r.oid, 'public', 'CREATE') AS can_create_public_schema,
            COALESCE(
              has_schema_privilege(r.oid, to_regnamespace('loyalty'), 'CREATE'),
              false
            ) AS can_create_loyalty_schema,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE c.relowner = r.oid AND n.nspname IN ('public', 'loyalty', 'drizzle')
            ) OR EXISTS (
              SELECT 1 FROM pg_catalog.pg_namespace n
               WHERE n.nspowner = r.oid AND n.nspname IN ('public', 'loyalty', 'drizzle')
            ) AS owns_application_objects
       FROM pg_catalog.pg_roles r
       JOIN pg_catalog.pg_roles m ON m.rolname = current_user
      WHERE r.rolname = $1`,
    [role],
  );
  const found = result.rows[0];
  if (
    result.rowCount !== 1 ||
    typeof found?.role_name !== 'string' ||
    found.role_name !== role ||
    typeof found.migration_role !== 'string' ||
    found.migration_role.length === 0 ||
    found.migration_role === role ||
    found.migration_rolsuper !== false ||
    found.migration_rolbypassrls !== false ||
    found.migration_rolcreaterole !== false ||
    found.migration_rolcreatedb !== false ||
    found.migration_rolreplication !== false ||
    found.migration_has_role_membership !== false ||
    typeof found.database_name !== 'string' ||
    found.database_name.length === 0 ||
    found.rolsuper !== false ||
    found.rolbypassrls !== false ||
    found.rolcreaterole !== false ||
    found.rolcreatedb !== false ||
    found.rolreplication !== false ||
    found.has_role_membership !== false ||
    found.can_create_database_objects !== false ||
    found.can_create_public_schema !== false ||
    found.can_create_loyalty_schema !== false ||
    found.owns_application_objects !== false
  ) {
    throw new Error('Les rôles migration/runtime supply sont absents ou privilégiés');
  }

  return found.database_name;
}

/** Refuse un compte DDL superuser ou capable d'endosser un autre rôle. */
export async function assertSupplyMigrationRoleSafe(
  pool: Pick<Pool, 'query'>,
  role: string,
): Promise<void> {
  await assertSupplyRolesSafe(pool, role);
}

/** Accorde le CRUD du schéma public au rôle runtime, jamais le DDL. */
export async function grantSupplyRuntimeRole(
  pool: Pick<Pool, 'query'>,
  role: string,
): Promise<void> {
  const databaseName = await assertSupplyRolesSafe(pool, role);

  const quotedRole = `"${role}"`;
  const quotedDatabase = `"${databaseName.replaceAll('"', '""')}"`;
  await pool.query(`
    GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole};
    GRANT USAGE ON SCHEMA public TO ${quotedRole};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quotedRole};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${quotedRole};
    GRANT USAGE ON SCHEMA drizzle TO ${quotedRole};
    GRANT SELECT ON TABLE drizzle.__drizzle_migrations TO ${quotedRole};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedRole};
  `);
}
