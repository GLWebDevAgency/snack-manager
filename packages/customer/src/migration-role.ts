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
  migration_has_role_members: unknown;
  migration_search_path: unknown;
  database_name: unknown;
  rolsuper: unknown;
  rolbypassrls: unknown;
  rolcreaterole: unknown;
  rolcreatedb: unknown;
  rolreplication: unknown;
  has_role_membership: unknown;
  has_role_members: unknown;
  can_create_database_objects: unknown;
  can_create_public_schema: unknown;
  can_create_customer_schema: unknown;
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

/** Vérifie simultanément le migrateur limité et le rôle runtime sans DDL persistant. */
async function assertCustomerRolesSafe(
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
               WHERE parent.oid <> m.oid
                 AND pg_catalog.pg_has_role(m.oid, parent.oid, 'MEMBER')
            ) AS migration_has_role_membership,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members membership
               WHERE membership.roleid = m.oid
            ) AS migration_has_role_members,
            pg_catalog.current_setting('search_path')::text AS migration_search_path,
            pg_catalog.current_database()::text AS database_name,
            r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles parent
               WHERE parent.oid <> r.oid
                 AND pg_catalog.pg_has_role(r.oid, parent.oid, 'MEMBER')
            ) AS has_role_membership,
            EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members membership
               WHERE membership.roleid = r.oid
            ) AS has_role_members,
            pg_catalog.has_database_privilege(
              r.oid,
              pg_catalog.current_database(),
              'CREATE'
            ) AS can_create_database_objects,
            pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE') AS can_create_public_schema,
            COALESCE(
              pg_catalog.has_schema_privilege(
                r.oid,
                pg_catalog.to_regnamespace('customer'),
                'CREATE'
              ),
              false
            ) AS can_create_customer_schema,
            EXISTS (
              SELECT 1
                FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE c.relowner = r.oid AND n.nspname IN ('public', 'customer', 'drizzle')
            ) OR EXISTS (
              SELECT 1 FROM pg_catalog.pg_namespace n
               WHERE n.nspowner = r.oid AND n.nspname IN ('public', 'customer', 'drizzle')
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
    found.migration_has_role_members !== false ||
    typeof found.migration_search_path !== 'string' ||
    found.migration_search_path
      .split(',')
      .map((schema) => schema.trim())
      .join(',') !== 'public,pg_catalog' ||
    typeof found.database_name !== 'string' ||
    found.database_name.length === 0 ||
    found.rolsuper !== false ||
    found.rolbypassrls !== false ||
    found.rolcreaterole !== false ||
    found.rolcreatedb !== false ||
    found.rolreplication !== false ||
    found.has_role_membership !== false ||
    found.has_role_members !== false ||
    found.can_create_database_objects !== false ||
    found.can_create_public_schema !== false ||
    found.can_create_customer_schema !== false ||
    found.owns_application_objects !== false
  ) {
    throw new Error('Les rôles migration/runtime identité client sont absents ou privilégiés');
  }

  return found.database_name;
}

/** Refuse un compte DDL superuser ou capable d'endosser un autre rôle. */
export async function assertCustomerMigrationRoleSafe(
  pool: Pick<Pool, 'query'>,
  role: string,
): Promise<void> {
  await assertCustomerRolesSafe(pool, role);
}

/** Accorde le CRUD du schéma identité client au rôle runtime, jamais le DDL persistant. */
export async function grantCustomerRuntimeRole(
  pool: Pick<Pool, 'query'>,
  role: string,
): Promise<void> {
  const databaseName = await assertCustomerRolesSafe(pool, role);

  // Le rôle est strictement validé avant interpolation comme identifiant.
  const quotedRole = `"${role}"`;
  const quotedDatabase = `"${databaseName.replaceAll('"', '""')}"`;
  await pool.query(`
    GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRole};
    GRANT USAGE ON SCHEMA customer TO ${quotedRole};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customer TO ${quotedRole};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA customer TO ${quotedRole};
    GRANT USAGE ON SCHEMA drizzle TO ${quotedRole};
    GRANT SELECT ON TABLE drizzle.__drizzle_customer_migrations TO ${quotedRole};
    ALTER DEFAULT PRIVILEGES IN SCHEMA customer
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quotedRole};
    ALTER DEFAULT PRIVILEGES IN SCHEMA customer
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${quotedRole};
    ${customerProductionRuntimeGrants(role)}
  `);
}


/** Apply after broad historical grants; production operator records are read-only. */
export async function restrictCustomerProductionRuntimeRole(pool: Pick<Pool, 'query'>, role: string): Promise<void> {
  assertRoleName(role);
  await pool.query(customerProductionRuntimeGrants(role));
}

function customerProductionRuntimeGrants(role: string): string {
  return `DO $grants$ BEGIN
    ${['production_budget_authorizations','production_budget_activation','production_admission_policies','production_admissions'].map(table => `
      IF pg_catalog.to_regclass('customer.${table}') IS NOT NULL THEN
        REVOKE ALL ON customer.${table} FROM "${role}";
        GRANT SELECT ON customer.${table} TO "${role}";
      END IF;`).join('')}
    END $grants$;`;
}

/** Narrow SQL grant shared with isolated PostgreSQL fixtures. No runtime connection receives it. A deployed third role requires a separately versioned bootstrap ACL policy. */
export async function grantCustomerProductionOperatorPrivileges(pool: Pick<Pool, 'query'>, role: string, database: string): Promise<void> {
  assertRoleName(role);
  const target = `"${role}"`;
  await pool.query(`GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO ${target};
    GRANT USAGE ON SCHEMA customer TO ${target};
    GRANT SELECT,UPDATE(parent_ref) ON customer.parent_budgets TO ${target};
    GRANT SELECT ON customer.production_budget_authorizations,customer.production_budget_activation,customer.production_admission_policies,customer.production_admissions TO ${target};
    GRANT INSERT(parent_ref,tenant_ref,authorization_ref,service_sid,currency,authorized_spend_microusd,reserve_per_send_microusd,
      max_send_reservations,cost_evidence_reference,not_before,expires_at),UPDATE(revoked_at)
      ON customer.production_budget_authorizations TO ${target};
    GRANT INSERT(parent_ref,tenant_ref,authorization_ref),UPDATE(authorization_ref) ON customer.production_budget_activation TO ${target};
    GRANT INSERT(parent_ref,tenant_ref,policy_ref,window_ms,browser_source_limit,browser_tenant_limit,browser_parent_limit,
      intent_browser_limit,intent_source_limit,intent_tenant_limit,intent_parent_limit),UPDATE(revoked_at)
      ON customer.production_admission_policies TO ${target};`);
}
