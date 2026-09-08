import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  PostgresBootstrapError,
  bootstrapSqlForTests,
  checkPostgresBootstrap,
  repairPostgresBootstrap,
} from './bootstrap';
import {
  JOURNALS,
  CUSTOMER_INITIAL_MIGRATION,
  CUSTOMER_PAID_BUDGET_MIGRATION,
  LOYALTY_EARN_RECEIPTS_MIGRATION,
  LOYALTY_INITIAL_MIGRATION,
  POSTGRES_MANAGED_OBJECTS,
  SUPPLY_INITIAL_MIGRATION,
  managedObjectKey,
  type ManagedObject,
} from './manifest';
import { parseRepairArguments, repairConnectionUrl } from './repair';

const roles = {
  migrationRole: 'snackmanager_staging_migrator',
  runtimeRole: 'snackmanager_staging_app',
};

function result<T extends Record<string, unknown>>(rows: T[]): QueryResult<T> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

function safeRoleProbe(overrides: Record<string, unknown> = {}) {
  return {
    database_name: 'railway',
    database_configuration_safe: true,
    database_create_granted_to_public: false,
    database_create_granted_to_other: false,
    migration_role: roles.migrationRole,
    migration_rolcanlogin: true,
    migration_rolsuper: false,
    migration_rolbypassrls: false,
    migration_rolcreaterole: false,
    migration_rolcreatedb: false,
    migration_rolreplication: false,
    migration_has_role_membership: false,
    migration_has_members: false,
    migration_role_configuration_safe: true,
    migration_database_configuration_safe: true,
    migration_has_session_replication_role_privilege: false,
    migration_search_path: 'public, pg_catalog',
    migration_session_replication_role: 'origin',
    migration_database_search_path: 'search_path=public, pg_catalog',
    migration_can_connect_database: true,
    migration_can_create_database_objects: true,
    migration_can_use_public_schema: true,
    migration_can_create_public_schema: true,
    public_schema_owner: 'pg_database_owner',
    public_create_granted_to_public: false,
    public_create_granted_to_other: false,
    drizzle_exists: false,
    drizzle_create_granted_to_public: false,
    drizzle_create_granted_to_other: false,
    migration_can_use_drizzle_schema: false,
    migration_can_create_drizzle_schema: false,
    loyalty_exists: false,
    loyalty_create_granted_to_public: false,
    loyalty_create_granted_to_other: false,
    migration_can_use_loyalty_schema: false,
    migration_can_create_loyalty_schema: false,
    customer_exists: false,
    customer_create_granted_to_public: false,
    customer_create_granted_to_other: false,
    migration_can_use_customer_schema: false,
    migration_can_create_customer_schema: false,
    runtime_role: roles.runtimeRole,
    runtime_rolcanlogin: true,
    runtime_rolsuper: false,
    runtime_rolbypassrls: false,
    runtime_rolcreaterole: false,
    runtime_rolcreatedb: false,
    runtime_rolreplication: false,
    runtime_has_role_membership: false,
    runtime_has_members: false,
    runtime_role_configuration_safe: true,
    runtime_database_configuration_safe: true,
    runtime_has_session_replication_role_privilege: false,
    runtime_can_connect_database: true,
    runtime_can_use_public_schema: true,
    runtime_can_use_drizzle_schema: false,
    runtime_can_use_loyalty_schema: false,
    runtime_can_use_customer_schema: false,
    runtime_can_create_database_objects: false,
    runtime_can_create_public_schema: false,
    runtime_can_create_drizzle_schema: false,
    runtime_can_create_loyalty_schema: false,
    runtime_can_create_customer_schema: false,
    runtime_owns_application_objects: false,
    ...overrides,
  };
}

function catalogRows(
  owners: Readonly<Record<string, string | null>> = {},
  unmanaged: Array<{
    kind: string;
    schema: string;
    name: string;
    owner: string;
    identityArguments?: string;
  }> = [],
) {
  return [
    ...POSTGRES_MANAGED_OBJECTS.map((object) => ({
      kind: object.kind,
      schema_name: object.schema,
      object_name: object.name,
      identity_arguments: object.identityArguments,
      owner_name: owners[managedObjectKey(object)] ?? null,
      managed: true,
    })),
    ...unmanaged.map((object) => ({
      kind: object.kind,
      schema_name: object.schema,
      object_name: object.name,
      identity_arguments: object.identityArguments ?? '',
      owner_name: object.owner,
      managed: false,
    })),
  ];
}

function poolFor(query: PoolClient['query']): Pick<Pool, 'connect'> {
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pick<Pool, 'connect'>;
}

function checkQuery(options: {
  effectiveSearchPath?: string;
  effectiveSessionReplicationRole?: string;
  probe?: Record<string, unknown>;
  owners?: Readonly<Record<string, string | null>>;
  unmanaged?: Parameters<typeof catalogRows>[1];
  journals?: Partial<Record<'supply' | 'loyalty' | 'customer', number[]>>;
  journalAcl?: Partial<
    Record<
      'supply' | 'loyalty' | 'customer',
      Partial<{
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
      }>
    >
  >;
  applicationAcl?: Partial<
    Record<
      string,
      Partial<{
        exists: boolean;
        runtimeHasRequired: boolean;
        runtimeHasDisallowed: boolean;
        runtimeHasGrantOption: boolean;
        runtimeHasColumnAcl: boolean;
        publicHasAny: boolean;
        publicHasColumnAcl: boolean;
        thirdPartyHasAny: boolean;
        thirdPartyHasColumnAcl: boolean;
      }>
    >
  >;
  defaultPrivileges?: Array<{
    schema_name: string;
    object_type: string;
    grantee_name: string;
    privilege_type: string;
    is_grantable: boolean;
  }>;
} = {}) {
  return vi.fn(async (query: unknown, parameters?: unknown[]) => {
    const sql = String(query);
    if (sql.includes('FROM pg_catalog.pg_stat_ssl')) {
      return result([{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }]);
    }
    if (sql.includes('AS effective_search_path')) {
      return result([
        {
          effective_search_path: options.effectiveSearchPath ?? 'public, pg_catalog',
          effective_session_replication_role:
            options.effectiveSessionReplicationRole ?? 'origin',
        },
      ]);
    }
    if (sql.includes('pg_catalog.pg_default_acl')) {
      return result(options.defaultPrivileges ?? []);
    }
    if (sql.includes('FROM pg_catalog.pg_roles migration')) {
      return result([
        safeRoleProbe({
          migration_search_path: parameters?.[1],
          migration_session_replication_role: parameters?.[2],
          ...options.probe,
        }),
      ]);
    }
    if (sql.includes('drizzle"."__drizzle_migrations')) {
      return result(
        (options.journals?.supply ?? []).map((createdAt) => ({
          created_at: String(createdAt),
        })),
      );
    }
    if (sql.includes('drizzle"."__drizzle_loyalty_migrations')) {
      return result(
        (options.journals?.loyalty ?? []).map((createdAt) => ({
          created_at: String(createdAt),
        })),
      );
    }
    if (sql.includes('drizzle"."__drizzle_customer_migrations')) {
      return result(
        (options.journals?.customer ?? []).map((createdAt) => ({
          created_at: String(createdAt),
        })),
      );
    }
    if (sql.includes('AS runtime_has_non_select')) {
      // Every migration journal participates in the same read-only ACL gate.
      return result(
        (['supply', 'loyalty', 'customer'] as const).map((journal) => {
          const tableName = JOURNALS[journal].table;
          const exists =
            options.journalAcl?.[journal]?.exists ??
            Boolean(options.owners?.[key('table', 'drizzle', tableName)]);
          return {
            table_name: tableName,
            relation_exists: exists,
            runtime_can_select: options.journalAcl?.[journal]?.runtimeCanSelect ?? exists,
            runtime_has_direct_select:
              options.journalAcl?.[journal]?.runtimeHasDirectSelect ?? exists,
            runtime_select_is_grantable:
              options.journalAcl?.[journal]?.runtimeSelectIsGrantable ?? false,
            runtime_has_non_select:
              options.journalAcl?.[journal]?.runtimeHasNonSelect ?? false,
            runtime_has_column_acl:
              options.journalAcl?.[journal]?.runtimeHasColumnAcl ?? false,
            public_has_any: options.journalAcl?.[journal]?.publicHasAny ?? false,
            public_has_column_acl:
              options.journalAcl?.[journal]?.publicHasColumnAcl ?? false,
            third_party_has_any:
              options.journalAcl?.[journal]?.thirdPartyHasAny ?? false,
            third_party_has_column_acl:
              options.journalAcl?.[journal]?.thirdPartyHasColumnAcl ?? false,
          };
        }),
      );
    }
    if (sql.includes('AS runtime_has_disallowed')) {
      return result(
        POSTGRES_MANAGED_OBJECTS.filter(
          (object) => object.kind === 'table' && object.schema !== 'drizzle',
        ).map((table) => {
          const objectKey = `${table.schema}.${table.name}`;
          const acl = options.applicationAcl?.[objectKey];
          return {
            schema_name: table.schema,
            table_name: table.name,
            relation_exists:
              acl?.exists ?? Boolean(options.owners?.[managedObjectKey(table)]),
            runtime_has_required: acl?.runtimeHasRequired ?? true,
            runtime_has_disallowed: acl?.runtimeHasDisallowed ?? false,
            runtime_has_grant_option: acl?.runtimeHasGrantOption ?? false,
            runtime_has_column_acl: acl?.runtimeHasColumnAcl ?? false,
            public_has_any: acl?.publicHasAny ?? false,
            public_has_column_acl: acl?.publicHasColumnAcl ?? false,
            third_party_has_any: acl?.thirdPartyHasAny ?? false,
            third_party_has_column_acl: acl?.thirdPartyHasColumnAcl ?? false,
          };
        }),
      );
    }
    if (sql.includes('AS runtime_can_usage')) {
      return result(
        POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'sequence').map(
          (sequence) => ({
            schema_name: sequence.schema,
            sequence_name: sequence.name,
            relation_exists: Boolean(options.owners?.[managedObjectKey(sequence)]),
            runtime_can_usage: false,
            runtime_can_select: false,
            runtime_can_update: false,
            runtime_has_grant_option: false,
            public_has_any: false,
            third_party_has_any: false,
          }),
        ),
      );
    }
    if (sql.includes('jsonb_to_recordset')) {
      return result(catalogRows(options.owners, options.unmanaged));
    }
    return result([]);
  }) as unknown as PoolClient['query'];
}

function key(kind: ManagedObject['kind'], schema: string, name: string): string {
  return managedObjectKey({ kind, schema, name, identityArguments: '' });
}

type DiscoveredMigrationObject = {
  kind: string;
  schema: string;
  name: string;
  identityArguments: string;
  journal: 'supply' | 'loyalty' | 'customer';
  introducedAt: number;
};

const ALLOWED_DYNAMIC_MIGRATION_BLOCKS = new Set([
  // loyalty/0000 : boucle RLS historique, qui n'introduit que les policies
  // tenant_isolation liées aux tables. Toute modification du bloc exige une
  // revue explicite et la mise à jour de cette empreinte.
  `loyalty:${LOYALTY_INITIAL_MIGRATION}:0000_glorious_swordsman:5f77fde3d5db88b65ad991d0a6cda96031e4a0cfe2449bb265805a83883833fe`,
]);

function sqlDigest(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

function discoveredKey(
  object: Pick<
    DiscoveredMigrationObject,
    'kind' | 'schema' | 'name' | 'identityArguments'
  >,
): string {
  const signature = ['function', 'procedure', 'aggregate', 'operator'].includes(object.kind)
    ? `(${object.identityArguments})`
    : '';
  return `${object.kind}:${object.schema}.${object.name}${signature}`;
}

function splitTopLevelSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === '-' && next === '-') {
      const newline = sql.indexOf('\n', index + 2);
      index = newline < 0 ? sql.length : newline;
      continue;
    }
    if (character === '/' && next === '*') {
      let commentDepth = 1;
      index += 2;
      while (index < sql.length && commentDepth > 0) {
        if (sql[index] === '/' && sql[index + 1] === '*') {
          commentDepth += 1;
          index += 2;
        } else if (sql[index] === '*' && sql[index + 1] === '/') {
          commentDepth -= 1;
          index += 2;
        } else {
          index += 1;
        }
      }
      if (commentDepth !== 0) throw new Error('Commentaire SQL non terminé');
      index -= 1;
      continue;
    }
    if (character === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index += 2;
          continue;
        }
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") break;
        index += 1;
      }
      if (index >= sql.length) throw new Error('Chaîne SQL non terminée');
      continue;
    }
    if (character === '"') {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (sql[index] === '"') break;
        index += 1;
      }
      if (index >= sql.length) throw new Error('Identifiant SQL non terminé');
      continue;
    }
    if (character === '$') {
      const tag = /^\$[a-z_][a-z0-9_]*\$|^\$\$/i.exec(sql.slice(index))?.[0];
      if (tag) {
        const close = sql.indexOf(tag, index + tag.length);
        if (close < 0) throw new Error(`Bloc SQL ${tag} non terminé`);
        index = close + tag.length - 1;
        continue;
      }
    }
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') depth -= 1;
    if (depth < 0) throw new Error('Parenthèses SQL déséquilibrées');
    if (character === ';' && depth === 0) {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error('Parenthèses SQL non terminées');
  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function splitFunctionArguments(raw: string): string[] {
  if (!raw.trim()) return [];
  const arguments_: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') depth -= 1;
    if (character === ',' && depth === 0) {
      arguments_.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  arguments_.push(raw.slice(start));
  return arguments_;
}

function normalizeFunctionIdentityArguments(raw: string): string {
  return splitFunctionArguments(raw)
    .map((argument) => argument.trim().replace(/\s+(?:DEFAULT\s+.+|=\s*.+)$/i, ''))
    .filter((argument) => !/^OUT\s+/i.test(argument))
    .map((argument) =>
      argument
        .replace(/^(?:IN|INOUT|VARIADIC)\s+/i, '')
        .replace(/^"[^"]+"\s+/, '')
        .replaceAll('"', '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join(', ');
}

function parseCallableHeader(
  sql: string,
  keyword: 'FUNCTION' | 'PROCEDURE' | 'AGGREGATE',
): { schema: string; name: string; arguments: string } | null {
  const replace = keyword === 'AGGREGATE' ? '' : '(?:OR\\s+REPLACE\\s+)?';
  const prefix = new RegExp(
    `^CREATE\\s+${replace}${keyword}\\s+(?:"([^"]+)"\\.)?"([^"]+)"\\s*\\(`,
    'i',
  ).exec(sql);
  if (!prefix) return null;
  const opening = prefix[0].lastIndexOf('(');
  let depth = 1;
  let quoted = false;
  for (let index = opening + 1; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === '"') {
      if (quoted && sql[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === '(' || character === '[') depth += 1;
    if (character === ')' || character === ']') depth -= 1;
    if (depth === 0) {
      return {
        schema: prefix[1] ?? 'public',
        name: prefix[2]!,
        arguments: sql.slice(opening + 1, index),
      };
    }
  }
  throw new Error(`Signature ${keyword} non terminée`);
}

function withoutLeadingComments(statement: string): string {
  let sql = statement.trim();
  while (true) {
    const next = sql
      .replace(/^--[^\n]*(?:\n|$)/, '')
      .replace(/^\/\*[\s\S]*?\*\//, '')
      .trim();
    if (next === sql) return sql;
    sql = next;
  }
}

function discoverCreatedObject(
  statement: string,
  journal: 'supply' | 'loyalty' | 'customer',
  introducedAt: number,
  sourceTag = '',
): DiscoveredMigrationObject | null {
  const sql = withoutLeadingComments(statement);
  if (/^DO\b/i.test(sql)) {
    const allowlistKey = `${journal}:${introducedAt}:${sourceTag}:${sqlDigest(sql)}`;
    if (!ALLOWED_DYNAMIC_MIGRATION_BLOCKS.has(allowlistKey)) {
      throw new Error(`Bloc DO dynamique non allowlisté dans ${journal}/${sourceTag || '?'}`);
    }
    return null;
  }
  if (!/^CREATE\b/i.test(sql)) return null;
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/i.test(sql)) return null;
  if (/^CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/i.test(sql)) return null;
  if (/^CREATE\s+POLICY\b/i.test(sql)) return null;

  const named = (
    kind: string,
    match: RegExpMatchArray,
    defaultSchema = 'public',
  ): DiscoveredMigrationObject => ({
    kind,
    schema: match[1] ?? defaultSchema,
    name: match[2]!,
    identityArguments: '',
    journal,
    introducedAt,
  });
  let match = sql.match(/^CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i);
  if (match) {
    return {
      kind: 'schema',
      schema: match[1]!,
      name: match[1]!,
      identityArguments: '',
      journal,
      introducedAt,
    };
  }
  match = sql.match(
    /^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/i,
  );
  if (match) {
    if (
      /\b(?:smallserial|serial|bigserial)\b/i.test(sql) ||
      /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\s+AS\s+IDENTITY\b/i.test(sql)
    ) {
      throw new Error(
        `Séquence implicite non inventoriable automatiquement dans ${journal}`,
      );
    }
    return named('table', match);
  }
  match = sql.match(/^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/i);
  if (match) return named('sequence', match);
  match = sql.match(/^CREATE\s+TYPE\s+(?:"([^"]+)"\.)?"([^"]+)"\s+AS\s+ENUM\b/i);
  if (match) return named('type', match);
  match = sql.match(/^CREATE\s+DOMAIN\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"\.)?"([^"]+)"/i);
  if (match) return named('domain', match);
  match = sql.match(/^CREATE\s+(?:MATERIALIZED\s+)?VIEW\s+(?:"([^"]+)"\.)?"([^"]+)"/i);
  if (match) {
    return named(/^CREATE\s+MATERIALIZED/i.test(sql) ? 'materialized_view' : 'view', match);
  }
  match = sql.match(/^CREATE\s+FOREIGN\s+TABLE\s+(?:"([^"]+)"\.)?"([^"]+)"/i);
  if (match) return named('foreign_table', match);
  const procedure = parseCallableHeader(sql, 'PROCEDURE');
  if (procedure) {
    return {
      kind: 'procedure',
      schema: procedure.schema,
      name: procedure.name,
      identityArguments: normalizeFunctionIdentityArguments(procedure.arguments),
      journal,
      introducedAt,
    };
  }
  const aggregate = parseCallableHeader(sql, 'AGGREGATE');
  if (aggregate) {
    return {
      kind: 'aggregate',
      schema: aggregate.schema,
      name: aggregate.name,
      identityArguments: normalizeFunctionIdentityArguments(aggregate.arguments),
      journal,
      introducedAt,
    };
  }
  match = sql.match(/^CREATE\s+OPERATOR\s+(?:"([^"]+)"\.)?([^\s(]+)\s*\(([\s\S]*)\)$/i);
  if (match) {
    const definition = match[3] ?? '';
    const left = /\bLEFTARG\s*=\s*([^,\s)]+)/i.exec(definition)?.[1] ?? 'NONE';
    const right = /\bRIGHTARG\s*=\s*([^,\s)]+)/i.exec(definition)?.[1] ?? 'NONE';
    return {
      ...named('operator', match),
      identityArguments: `${left.replaceAll('"', '')}, ${right.replaceAll('"', '')}`,
    };
  }
  const callable = parseCallableHeader(sql, 'FUNCTION');
  if (callable) {
    return {
      kind: 'function',
      schema: callable.schema,
      name: callable.name,
      identityArguments: normalizeFunctionIdentityArguments(callable.arguments),
      journal,
      introducedAt,
    };
  }
  throw new Error(
    `CREATE autonome non inventorié dans ${journal}: ${sql.slice(0, 100)}`,
  );
}

describe('manifeste PostgreSQL versionné', () => {
  it('relie les trois migrateurs au job privilégié et aux seules vérifications runtime', () => {
    const root = resolve(__dirname, '../../..');
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const contexts = ['supply', 'loyalty', 'customer'];
    expect(manifest.scripts['migrate:postgres']).toBe(
      contexts.map((context) => `pnpm --filter @sm/${context} migrate`).join(' && '),
    );
    expect(manifest.scripts['migrate:postgres:built']).toBe(
      contexts.map((context) => `node packages/${context}/dist/migrate.js`).join(' && '),
    );
    expect(manifest.scripts['verify:postgres:built']).toBe(
      contexts.map((context) => `node packages/${context}/dist/verify-migrations.js`).join(' && '),
    );
    const deploy = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
    const compiler = deploy.slice(deploy.indexOf('- name: Compiler les migrateurs'));
    for (const context of contexts) expect(compiler).toContain(`pnpm --filter @sm/${context} build`);
    expect(deploy).toContain('pnpm migrate:postgres:built');
    expect(deploy).toContain('pnpm verify:postgres:built');
    const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/CUSTOMER_TEST_DATABASE_URL: postgresql:\/\/user:password@127\.0\.0\.1:5432\/snackmanager_loyalty_test_ci/);
    expect(ci).toContain('run: pnpm --filter @sm/customer test:integration');
    const api = JSON.parse(readFileSync(resolve(root, 'apps/api/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(api.dependencies['@sm/customer']).toBe('workspace:*');
    const turbo = JSON.parse(readFileSync(resolve(root, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { dependsOn: string[]; inputs: string[] }>;
    };
    expect(turbo.tasks['@sm/postgres-bootstrap#test']?.inputs).toEqual(expect.arrayContaining([
      ...contexts.map((context) => `$TURBO_ROOT$/packages/${context}/drizzle/**`),
      '$TURBO_ROOT$/packages/customer/src/migration-role.ts',
      '$TURBO_ROOT$/package.json', '$TURBO_ROOT$/apps/api/package.json',
      '$TURBO_ROOT$/.github/workflows/ci.yml', '$TURBO_ROOT$/.github/workflows/deploy.yml',
    ]));
    const customerTask = turbo.tasks['@sm/customer#test'];
    expect(customerTask?.dependsOn).toEqual(['^build']);
    expect(customerTask?.inputs).toEqual(expect.arrayContaining([
      '$TURBO_ROOT$/apps/api/src/modules/customer-identity/customer-identity.service.ts',
      '$TURBO_ROOT$/apps/api/src/modules/customer-identity/trial-verification-policy.ts',
      '$TURBO_ROOT$/apps/api/src/modules/customer-identity/phone-verification.port.ts',
    ]));
  });

  it('énumère exactement les 73 objets propriétaires attendus', () => {
    expect(POSTGRES_MANAGED_OBJECTS).toHaveLength(73);
    expect(POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'schema')).toHaveLength(3);
    expect(POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'table')).toHaveLength(39);
    expect(POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'sequence')).toHaveLength(3);
    expect(POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'type')).toHaveLength(21);
    expect(POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'function')).toHaveLength(7);
    expect(new Set(POSTGRES_MANAGED_OBJECTS.map(managedObjectKey)).size).toBe(73);
    expect(
      POSTGRES_MANAGED_OBJECTS.filter((object) => object.introducedAt === undefined).map(
        managedObjectKey,
      ),
    ).toEqual([
      'schema:drizzle.drizzle',
      'table:drizzle.__drizzle_migrations',
      'table:drizzle.__drizzle_loyalty_migrations',
      'table:drizzle.__drizzle_customer_migrations',
      'sequence:drizzle.__drizzle_migrations_id_seq',
      'sequence:drizzle.__drizzle_loyalty_migrations_id_seq',
      'sequence:drizzle.__drizzle_customer_migrations_id_seq',
    ]);
    expect(JOURNALS).toEqual({
      supply: {
        table: '__drizzle_migrations',
        sequence: '__drizzle_migrations_id_seq',
        columns: ['id', 'hash', 'created_at'],
      },
      loyalty: {
        table: '__drizzle_loyalty_migrations',
        sequence: '__drizzle_loyalty_migrations_id_seq',
        columns: ['id', 'hash', 'created_at'],
      },
      customer: {
        table: '__drizzle_customer_migrations',
        sequence: '__drizzle_customer_migrations_id_seq',
        columns: ['id', 'hash', 'created_at'],
      },
    });
  });

  it('rattache exhaustivement chaque CREATE autonome à son fichier et journal Drizzle', () => {
    const found = new Map<string, DiscoveredMigrationObject>();
    for (const context of ['supply', 'loyalty', 'customer'] as const) {
      const directory = resolve(__dirname, `../../${context}/drizzle`);
      const journal = JSON.parse(
        readFileSync(resolve(directory, 'meta/_journal.json'), 'utf8'),
      ) as { entries: Array<{ idx: number; tag: string; when: number }> };
      expect(journal.entries.map((entry) => entry.idx)).toEqual(
        journal.entries.map((_entry, index) => index),
      );
      expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(
        journal.entries.length,
      );
      expect(new Set(journal.entries.map((entry) => entry.when)).size).toBe(
        journal.entries.length,
      );
      expect(journal.entries.every((entry) => Number.isSafeInteger(entry.when))).toBe(true);
      const timestampByTag = new Map(journal.entries.map((entry) => [entry.tag, entry.when]));
      const filenames = readdirSync(directory).filter((name) => name.endsWith('.sql'));
      expect(filenames.map((filename) => filename.slice(0, -4)).sort()).toEqual(
        journal.entries.map((entry) => entry.tag).sort(),
      );
      for (const filename of filenames) {
        const sql = readFileSync(resolve(directory, filename), 'utf8');
        const tag = filename.slice(0, -'.sql'.length);
        const timestamp = timestampByTag.get(tag);
        expect(timestamp, `${context}/${filename} absent du journal`).toBeTypeOf('number');
        for (const statement of splitTopLevelSqlStatements(sql)) {
          const object = discoverCreatedObject(statement, context, timestamp!, tag);
          if (!object) continue;
          const objectKey = discoveredKey(object);
          // CREATE OR REPLACE d'une fonction déjà introduite ne déplace pas sa
          // date d'introduction dans le manifeste.
          if (!found.has(objectKey)) found.set(objectKey, object);
        }
      }
    }
    const introduced = new Map(
      POSTGRES_MANAGED_OBJECTS.filter((object) => object.introducedAt !== undefined).map(
        (object) => [managedObjectKey(object), object],
      ),
    );
    expect([...found.keys()].sort()).toEqual([...introduced.keys()].sort());
    for (const [objectKey, discovered] of found) {
      expect(introduced.get(objectKey), objectKey).toMatchObject({
        journal: discovered.journal,
        introducedAt: discovered.introducedAt,
      });
    }
  });

  it('reprend les horodatages exacts des journaux Drizzle', () => {
    const supply = JSON.parse(
      readFileSync(resolve(__dirname, '../../supply/drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> };
    const loyalty = JSON.parse(
      readFileSync(resolve(__dirname, '../../loyalty/drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> };
    expect(supply.entries.find((entry) => entry.tag.startsWith('0000_'))?.when).toBe(
      SUPPLY_INITIAL_MIGRATION,
    );
    expect(loyalty.entries.find((entry) => entry.tag.startsWith('0000_'))?.when).toBe(
      LOYALTY_INITIAL_MIGRATION,
    );
    expect(loyalty.entries.find((entry) => entry.tag.startsWith('0002_'))?.when).toBe(
      LOYALTY_EARN_RECEIPTS_MIGRATION,
    );
    const customer = JSON.parse(
      readFileSync(resolve(__dirname, '../../customer/drizzle/meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string; when: number }> };
    expect(customer.entries.find((entry) => entry.tag === '0000_customer_identity')?.when)
      .toBe(CUSTOMER_INITIAL_MIGRATION);
    expect(customer.entries.find((entry) => entry.tag === '0001_customer_paid_budget')?.when)
      .toBe(CUSTOMER_PAID_BUDGET_MIGRATION);
  });

  it('lexe les CREATE top-level sans interpréter commentaires, chaînes ou corps dollar', () => {
    const sql = `
      -- CREATE TABLE "public"."commented" (id integer);
      CREATE FUNCTION "public"."overloaded"(integer)
        RETURNS integer LANGUAGE SQL AS $body$ SELECT 1; $body$;
      CREATE FUNCTION "public"."overloaded"(text)
        RETURNS integer LANGUAGE SQL AS $body$ SELECT 2; $body$;
    `;
    const objects = splitTopLevelSqlStatements(sql)
      .map((statement) => discoverCreatedObject(statement, 'supply', 123))
      .filter((object): object is DiscoveredMigrationObject => object !== null);
    expect(objects.map(discoveredKey)).toEqual([
      'function:public.overloaded(integer)',
      'function:public.overloaded(text)',
    ]);
  });

  it.each([
    `DO $$ BEGIN EXECUTE 'CRE' || 'ATE TABLE public.dynamic(id integer)'; END $$`,
    `DO $$ BEGIN EXECUTE format('%s %s public.dynamic(id integer)', 'CREATE', 'TABLE'); END $$`,
    `DO $$ DECLARE command text := 'CREATE TABLE public.dynamic(id integer)';
       BEGIN EXECUTE command; END $$`,
  ])('échoue fermé sur tout bloc DO dynamique non allowlisté', (sql) => {
    expect(() => discoverCreatedObject(sql, 'supply', 123, '0001_rogue')).toThrow(
      /Bloc DO dynamique non allowlisté/,
    );
  });

  it('échoue fermé sur un nouveau kind CREATE autonome', () => {
    expect(() =>
      discoverCreatedObject(
        'CREATE COLLATION "public"."rogue" (provider = libc)',
        'supply',
        123,
      ),
    ).toThrow(/CREATE autonome non inventorié/);
  });
});

describe('préflight PostgreSQL', () => {
  it('accepte une base vierge et ne démarre qu’une transaction READ ONLY', async () => {
    const query = checkQuery();
    await expect(checkPostgresBootstrap(poolFor(query), roles)).resolves.toMatchObject({
      database: 'railway',
      issues: [],
    });
    const statements = (query as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) =>
      String(sql).trim(),
    );
    expect(statements[0]).toContain('FROM pg_catalog.pg_stat_ssl');
    expect(statements[1]).toBe('BEGIN TRANSACTION READ ONLY');
    expect(statements[2]).toContain('AS effective_search_path');
    expect(statements[3]).toBe('SET LOCAL search_path = pg_catalog, public');
    expect(statements).toContain('COMMIT');
    expect(
      statements.filter((sql) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|REASSIGN)\b/i.test(sql)),
    ).toEqual([]);
  });

  it('accepte les trois schémas gérés fermés sur une base saine', async () => {
    const query = checkQuery({
      probe: {
        drizzle_exists: true,
        migration_can_use_drizzle_schema: true,
        migration_can_create_drizzle_schema: true,
        runtime_can_use_drizzle_schema: true,
        loyalty_exists: true,
        migration_can_use_loyalty_schema: true,
        migration_can_create_loyalty_schema: true,
        runtime_can_use_loyalty_schema: true,
        customer_exists: true,
        migration_can_use_customer_schema: true,
        migration_can_create_customer_schema: true,
        runtime_can_use_customer_schema: true,
        drizzle_create_granted_to_public: false,
        drizzle_create_granted_to_other: false,
        loyalty_create_granted_to_public: false,
        loyalty_create_granted_to_other: false,
      },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).resolves.toMatchObject({
      issues: [],
    });
  });

  it.each([
    ['CREATE runtime', { runtime_can_create_customer_schema: true }, 'runtime_privilege_excessive'],
    ['CREATE runtime inconnu', { runtime_can_create_customer_schema: null }, 'runtime_privilege_excessive'],
    ['CREATE PUBLIC', { customer_create_granted_to_public: true }, 'managed_schema_unsafe'],
    ['CREATE tiers', { customer_create_granted_to_other: true }, 'managed_schema_unsafe'],
    ['USAGE runtime absent', { runtime_can_use_customer_schema: false }, 'runtime_privilege_missing'],
    ['CREATE migrateur absent', { migration_can_create_customer_schema: false }, 'migration_privilege_missing'],
  ])('ferme le schéma customer si %s', async (_label, override, code) => {
    const query = checkQuery({ probe: {
      customer_exists: true,
      migration_can_use_customer_schema: true,
      migration_can_create_customer_schema: true,
      runtime_can_use_customer_schema: true,
      ...override,
    } });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: { issues: expect.arrayContaining([expect.objectContaining({ code })]) },
    });
  });

  it.each([
    [
      'membership entrant migrateur',
      { migration_has_members: true },
      'migration_role_unsafe',
    ],
    [
      'membership entrant runtime',
      { runtime_has_members: true },
      'runtime_role_unsafe',
    ],
    [
      'configuration runtime',
      { runtime_role_configuration_safe: false },
      'role_configuration_unsafe',
    ],
    [
      'droit SET session_replication_role',
      { runtime_has_session_replication_role_privilege: true },
      'parameter_privilege_excessive',
    ],
    [
      'CREATE base accordé à un tiers',
      { database_create_granted_to_other: true },
      'database_privilege_excessive',
    ],
  ])('refuse %s', async (_label, probe, issueCode) => {
    await expect(
      checkPostgresBootstrap(poolFor(checkQuery({ probe })), roles),
    ).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: issueCode }),
        ]),
      },
    });
  });

  it('refuse un search_path injecté ou session_replication_role non origin avant override local', async () => {
    await expect(
      checkPostgresBootstrap(
        poolFor(
          checkQuery({
            effectiveSearchPath: 'attacker, public',
            effectiveSessionReplicationRole: 'replica',
          }),
        ),
        roles,
      ),
    ).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'migration_role_unsafe' }),
          expect.objectContaining({ code: 'role_configuration_unsafe' }),
        ]),
      },
    });
  });

  it('refuse le transport avant même d’ouvrir la transaction de contrôle', async () => {
    const query = vi.fn().mockResolvedValue(
      result([{ ssl: false, version: null, cipher: null }]),
    ) as unknown as PoolClient['query'];
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toThrow(/TLS 1\.2/);
    expect(query).toHaveBeenCalledOnce();
    expect(String((query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      'FROM pg_catalog.pg_stat_ssl',
    );
  });

  it('refuse un propriétaire historique avant toute migration', async () => {
    const query = checkQuery({
      probe: {
        drizzle_exists: true,
        migration_can_use_drizzle_schema: true,
        migration_can_create_drizzle_schema: true,
      },
      owners: { [key('schema', 'drizzle', 'drizzle')]: 'postgres' },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'wrong_owner', target: 'drizzle.drizzle' }),
        ]),
      },
    });
  });

  it('refuse un migrateur sans CREATE et un runtime qui récupère du DDL persistant', async () => {
    const query = checkQuery({
      probe: {
        migration_can_create_database_objects: false,
        runtime_can_create_public_schema: true,
      },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'migration_privilege_missing' }),
          expect.objectContaining({ code: 'runtime_privilege_excessive' }),
        ]),
      },
    });
  });

  it.each([
    ['supply', SUPPLY_INITIAL_MIGRATION, 'public.ingredients'],
    ['customer', CUSTOMER_INITIAL_MIGRATION, 'customer.accounts'],
  ] as const)('refuse un objet %s déclaré appliqué mais absent', async (journal, timestamp, target) => {
    const owners = {
      [key('schema', 'drizzle', 'drizzle')]: roles.migrationRole,
      [key('table', 'drizzle', JOURNALS[journal].table)]: roles.migrationRole,
      [key('sequence', 'drizzle', JOURNALS[journal].sequence)]: roles.migrationRole,
    };
    const query = checkQuery({
      probe: {
        drizzle_exists: true,
        migration_can_use_drizzle_schema: true,
        migration_can_create_drizzle_schema: true,
      },
      owners,
      journals: { [journal]: [timestamp] },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'missing_object', target }),
        ]),
      },
    });
  });

  it.each(['loyalty', 'customer'])('refuse un objet inattendu dans le schéma exclusif %s', async (schema) => {
    const query = checkQuery({
      unmanaged: [
        { kind: 'table', schema, name: 'rogue', owner: 'postgres' },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'unexpected_object', target: `${schema}.rogue` }),
        ]),
      },
    });
  });

  it('refuse une relation public du mauvais kind qui réserve un nom du manifeste', async () => {
    const query = checkQuery({
      unmanaged: [
        { kind: 'view', schema: 'public', name: 'ingredients', owner: 'postgres' },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'unexpected_object', target: 'public.ingredients' }),
        ]),
      },
    });
  });

  it.each([
    ['view', 'loyalty.rogue_view'],
    ['procedure', 'loyalty.rogue_procedure()'],
    ['domain', 'loyalty.rogue_domain'],
  ])('refuse aussi un objet autonome inattendu de kind %s', async (kind, target) => {
    const query = checkQuery({
      unmanaged: [
        { kind, schema: 'loyalty', name: target.split('.')[1]!.replace('()', ''), owner: 'postgres' },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'unexpected_object', target }),
        ]),
      },
    });
  });

  it.each([
    ['function', 'bootstrap_rogue_function', 'public.bootstrap_rogue_function()'],
    ['domain', 'bootstrap_rogue_domain', 'public.bootstrap_rogue_domain'],
    ['operator', '#=#', 'public.#=#(integer, integer)'],
  ])('refuse le shadowing public par un %s hors manifeste', async (kind, name, target) => {
    const query = checkQuery({
      unmanaged: [
        {
          kind,
          schema: 'public',
          name,
          owner: 'postgres',
          identityArguments: kind === 'operator' ? 'integer, integer' : '',
        },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'unexpected_object', target }),
        ]),
      },
    });
  });

  it('refuse une frontière public détenue ou ouverte incorrectement', async () => {
    const query = checkQuery({
      probe: {
        public_schema_owner: roles.runtimeRole,
        public_create_granted_to_public: true,
      },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'public_schema_unsafe', target: 'schema:public' }),
        ]),
      },
    });
  });

  it('refuse CREATE accordé à PUBLIC ou à un tiers sur un schéma géré', async () => {
    const query = checkQuery({
      probe: {
        loyalty_exists: true,
        migration_can_use_loyalty_schema: true,
        migration_can_create_loyalty_schema: true,
        runtime_can_use_loyalty_schema: true,
        loyalty_create_granted_to_public: true,
        loyalty_create_granted_to_other: true,
      },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            code: 'managed_schema_unsafe',
            target: 'schema:loyalty',
          }),
        ]),
      },
    });
  });

  it('refuse les droits métier incomplets/excessifs et un default ACL hors matrice', async () => {
    const owners = {
      [key('table', 'loyalty', 'ledger_entries')]: roles.migrationRole,
    };
    const query = checkQuery({
      owners,
      applicationAcl: {
        'loyalty.ledger_entries': {
          exists: true,
          runtimeHasRequired: false,
          runtimeHasDisallowed: true,
          publicHasAny: true,
        },
      },
      defaultPrivileges: [
        {
          schema_name: 'loyalty',
          object_type: 'r',
          grantee_name: 'PUBLIC',
          privilege_type: 'TRUNCATE',
          is_grantable: false,
        },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'application_privilege_missing' }),
          expect.objectContaining({ code: 'application_privilege_excessive' }),
          expect.objectContaining({ code: 'default_privilege_excessive' }),
        ]),
      },
    });
  });

  it('accepte uniquement la matrice default ACL versionnée du runtime et du propriétaire', async () => {
    const query = checkQuery({
      defaultPrivileges: [
        {
          schema_name: 'public',
          object_type: 'r',
          grantee_name: roles.runtimeRole,
          privilege_type: 'SELECT',
          is_grantable: false,
        },
        {
          schema_name: 'loyalty',
          object_type: 'S',
          grantee_name: roles.runtimeRole,
          privilege_type: 'USAGE',
          is_grantable: false,
        },
        {
          schema_name: '*',
          object_type: 'f',
          grantee_name: roles.migrationRole,
          privilege_type: 'EXECUTE',
          is_grantable: true,
        },
      ],
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).resolves.toMatchObject({
      issues: [],
    });
  });

  it.each(['supply', 'loyalty', 'customer'] as const)('refuse le journal %s non SELECT-only ou exposé à PUBLIC', async (journal) => {
    const owners = {
      [key('schema', 'drizzle', 'drizzle')]: roles.migrationRole,
      [key('table', 'drizzle', JOURNALS[journal].table)]: roles.migrationRole,
      [key('sequence', 'drizzle', JOURNALS[journal].sequence)]: roles.migrationRole,
    };
    const query = checkQuery({
      probe: {
        drizzle_exists: true,
        migration_can_use_drizzle_schema: true,
        migration_can_create_drizzle_schema: true,
      },
      owners,
      journalAcl: {
        [journal]: {
          exists: true,
          runtimeCanSelect: false,
          runtimeHasDirectSelect: false,
          runtimeSelectIsGrantable: true,
          runtimeHasNonSelect: true,
          runtimeHasColumnAcl: true,
          publicHasAny: true,
          publicHasColumnAcl: true,
          thirdPartyHasAny: true,
          thirdPartyHasColumnAcl: true,
        },
      },
    });
    await expect(checkPostgresBootstrap(poolFor(query), roles)).rejects.toMatchObject({
      report: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: 'journal_privilege_missing' }),
          expect.objectContaining({ code: 'journal_privilege_excessive' }),
        ]),
      },
    });
  });

  it('refuse les identifiants SQL avant la première connexion', async () => {
    const pool = { connect: vi.fn() } as unknown as Pick<Pool, 'connect'>;
    await expect(
      checkPostgresBootstrap(pool, { ...roles, runtimeRole: 'app;drop' }),
    ).rejects.toThrow(/invalide/);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('réparation PostgreSQL', () => {
  function safeAdminProbe() {
    return {
      database_name: 'railway',
      database_configuration_safe: true,
      database_create_granted_to_public: false,
      database_create_granted_to_other: false,
      admin_role: 'postgres',
      session_role: 'postgres',
      admin_rolsuper: true,
      migration_role: roles.migrationRole,
      migration_rolcanlogin: true,
      migration_rolsuper: false,
      migration_rolbypassrls: false,
      migration_rolcreaterole: false,
      migration_rolcreatedb: false,
      migration_rolreplication: false,
      migration_has_role_membership: false,
      migration_has_members: false,
      migration_role_configuration_safe: true,
      migration_database_configuration_safe: true,
      migration_has_session_replication_role_privilege: false,
      runtime_role: roles.runtimeRole,
      runtime_rolcanlogin: true,
      runtime_rolsuper: false,
      runtime_rolbypassrls: false,
      runtime_rolcreaterole: false,
      runtime_rolcreatedb: false,
      runtime_rolreplication: false,
      runtime_has_role_membership: false,
      runtime_has_members: false,
      runtime_role_configuration_safe: true,
      runtime_database_configuration_safe: true,
      runtime_database_search_path: 'search_path=pg_catalog, public',
      runtime_has_session_replication_role_privilege: false,
      migration_database_search_path: 'search_path=public, pg_catalog',
      public_schema_owner: 'pg_database_owner',
      public_create_granted_to_public: false,
      public_create_granted_to_other: false,
      drizzle_create_granted_to_public: false,
      drizzle_create_granted_to_other: false,
      loyalty_create_granted_to_public: false,
      loyalty_create_granted_to_other: false,
      customer_create_granted_to_public: false,
      customer_create_granted_to_other: false,
    };
  }

  type RepairJournalAcl = {
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
  };

  function repairQuery(state: {
    drizzleOwner: string;
    rogue?: boolean;
    publicCreate?: boolean;
    publicOwner?: string;
    defaultPrivileges?: Array<{
      schema_name: string;
      object_type: string;
      grantee_name: string;
      privilege_type: string;
      is_grantable: boolean;
    }>;
    journalAcl?: Partial<Record<'supply' | 'loyalty' | 'customer', RepairJournalAcl>>;
  }) {
    return vi.fn(async (query: unknown, parameters?: unknown[]) => {
      const sql = String(query);
      if (sql.includes('FROM pg_catalog.pg_stat_ssl')) {
        return result([{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }]);
      }
      if (sql.includes('FROM pg_catalog.pg_roles admin')) {
        return result([
          {
            ...safeAdminProbe(),
            public_schema_owner: state.publicOwner ?? 'pg_database_owner',
            public_create_granted_to_public: state.publicCreate ?? false,
          },
        ]);
      }
      if (sql.includes('pg_catalog.pg_default_acl')) {
        return result(state.defaultPrivileges ?? []);
      }
      if (sql === 'REVOKE CREATE ON SCHEMA "public" FROM PUBLIC') {
        state.publicCreate = false;
        return result([]);
      }
      if (sql.startsWith('ALTER SCHEMA "drizzle" OWNER')) {
        state.drizzleOwner = roles.migrationRole;
        return result([]);
      }
      if (sql.includes('FROM pg_catalog.pg_roles migration')) {
        return result([
          safeRoleProbe({
            drizzle_exists: true,
            migration_can_use_drizzle_schema: true,
            migration_can_create_drizzle_schema: true,
            runtime_can_use_drizzle_schema: true,
            public_schema_owner: state.publicOwner ?? 'pg_database_owner',
            public_create_granted_to_public: state.publicCreate ?? false,
          }),
        ]);
      }
      if (sql.includes('AS allowed')) {
        const role = parameters?.[0];
        const privilege = parameters?.[2];
        return result([
          {
            allowed:
              role === roles.migrationRole ||
              (role === roles.runtimeRole && ['USAGE', 'CONNECT'].includes(String(privilege))),
          },
        ]);
      }
      if (sql.includes('AS runtime_has_non_select')) {
        return result(
          (['supply', 'loyalty', 'customer'] as const).map((journal) => {
            const acl = state.journalAcl?.[journal];
            return {
              table_name: JOURNALS[journal].table,
              relation_exists: acl?.exists ?? false,
              runtime_can_select: acl?.runtimeCanSelect ?? false,
              runtime_has_direct_select: acl?.runtimeHasDirectSelect ?? false,
              runtime_select_is_grantable: acl?.runtimeSelectIsGrantable ?? false,
              runtime_has_non_select: acl?.runtimeHasNonSelect ?? false,
              runtime_has_column_acl: acl?.runtimeHasColumnAcl ?? false,
              public_has_any: acl?.publicHasAny ?? false,
              public_has_column_acl: acl?.publicHasColumnAcl ?? false,
              third_party_has_any: acl?.thirdPartyHasAny ?? false,
              third_party_has_column_acl: acl?.thirdPartyHasColumnAcl ?? false,
            };
          }),
        );
      }
      if (sql.includes('AS runtime_has_disallowed')) {
        return result(
          POSTGRES_MANAGED_OBJECTS.filter(
            (object) => object.kind === 'table' && object.schema !== 'drizzle',
          ).map((table) => ({
            schema_name: table.schema,
            table_name: table.name,
            relation_exists: false,
            runtime_has_required: false,
            runtime_has_disallowed: false,
            runtime_has_grant_option: false,
            runtime_has_column_acl: false,
            public_has_any: false,
            public_has_column_acl: false,
            third_party_has_any: false,
            third_party_has_column_acl: false,
          })),
        );
      }
      if (sql.includes('AS runtime_can_usage')) {
        return result(
          POSTGRES_MANAGED_OBJECTS.filter((object) => object.kind === 'sequence').map(
            (sequence) => ({
              schema_name: sequence.schema,
              sequence_name: sequence.name,
              relation_exists: ['supply', 'loyalty', 'customer'].some(
                (journal) =>
                  state.journalAcl?.[journal as 'supply' | 'loyalty' | 'customer']?.exists &&
                  JOURNALS[journal as 'supply' | 'loyalty' | 'customer'].sequence === sequence.name,
              ),
              runtime_can_usage: false,
              runtime_can_select: false,
              runtime_can_update: false,
              runtime_has_grant_option: false,
              public_has_any: false,
              third_party_has_any: false,
            }),
          ),
        );
      }
      for (const journal of ['supply', 'loyalty', 'customer'] as const) {
        const acl = state.journalAcl?.[journal];
        if (!acl || !sql.includes(`"${JOURNALS[journal].table}"`)) continue;
        if (sql.startsWith('REVOKE SELECT,') && sql.endsWith('FROM PUBLIC')) {
          acl.publicHasAny = false;
        }
        if (sql.startsWith('REVOKE SELECT (') && sql.endsWith('FROM PUBLIC')) {
          acl.publicHasColumnAcl = false;
        }
        if (sql.startsWith('REVOKE INSERT')) acl.runtimeHasNonSelect = false;
        if (sql.startsWith('REVOKE SELECT (') && !sql.endsWith('FROM PUBLIC')) {
          acl.runtimeHasColumnAcl = false;
        }
        if (sql.startsWith('REVOKE GRANT OPTION')) {
          acl.runtimeSelectIsGrantable = false;
        }
        if (sql.startsWith('GRANT SELECT')) {
          acl.runtimeCanSelect = true;
          acl.runtimeHasDirectSelect = true;
        }
        return result([]);
      }
      if (sql.includes('jsonb_to_recordset')) {
        const owners: Record<string, string> = {
          [key('schema', 'drizzle', 'drizzle')]: state.drizzleOwner,
        };
        for (const journal of ['supply', 'loyalty', 'customer'] as const) {
          if (!state.journalAcl?.[journal]?.exists) continue;
          owners[key('table', 'drizzle', JOURNALS[journal].table)] = roles.migrationRole;
          owners[key('sequence', 'drizzle', JOURNALS[journal].sequence)] = roles.migrationRole;
        }
        return result(
          catalogRows(
            owners,
            state.rogue
              ? [{ kind: 'table', schema: 'loyalty', name: 'rogue', owner: 'postgres' }]
              : [],
          ),
        );
      }
      return result([]);
    }) as unknown as PoolClient['query'];
  }

  it('répare seulement l’allowlist et devient un no-op au second passage', async () => {
    const state = { drizzleOwner: 'postgres' };
    const firstQuery = repairQuery(state);
    const first = await repairPostgresBootstrap(poolFor(firstQuery), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(first.changed).toEqual([
      `owner:drizzle.drizzle:${roles.migrationRole}`,
    ]);
    expect(state.drizzleOwner).toBe(roles.migrationRole);

    const secondQuery = repairQuery(state);
    const second = await repairPostgresBootstrap(poolFor(secondQuery), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(second.changed).toEqual([]);
    const allSql = [...(firstQuery as ReturnType<typeof vi.fn>).mock.calls, ...(secondQuery as ReturnType<typeof vi.fn>).mock.calls]
      .map(([sql]) => String(sql))
      .join('\n');
    expect(allSql).not.toMatch(/REASSIGN\s+OWNED|ALTER\s+.*\s+ALL\b/i);
  });

  it('retire CREATE à PUBLIC sans changer le propriétaire partagé', async () => {
    const state = { drizzleOwner: roles.migrationRole, publicCreate: true };
    const firstQuery = repairQuery(state);
    const first = await repairPostgresBootstrap(poolFor(firstQuery), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(first.changed).toEqual(['revoke:public:CREATE:PUBLIC']);
    expect(state.publicCreate).toBe(false);
    expect(
      (firstQuery as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) =>
        String(sql).startsWith('ALTER SCHEMA "public" OWNER'),
      ),
    ).toBe(false);

    const second = await repairPostgresBootstrap(poolFor(repairQuery(state)), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(second.changed).toEqual([]);
  });

  it('refuse de modifier automatiquement le propriétaire du schéma public', async () => {
    const query = repairQuery({
      drizzleOwner: roles.migrationRole,
      publicOwner: 'postgres',
    });
    await expect(
      repairPostgresBootstrap(poolFor(query), { ...roles, expectedDatabase: 'railway' }),
    ).rejects.toThrow(/pg_database_owner/);
    const statements = (query as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql));
    expect(statements).not.toContainEqual(expect.stringMatching(/^ALTER SCHEMA "public" OWNER/));
    expect(statements).toContain('ROLLBACK');
  });

  it('ramène chaque journal à SELECT-only pour le runtime et aucun droit PUBLIC', async () => {
    const state = {
      drizzleOwner: roles.migrationRole,
      journalAcl: {
        supply: {
          exists: true,
          runtimeCanSelect: false,
          runtimeHasDirectSelect: false,
          runtimeSelectIsGrantable: true,
          runtimeHasNonSelect: true,
          runtimeHasColumnAcl: true,
          publicHasAny: true,
          publicHasColumnAcl: true,
          thirdPartyHasAny: false,
          thirdPartyHasColumnAcl: false,
        },
      },
    };
    const first = await repairPostgresBootstrap(poolFor(repairQuery(state)), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(first.changed).toEqual([
      `revoke:drizzle.${JOURNALS.supply.table}:ALL:PUBLIC`,
      `revoke:drizzle.${JOURNALS.supply.table}:COLUMNS:PUBLIC`,
      `revoke:drizzle.${JOURNALS.supply.table}:WRITE:${roles.runtimeRole}`,
      `revoke:drizzle.${JOURNALS.supply.table}:COLUMNS:${roles.runtimeRole}`,
      `revoke:drizzle.${JOURNALS.supply.table}:SELECT_GRANT_OPTION:${roles.runtimeRole}`,
      `grant:drizzle.${JOURNALS.supply.table}:SELECT:${roles.runtimeRole}`,
    ]);
    expect(state.journalAcl.supply).toMatchObject({
      runtimeCanSelect: true,
      runtimeHasDirectSelect: true,
      runtimeSelectIsGrantable: false,
      runtimeHasNonSelect: false,
      runtimeHasColumnAcl: false,
      publicHasAny: false,
      publicHasColumnAcl: false,
      thirdPartyHasAny: false,
      thirdPartyHasColumnAcl: false,
    });
    const second = await repairPostgresBootstrap(poolFor(repairQuery(state)), {
      ...roles,
      expectedDatabase: 'railway',
    });
    expect(second.changed).toEqual([]);
  });

  it('laisse un objet rogue intact et annule toute la transaction', async () => {
    const state = { drizzleOwner: 'postgres', rogue: true };
    const query = repairQuery(state);
    await expect(
      repairPostgresBootstrap(poolFor(query), { ...roles, expectedDatabase: 'railway' }),
    ).rejects.toBeInstanceOf(PostgresBootstrapError);
    const statements = (query as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) => String(sql));
    expect(statements).not.toContainEqual(expect.stringMatching(/ALTER TABLE .*rogue/));
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });

  it('refuse un default ACL hors matrice avant toute réparation', async () => {
    const query = repairQuery({
      drizzleOwner: 'postgres',
      defaultPrivileges: [
        {
          schema_name: 'loyalty',
          object_type: 'r',
          grantee_name: 'PUBLIC',
          privilege_type: 'TRUNCATE',
          is_grantable: false,
        },
      ],
    });
    await expect(
      repairPostgresBootstrap(poolFor(query), { ...roles, expectedDatabase: 'railway' }),
    ).rejects.toThrow(/Privilège par défaut hors allowlist/);
    const statements = (query as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) =>
      String(sql),
    );
    expect(statements).not.toContainEqual(expect.stringMatching(/^ALTER SCHEMA/));
    expect(statements).toContain('ROLLBACK');
  });

  it('refuse un administrateur non superuser avant le premier DDL', async () => {
    const query = vi.fn(async (sql: unknown) => {
      if (String(sql).includes('FROM pg_catalog.pg_stat_ssl')) {
        return result([{ ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }]);
      }
      if (String(sql).includes('FROM pg_catalog.pg_roles admin')) {
        return result([{ ...safeAdminProbe(), admin_rolsuper: false }]);
      }
      return result([]);
    }) as unknown as PoolClient['query'];
    await expect(
      repairPostgresBootstrap(poolFor(query), { ...roles, expectedDatabase: 'railway' }),
    ).rejects.toThrow(/administrateur/);
    const statements = (query as ReturnType<typeof vi.fn>).mock.calls.map(([sql]) =>
      String(sql).trim(),
    );
    expect(
      statements.some((sql) => /^(ALTER|GRANT|REVOKE|REASSIGN)\b/i.test(sql)),
    ).toBe(false);
  });

  it('refuse un transport non chiffré avant BEGIN et tout DDL', async () => {
    const query = vi.fn().mockResolvedValue(
      result([{ ssl: false, version: null, cipher: null }]),
    ) as unknown as PoolClient['query'];
    await expect(
      repairPostgresBootstrap(poolFor(query), { ...roles, expectedDatabase: 'railway' }),
    ).rejects.toThrow(/TLS 1\.2/);
    expect(query).toHaveBeenCalledOnce();
    expect(String((query as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain(
      'FROM pg_catalog.pg_stat_ssl',
    );
  });

  it('exige environnement et --apply au niveau de la CLI', () => {
    expect(() => parseRepairArguments(['--environment', 'production'])).toThrow(/--apply/);
    expect(() => parseRepairArguments(['--apply'])).toThrow(/--environment/);
    expect(parseRepairArguments(['--environment', 'staging', '--apply'])).toEqual({
      environment: 'staging',
      apply: true,
    });
    expect(parseRepairArguments(['--', '--environment', 'production', '--apply'])).toEqual({
      environment: 'production',
      apply: true,
    });
  });

  it('épingle hôte et port administrateur avant toute ouverture de socket', () => {
    const environment = {
      DATABASE_BOOTSTRAP_ADMIN_URL:
        'postgresql://user:password@staging-db.internal:6543/railway?sslmode=verify-full',
      DATABASE_BOOTSTRAP_EXPECTED_HOST: 'staging-db.internal',
      DATABASE_BOOTSTRAP_EXPECTED_PORT: '6543',
    };
    expect(repairConnectionUrl('staging', environment)).toBe(
      environment.DATABASE_BOOTSTRAP_ADMIN_URL,
    );
    expect(() =>
      repairConnectionUrl('staging', {
        ...environment,
        DATABASE_BOOTSTRAP_EXPECTED_HOST: 'production-db.internal',
      }),
    ).toThrow(/hôte PostgreSQL attendu/);
    expect(() =>
      repairConnectionUrl('staging', {
        ...environment,
        DATABASE_BOOTSTRAP_EXPECTED_PORT: '5432',
      }),
    ).toThrow(/port PostgreSQL attendu/);
  });

  it.each([
    ['DATABASE_BOOTSTRAP_EXPECTED_HOST', undefined],
    ['DATABASE_BOOTSTRAP_EXPECTED_PORT', undefined],
    ['DATABASE_BOOTSTRAP_EXPECTED_PORT', '0'],
    ['DATABASE_BOOTSTRAP_EXPECTED_PORT', '65536'],
  ] as const)('refuse un ciblage administrateur absent ou invalide : %s', (name, value) => {
    expect(() =>
      repairConnectionUrl('production', {
        DATABASE_BOOTSTRAP_ADMIN_URL:
          'postgresql://user:password@production-db.internal:6543/railway?sslmode=verify-full',
        DATABASE_BOOTSTRAP_EXPECTED_HOST: 'production-db.internal',
        DATABASE_BOOTSTRAP_EXPECTED_PORT: '6543',
        [name]: value,
      }),
    ).toThrow(/DATABASE_BOOTSTRAP_EXPECTED_(?:HOST|PORT)/);
  });

  it('ne contient aucune primitive globale de réattribution', () => {
    expect(Object.values(bootstrapSqlForTests).join('\n')).not.toMatch(
      /REASSIGN\s+OWNED|ALTER\s+.*\s+ALL\b/i,
    );
  });
});
