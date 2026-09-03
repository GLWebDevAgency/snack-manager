import type { Pool, PoolClient } from 'pg';
import {
  JOURNALS,
  POSTGRES_MANAGED_OBJECTS,
  managedObjectKey,
  type ManagedObject,
  type ManagedObjectKind,
  type MigrationJournal,
} from './manifest';
import { assertPostgresConnectionEncrypted } from './connection-tls';

const ROLE_NAME = /^[a-z][a-z0-9_]{2,62}$/;
// Les migrations Supply historiques créent leurs tables sans qualifier le
// schéma. `public` doit donc rester premier ; toutes les fonctions sensibles
// de ce fichier sont qualifiées explicitement avec pg_catalog.
// La frontière runtime interdit le DDL persistant. PostgreSQL conserve TEMP
// (et son pg_temp propre à la session) : ce bootstrap ne prétend pas le retirer.
const SAFE_SEARCH_PATH = 'public,pg_catalog';

export type BootstrapRoles = Readonly<{
  migrationRole: string;
  runtimeRole: string;
}>;

export type BootstrapIssueCode =
  | 'migration_role_unsafe'
  | 'migration_privilege_missing'
  | 'database_privilege_excessive'
  | 'runtime_role_unsafe'
  | 'runtime_privilege_missing'
  | 'runtime_privilege_excessive'
  | 'parameter_privilege_excessive'
  | 'role_configuration_unsafe'
  | 'public_schema_unsafe'
  | 'managed_schema_unsafe'
  | 'wrong_owner'
  | 'missing_object'
  | 'orphaned_object'
  | 'unexpected_object'
  | 'journal_unreadable'
  | 'journal_privilege_missing'
  | 'journal_privilege_excessive'
  | 'application_privilege_excessive'
  | 'application_privilege_missing'
  | 'sequence_privilege_missing'
  | 'sequence_privilege_excessive'
  | 'default_privilege_excessive';

export type BootstrapIssue = Readonly<{
  code: BootstrapIssueCode;
  target: string;
  expected?: string;
  actual?: string;
}>;

type CatalogObjectKind =
  | ManagedObjectKind
  | 'view'
  | 'materialized_view'
  | 'foreign_table'
  | 'procedure'
  | 'aggregate'
  | 'window_function'
  | 'operator'
  | 'domain'
  | 'range'
  | 'multirange'
  | 'composite_type'
  | 'base_type';

export type CatalogObject = Readonly<{
  kind: CatalogObjectKind;
  schema: string;
  name: string;
  identityArguments: string;
  owner: string | null;
  managed: boolean;
}>;

export type BootstrapReport = Readonly<{
  database: string | null;
  migrationRole: string;
  runtimeRole: string;
  objects: readonly CatalogObject[];
  unmanagedObjects: readonly CatalogObject[];
  issues: readonly BootstrapIssue[];
}>;

export type BootstrapRepairResult = Readonly<{
  database: string;
  changed: readonly string[];
  report: BootstrapReport;
}>;

type CatalogRow = {
  kind: unknown;
  schema_name: unknown;
  object_name: unknown;
  identity_arguments: unknown;
  owner_name: unknown;
  managed: unknown;
};

type RoleProbe = {
  database_name: unknown;
  database_configuration_safe: unknown;
  database_create_granted_to_public: unknown;
  database_create_granted_to_other: unknown;
  migration_role: unknown;
  migration_rolcanlogin: unknown;
  migration_rolsuper: unknown;
  migration_rolbypassrls: unknown;
  migration_rolcreaterole: unknown;
  migration_rolcreatedb: unknown;
  migration_rolreplication: unknown;
  migration_has_role_membership: unknown;
  migration_has_members: unknown;
  migration_role_configuration_safe: unknown;
  migration_database_configuration_safe: unknown;
  migration_has_session_replication_role_privilege: unknown;
  migration_search_path: unknown;
  migration_session_replication_role: unknown;
  migration_database_search_path: unknown;
  migration_can_connect_database: unknown;
  migration_can_create_database_objects: unknown;
  migration_can_use_public_schema: unknown;
  migration_can_create_public_schema: unknown;
  public_schema_owner: unknown;
  public_create_granted_to_public: unknown;
  public_create_granted_to_other: unknown;
  drizzle_exists: unknown;
  drizzle_create_granted_to_public: unknown;
  drizzle_create_granted_to_other: unknown;
  migration_can_use_drizzle_schema: unknown;
  migration_can_create_drizzle_schema: unknown;
  loyalty_exists: unknown;
  loyalty_create_granted_to_public: unknown;
  loyalty_create_granted_to_other: unknown;
  migration_can_use_loyalty_schema: unknown;
  migration_can_create_loyalty_schema: unknown;
  runtime_role: unknown;
  runtime_rolcanlogin: unknown;
  runtime_rolsuper: unknown;
  runtime_rolbypassrls: unknown;
  runtime_rolcreaterole: unknown;
  runtime_rolcreatedb: unknown;
  runtime_rolreplication: unknown;
  runtime_has_role_membership: unknown;
  runtime_has_members: unknown;
  runtime_role_configuration_safe: unknown;
  runtime_database_configuration_safe: unknown;
  runtime_has_session_replication_role_privilege: unknown;
  runtime_can_connect_database: unknown;
  runtime_can_use_public_schema: unknown;
  runtime_can_use_drizzle_schema: unknown;
  runtime_can_use_loyalty_schema: unknown;
  runtime_can_create_database_objects: unknown;
  runtime_can_create_public_schema: unknown;
  runtime_can_create_drizzle_schema: unknown;
  runtime_can_create_loyalty_schema: unknown;
  runtime_owns_application_objects: unknown;
};

type JournalRow = { created_at: unknown };

type JournalPrivilegeRow = {
  table_name: unknown;
  relation_exists: unknown;
  runtime_can_select: unknown;
  runtime_has_direct_select: unknown;
  runtime_select_is_grantable: unknown;
  runtime_has_non_select: unknown;
  runtime_has_column_acl: unknown;
  public_has_any: unknown;
  public_has_column_acl: unknown;
  third_party_has_any: unknown;
  third_party_has_column_acl: unknown;
};

type ApplicationPrivilegeRow = {
  schema_name: unknown;
  table_name: unknown;
  relation_exists: unknown;
  runtime_has_required: unknown;
  runtime_has_disallowed: unknown;
  runtime_has_grant_option: unknown;
  runtime_has_column_acl: unknown;
  public_has_any: unknown;
  public_has_column_acl: unknown;
  third_party_has_any: unknown;
  third_party_has_column_acl: unknown;
};

type DefaultPrivilegeRow = {
  schema_name: unknown;
  object_type: unknown;
  grantee_name: unknown;
  privilege_type: unknown;
  is_grantable: unknown;
};

type SequencePrivilegeRow = {
  schema_name: unknown;
  sequence_name: unknown;
  relation_exists: unknown;
  runtime_can_usage: unknown;
  runtime_can_select: unknown;
  runtime_can_update: unknown;
  runtime_has_grant_option: unknown;
  public_has_any: unknown;
  third_party_has_any: unknown;
};

type AdminProbe = {
  database_name: unknown;
  database_configuration_safe: unknown;
  database_create_granted_to_public: unknown;
  database_create_granted_to_other: unknown;
  admin_role: unknown;
  session_role: unknown;
  admin_rolsuper: unknown;
  migration_role: unknown;
  migration_rolcanlogin: unknown;
  migration_rolsuper: unknown;
  migration_rolbypassrls: unknown;
  migration_rolcreaterole: unknown;
  migration_rolcreatedb: unknown;
  migration_rolreplication: unknown;
  migration_has_role_membership: unknown;
  migration_has_members: unknown;
  migration_role_configuration_safe: unknown;
  migration_database_configuration_safe: unknown;
  migration_has_session_replication_role_privilege: unknown;
  runtime_role: unknown;
  runtime_rolcanlogin: unknown;
  runtime_rolsuper: unknown;
  runtime_rolbypassrls: unknown;
  runtime_rolcreaterole: unknown;
  runtime_rolcreatedb: unknown;
  runtime_rolreplication: unknown;
  runtime_has_role_membership: unknown;
  runtime_has_members: unknown;
  runtime_role_configuration_safe: unknown;
  runtime_database_configuration_safe: unknown;
  runtime_database_search_path: unknown;
  runtime_has_session_replication_role_privilege: unknown;
  migration_database_search_path: unknown;
  public_schema_owner: unknown;
  public_create_granted_to_public: unknown;
  public_create_granted_to_other: unknown;
  drizzle_create_granted_to_public: unknown;
  drizzle_create_granted_to_other: unknown;
  loyalty_create_granted_to_public: unknown;
  loyalty_create_granted_to_other: unknown;
};

type ConnectablePool = Pick<Pool, 'connect'>;
type QueryClient = Pick<PoolClient, 'query'>;

const CATALOG_QUERY = `
WITH wanted AS (
  SELECT kind, schema_name, object_name, COALESCE(identity_arguments, '') AS identity_arguments
    FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb)
      AS entry(
        kind pg_catalog.text,
        schema_name pg_catalog.text,
        object_name pg_catalog.text,
        identity_arguments pg_catalog.text
      )
),
actual AS (
  SELECT 'schema'::pg_catalog.text AS kind,
         namespace.nspname::pg_catalog.text AS schema_name,
         namespace.nspname::pg_catalog.text AS object_name,
         ''::pg_catalog.text AS identity_arguments,
         pg_catalog.pg_get_userbyid(namespace.nspowner)::pg_catalog.text AS owner_name
    FROM pg_catalog.pg_namespace namespace
   WHERE namespace.nspname IN ('drizzle', 'loyalty')
  UNION ALL
  SELECT CASE relation.relkind
           WHEN 'S' THEN 'sequence'
           WHEN 'v' THEN 'view'
           WHEN 'm' THEN 'materialized_view'
           WHEN 'f' THEN 'foreign_table'
           ELSE 'table'
         END::pg_catalog.text AS kind,
         namespace.nspname::pg_catalog.text AS schema_name,
         relation.relname::pg_catalog.text AS object_name,
         ''::pg_catalog.text AS identity_arguments,
         pg_catalog.pg_get_userbyid(relation.relowner)::pg_catalog.text AS owner_name
    FROM pg_catalog.pg_class relation
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname IN ('public', 'drizzle', 'loyalty')
     -- Indexes, contraintes, triggers et row-types suivent la propriété de
     -- leur table. Les objets ci-dessous ont une propriété autonome.
     AND relation.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
  UNION ALL
  SELECT CASE data_type.typtype
           WHEN 'e' THEN 'type'
           WHEN 'd' THEN 'domain'
           WHEN 'r' THEN 'range'
           WHEN 'm' THEN 'multirange'
           WHEN 'c' THEN 'composite_type'
           ELSE 'base_type'
         END::pg_catalog.text AS kind,
         namespace.nspname::pg_catalog.text AS schema_name,
         data_type.typname::pg_catalog.text AS object_name,
         ''::pg_catalog.text AS identity_arguments,
         pg_catalog.pg_get_userbyid(data_type.typowner)::pg_catalog.text AS owner_name
    FROM pg_catalog.pg_type data_type
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = data_type.typnamespace
    LEFT JOIN pg_catalog.pg_class composite_relation ON composite_relation.oid = data_type.typrelid
   WHERE namespace.nspname IN ('public', 'drizzle', 'loyalty')
     AND (
       data_type.typtype IN ('e', 'd', 'r', 'm')
       OR (data_type.typtype = 'c' AND composite_relation.relkind = 'c')
       OR (
         data_type.typtype = 'b'
         AND data_type.typelem = 0
         AND data_type.typrelid = 0
       )
     )
  UNION ALL
  SELECT CASE procedure.prokind
           WHEN 'p' THEN 'procedure'
           WHEN 'a' THEN 'aggregate'
           WHEN 'w' THEN 'window_function'
           ELSE 'function'
         END::pg_catalog.text AS kind,
         namespace.nspname::pg_catalog.text AS schema_name,
         procedure.proname::pg_catalog.text AS object_name,
         pg_catalog.pg_get_function_identity_arguments(procedure.oid)::pg_catalog.text AS identity_arguments,
         pg_catalog.pg_get_userbyid(procedure.proowner)::pg_catalog.text AS owner_name
   FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname IN ('public', 'drizzle', 'loyalty')
  UNION ALL
  SELECT 'operator'::pg_catalog.text AS kind,
         namespace.nspname::pg_catalog.text AS schema_name,
         operator.oprname::pg_catalog.text AS object_name,
         pg_catalog.concat(
           CASE
             WHEN operator.oprleft = 0 THEN 'NONE'
             ELSE pg_catalog.format_type(operator.oprleft, NULL)
           END,
           ', ',
           CASE
             WHEN operator.oprright = 0 THEN 'NONE'
             ELSE pg_catalog.format_type(operator.oprright, NULL)
           END
         )::pg_catalog.text AS identity_arguments,
         pg_catalog.pg_get_userbyid(operator.oprowner)::pg_catalog.text AS owner_name
    FROM pg_catalog.pg_operator operator
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = operator.oprnamespace
   WHERE namespace.nspname IN ('public', 'drizzle', 'loyalty')
)
SELECT wanted.kind,
       wanted.schema_name,
       wanted.object_name,
       wanted.identity_arguments,
       actual.owner_name,
       true AS managed
  FROM wanted
  LEFT JOIN actual
    ON actual.kind = wanted.kind
   AND actual.schema_name = wanted.schema_name
   AND actual.object_name = wanted.object_name
   AND actual.identity_arguments = wanted.identity_arguments
UNION ALL
SELECT actual.kind,
       actual.schema_name,
       actual.object_name,
       actual.identity_arguments,
       actual.owner_name,
       false AS managed
  FROM actual
 WHERE (
   actual.schema_name IN ('drizzle', 'loyalty')
   OR (
     actual.schema_name = 'public'
     AND (
       actual.kind IN (
         'type',
         'function',
         'procedure',
         'aggregate',
         'window_function',
         'operator',
         'domain',
         'range',
         'multirange',
         'composite_type',
         'base_type'
       )
       OR EXISTS (
         SELECT 1
           FROM wanted reserved
          WHERE reserved.schema_name = actual.schema_name
            AND reserved.object_name = actual.object_name
            AND reserved.kind <> actual.kind
       )
     )
   )
 )
   AND NOT EXISTS (
     SELECT 1
       FROM wanted
      WHERE wanted.kind = actual.kind
        AND wanted.schema_name = actual.schema_name
        AND wanted.object_name = actual.object_name
        AND wanted.identity_arguments = actual.identity_arguments
   )
ORDER BY schema_name, kind, object_name, identity_arguments
`;

const ROLE_QUERY = `
SELECT pg_catalog.current_database()::pg_catalog.text AS database_name,
       NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = 0
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ) AS database_configuration_safe,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_database database
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
           ) AS privilege
          WHERE database.datname = pg_catalog.current_database()
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS database_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_database database
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
           ) AS privilege
          WHERE database.datname = pg_catalog.current_database()
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, database.datdba)
            AND privilege.privilege_type = 'CREATE'
       ) AS database_create_granted_to_other,
       migration.rolname::pg_catalog.text AS migration_role,
       migration.rolcanlogin AS migration_rolcanlogin,
       migration.rolsuper AS migration_rolsuper,
       migration.rolbypassrls AS migration_rolbypassrls,
       migration.rolcreaterole AS migration_rolcreaterole,
       migration.rolcreatedb AS migration_rolcreatedb,
       migration.rolreplication AS migration_rolreplication,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles parent
          WHERE parent.oid <> migration.oid
            AND pg_catalog.pg_has_role(migration.oid, parent.oid, 'MEMBER')
       ) AS migration_has_role_membership,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_auth_members membership
          WHERE membership.roleid = migration.oid
       ) AS migration_has_members,
       COALESCE(pg_catalog.cardinality(migration.rolconfig), 0) = 0
         AS migration_role_configuration_safe,
       COALESCE((
         SELECT role_setting.setconfig =
                  ARRAY['search_path=public, pg_catalog']::pg_catalog.text[]
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = migration.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ), false) AS migration_database_configuration_safe,
       pg_catalog.has_parameter_privilege(
         migration.oid,
         'session_replication_role',
         'SET'
       ) OR pg_catalog.has_parameter_privilege(
         migration.oid,
         'session_replication_role',
         'ALTER SYSTEM'
       ) AS migration_has_session_replication_role_privilege,
       $2::pg_catalog.text AS migration_search_path,
       $3::pg_catalog.text AS migration_session_replication_role,
       COALESCE((
         SELECT setting
           FROM pg_catalog.pg_db_role_setting role_setting
           CROSS JOIN LATERAL pg_catalog.unnest(role_setting.setconfig) AS setting
          WHERE role_setting.setrole = migration.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
            AND setting LIKE 'search_path=%'
          LIMIT 1
       ), '')::pg_catalog.text AS migration_database_search_path,
       pg_catalog.has_database_privilege(
         migration.oid,
         pg_catalog.current_database(),
         'CONNECT'
       ) AS migration_can_connect_database,
       pg_catalog.has_database_privilege(
         migration.oid,
         pg_catalog.current_database(),
         'CREATE'
       ) AS migration_can_create_database_objects,
       pg_catalog.has_schema_privilege(migration.oid, 'public', 'USAGE') AS migration_can_use_public_schema,
       pg_catalog.has_schema_privilege(migration.oid, 'public', 'CREATE') AS migration_can_create_public_schema,
       pg_catalog.pg_get_userbyid(public_namespace.nspowner)::pg_catalog.text AS public_schema_owner,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               public_namespace.nspacl,
               pg_catalog.acldefault('n', public_namespace.nspowner)
             )
           ) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS public_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               public_namespace.nspacl,
               pg_catalog.acldefault('n', public_namespace.nspowner)
             )
           ) AS privilege
          WHERE privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, public_namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS public_create_granted_to_other,
       pg_catalog.to_regnamespace('drizzle') IS NOT NULL AS drizzle_exists,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               namespace.nspacl,
               pg_catalog.acldefault('n', namespace.nspowner)
             )
           ) AS privilege
          WHERE namespace.nspname = 'drizzle'
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS drizzle_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               namespace.nspacl,
               pg_catalog.acldefault('n', namespace.nspowner)
             )
           ) AS privilege
          WHERE namespace.nspname = 'drizzle'
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS drizzle_create_granted_to_other,
       COALESCE(pg_catalog.has_schema_privilege(migration.oid, pg_catalog.to_regnamespace('drizzle'), 'USAGE'), false)
         AS migration_can_use_drizzle_schema,
       COALESCE(pg_catalog.has_schema_privilege(migration.oid, pg_catalog.to_regnamespace('drizzle'), 'CREATE'), false)
         AS migration_can_create_drizzle_schema,
       pg_catalog.to_regnamespace('loyalty') IS NOT NULL AS loyalty_exists,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               namespace.nspacl,
               pg_catalog.acldefault('n', namespace.nspowner)
             )
           ) AS privilege
          WHERE namespace.nspname = 'loyalty'
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS loyalty_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               namespace.nspacl,
               pg_catalog.acldefault('n', namespace.nspowner)
             )
           ) AS privilege
          WHERE namespace.nspname = 'loyalty'
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS loyalty_create_granted_to_other,
       COALESCE(pg_catalog.has_schema_privilege(migration.oid, pg_catalog.to_regnamespace('loyalty'), 'USAGE'), false)
         AS migration_can_use_loyalty_schema,
       COALESCE(pg_catalog.has_schema_privilege(migration.oid, pg_catalog.to_regnamespace('loyalty'), 'CREATE'), false)
         AS migration_can_create_loyalty_schema,
       runtime.rolname::pg_catalog.text AS runtime_role,
       runtime.rolcanlogin AS runtime_rolcanlogin,
       runtime.rolsuper AS runtime_rolsuper,
       runtime.rolbypassrls AS runtime_rolbypassrls,
       runtime.rolcreaterole AS runtime_rolcreaterole,
       runtime.rolcreatedb AS runtime_rolcreatedb,
       runtime.rolreplication AS runtime_rolreplication,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles parent
          WHERE parent.oid <> runtime.oid
            AND pg_catalog.pg_has_role(runtime.oid, parent.oid, 'MEMBER')
       ) AS runtime_has_role_membership,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_auth_members membership
          WHERE membership.roleid = runtime.oid
       ) AS runtime_has_members,
       COALESCE(pg_catalog.cardinality(runtime.rolconfig), 0) = 0
         AS runtime_role_configuration_safe,
       COALESCE((
         SELECT role_setting.setconfig =
                  ARRAY['search_path=pg_catalog, public']::pg_catalog.text[]
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = runtime.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ), false) AS runtime_database_configuration_safe,
       pg_catalog.has_parameter_privilege(
         runtime.oid,
         'session_replication_role',
         'SET'
       ) OR pg_catalog.has_parameter_privilege(
         runtime.oid,
         'session_replication_role',
         'ALTER SYSTEM'
       ) AS runtime_has_session_replication_role_privilege,
       pg_catalog.has_database_privilege(
         runtime.oid,
         pg_catalog.current_database(),
         'CONNECT'
       ) AS runtime_can_connect_database,
       pg_catalog.has_schema_privilege(runtime.oid, 'public', 'USAGE')
         AS runtime_can_use_public_schema,
       COALESCE(
         pg_catalog.has_schema_privilege(
           runtime.oid,
           pg_catalog.to_regnamespace('drizzle'),
           'USAGE'
         ),
         false
       ) AS runtime_can_use_drizzle_schema,
       COALESCE(
         pg_catalog.has_schema_privilege(
           runtime.oid,
           pg_catalog.to_regnamespace('loyalty'),
           'USAGE'
         ),
         false
       ) AS runtime_can_use_loyalty_schema,
       pg_catalog.has_database_privilege(runtime.oid, pg_catalog.current_database(), 'CREATE')
         AS runtime_can_create_database_objects,
       pg_catalog.has_schema_privilege(runtime.oid, 'public', 'CREATE') AS runtime_can_create_public_schema,
       COALESCE(pg_catalog.has_schema_privilege(runtime.oid, pg_catalog.to_regnamespace('drizzle'), 'CREATE'), false)
         AS runtime_can_create_drizzle_schema,
       COALESCE(pg_catalog.has_schema_privilege(runtime.oid, pg_catalog.to_regnamespace('loyalty'), 'CREATE'), false)
         AS runtime_can_create_loyalty_schema,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE relation.relowner = runtime.oid
            AND namespace.nspname !~ '^pg_'
            AND namespace.nspname <> 'information_schema'
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
          WHERE namespace.nspowner = runtime.oid
            AND namespace.nspname !~ '^pg_'
            AND namespace.nspname <> 'information_schema'
       ) OR EXISTS (
         SELECT 1
          FROM pg_catalog.pg_type data_type
          JOIN pg_catalog.pg_namespace namespace ON namespace.oid = data_type.typnamespace
         WHERE data_type.typowner = runtime.oid
            AND namespace.nspname !~ '^pg_'
            AND namespace.nspname <> 'information_schema'
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_proc procedure
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
         WHERE procedure.proowner = runtime.oid
            AND namespace.nspname !~ '^pg_'
            AND namespace.nspname <> 'information_schema'
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_operator operator
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = operator.oprnamespace
         WHERE operator.oprowner = runtime.oid
            AND namespace.nspname !~ '^pg_'
            AND namespace.nspname <> 'information_schema'
       ) AS runtime_owns_application_objects
  FROM pg_catalog.pg_roles migration
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname = $1
  JOIN pg_catalog.pg_namespace public_namespace ON public_namespace.nspname = 'public'
 WHERE migration.rolname = current_user
`;

const ADMIN_QUERY = `
SELECT pg_catalog.current_database()::pg_catalog.text AS database_name,
       NOT EXISTS (
         SELECT 1
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = 0
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ) AS database_configuration_safe,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_database database
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
           ) AS privilege
          WHERE database.datname = pg_catalog.current_database()
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS database_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_database database
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(database.datacl, pg_catalog.acldefault('d', database.datdba))
           ) AS privilege
          WHERE database.datname = pg_catalog.current_database()
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, database.datdba)
            AND privilege.privilege_type = 'CREATE'
       ) AS database_create_granted_to_other,
       admin.rolname::pg_catalog.text AS admin_role,
       session_user::pg_catalog.text AS session_role,
       admin.rolsuper AS admin_rolsuper,
       migration.rolname::pg_catalog.text AS migration_role,
       migration.rolcanlogin AS migration_rolcanlogin,
       migration.rolsuper AS migration_rolsuper,
       migration.rolbypassrls AS migration_rolbypassrls,
       migration.rolcreaterole AS migration_rolcreaterole,
       migration.rolcreatedb AS migration_rolcreatedb,
       migration.rolreplication AS migration_rolreplication,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles parent
          WHERE parent.oid <> migration.oid
            AND pg_catalog.pg_has_role(migration.oid, parent.oid, 'MEMBER')
       ) AS migration_has_role_membership,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_auth_members membership
          WHERE membership.roleid = migration.oid
       ) AS migration_has_members,
       COALESCE(pg_catalog.cardinality(migration.rolconfig), 0) = 0
         AS migration_role_configuration_safe,
       COALESCE((
         SELECT NOT EXISTS (
                  SELECT 1
                    FROM pg_catalog.unnest(role_setting.setconfig) AS setting
                   WHERE setting NOT LIKE 'search_path=%'
                )
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = migration.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ), true) AS migration_database_configuration_safe,
       pg_catalog.has_parameter_privilege(
         migration.oid,
         'session_replication_role',
         'SET'
       ) OR pg_catalog.has_parameter_privilege(
         migration.oid,
         'session_replication_role',
         'ALTER SYSTEM'
       ) AS migration_has_session_replication_role_privilege,
       runtime.rolname::pg_catalog.text AS runtime_role,
       runtime.rolcanlogin AS runtime_rolcanlogin,
       runtime.rolsuper AS runtime_rolsuper,
       runtime.rolbypassrls AS runtime_rolbypassrls,
       runtime.rolcreaterole AS runtime_rolcreaterole,
       runtime.rolcreatedb AS runtime_rolcreatedb,
       runtime.rolreplication AS runtime_rolreplication,
       EXISTS (
         SELECT 1 FROM pg_catalog.pg_roles parent
          WHERE parent.oid <> runtime.oid
            AND pg_catalog.pg_has_role(runtime.oid, parent.oid, 'MEMBER')
       ) AS runtime_has_role_membership,
       EXISTS (
         SELECT 1
           FROM pg_catalog.pg_auth_members membership
          WHERE membership.roleid = runtime.oid
       ) AS runtime_has_members,
       COALESCE(pg_catalog.cardinality(runtime.rolconfig), 0) = 0
         AS runtime_role_configuration_safe,
       COALESCE((
         SELECT NOT EXISTS (
                  SELECT 1
                    FROM pg_catalog.unnest(role_setting.setconfig) AS setting
                   WHERE setting NOT LIKE 'search_path=%'
                )
           FROM pg_catalog.pg_db_role_setting role_setting
          WHERE role_setting.setrole = runtime.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
       ), true) AS runtime_database_configuration_safe,
       pg_catalog.has_parameter_privilege(
         runtime.oid,
         'session_replication_role',
         'SET'
       ) OR pg_catalog.has_parameter_privilege(
         runtime.oid,
         'session_replication_role',
         'ALTER SYSTEM'
       ) AS runtime_has_session_replication_role_privilege,
       COALESCE((
         SELECT setting
           FROM pg_catalog.pg_db_role_setting role_setting
           CROSS JOIN LATERAL pg_catalog.unnest(role_setting.setconfig) AS setting
          WHERE role_setting.setrole = migration.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
            AND setting LIKE 'search_path=%'
          LIMIT 1
       ), '')::pg_catalog.text AS migration_database_search_path,
       COALESCE((
         SELECT setting
           FROM pg_catalog.pg_db_role_setting role_setting
           CROSS JOIN LATERAL pg_catalog.unnest(role_setting.setconfig) AS setting
          WHERE role_setting.setrole = runtime.oid
            AND role_setting.setdatabase = (
              SELECT database.oid
                FROM pg_catalog.pg_database database
               WHERE database.datname = pg_catalog.current_database()
            )
            AND setting LIKE 'search_path=%'
          LIMIT 1
       ), '')::pg_catalog.text AS runtime_database_search_path,
       pg_catalog.pg_get_userbyid(public_namespace.nspowner)::pg_catalog.text AS public_schema_owner,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               public_namespace.nspacl,
               pg_catalog.acldefault('n', public_namespace.nspowner)
             )
           ) AS privilege
          WHERE privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS public_create_granted_to_public,
       EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               public_namespace.nspacl,
               pg_catalog.acldefault('n', public_namespace.nspowner)
             )
           ) AS privilege
          WHERE privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, public_namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS public_create_granted_to_other
       , EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
           ) AS privilege
          WHERE namespace.nspname = 'drizzle'
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS drizzle_create_granted_to_public
       , EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
           ) AS privilege
          WHERE namespace.nspname = 'drizzle'
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS drizzle_create_granted_to_other
       , EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
           ) AS privilege
          WHERE namespace.nspname = 'loyalty'
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'CREATE'
       ) AS loyalty_create_granted_to_public
       , EXISTS (
         SELECT 1
           FROM pg_catalog.pg_namespace namespace
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
           ) AS privilege
          WHERE namespace.nspname = 'loyalty'
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (migration.oid, namespace.nspowner)
            AND privilege.privilege_type = 'CREATE'
       ) AS loyalty_create_granted_to_other
  FROM pg_catalog.pg_roles admin
  JOIN pg_catalog.pg_roles migration ON migration.rolname = $1
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname = $2
  JOIN pg_catalog.pg_namespace public_namespace ON public_namespace.nspname = 'public'
 WHERE admin.rolname = current_user
`;

const EFFECTIVE_SEARCH_PATH_QUERY = `
SELECT pg_catalog.current_setting('search_path')::pg_catalog.text AS effective_search_path,
       pg_catalog.current_setting('session_replication_role')::pg_catalog.text
         AS effective_session_replication_role
`;

const JOURNAL_PRIVILEGE_QUERY = `
WITH wanted AS (
  SELECT table_name
    FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb)
      AS entry(table_name pg_catalog.text)
)
SELECT wanted.table_name,
       relation.oid IS NOT NULL AS relation_exists,
       COALESCE(
         pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'SELECT'),
         false
       ) AS runtime_can_select,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee = runtime.oid
            AND privilege.privilege_type = 'SELECT'
       ) END AS runtime_has_direct_select,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee = runtime.oid
            AND privilege.privilege_type = 'SELECT'
            AND privilege.is_grantable
       ) END AS runtime_select_is_grantable,
       COALESCE(
         pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'INSERT')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'UPDATE')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'DELETE')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'TRIGGER')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'MAINTAIN'),
         false
       ) AS runtime_has_non_select,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee = runtime.oid
       ) END AS runtime_has_column_acl,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee = 0
       ) END AS public_has_any,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee = 0
       ) END AS public_has_column_acl,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee <> 0
            AND privilege.grantee NOT IN (relation.relowner, runtime.oid)
       ) END AS third_party_has_any,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (relation.relowner, runtime.oid)
       ) END AS third_party_has_column_acl
  FROM wanted
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname = $2
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = 'drizzle'
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = wanted.table_name
   AND relation.relkind IN ('r', 'p')
 ORDER BY wanted.table_name
`;

const APPLICATION_PRIVILEGE_QUERY = `
WITH wanted AS (
  SELECT schema_name, table_name
    FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb)
      AS entry(schema_name pg_catalog.text, table_name pg_catalog.text)
)
SELECT wanted.schema_name,
       wanted.table_name,
       relation.oid IS NOT NULL AS relation_exists,
       CASE WHEN relation.oid IS NULL THEN false ELSE
         EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
           ) AS privilege
            WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'SELECT'
         ) AND EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
           ) AS privilege
            WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'INSERT'
         ) AND EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
           ) AS privilege
            WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'UPDATE'
         ) AND EXISTS (
           SELECT 1 FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
           ) AS privilege
            WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'DELETE'
         )
       END AS runtime_has_required,
       COALESCE(
         pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'TRUNCATE')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'REFERENCES')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'TRIGGER')
         OR pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'MAINTAIN'),
         false
       ) AS runtime_has_disallowed,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee = runtime.oid
            AND privilege.is_grantable
       ) END AS runtime_has_grant_option,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee = runtime.oid
       ) END AS runtime_has_column_acl,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee = 0
       ) END AS public_has_any,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee = 0
       ) END AS public_has_column_acl,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation.relacl,
               pg_catalog.acldefault('r', relation.relowner)
             )
           ) AS privilege
          WHERE privilege.grantee <> 0
            AND privilege.grantee NOT IN (relation.relowner, runtime.oid)
       ) END AS third_party_has_any,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS privilege
          WHERE attribute.attrelid = relation.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND privilege.grantee <> 0
            AND privilege.grantee NOT IN (relation.relowner, runtime.oid)
       ) END AS third_party_has_column_acl
  FROM wanted
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname = $2
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = wanted.schema_name
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = wanted.table_name
   AND relation.relkind IN ('r', 'p')
 ORDER BY wanted.schema_name, wanted.table_name
`;

const DEFAULT_PRIVILEGE_QUERY = `
SELECT COALESCE(namespace.nspname, '*')::pg_catalog.text AS schema_name,
       default_acl.defaclobjtype::pg_catalog.text AS object_type,
       CASE privilege.grantee
         WHEN 0 THEN 'PUBLIC'
         ELSE pg_catalog.pg_get_userbyid(privilege.grantee)
       END::pg_catalog.text AS grantee_name,
       privilege.privilege_type::pg_catalog.text AS privilege_type,
       privilege.is_grantable
  FROM pg_catalog.pg_roles migration
  JOIN pg_catalog.pg_default_acl default_acl ON default_acl.defaclrole = migration.oid
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.oid = default_acl.defaclnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS privilege
 WHERE migration.rolname = $1
 ORDER BY schema_name, object_type, grantee_name, privilege_type
`;

const SEQUENCE_PRIVILEGE_QUERY = `
WITH wanted AS (
  SELECT schema_name, sequence_name
    FROM pg_catalog.jsonb_to_recordset($1::pg_catalog.jsonb)
      AS entry(schema_name pg_catalog.text, sequence_name pg_catalog.text)
)
SELECT wanted.schema_name,
       wanted.sequence_name,
       relation.oid IS NOT NULL AS relation_exists,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
         ) AS privilege
          WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'USAGE'
       ) END AS runtime_can_usage,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
         ) AS privilege
          WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'SELECT'
       ) END AS runtime_can_select,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1 FROM pg_catalog.aclexplode(
           COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
         ) AS privilege
          WHERE privilege.grantee = runtime.oid AND privilege.privilege_type = 'UPDATE'
       ) END AS runtime_can_update,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
           ) AS privilege
          WHERE privilege.grantee = runtime.oid
            AND privilege.is_grantable
       ) END AS runtime_has_grant_option,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
           ) AS privilege
          WHERE privilege.grantee = 0
       ) END AS public_has_any,
       CASE WHEN relation.oid IS NULL THEN false ELSE EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(relation.relacl, pg_catalog.acldefault('S', relation.relowner))
           ) AS privilege
          WHERE privilege.grantee <> 0
            AND privilege.grantee NOT IN (relation.relowner, runtime.oid)
       ) END AS third_party_has_any
  FROM wanted
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname = $2
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname = wanted.schema_name
  LEFT JOIN pg_catalog.pg_class relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = wanted.sequence_name
   AND relation.relkind = 'S'
 ORDER BY wanted.schema_name, wanted.sequence_name
`;

function assertRoleNames(roles: BootstrapRoles): void {
  if (!ROLE_NAME.test(roles.migrationRole)) {
    throw new Error('DATABASE_MIGRATION_ROLE invalide');
  }
  if (!ROLE_NAME.test(roles.runtimeRole)) {
    throw new Error('DATABASE_RUNTIME_ROLE invalide');
  }
  if (roles.migrationRole === roles.runtimeRole) {
    throw new Error('Les rôles migration et runtime doivent être distincts');
  }
}

function canonicalSearchPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .split(',')
    .map((schema) => schema.trim())
    .join(',');
}

function canonicalStoredSearchPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('search_path=')) return null;
  return canonicalSearchPath(value.slice('search_path='.length));
}

function catalogPayload(): string {
  return JSON.stringify(
    POSTGRES_MANAGED_OBJECTS.map((object) => ({
      kind: object.kind,
      schema_name: object.schema,
      object_name: object.name,
      identity_arguments: object.identityArguments,
    })),
  );
}

function journalPrivilegePayload(): string {
  return JSON.stringify(
    (Object.keys(JOURNALS) as MigrationJournal[]).map((journal) => ({
      table_name: JOURNALS[journal].table,
    })),
  );
}

function applicationTables(): readonly ManagedObject[] {
  return POSTGRES_MANAGED_OBJECTS.filter(
    (object) => object.kind === 'table' && object.schema !== 'drizzle',
  );
}

function applicationPrivilegePayload(): string {
  return JSON.stringify(
    applicationTables().map((table) => ({
      schema_name: table.schema,
      table_name: table.name,
    })),
  );
}

function managedSequences(): readonly ManagedObject[] {
  return POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'sequence');
}

function sequencePrivilegePayload(): string {
  return JSON.stringify(
    managedSequences().map((sequence) => ({
      schema_name: sequence.schema,
      sequence_name: sequence.name,
    })),
  );
}

type JournalPrivilege = Readonly<{
  tableName: string;
  exists: boolean;
  runtimeCanSelect: boolean;
  runtimeHasDirectSelect: boolean;
  runtimeSelectIsGrantable: boolean;
  runtimeHasNonSelect: boolean;
  runtimeHasColumnAcl: boolean;
  publicHasAny: boolean;
  publicHasColumnAcl: boolean;
  thirdPartyHasAny: boolean;
  thirdPartyHasColumnAcl: boolean;
}>;

async function readJournalPrivileges(
  client: QueryClient,
  runtimeRole: string,
): Promise<readonly JournalPrivilege[]> {
  const result = await client.query<JournalPrivilegeRow>(JOURNAL_PRIVILEGE_QUERY, [
    journalPrivilegePayload(),
    runtimeRole,
  ]);
  const expectedNames = new Set(Object.values(JOURNALS).map((journal) => journal.table));
  const seen = new Set<string>();
  const privileges = result.rows.map((row): JournalPrivilege => {
    if (
      typeof row.table_name !== 'string' ||
      !expectedNames.has(row.table_name) ||
      seen.has(row.table_name) ||
      typeof row.relation_exists !== 'boolean' ||
      typeof row.runtime_can_select !== 'boolean' ||
      typeof row.runtime_has_direct_select !== 'boolean' ||
      typeof row.runtime_select_is_grantable !== 'boolean' ||
      typeof row.runtime_has_non_select !== 'boolean' ||
      typeof row.runtime_has_column_acl !== 'boolean' ||
      typeof row.public_has_any !== 'boolean' ||
      typeof row.public_has_column_acl !== 'boolean' ||
      typeof row.third_party_has_any !== 'boolean' ||
      typeof row.third_party_has_column_acl !== 'boolean'
    ) {
      throw new Error('La sonde ACL des journaux PostgreSQL est illisible');
    }
    seen.add(row.table_name);
    return {
      tableName: row.table_name,
      exists: row.relation_exists,
      runtimeCanSelect: row.runtime_can_select,
      runtimeHasDirectSelect: row.runtime_has_direct_select,
      runtimeSelectIsGrantable: row.runtime_select_is_grantable,
      runtimeHasNonSelect: row.runtime_has_non_select,
      runtimeHasColumnAcl: row.runtime_has_column_acl,
      publicHasAny: row.public_has_any,
      publicHasColumnAcl: row.public_has_column_acl,
      thirdPartyHasAny: row.third_party_has_any,
      thirdPartyHasColumnAcl: row.third_party_has_column_acl,
    };
  });
  if (seen.size !== expectedNames.size) {
    throw new Error('La sonde ACL des journaux PostgreSQL est incomplète');
  }
  return privileges;
}

function appendJournalPrivilegeIssues(
  privileges: readonly JournalPrivilege[],
  runtimeRole: string,
  issues: BootstrapIssue[],
): void {
  for (const privilege of privileges) {
    if (!privilege.exists) continue;
    const target = `drizzle.${privilege.tableName}`;
    if (!privilege.runtimeCanSelect || !privilege.runtimeHasDirectSelect) {
      issues.push({
        code: 'journal_privilege_missing',
        target,
        expected: `SELECT accordé à ${runtimeRole}`,
        actual: 'SELECT refusé',
      });
    }
    if (
      privilege.runtimeSelectIsGrantable ||
      privilege.runtimeHasNonSelect ||
      privilege.runtimeHasColumnAcl ||
      privilege.publicHasAny ||
      privilege.publicHasColumnAcl ||
      privilege.thirdPartyHasAny ||
      privilege.thirdPartyHasColumnAcl
    ) {
      issues.push({
        code: 'journal_privilege_excessive',
        target,
        expected: `${runtimeRole}=SELECT uniquement ; PUBLIC=aucun privilège`,
        actual: `runtime_select_grantable=${String(privilege.runtimeSelectIsGrantable)}; runtime_non_select=${String(privilege.runtimeHasNonSelect)}; runtime_column_acl=${String(privilege.runtimeHasColumnAcl)}; public_any=${String(privilege.publicHasAny)}; public_column_acl=${String(privilege.publicHasColumnAcl)}; third_party_any=${String(privilege.thirdPartyHasAny)}; third_party_column_acl=${String(privilege.thirdPartyHasColumnAcl)}`,
      });
    }
  }
}

type ApplicationPrivilege = Readonly<{
  schema: string;
  tableName: string;
  exists: boolean;
  runtimeHasRequired: boolean;
  runtimeHasDisallowed: boolean;
  runtimeHasGrantOption: boolean;
  runtimeHasColumnAcl: boolean;
  publicHasAny: boolean;
  publicHasColumnAcl: boolean;
  thirdPartyHasAny: boolean;
  thirdPartyHasColumnAcl: boolean;
}>;

async function readApplicationPrivileges(
  client: QueryClient,
  runtimeRole: string,
): Promise<readonly ApplicationPrivilege[]> {
  const result = await client.query<ApplicationPrivilegeRow>(APPLICATION_PRIVILEGE_QUERY, [
    applicationPrivilegePayload(),
    runtimeRole,
  ]);
  const expected = new Set(applicationTables().map((table) => `${table.schema}.${table.name}`));
  const seen = new Set<string>();
  const privileges = result.rows.map((row): ApplicationPrivilege => {
    const key = `${String(row.schema_name)}.${String(row.table_name)}`;
    if (
      typeof row.schema_name !== 'string' ||
      typeof row.table_name !== 'string' ||
      !expected.has(key) ||
      seen.has(key) ||
      typeof row.relation_exists !== 'boolean' ||
      typeof row.runtime_has_required !== 'boolean' ||
      typeof row.runtime_has_disallowed !== 'boolean' ||
      typeof row.runtime_has_grant_option !== 'boolean' ||
      typeof row.runtime_has_column_acl !== 'boolean' ||
      typeof row.public_has_any !== 'boolean' ||
      typeof row.public_has_column_acl !== 'boolean' ||
      typeof row.third_party_has_any !== 'boolean' ||
      typeof row.third_party_has_column_acl !== 'boolean'
    ) {
      throw new Error('La sonde ACL des tables applicatives est illisible');
    }
    seen.add(key);
    return {
      schema: row.schema_name,
      tableName: row.table_name,
      exists: row.relation_exists,
      runtimeHasRequired: row.runtime_has_required,
      runtimeHasDisallowed: row.runtime_has_disallowed,
      runtimeHasGrantOption: row.runtime_has_grant_option,
      runtimeHasColumnAcl: row.runtime_has_column_acl,
      publicHasAny: row.public_has_any,
      publicHasColumnAcl: row.public_has_column_acl,
      thirdPartyHasAny: row.third_party_has_any,
      thirdPartyHasColumnAcl: row.third_party_has_column_acl,
    };
  });
  if (seen.size !== expected.size) {
    throw new Error('La sonde ACL des tables applicatives est incomplète');
  }
  return privileges;
}

function appendApplicationPrivilegeIssues(
  privileges: readonly ApplicationPrivilege[],
  runtimeRole: string,
  issues: BootstrapIssue[],
): void {
  for (const privilege of privileges) {
    if (!privilege.exists) continue;
    if (!privilege.runtimeHasRequired) {
      issues.push({
        code: 'application_privilege_missing',
        target: `${privilege.schema}.${privilege.tableName}`,
        expected: `${runtimeRole}=SELECT,INSERT,UPDATE,DELETE`,
        actual: 'au moins un privilège DML effectif manque',
      });
    }
    if (
      privilege.runtimeHasDisallowed ||
      privilege.runtimeHasGrantOption ||
      privilege.runtimeHasColumnAcl ||
      privilege.publicHasAny ||
      privilege.publicHasColumnAcl ||
      privilege.thirdPartyHasAny ||
      privilege.thirdPartyHasColumnAcl
    ) {
      issues.push({
        code: 'application_privilege_excessive',
        target: `${privilege.schema}.${privilege.tableName}`,
        expected: `${runtimeRole}=DML sans grant option ; PUBLIC/tiers=aucun privilège`,
        actual: `runtime_disallowed=${String(privilege.runtimeHasDisallowed)}; runtime_grant_option=${String(privilege.runtimeHasGrantOption)}; runtime_column_acl=${String(privilege.runtimeHasColumnAcl)}; public_any=${String(privilege.publicHasAny)}; public_column_acl=${String(privilege.publicHasColumnAcl)}; third_party_any=${String(privilege.thirdPartyHasAny)}; third_party_column_acl=${String(privilege.thirdPartyHasColumnAcl)}`,
      });
    }
  }
}

type SequencePrivilege = Readonly<{
  schema: string;
  sequenceName: string;
  exists: boolean;
  runtimeCanUsage: boolean;
  runtimeCanSelect: boolean;
  runtimeCanUpdate: boolean;
  runtimeHasGrantOption: boolean;
  publicHasAny: boolean;
  thirdPartyHasAny: boolean;
}>;

async function readSequencePrivileges(
  client: QueryClient,
  runtimeRole: string,
): Promise<readonly SequencePrivilege[]> {
  const result = await client.query<SequencePrivilegeRow>(SEQUENCE_PRIVILEGE_QUERY, [
    sequencePrivilegePayload(),
    runtimeRole,
  ]);
  const expected = new Set(
    managedSequences().map((sequence) => `${sequence.schema}.${sequence.name}`),
  );
  const seen = new Set<string>();
  const privileges = result.rows.map((row): SequencePrivilege => {
    const objectKey = `${String(row.schema_name)}.${String(row.sequence_name)}`;
    if (
      typeof row.schema_name !== 'string' ||
      typeof row.sequence_name !== 'string' ||
      !expected.has(objectKey) ||
      seen.has(objectKey) ||
      typeof row.relation_exists !== 'boolean' ||
      typeof row.runtime_can_usage !== 'boolean' ||
      typeof row.runtime_can_select !== 'boolean' ||
      typeof row.runtime_can_update !== 'boolean' ||
      typeof row.runtime_has_grant_option !== 'boolean' ||
      typeof row.public_has_any !== 'boolean' ||
      typeof row.third_party_has_any !== 'boolean'
    ) {
      throw new Error('La sonde ACL des séquences PostgreSQL est illisible');
    }
    seen.add(objectKey);
    return {
      schema: row.schema_name,
      sequenceName: row.sequence_name,
      exists: row.relation_exists,
      runtimeCanUsage: row.runtime_can_usage,
      runtimeCanSelect: row.runtime_can_select,
      runtimeCanUpdate: row.runtime_can_update,
      runtimeHasGrantOption: row.runtime_has_grant_option,
      publicHasAny: row.public_has_any,
      thirdPartyHasAny: row.third_party_has_any,
    };
  });
  if (seen.size !== expected.size) {
    throw new Error('La sonde ACL des séquences PostgreSQL est incomplète');
  }
  return privileges;
}

function appendSequencePrivilegeIssues(
  privileges: readonly SequencePrivilege[],
  runtimeRole: string,
  issues: BootstrapIssue[],
): void {
  for (const privilege of privileges) {
    if (!privilege.exists) continue;
    const target = `${privilege.schema}.${privilege.sequenceName}`;
    const runtimeAllowed = privilege.schema !== 'drizzle';
    const runtimeHasAny =
      privilege.runtimeCanUsage || privilege.runtimeCanSelect || privilege.runtimeCanUpdate;
    if (
      runtimeAllowed &&
      (!privilege.runtimeCanUsage ||
        !privilege.runtimeCanSelect ||
        !privilege.runtimeCanUpdate)
    ) {
      issues.push({
        code: 'sequence_privilege_missing',
        target,
        expected: `${runtimeRole}=USAGE,SELECT,UPDATE`,
        actual: 'au moins un privilège effectif manque',
      });
    }
    if (
      (!runtimeAllowed && runtimeHasAny) ||
      privilege.runtimeHasGrantOption ||
      privilege.publicHasAny ||
      privilege.thirdPartyHasAny
    ) {
      issues.push({
        code: 'sequence_privilege_excessive',
        target,
        expected: runtimeAllowed
          ? `${runtimeRole}=USAGE,SELECT,UPDATE sans grant option ; PUBLIC/tiers=aucun`
          : `${runtimeRole}/PUBLIC/tiers=aucun privilège`,
        actual: `runtime_usage=${String(privilege.runtimeCanUsage)}; runtime_select=${String(privilege.runtimeCanSelect)}; runtime_update=${String(privilege.runtimeCanUpdate)}; runtime_grantable=${String(privilege.runtimeHasGrantOption)}; public_any=${String(privilege.publicHasAny)}; third_party_any=${String(privilege.thirdPartyHasAny)}`,
      });
    }
  }
}

type DefaultPrivilege = Readonly<{
  schema: string;
  objectType: string;
  grantee: string;
  privilege: string;
  grantable: boolean;
}>;

async function readDefaultPrivileges(
  client: QueryClient,
  migrationRole: string,
): Promise<readonly DefaultPrivilege[]> {
  const result = await client.query<DefaultPrivilegeRow>(DEFAULT_PRIVILEGE_QUERY, [
    migrationRole,
  ]);
  return result.rows.map((row): DefaultPrivilege => {
    if (
      typeof row.schema_name !== 'string' ||
      typeof row.object_type !== 'string' ||
      typeof row.grantee_name !== 'string' ||
      typeof row.privilege_type !== 'string' ||
      typeof row.is_grantable !== 'boolean'
    ) {
      throw new Error('La sonde des privilèges par défaut PostgreSQL est illisible');
    }
    return {
      schema: row.schema_name,
      objectType: row.object_type,
      grantee: row.grantee_name,
      privilege: row.privilege_type,
      grantable: row.is_grantable,
    };
  });
}

function defaultPrivilegeAllowed(
  privilege: DefaultPrivilege,
  roles: BootstrapRoles,
): boolean {
  if (privilege.grantee === roles.migrationRole) return true;
  if (privilege.grantee !== roles.runtimeRole || privilege.grantable) return false;
  if (!['public', 'loyalty'].includes(privilege.schema)) return false;
  if (privilege.objectType === 'r') {
    return ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(privilege.privilege);
  }
  if (privilege.objectType === 'S') {
    return ['USAGE', 'SELECT', 'UPDATE'].includes(privilege.privilege);
  }
  return false;
}

function appendDefaultPrivilegeIssues(
  privileges: readonly DefaultPrivilege[],
  roles: BootstrapRoles,
  issues: BootstrapIssue[],
): void {
  for (const privilege of privileges) {
    if (defaultPrivilegeAllowed(privilege, roles)) continue;
    issues.push({
      code: 'default_privilege_excessive',
      target: `${privilege.schema}:${privilege.objectType}:${privilege.grantee}`,
      expected:
        'migrateur propriétaire ou runtime DML/sequence sans grant option dans public/loyalty',
      actual: `${privilege.privilege}; grantable=${String(privilege.grantable)}`,
    });
  }
}

function parseCatalogRow(row: CatalogRow): CatalogObject {
  if (
    ![
      'schema',
      'table',
      'sequence',
      'type',
      'function',
      'view',
      'materialized_view',
      'foreign_table',
      'procedure',
      'aggregate',
      'window_function',
      'operator',
      'domain',
      'range',
      'multirange',
      'composite_type',
      'base_type',
    ].includes(String(row.kind)) ||
    typeof row.schema_name !== 'string' ||
    typeof row.object_name !== 'string' ||
    typeof row.identity_arguments !== 'string' ||
    (row.owner_name !== null && typeof row.owner_name !== 'string') ||
    typeof row.managed !== 'boolean'
  ) {
    throw new Error('Le catalogue PostgreSQL a renvoyé un objet illisible');
  }
  return {
    kind: row.kind as CatalogObjectKind,
    schema: row.schema_name,
    name: row.object_name,
    identityArguments: row.identity_arguments,
    owner: row.owner_name,
    managed: row.managed,
  };
}

function roleIssues(row: RoleProbe | undefined, roles: BootstrapRoles): BootstrapIssue[] {
  if (!row) {
    return [
      {
        code: 'migration_role_unsafe',
        target: roles.migrationRole,
        expected: 'rôles migration et runtime présents',
        actual: 'sonde vide',
      },
    ];
  }

  const issues: BootstrapIssue[] = [];
  if (
    row.database_create_granted_to_public !== false ||
    row.database_create_granted_to_other !== false
  ) {
    issues.push({
      code: 'database_privilege_excessive',
      target: `database:${String(row.database_name ?? 'inconnue')}:CREATE`,
      expected: `CREATE limité au propriétaire et à ${roles.migrationRole}`,
      actual: `public=${String(row.database_create_granted_to_public)}; other=${String(row.database_create_granted_to_other)}`,
    });
  }
  const migrationUnsafe =
    row.migration_role !== roles.migrationRole ||
    row.migration_rolcanlogin !== true ||
    row.migration_rolsuper !== false ||
    row.migration_rolbypassrls !== false ||
    row.migration_rolcreaterole !== false ||
    row.migration_rolcreatedb !== false ||
    row.migration_rolreplication !== false ||
    row.migration_has_role_membership !== false ||
    row.migration_has_members !== false ||
    canonicalSearchPath(row.migration_search_path) !== SAFE_SEARCH_PATH ||
    canonicalStoredSearchPath(row.migration_database_search_path) !== SAFE_SEARCH_PATH;
  if (migrationUnsafe) {
    issues.push({
      code: 'migration_role_unsafe',
      target: roles.migrationRole,
      expected: 'LOGIN sans privilège global, membership ni search_path implicite',
      actual: String(row.migration_role ?? 'absent'),
    });
  }
  if (
    row.database_configuration_safe !== true ||
    row.migration_role_configuration_safe !== true ||
    row.migration_database_configuration_safe !== true ||
    row.migration_session_replication_role !== 'origin'
  ) {
    issues.push({
      code: 'role_configuration_unsafe',
      target: roles.migrationRole,
      expected:
        'aucune configuration globale ; search_path=public,pg_catalog seul réglage base ; session_replication_role=origin',
      actual: `database_global_safe=${String(row.database_configuration_safe)}; role_config_safe=${String(row.migration_role_configuration_safe)}; database_config_safe=${String(row.migration_database_configuration_safe)}; session_replication_role=${String(row.migration_session_replication_role)}`,
    });
  }
  if (row.migration_has_session_replication_role_privilege !== false) {
    issues.push({
      code: 'parameter_privilege_excessive',
      target: `${roles.migrationRole}:session_replication_role`,
      expected: 'SET et ALTER SYSTEM refusés',
      actual: String(row.migration_has_session_replication_role_privilege),
    });
  }

  for (const [target, allowed] of [
    ['database:CONNECT', row.migration_can_connect_database],
    ['database:CREATE', row.migration_can_create_database_objects],
    ['schema:public:USAGE', row.migration_can_use_public_schema],
    ['schema:public:CREATE', row.migration_can_create_public_schema],
    ...(row.drizzle_exists === true
      ? ([
          ['schema:drizzle:USAGE', row.migration_can_use_drizzle_schema],
          ['schema:drizzle:CREATE', row.migration_can_create_drizzle_schema],
        ] as const)
      : []),
    ...(row.loyalty_exists === true
      ? ([
          ['schema:loyalty:USAGE', row.migration_can_use_loyalty_schema],
          ['schema:loyalty:CREATE', row.migration_can_create_loyalty_schema],
        ] as const)
      : []),
  ] as const) {
    if (allowed !== true) {
      issues.push({
        code: 'migration_privilege_missing',
        target,
        expected: 'accordé au migrateur',
        actual: String(allowed),
      });
    }
  }

  if (
    row.public_schema_owner !== 'pg_database_owner' ||
    row.public_create_granted_to_public !== false ||
    row.public_create_granted_to_other !== false
  ) {
    issues.push({
      code: 'public_schema_unsafe',
      target: 'schema:public',
      expected:
        'owner=pg_database_owner ; CREATE limité au propriétaire de la base et au migrateur',
      actual: `owner=${String(row.public_schema_owner)}; public_create=${String(row.public_create_granted_to_public)}; other_create=${String(row.public_create_granted_to_other)}`,
    });
  }

  for (const [schema, exists, publicCreate, otherCreate] of [
    [
      'drizzle',
      row.drizzle_exists,
      row.drizzle_create_granted_to_public,
      row.drizzle_create_granted_to_other,
    ],
    [
      'loyalty',
      row.loyalty_exists,
      row.loyalty_create_granted_to_public,
      row.loyalty_create_granted_to_other,
    ],
  ] as const) {
    if (exists === true && (publicCreate !== false || otherCreate !== false)) {
      issues.push({
        code: 'managed_schema_unsafe',
        target: `schema:${schema}`,
        expected: `CREATE limité au propriétaire et à ${roles.migrationRole}`,
        actual: `public_create=${String(publicCreate)}; other_create=${String(otherCreate)}`,
      });
    }
  }

  const runtimeUnsafe =
    row.runtime_role !== roles.runtimeRole ||
    row.runtime_rolcanlogin !== true ||
    row.runtime_rolsuper !== false ||
    row.runtime_rolbypassrls !== false ||
    row.runtime_rolcreaterole !== false ||
    row.runtime_rolcreatedb !== false ||
    row.runtime_rolreplication !== false ||
    row.runtime_has_role_membership !== false ||
    row.runtime_has_members !== false;
  if (runtimeUnsafe) {
    issues.push({
      code: 'runtime_role_unsafe',
      target: roles.runtimeRole,
      expected: 'LOGIN sans privilège global ni membership',
      actual: String(row.runtime_role ?? 'absent'),
    });
  }
  if (
    row.runtime_role_configuration_safe !== true ||
    row.runtime_database_configuration_safe !== true
  ) {
    issues.push({
      code: 'role_configuration_unsafe',
      target: roles.runtimeRole,
      expected:
        'aucune configuration globale ; search_path=pg_catalog,public seul réglage base',
      actual: `role_config_safe=${String(row.runtime_role_configuration_safe)}; database_config_safe=${String(row.runtime_database_configuration_safe)}`,
    });
  }
  if (row.runtime_has_session_replication_role_privilege !== false) {
    issues.push({
      code: 'parameter_privilege_excessive',
      target: `${roles.runtimeRole}:session_replication_role`,
      expected: 'SET et ALTER SYSTEM refusés',
      actual: String(row.runtime_has_session_replication_role_privilege),
    });
  }

  for (const [target, allowed] of [
    ['database:CONNECT', row.runtime_can_connect_database],
    ['schema:public:USAGE', row.runtime_can_use_public_schema],
    ...(row.drizzle_exists === true
      ? ([['schema:drizzle:USAGE', row.runtime_can_use_drizzle_schema]] as const)
      : []),
    ...(row.loyalty_exists === true
      ? ([['schema:loyalty:USAGE', row.runtime_can_use_loyalty_schema]] as const)
      : []),
  ] as const) {
    if (allowed !== true) {
      issues.push({
        code: 'runtime_privilege_missing',
        target,
        expected: `${target === 'database:CONNECT' ? 'CONNECT' : 'USAGE'} accordé à ${roles.runtimeRole}`,
        actual: String(allowed),
      });
    }
  }

  for (const [target, excessive] of [
    ['database:CREATE', row.runtime_can_create_database_objects],
    ['schema:public:CREATE', row.runtime_can_create_public_schema],
    ['schema:drizzle:CREATE', row.runtime_can_create_drizzle_schema],
    ['schema:loyalty:CREATE', row.runtime_can_create_loyalty_schema],
    ['application:OWNER', row.runtime_owns_application_objects],
  ] as const) {
    if (excessive !== false) {
      issues.push({
        code: 'runtime_privilege_excessive',
        target,
        expected: 'refusé au runtime',
        actual: String(excessive),
      });
    }
  }
  return issues;
}

function catalogObjectKey(
  object: Pick<CatalogObject, 'kind' | 'schema' | 'name' | 'identityArguments'>,
): string {
  const signature = object.kind === 'function' ? `(${object.identityArguments})` : '';
  return `${object.kind}:${object.schema}.${object.name}${signature}`;
}

function objectForCatalog(catalog: readonly CatalogObject[], object: ManagedObject): CatalogObject {
  const found = catalog.find(
    (entry) => entry.managed && catalogObjectKey(entry) === managedObjectKey(object),
  );
  if (!found) throw new Error(`Objet manquant dans la sonde : ${managedObjectKey(object)}`);
  return found;
}

function targetLabel(
  object: Pick<CatalogObject, 'kind' | 'schema' | 'name' | 'identityArguments'>,
): string {
  const callable = ['function', 'procedure', 'aggregate', 'window_function', 'operator'].includes(
    object.kind,
  );
  return `${object.schema}.${object.name}${callable ? `(${object.identityArguments})` : ''}`;
}

async function readJournal(
  client: QueryClient,
  journal: MigrationJournal,
  catalog: readonly CatalogObject[],
  migrationRole: string,
  issues: BootstrapIssue[],
): Promise<Set<number> | null> {
  const definition = JOURNALS[journal];
  const tableObject = POSTGRES_MANAGED_OBJECTS.find(
    (object) => object.kind === 'table' && object.schema === 'drizzle' && object.name === definition.table,
  );
  if (!tableObject) throw new Error(`Journal ${journal} absent du manifeste`);
  const table = objectForCatalog(catalog, tableObject);
  if (!table.owner) return null;
  if (table.owner !== migrationRole) return null;

  try {
    const result = await client.query<JournalRow>(
      `SELECT created_at::pg_catalog.text AS created_at FROM ${qualified('drizzle', definition.table)} ORDER BY created_at ASC`,
    );
    const applied = new Set<number>();
    for (const row of result.rows) {
      if (typeof row.created_at !== 'string' || !/^\d+$/.test(row.created_at)) {
        throw new Error('horodatage illisible');
      }
      applied.add(Number(row.created_at));
    }
    return applied;
  } catch (error) {
    issues.push({
      code: 'journal_unreadable',
      target: `drizzle.${definition.table}`,
      expected: 'journal lisible par le migrateur',
      actual: error instanceof Error ? error.message.slice(0, 180) : 'erreur PostgreSQL',
    });
    return null;
  }
}

function appendObjectStateIssues(
  catalog: readonly CatalogObject[],
  migrationRole: string,
  applied: Readonly<Record<MigrationJournal, Set<number> | null>>,
  issues: BootstrapIssue[],
): void {
  for (const object of POSTGRES_MANAGED_OBJECTS) {
    const actual = objectForCatalog(catalog, object);
    if (actual.owner && actual.owner !== migrationRole) {
      issues.push({
        code: 'wrong_owner',
        target: targetLabel(object),
        expected: migrationRole,
        actual: actual.owner,
      });
    }
  }

  for (const journal of ['supply', 'loyalty'] as const) {
    const definition = JOURNALS[journal];
    const journalTable = POSTGRES_MANAGED_OBJECTS.find(
      (object) => object.kind === 'table' && object.schema === 'drizzle' && object.name === definition.table,
    );
    const journalSequence = POSTGRES_MANAGED_OBJECTS.find(
      (object) => object.kind === 'sequence' && object.schema === 'drizzle' && object.name === definition.sequence,
    );
    if (!journalTable || !journalSequence) throw new Error(`Journal ${journal} incomplet`);
    const tableActual = objectForCatalog(catalog, journalTable);
    const sequenceActual = objectForCatalog(catalog, journalSequence);
    if (tableActual.owner && !sequenceActual.owner) {
      issues.push({
        code: 'missing_object',
        target: targetLabel(journalSequence),
        expected: `présent avec ${targetLabel(journalTable)}`,
        actual: 'absent',
      });
    }
    if (!tableActual.owner && sequenceActual.owner) {
      issues.push({
        code: 'orphaned_object',
        target: targetLabel(journalSequence),
        expected: `absent sans ${targetLabel(journalTable)}`,
        actual: 'présent',
      });
    }

    for (const object of POSTGRES_MANAGED_OBJECTS.filter((entry) => entry.journal === journal)) {
      const actual = objectForCatalog(catalog, object);
      const journalState = applied[journal];
      if (!tableActual.owner) {
        if (actual.owner) {
          issues.push({
            code: 'orphaned_object',
            target: targetLabel(object),
            expected: `absent sans journal ${journal}`,
            actual: 'présent',
          });
        }
        continue;
      }
      if (!journalState || object.introducedAt === undefined) continue;
      const migrationApplied = journalState.has(object.introducedAt);
      if (migrationApplied && !actual.owner) {
        issues.push({
          code: 'missing_object',
          target: targetLabel(object),
          expected: `présent après migration ${object.introducedAt}`,
          actual: 'absent',
        });
      }
      if (!migrationApplied && actual.owner) {
        issues.push({
          code: 'orphaned_object',
          target: targetLabel(object),
          expected: `absent avant migration ${object.introducedAt}`,
          actual: 'présent',
        });
      }
    }
  }
}

async function inspectPostgresBootstrap(
  client: QueryClient,
  roles: BootstrapRoles,
  effectiveMigrationSearchPath: string,
  effectiveMigrationSessionReplicationRole: string,
): Promise<BootstrapReport> {
  assertRoleNames(roles);
  // Un PoolClient PostgreSQL sérialise une seule requête à la fois. Garder ces
  // sondes séquentielles évite les interleavings non supportés par pg >= 9.
  const roleResult = await client.query<RoleProbe>(ROLE_QUERY, [
    roles.runtimeRole,
    effectiveMigrationSearchPath,
    effectiveMigrationSessionReplicationRole,
  ]);
  const catalogResult = await client.query<CatalogRow>(CATALOG_QUERY, [catalogPayload()]);
  const journalPrivileges = await readJournalPrivileges(client, roles.runtimeRole);
  const applicationPrivileges = await readApplicationPrivileges(client, roles.runtimeRole);
  const sequencePrivileges = await readSequencePrivileges(client, roles.runtimeRole);
  const defaultPrivileges = await readDefaultPrivileges(client, roles.migrationRole);
  const catalog = catalogResult.rows.map(parseCatalogRow);
  const managedObjects = catalog.filter((object) => object.managed);
  if (managedObjects.length !== POSTGRES_MANAGED_OBJECTS.length) {
    throw new Error('La sonde PostgreSQL ne correspond pas au manifeste versionné');
  }

  const issues = roleIssues(roleResult.rows[0], roles);
  for (const object of catalog.filter((entry) => !entry.managed)) {
    issues.push({
      code: 'unexpected_object',
      target: targetLabel(object),
      expected: 'objet autonome absent de l’allowlist d’ownership',
      actual: object.owner ?? 'propriétaire illisible',
    });
  }
  appendJournalPrivilegeIssues(journalPrivileges, roles.runtimeRole, issues);
  appendApplicationPrivilegeIssues(applicationPrivileges, roles.runtimeRole, issues);
  appendSequencePrivilegeIssues(sequencePrivileges, roles.runtimeRole, issues);
  appendDefaultPrivilegeIssues(defaultPrivileges, roles, issues);
  const applied = {
    supply: await readJournal(client, 'supply', catalog, roles.migrationRole, issues),
    loyalty: await readJournal(client, 'loyalty', catalog, roles.migrationRole, issues),
  };
  appendObjectStateIssues(catalog, roles.migrationRole, applied, issues);

  return {
    database:
      typeof roleResult.rows[0]?.database_name === 'string'
        ? roleResult.rows[0].database_name
        : null,
    migrationRole: roles.migrationRole,
    runtimeRole: roles.runtimeRole,
    objects: managedObjects,
    unmanagedObjects: catalog.filter((object) => !object.managed),
    issues,
  };
}

function issueLine(issue: BootstrapIssue): string {
  const expected = issue.expected ? ` ; attendu : ${issue.expected}` : '';
  const actual = issue.actual ? ` ; observé : ${issue.actual}` : '';
  return `- [${issue.code}] ${issue.target}${expected}${actual}`;
}

export class PostgresBootstrapError extends Error {
  constructor(readonly report: BootstrapReport) {
    super(`Préflight PostgreSQL refusé :\n${report.issues.map(issueLine).join('\n')}`);
    this.name = 'PostgresBootstrapError';
  }
}

export async function checkPostgresBootstrap(
  pool: ConnectablePool,
  roles: BootstrapRoles,
): Promise<BootstrapReport> {
  assertRoleNames(roles);
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await assertPostgresConnectionEncrypted(client);
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionStarted = true;
    const searchPathResult = await client.query<{
      effective_search_path: unknown;
      effective_session_replication_role: unknown;
    }>(
      EFFECTIVE_SEARCH_PATH_QUERY,
    );
    const effectiveSearchPath = searchPathResult.rows[0]?.effective_search_path;
    const effectiveSessionReplicationRole =
      searchPathResult.rows[0]?.effective_session_replication_role;
    await client.query('SET LOCAL search_path = pg_catalog, public');
    await client.query("SET LOCAL statement_timeout = '10s'");
    const report = await inspectPostgresBootstrap(
      client,
      roles,
      String(effectiveSearchPath ?? ''),
      String(effectiveSessionReplicationRole ?? ''),
    );
    if (report.issues.length > 0) throw new PostgresBootstrapError(report);
    await client.query('COMMIT');
    transactionStarted = false;
    return report;
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function qualified(schema: string, name: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;
}

function ownerStatement(object: ManagedObject, migrationRole: string): string {
  const target = qualified(object.schema, object.name);
  const role = quoteIdentifier(migrationRole);
  switch (object.kind) {
    case 'schema':
      return `ALTER SCHEMA ${quoteIdentifier(object.name)} OWNER TO ${role}`;
    case 'table':
      return `ALTER TABLE ${target} OWNER TO ${role}`;
    case 'sequence':
      return `ALTER SEQUENCE ${target} OWNER TO ${role}`;
    case 'type':
      return `ALTER TYPE ${target} OWNER TO ${role}`;
    case 'function':
      if (/;|--|\/\*/.test(object.identityArguments)) {
        throw new Error(`Signature de fonction non sûre : ${targetLabel(object)}`);
      }
      return `ALTER FUNCTION ${target}(${object.identityArguments}) OWNER TO ${role}`;
  }
}

function assertAdminProbe(
  row: AdminProbe | undefined,
  roles: BootstrapRoles,
  expectedDatabase: string,
): asserts row is AdminProbe {
  if (!row) throw new Error('Les rôles PostgreSQL attendus sont absents');
  if (
    row.database_name !== expectedDatabase ||
    row.database_configuration_safe !== true ||
    typeof row.admin_role !== 'string' ||
    row.admin_role !== row.session_role ||
    row.admin_role === roles.migrationRole ||
    row.admin_role === roles.runtimeRole ||
    row.admin_rolsuper !== true
  ) {
    throw new Error('La réparation exige une session administrateur directe sur la base attendue');
  }
  if (
    row.database_create_granted_to_public !== false ||
    row.database_create_granted_to_other !== false
  ) {
    throw new Error(
      'La base accorde CREATE à PUBLIC ou à un rôle hors allowlist ; réparation automatique refusée',
    );
  }
  if (
    typeof row.public_schema_owner !== 'string' ||
    row.public_schema_owner.length === 0 ||
    typeof row.public_create_granted_to_public !== 'boolean' ||
    typeof row.public_create_granted_to_other !== 'boolean'
  ) {
    throw new Error('La frontière du schéma public est illisible');
  }
  if (
    row.migration_role !== roles.migrationRole ||
    row.migration_rolcanlogin !== true ||
    row.migration_rolsuper !== false ||
    row.migration_rolbypassrls !== false ||
    row.migration_rolcreaterole !== false ||
    row.migration_rolcreatedb !== false ||
    row.migration_rolreplication !== false ||
    row.migration_has_role_membership !== false ||
    row.migration_has_members !== false ||
    row.migration_role_configuration_safe !== true ||
    row.migration_database_configuration_safe !== true ||
    row.migration_has_session_replication_role_privilege !== false
  ) {
    throw new Error('Le rôle de migration est absent ou porte un privilège global');
  }
  if (
    row.runtime_role !== roles.runtimeRole ||
    row.runtime_rolcanlogin !== true ||
    row.runtime_rolsuper !== false ||
    row.runtime_rolbypassrls !== false ||
    row.runtime_rolcreaterole !== false ||
    row.runtime_rolcreatedb !== false ||
    row.runtime_rolreplication !== false ||
    row.runtime_has_role_membership !== false ||
    row.runtime_has_members !== false ||
    row.runtime_role_configuration_safe !== true ||
    row.runtime_database_configuration_safe !== true ||
    row.runtime_has_session_replication_role_privilege !== false
  ) {
    throw new Error('Le rôle runtime est absent ou privilégié');
  }
  if (
    row.drizzle_create_granted_to_public !== false ||
    row.drizzle_create_granted_to_other !== false ||
    row.loyalty_create_granted_to_public !== false ||
    row.loyalty_create_granted_to_other !== false
  ) {
    throw new Error(
      'Un schéma géré accorde CREATE à PUBLIC ou à un rôle hors allowlist ; réparation automatique refusée',
    );
  }
}

async function effectivePrivilege(
  client: QueryClient,
  role: string,
  objectKind: 'database' | 'schema',
  objectName: string,
  privilege: 'CONNECT' | 'CREATE' | 'USAGE',
): Promise<boolean> {
  const expression =
    objectKind === 'database'
      ? 'pg_catalog.has_database_privilege(role.oid, $2, $3)'
      : 'pg_catalog.has_schema_privilege(role.oid, pg_catalog.to_regnamespace($2), $3)';
  const result = await client.query<{ allowed: unknown }>(
    `SELECT COALESCE(${expression}, false) AS allowed
       FROM pg_catalog.pg_roles role
      WHERE role.rolname = $1`,
    [role, objectName, privilege],
  );
  return result.rows[0]?.allowed === true;
}

export async function repairPostgresBootstrap(
  pool: ConnectablePool,
  options: BootstrapRoles & { expectedDatabase: string },
): Promise<BootstrapRepairResult> {
  assertRoleNames(options);
  if (!options.expectedDatabase.trim()) throw new Error('Base PostgreSQL attendue manquante');
  const client = await pool.connect();
  const changed: string[] = [];
  let transactionStarted = false;
  try {
    await assertPostgresConnectionEncrypted(client);
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query('SET LOCAL search_path = pg_catalog, public');
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query(
      "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('snackmanager-postgres-bootstrap-v1', 0))",
    );

    const adminResult = await client.query<AdminProbe>(ADMIN_QUERY, [
      options.migrationRole,
      options.runtimeRole,
    ]);
    const admin = adminResult.rows[0];
    assertAdminProbe(admin, options, options.expectedDatabase);

    const database = String(admin.database_name);
    const quotedDatabase = quoteIdentifier(database);
    const quotedMigrationRole = quoteIdentifier(options.migrationRole);
    const quotedRuntimeRole = quoteIdentifier(options.runtimeRole);

    if (admin.public_schema_owner !== 'pg_database_owner') {
      throw new Error(
        'Le schéma public doit appartenir à pg_database_owner ; changement de propriétaire automatique refusé',
      );
    }
    if (admin.public_create_granted_to_other === true) {
      throw new Error(
        'Le schéma public accorde CREATE à un rôle hors allowlist ; réparation automatique refusée',
      );
    }

    const defaultPrivileges = await readDefaultPrivileges(client, options.migrationRole);
    const unsafeDefaultPrivileges = defaultPrivileges.filter(
      (privilege) => !defaultPrivilegeAllowed(privilege, options),
    );
    if (unsafeDefaultPrivileges.length > 0) {
      const privilege = unsafeDefaultPrivileges[0]!;
      throw new Error(
        `Privilège par défaut hors allowlist (${privilege.schema}:${privilege.objectType}:${privilege.grantee}:${privilege.privilege}) ; réparation automatique refusée`,
      );
    }

    if (admin.public_create_granted_to_public === true) {
      await client.query('REVOKE CREATE ON SCHEMA "public" FROM PUBLIC');
      changed.push('revoke:public:CREATE:PUBLIC');
    }

    if (
      !(await effectivePrivilege(
        client,
        options.migrationRole,
        'database',
        database,
        'CONNECT',
      ))
    ) {
      await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedMigrationRole}`);
      changed.push(`grant:${database}:CONNECT:${options.migrationRole}`);
    }

    if (
      !(await effectivePrivilege(
        client,
        options.migrationRole,
        'database',
        database,
        'CREATE',
      ))
    ) {
      await client.query(`GRANT CREATE ON DATABASE ${quotedDatabase} TO ${quotedMigrationRole}`);
      changed.push(`grant:${database}:CREATE:${options.migrationRole}`);
    }

    if (
      !(await effectivePrivilege(
        client,
        options.runtimeRole,
        'database',
        database,
        'CONNECT',
      ))
    ) {
      await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO ${quotedRuntimeRole}`);
      changed.push(`grant:${database}:CONNECT:${options.runtimeRole}`);
    }

    for (const privilege of ['USAGE', 'CREATE'] as const) {
      if (
        !(await effectivePrivilege(
          client,
          options.migrationRole,
          'schema',
          'public',
          privilege,
        ))
      ) {
        await client.query(
          `GRANT ${privilege} ON SCHEMA "public" TO ${quotedMigrationRole}`,
        );
        changed.push(`grant:public:${privilege}:${options.migrationRole}`);
      }
    }

    const catalogResult = await client.query<CatalogRow>(CATALOG_QUERY, [catalogPayload()]);
    const catalog = catalogResult.rows.map(parseCatalogRow);
    for (const schema of ['drizzle', 'loyalty'] as const) {
      const schemaEntry = catalog.find(
        (object) => object.managed && object.kind === 'schema' && object.name === schema,
      );
      if (!schemaEntry?.owner) continue;
      for (const privilege of ['USAGE', 'CREATE'] as const) {
        if (
          !(await effectivePrivilege(
            client,
            options.migrationRole,
            'schema',
            schema,
            privilege,
          ))
        ) {
          await client.query(
            `GRANT ${privilege} ON SCHEMA ${quoteIdentifier(schema)} TO ${quotedMigrationRole}`,
          );
          changed.push(`grant:${schema}:${privilege}:${options.migrationRole}`);
        }
      }
    }

    for (const object of POSTGRES_MANAGED_OBJECTS) {
      const actual = objectForCatalog(catalog, object);
      if (!actual.owner || actual.owner === options.migrationRole) continue;
      await client.query(ownerStatement(object, options.migrationRole));
      changed.push(`owner:${targetLabel(object)}:${options.migrationRole}`);
    }

    for (const schema of ['public', 'drizzle', 'loyalty'] as const) {
      const exists =
        schema === 'public' ||
        catalog.some(
          (object) => object.kind === 'schema' && object.name === schema && object.owner,
        );
      if (
        exists &&
        !(await effectivePrivilege(client, options.runtimeRole, 'schema', schema, 'USAGE'))
      ) {
        await client.query(
          `GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${quotedRuntimeRole}`,
        );
        changed.push(`grant:${schema}:USAGE:${options.runtimeRole}`);
      }
    }

    const applicationPrivileges = await readApplicationPrivileges(
      client,
      options.runtimeRole,
    );
    for (const privilege of applicationPrivileges) {
      if (!privilege.exists) continue;
      const table = qualified(privilege.schema, privilege.tableName);
      if (
        privilege.thirdPartyHasAny ||
        privilege.thirdPartyHasColumnAcl ||
        privilege.runtimeHasColumnAcl ||
        privilege.publicHasColumnAcl
      ) {
        throw new Error(
          `La table ${privilege.schema}.${privilege.tableName} contient une ACL hors allowlist non réparable automatiquement`,
        );
      }
      if (privilege.publicHasAny) {
        await client.query(
          `REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE ${table} FROM PUBLIC`,
        );
        changed.push(`revoke:${privilege.schema}.${privilege.tableName}:ALL:PUBLIC`);
      }
      if (privilege.runtimeHasDisallowed) {
        await client.query(
          `REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE ${table} FROM ${quotedRuntimeRole}`,
        );
        changed.push(
          `revoke:${privilege.schema}.${privilege.tableName}:EXCESSIVE:${options.runtimeRole}`,
        );
      }
      if (privilege.runtimeHasGrantOption) {
        await client.query(
          `REVOKE GRANT OPTION FOR SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} FROM ${quotedRuntimeRole}`,
        );
        changed.push(
          `revoke:${privilege.schema}.${privilege.tableName}:GRANT_OPTION:${options.runtimeRole}`,
        );
      }
      if (!privilege.runtimeHasRequired) {
        await client.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${table} TO ${quotedRuntimeRole}`,
        );
        changed.push(
          `grant:${privilege.schema}.${privilege.tableName}:DML:${options.runtimeRole}`,
        );
      }
    }

    const sequencePrivileges = await readSequencePrivileges(client, options.runtimeRole);
    for (const privilege of sequencePrivileges) {
      if (!privilege.exists) continue;
      const sequence = qualified(privilege.schema, privilege.sequenceName);
      const target = `${privilege.schema}.${privilege.sequenceName}`;
      const runtimeAllowed = privilege.schema !== 'drizzle';
      const runtimeHasAny =
        privilege.runtimeCanUsage || privilege.runtimeCanSelect || privilege.runtimeCanUpdate;
      if (privilege.thirdPartyHasAny) {
        throw new Error(
          `La séquence ${target} accorde des privilèges à un rôle hors allowlist ; réparation automatique refusée`,
        );
      }
      if (privilege.publicHasAny) {
        await client.query(
          `REVOKE USAGE, SELECT, UPDATE ON SEQUENCE ${sequence} FROM PUBLIC`,
        );
        changed.push(`revoke:${target}:ALL:PUBLIC`);
      }
      if (!runtimeAllowed && runtimeHasAny) {
        await client.query(
          `REVOKE USAGE, SELECT, UPDATE ON SEQUENCE ${sequence} FROM ${quotedRuntimeRole}`,
        );
        changed.push(`revoke:${target}:ALL:${options.runtimeRole}`);
      } else if (runtimeAllowed) {
        if (privilege.runtimeHasGrantOption) {
          await client.query(
            `REVOKE GRANT OPTION FOR USAGE, SELECT, UPDATE ON SEQUENCE ${sequence} FROM ${quotedRuntimeRole}`,
          );
          changed.push(`revoke:${target}:GRANT_OPTION:${options.runtimeRole}`);
        }
        if (
          !privilege.runtimeCanUsage ||
          !privilege.runtimeCanSelect ||
          !privilege.runtimeCanUpdate
        ) {
          await client.query(
            `GRANT USAGE, SELECT, UPDATE ON SEQUENCE ${sequence} TO ${quotedRuntimeRole}`,
          );
          changed.push(`grant:${target}:SEQUENCE:${options.runtimeRole}`);
        }
      }
    }

    const journalPrivileges = await readJournalPrivileges(client, options.runtimeRole);
    for (const privilege of journalPrivileges) {
      if (!privilege.exists) continue;
      const journalTable = qualified('drizzle', privilege.tableName);
      const journal = Object.values(JOURNALS).find(
        (candidate) => candidate.table === privilege.tableName,
      );
      if (!journal) throw new Error(`Journal hors allowlist : ${privilege.tableName}`);
      if (privilege.thirdPartyHasAny || privilege.thirdPartyHasColumnAcl) {
        throw new Error(
          `Le journal ${privilege.tableName} accorde des privilèges à un rôle hors allowlist ; réparation automatique refusée`,
        );
      }
      const columns = journal.columns.map(quoteIdentifier).join(', ');
      if (privilege.publicHasAny) {
        await client.query(
          `REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE ${journalTable} FROM PUBLIC`,
        );
        changed.push(`revoke:drizzle.${privilege.tableName}:ALL:PUBLIC`);
      }
      if (privilege.publicHasColumnAcl) {
        await client.query(
          `REVOKE SELECT (${columns}), INSERT (${columns}), UPDATE (${columns}), REFERENCES (${columns}) ON TABLE ${journalTable} FROM PUBLIC`,
        );
        changed.push(`revoke:drizzle.${privilege.tableName}:COLUMNS:PUBLIC`);
      }
      if (privilege.runtimeHasNonSelect) {
        await client.query(
          `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE ${journalTable} FROM ${quotedRuntimeRole}`,
        );
        changed.push(`revoke:drizzle.${privilege.tableName}:WRITE:${options.runtimeRole}`);
      }
      if (privilege.runtimeHasColumnAcl) {
        await client.query(
          `REVOKE SELECT (${columns}), INSERT (${columns}), UPDATE (${columns}), REFERENCES (${columns}) ON TABLE ${journalTable} FROM ${quotedRuntimeRole}`,
        );
        changed.push(
          `revoke:drizzle.${privilege.tableName}:COLUMNS:${options.runtimeRole}`,
        );
      }
      if (privilege.runtimeSelectIsGrantable) {
        await client.query(
          `REVOKE GRANT OPTION FOR SELECT ON TABLE ${journalTable} FROM ${quotedRuntimeRole}`,
        );
        changed.push(
          `revoke:drizzle.${privilege.tableName}:SELECT_GRANT_OPTION:${options.runtimeRole}`,
        );
      }
      if (!privilege.runtimeHasDirectSelect) {
        await client.query(`GRANT SELECT ON TABLE ${journalTable} TO ${quotedRuntimeRole}`);
        changed.push(`grant:drizzle.${privilege.tableName}:SELECT:${options.runtimeRole}`);
      }
    }

    if (admin.migration_database_search_path !== 'search_path=public, pg_catalog') {
      await client.query(
        `ALTER ROLE ${quotedMigrationRole} IN DATABASE ${quotedDatabase} SET search_path = public, pg_catalog`,
      );
      changed.push(`search_path:${options.migrationRole}:${database}`);
    }
    if (admin.runtime_database_search_path !== 'search_path=pg_catalog, public') {
      await client.query(
        `ALTER ROLE ${quotedRuntimeRole} IN DATABASE ${quotedDatabase} SET search_path = pg_catalog, public`,
      );
      changed.push(`search_path:${options.runtimeRole}:${database}`);
    }

    if (
      await effectivePrivilege(
        client,
        options.runtimeRole,
        'database',
        database,
        'CREATE',
      )
    ) {
      await client.query(`REVOKE CREATE ON DATABASE ${quotedDatabase} FROM ${quotedRuntimeRole}`);
      changed.push(`revoke:${database}:CREATE:${options.runtimeRole}`);
    }
    for (const schema of ['public', 'drizzle', 'loyalty'] as const) {
      const exists =
        schema === 'public' || catalog.some((object) => object.kind === 'schema' && object.name === schema && object.owner);
      if (
        exists &&
        (await effectivePrivilege(client, options.runtimeRole, 'schema', schema, 'CREATE'))
      ) {
        await client.query(
          `REVOKE CREATE ON SCHEMA ${quoteIdentifier(schema)} FROM ${quotedRuntimeRole}`,
        );
        changed.push(`revoke:${schema}:CREATE:${options.runtimeRole}`);
      }
    }

    await client.query(`SET LOCAL ROLE ${quotedMigrationRole}`);
    const report = await inspectPostgresBootstrap(client, options, SAFE_SEARCH_PATH, 'origin');
    await client.query('RESET ROLE');
    if (report.issues.length > 0) throw new PostgresBootstrapError(report);

    await client.query('COMMIT');
    transactionStarted = false;
    return { database, changed, report };
  } catch (error) {
    if (transactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const bootstrapSqlForTests = {
  catalog: CATALOG_QUERY,
  roles: ROLE_QUERY,
  admin: ADMIN_QUERY,
  journalPrivileges: JOURNAL_PRIVILEGE_QUERY,
  applicationPrivileges: APPLICATION_PRIVILEGE_QUERY,
  defaultPrivileges: DEFAULT_PRIVILEGE_QUERY,
  sequencePrivileges: SEQUENCE_PRIVILEGE_QUERY,
  effectiveSearchPath: EFFECTIVE_SEARCH_PATH_QUERY,
};
