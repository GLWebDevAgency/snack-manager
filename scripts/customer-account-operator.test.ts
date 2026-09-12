import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { Pool, PoolConfig } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { customerAccountOperator, customerOperatorFromStdin, customerOperatorExitCode,
  MAX_CUSTOMER_OPERATOR_BYTES } from './customer-account-operator';

function fixture(environment: 'staging' | 'production' = 'production') {
  const target = { version: 1 as const, environment, railwayProjectId: '11111111-1111-4111-8111-111111111111',
    railwayEnvironmentId: '22222222-2222-4222-8222-222222222222', tenantRef: 'a'.repeat(24), slug: 'restaurant-fixture',
    verifyAccountSid: `AC${'b'.repeat(32)}`, verifyServiceSid: `VA${'c'.repeat(32)}`,
    origins: ['https://restaurant.example'], apiOrigin: 'https://api.example' };
  const scope = { parentRef: target.verifyAccountSid, tenantRef: target.tenantRef };
  const budget = { ...scope, authorizationRef: 'budget-reviewed-2026-01', serviceSid: target.verifyServiceSid,
    currency: 'USD' as const, authorizedSpendMicrousd: 90_000_000, reservePerSendMicrousd: 150_000,
    maxSendReservations: 500, costEvidenceReference: 'cost-reviewed-2026-01',
    notBefore: 1_800_000_000_000, expiresAt: 1_802_592_000_000 };
  const admissions = { ...scope, policyRef: 'admissions-reviewed-2026-01', windowMs: 86_400_000,
    browserSourceLimit: 10, browserTenantLimit: 500, browserParentLimit: 1000, intentBrowserLimit: 4,
    intentSourceLimit: 10, intentTenantLimit: 500, intentParentLimit: 1000 };
  const env: Record<string, string | undefined> = { RAILWAY_PROJECT_ID: target.railwayProjectId,
    RAILWAY_ENVIRONMENT_ID: target.railwayEnvironmentId, RAILWAY_ENVIRONMENT_NAME: environment, SM_ENV: environment,
    DATABASE_MIGRATION_URL: 'postgresql://operator:PRIVATE_DATABASE_SECRET@database.example/fixture?sslmode=verify-full',
    DATABASE_MIGRATION_ROLE: 'fixture_migrator', DATABASE_RUNTIME_ROLE: 'fixture_runtime' };
  return { target, budget, admissions, scope, env };
}
function request(action: 'authorize-budget' | 'authorize-admissions' | 'activate-budget' | 'revoke-budget', f = fixture()) {
  return { action, target: f.target, input: action === 'authorize-budget' ? f.budget : action === 'authorize-admissions' ? f.admissions
    : action === 'activate-budget' ? { ...f.scope, authorizationRef: f.budget.authorizationRef, expectedActiveAuthorizationRef: null }
      : { ...f.scope, authorizationRef: f.budget.authorizationRef } };
}
function safeRoles() {
  return { role_name: 'fixture_runtime', migration_role: 'fixture_migrator', migration_rolsuper: false,
    migration_rolbypassrls: false, migration_rolcreaterole: false, migration_rolcreatedb: false, migration_rolreplication: false,
    migration_has_role_membership: false, migration_has_role_members: false, migration_search_path: 'public, pg_catalog',
    database_name: 'fixture', rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
    rolreplication: false, has_role_membership: false, has_role_members: false, can_create_database_objects: false,
    can_create_public_schema: false, can_create_customer_schema: false, owns_application_objects: false };
}
const operatorTables = ['production_budget_authorizations', 'production_budget_activation', 'production_admission_policies', 'production_admissions'];
function readOnlyOperatorTables() {
  return operatorTables.map(table_name => ({ table_name, relation_exists: true, runtime_select: true,
    runtime_insert: false, runtime_update: false, runtime_delete: false, runtime_truncate: false, runtime_references: false,
    runtime_trigger: false, runtime_maintain: false, runtime_grantable: false, runtime_or_public_column_acl: false, public_acl: false }));
}
/** All production SQL and transaction boundaries run against this local deterministic port.
 * The migration/role/TLS helpers and PostgresCustomerProductionOperator are the real implementations. */
function database() {
  const state = { identity: 'fixture_migrator', roles: safeRoles(), tls: { ssl: true, version: 'TLSv1.3', cipher: 'fixture_cipher' },
    tableAcls: readOnlyOperatorTables(),
    migrations: readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../packages/customer/drizzle', import.meta.url)) })
      .map(migration => ({ hash: migration.hash, created_at: String(migration.folderMillis) })),
    grantService: fixture().target.verifyServiceSid as string | null, active: null as { authorization_ref: string; tenant_ref: string } | null,
    rowCount: 1, failSql: null as RegExp | null, failEnd: false,
    beforeQuery: undefined as ((sql: string) => void | Promise<void>) | undefined };
  const statements: { sql: string; values: unknown[] }[] = [];
  const result = (rows: unknown[] = [], rowCount = rows.length) => ({ rows, rowCount });
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push({ sql, values }); await state.beforeQuery?.(sql);
    if (state.failSql?.test(sql)) throw new Error('PRIVATE_QUERY_SECRET postgres://private-host +33612345678');
    if (sql.includes('pg_catalog.pg_stat_ssl')) return result([state.tls]);
    if (sql === 'SELECT current_user::text AS migration_role') return result([{ migration_role: state.identity }]);
    if (sql.includes('FROM pg_catalog.pg_roles r')) return result([state.roles]);
    if (sql.includes('drizzle.__drizzle_customer_migrations')) return result(state.migrations);
    if (sql.startsWith('WITH operator_tables AS')) return result(state.tableAcls);
    if (sql.startsWith('SELECT service_sid')) return result(state.grantService === null ? [] : [{ service_sid: state.grantService }]);
    if (sql.startsWith('SELECT authorization_ref,tenant_ref')) return result(state.active ? [state.active] : []);
    if (/^(INSERT|UPDATE) INTO?/.test(sql) || sql.startsWith('UPDATE ')) return result([], state.rowCount);
    if (sql.startsWith('SELECT 1 FROM customer.production_')) return result(state.rowCount ? [{}] : []);
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) || sql.startsWith('SET LOCAL ') || sql.startsWith('SELECT set_config(')
      || sql.startsWith('SELECT pg_advisory_xact_lock(') || sql.startsWith('SELECT parent_ref FROM customer.parent_budgets')) return result();
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  });
  const client = { query, release: vi.fn(), on: vi.fn() };
  const pool = { connect: vi.fn(async () => client), end: vi.fn(async () => { if (state.failEnd) throw new Error('PRIVATE_END_SECRET'); }), on: vi.fn() };
  const createPool = vi.fn((_config: PoolConfig) => pool as unknown as Pool);
  const mutations = () => statements.filter(item => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|GRANT|DROP|TRUNCATE)\b/.test(item.sql));
  return { state, statements, query, client, pool, createPool, mutations };
}
async function* stdin(...parts: (string | Uint8Array)[]) { for (const part of parts) yield part; }
const actions = ['authorize-budget', 'activate-budget', 'revoke-budget', 'authorize-admissions'] as const;

describe('document opérateur et simulation hermétique', () => {
  it.each(actions)('%s valide les valeurs explicites sans lire la configuration ni ouvrir une connexion', async action => {
    const f = fixture(); const createPool = vi.fn(() => { throw new Error('No database in dry-run'); });
    const env = new Proxy({}, { get: () => { throw new Error('No environment in dry-run'); } });
    const output = await customerAccountOperator(request(action, f), { env }, { createPool });
    expect(output).toMatchObject({ action, mode: 'dry-run', outcome: 'planned', code: 'validated_only' });
    expect(customerOperatorExitCode(output)).toBe(0); expect(createPool).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toMatch(/https:|postgres:|PRIVATE_|verifyAccountSid|verifyServiceSid|railwayProjectId/);
  });
  it('préserve les unités, le plafond, les références et les bornes temporelles de l’autorisation', async () => {
    const f = fixture(); const output = await customerAccountOperator(request('authorize-budget', f));
    const { tenantRef: _tenant, parentRef: _parent, serviceSid: _service, ...expected } = f.budget;
    expect(output.details).toEqual(expected);
    expect((await customerAccountOperator(request('authorize-admissions', f))).details).toMatchObject({ policyRef: f.admissions.policyRef,
      windowMs: 86_400_000, browserSourceLimit: 10, intentBrowserLimit: 4 });
  });
  it.each([null, {}, { action: 'unknown' }, { ...request('authorize-budget'), source: 'browser' },
    { ...request('activate-budget'), input: { ...fixture().scope, authorizationRef: 'budget' } },
    { ...request('authorize-budget'), input: { ...fixture().budget, reservePerSendMicrousd: 0 } },
    { ...request('authorize-budget'), input: { ...fixture().budget, authorizedSpendMicrousd: 0 } },
    { ...request('authorize-budget'), input: { ...fixture().budget, maxSendReservations: 1.5 } },
    { ...request('authorize-budget'), input: { ...fixture().budget, expiresAt: fixture().budget.notBefore } },
    { ...request('authorize-budget'), input: { ...fixture().budget, apiKeySecret: 'PRIVATE_EXTRA_SECRET' } },
    { ...request('authorize-admissions'), input: { ...fixture().admissions, windowMs: 0 } },
    { ...request('authorize-admissions'), input: { ...fixture().admissions, browserSourceLimit: 1001 } },
  ])('refuse un document invalide sans connexion : %#', async raw => {
    const db = database(); const output = await customerAccountOperator(raw, { apply: true, env: fixture().env }, db);
    expect(output).toMatchObject({ outcome: 'invalid_input', code: 'input_invalid' });
    expect(output.details).toBeUndefined(); expect(db.createPool).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toContain('PRIVATE_EXTRA_SECRET');
  });
  it.each(['tenantRef', 'parentRef', 'serviceSid'])('refuse le scope %s distinct de la cible même en simulation', async field => {
    const f = fixture(); const output = await customerAccountOperator({ ...request('authorize-budget', f),
      input: { ...f.budget, [field]: field === 'tenantRef' ? 'd'.repeat(24) : field === 'parentRef' ? `AC${'d'.repeat(32)}` : `VA${'d'.repeat(32)}` } });
    expect(output.outcome).toBe('invalid_input');
  });
  it('refuse les origines non HTTPS, inconnues ou ambiguës de la cible partagée', async () => {
    for (const target of [{ ...fixture().target, apiOrigin: 'http://api.example' },
      { ...fixture().target, origins: ['https://restaurant.example/'] }, { ...fixture().target, extra: true }]) {
      expect((await customerAccountOperator({ ...request('authorize-budget'), target })).outcome).toBe('invalid_input');
    }
  });
  it('ne fait aucun appel HTTP/TCP même avec des variables et cibles réseau présentes', async () => {
    const network = [vi.spyOn(net, 'connect'), vi.spyOn(http, 'request'), vi.spyOn(https, 'request')];
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const spy of network) spy.mockImplementation(() => { throw new Error('Unexpected network'); });
    fetcher.mockRejectedValue(new Error('Unexpected fetch'));
    try {
      const output = await customerOperatorFromStdin(stdin(JSON.stringify(request('authorize-budget'))), { env: fixture().env });
      expect(output.outcome).toBe('planned');
      for (const spy of [...network, fetcher]) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of [...network, fetcher]) spy.mockRestore(); }
  });
  it('borne le nombre d’octets effectivement lus, y compris UTF-8 et flux découpé', async () => {
    const createPool = vi.fn();
    expect((await customerOperatorFromStdin(stdin('é'.repeat(MAX_CUSTOMER_OPERATOR_BYTES / 2), ' '), {}, { createPool })).code).toBe('input_too_large');
    const json = JSON.stringify(request('authorize-budget'));
    expect((await customerOperatorFromStdin(stdin(json, ' '.repeat(MAX_CUSTOMER_OPERATOR_BYTES - Buffer.byteLength(json))))).outcome).toBe('planned');
    expect(createPool).not.toHaveBeenCalled();
  });
  it.each(['', '{"PRIVATE_INPUT_SECRET":', '{}{}', Buffer.from([0xc3, 0x28])])('refuse le JSON/UTF-8 incorrect sans le refléter : %#', async value => {
    const output = await customerOperatorFromStdin(stdin(value));
    expect(output).toMatchObject({ outcome: 'invalid_input', code: 'input_invalid' });
    expect(JSON.stringify(output)).not.toContain('PRIVATE_INPUT');
  });
});

describe('application réservée à la connexion migrateur de la cible native exacte', () => {
  it.each(['staging', 'production'] as const)('accepte %s seulement après les contrôles réels, sur la même connexion physique', async environment => {
    const f = fixture(environment); const db = database();
    expect(await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).toMatchObject({ outcome: 'applied' });
    expect(db.createPool).toHaveBeenCalledWith(expect.objectContaining({ connectionString: f.env.DATABASE_MIGRATION_URL, max: 1,
      connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 }));
    expect(db.pool.connect).toHaveBeenCalledTimes(1); expect(db.client.release).toHaveBeenCalledWith(true); expect(db.pool.end).toHaveBeenCalledOnce();
    const firstWrite = db.statements.findIndex(item => item.sql.startsWith('INSERT'));
    expect(firstWrite).toBeGreaterThan(db.statements.findIndex(item => item.sql.includes('drizzle.__drizzle_customer_migrations')));
    expect(db.statements.slice(0, firstWrite).some(item => item.sql.includes('pg_catalog.pg_roles'))).toBe(true);
    expect(db.mutations()).toHaveLength(1);
    expect(db.mutations()[0]?.values).toEqual([f.budget.parentRef, f.budget.tenantRef, f.budget.authorizationRef, f.budget.serviceSid,
      'USD', 90_000_000, 150_000, 500, f.budget.costEvidenceReference, new Date(f.budget.notBefore), new Date(f.budget.expiresAt)]);
    expect(db.statements.map(item => item.sql).join('\n')).not.toMatch(/GRANT |CREATE |ALTER |verification_intents|reservations\s*\(/);
  });
  it.each(['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_ENVIRONMENT_NAME', 'SM_ENV'])('refuse une identité %s absente ou discordante avant connexion', async field => {
    for (const value of [undefined, 'wrong', 'production ']) {
      const f = fixture(); f.env[field] = value; const db = database();
      expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).code).toBe('native_target_mismatch');
      expect(db.createPool).not.toHaveBeenCalled();
    }
  });
  it.each([
    { DATABASE_MIGRATION_URL: undefined, DATABASE_URL: 'postgres://runtime:PRIVATE_SECRET@db/app' },
    { DATABASE_MIGRATION_URL: 'postgres://migration:PRIVATE_SECRET@db/app' },
    { DATABASE_MIGRATION_URL: 'postgres://migration:PRIVATE_SECRET@db/app?sslmode=no-verify' },
    { DATABASE_MIGRATION_URL: 'postgres://migration:PRIVATE_SECRET@db/app?sslmode=verify-full&options=-csession_authorization=other' },
    { DATABASE_MIGRATION_ROLE: undefined }, { DATABASE_MIGRATION_ROLE: 'postgres;DROP DATABASE fixture' },
    { DATABASE_RUNTIME_ROLE: undefined }, { DATABASE_RUNTIME_ROLE: 'fixture_migrator' },
  ])('refuse une configuration migrateur unsafe ou implicite : %#', async changes => {
    const f = fixture(); const db = database(); Object.assign(f.env, changes);
    const output = await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db);
    expect(output.code).toBe('migration_configuration_invalid'); expect(db.createPool).not.toHaveBeenCalled();
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE_SECRET|postgres:|DROP DATABASE/);
  });
  it.each(['migration_rolsuper', 'migration_rolbypassrls', 'migration_rolcreaterole', 'migration_rolcreatedb', 'migration_rolreplication',
    'migration_has_role_membership', 'migration_has_role_members', 'rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb',
    'rolreplication', 'has_role_membership', 'has_role_members', 'can_create_database_objects', 'can_create_public_schema',
    'can_create_customer_schema', 'owns_application_objects'] as const)('refuse le privilège %s avant toute mutation', async field => {
    const f = fixture(); const db = database(); db.state.roles[field] = true;
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).code).toBe('database_checks_failed');
    expect(db.mutations()).toEqual([]);
  });
  it.each(['wrong_user', 'unsafe_search_path', 'wrong_runtime', 'unencrypted', 'old_tls', 'missing_migration', 'changed_migration'])('bloque %s avant mutation', async scenario => {
    const f = fixture(); const db = database();
    if (scenario === 'wrong_user') db.state.identity = 'other_migrator';
    if (scenario === 'unsafe_search_path') db.state.roles.migration_search_path = 'public, malicious, pg_catalog';
    if (scenario === 'wrong_runtime') db.state.roles.role_name = 'other_runtime';
    if (scenario === 'unencrypted') db.state.tls.ssl = false;
    if (scenario === 'old_tls') db.state.tls.version = 'TLSv1.1';
    if (scenario === 'missing_migration') db.state.migrations.pop();
    if (scenario === 'changed_migration') db.state.migrations[0]!.hash = 'wrong_hash';
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).code).toBe('database_checks_failed');
    expect(db.mutations()).toEqual([]); expect(db.pool.end).toHaveBeenCalledOnce();
  });
  it('relit la cible avant de déléguer si elle change pendant les contrôles SQL', async () => {
    const f = fixture(); const db = database();
    db.state.beforeQuery = sql => { if (sql.includes('drizzle.__drizzle_customer_migrations')) f.env.SM_ENV = 'staging'; };
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).code).toBe('native_target_mismatch');
    expect(db.mutations()).toEqual([]);
  });
  it('sonde effectivement tous les droits table interdits et les ACL colonne/délégation avec le rôle exact', async () => {
    const f = fixture(); const db = database();
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).outcome).toBe('applied');
    const probe = db.statements.find(item => item.sql.startsWith('WITH operator_tables AS'));
    expect(probe?.values).toEqual([operatorTables, 'fixture_runtime']);
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) {
      expect(probe?.sql).toContain(`pg_catalog.has_table_privilege(runtime.oid, relation.oid, '${privilege}')`);
    }
    expect(probe?.sql).toContain('pg_catalog.aclexplode(attribute.attacl)');
    expect(probe?.sql).toContain('privilege.grantee IN (0,runtime.oid)');
    expect(probe?.sql).toContain('privilege.is_grantable');
  });
  const unsafeAcls = ['runtime_insert', 'runtime_update', 'runtime_delete', 'runtime_truncate', 'runtime_references',
    'runtime_trigger', 'runtime_maintain', 'runtime_grantable', 'runtime_or_public_column_acl', 'public_acl'] as const;
  it.each(operatorTables.flatMap(table => unsafeAcls.map(privilege => ({ table, privilege }))))(
    'refuse $privilege sur $table avant toute écriture', async ({ table, privilege }) => {
      const f = fixture(); const db = database(); db.state.tableAcls.find(row => row.table_name === table)![privilege] = true;
      const output = await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db);
      expect(output).toMatchObject({ outcome: 'blocked', code: 'runtime_operator_acl_unsafe' });
      expect(db.mutations()).toEqual([]);
    });
  it.each(['missing_table', 'missing_select', 'incomplete_probe', 'duplicate_row', 'malformed_probe'])('ferme une sonde ACL %s', async scenario => {
    const f = fixture(); const db = database();
    if (scenario === 'missing_table') db.state.tableAcls[0]!.relation_exists = false;
    if (scenario === 'missing_select') db.state.tableAcls[0]!.runtime_select = false;
    if (scenario === 'incomplete_probe') db.state.tableAcls.pop();
    if (scenario === 'duplicate_row') db.state.tableAcls[0]!.table_name = db.state.tableAcls[1]!.table_name;
    if (scenario === 'malformed_probe') Reflect.deleteProperty(db.state.tableAcls[0]!, 'runtime_maintain');
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).code).toBe('runtime_operator_acl_unsafe');
    expect(db.mutations()).toEqual([]);
  });
});

describe('délégation aux transactions de production existantes', () => {
  it('enregistre tous les plafonds d’admission explicites, sans créer de budget financier', async () => {
    const f = fixture(); const db = database();
    expect((await customerAccountOperator(request('authorize-admissions', f), { apply: true, env: f.env }, db)).outcome).toBe('applied');
    expect(db.mutations()).toHaveLength(1);
    expect(db.mutations()[0]?.sql).toContain('INSERT INTO customer.production_admission_policies');
    expect(db.mutations()[0]?.values).toEqual([f.scope.parentRef, f.scope.tenantRef, f.admissions.policyRef, 86_400_000, 10, 500, 1000, 4, 10, 500, 1000]);
  });
  it.each([null, 'older-budget'])('active avec la référence CAS attendue %s', async expected => {
    const f = fixture(); const db = database();
    db.state.active = expected ? { authorization_ref: expected, tenant_ref: f.target.tenantRef } : null;
    const output = await customerAccountOperator({ ...request('activate-budget', f), input: { ...f.scope,
      authorizationRef: f.budget.authorizationRef, expectedActiveAuthorizationRef: expected } }, { apply: true, env: f.env }, db);
    expect(output).toMatchObject({ outcome: 'applied', details: { expectedActiveAuthorizationRef: expected } });
    expect(db.mutations()).toHaveLength(1); expect(db.mutations()[0]?.values).toEqual([f.scope.parentRef, f.scope.tenantRef, f.budget.authorizationRef]);
    const serviceRead = db.statements.find(item => item.sql.startsWith('SELECT service_sid'));
    expect(serviceRead?.values).toEqual([f.scope.parentRef, f.scope.tenantRef, f.budget.authorizationRef]);
  });
  it.each(['concurrent_reference', 'foreign_tenant'])('ne remplace pas un pointeur CAS %s', async reason => {
    const f = fixture(); const db = database();
    db.state.active = { authorization_ref: 'concurrent-budget', tenant_ref: reason === 'foreign_tenant' ? 'd'.repeat(24) : f.target.tenantRef };
    const output = await customerAccountOperator({ ...request('activate-budget', f), input: { ...f.scope,
      authorizationRef: f.budget.authorizationRef, expectedActiveAuthorizationRef: reason === 'foreign_tenant' ? 'concurrent-budget' : null,
    } }, { apply: true, env: f.env }, db);
    expect(output).toMatchObject({ outcome: 'conflict', code: 'active_reference_conflict' }); expect(customerOperatorExitCode(output)).toBe(2);
    expect(db.mutations()).toEqual([]);
  });
  it('préserve l’idempotence du même budget actif, même si la référence attendue est ancienne', async () => {
    const f = fixture(); const db = database(); db.state.active = { authorization_ref: f.budget.authorizationRef, tenant_ref: f.target.tenantRef };
    expect((await customerAccountOperator(request('activate-budget', f), { apply: true, env: f.env }, db)).outcome).toBe('applied');
    expect(db.mutations()).toEqual([]);
  });
  it.each(['activate-budget', 'revoke-budget'] as const)('%s exige un grant existant du bon service', async action => {
    for (const service of [null, `VA${'d'.repeat(32)}`]) {
      const f = fixture(); const db = database(); db.state.grantService = service;
      expect((await customerAccountOperator(request(action, f), { apply: true, env: f.env }, db)).code)
        .toBe(service === null ? 'authorization_not_found' : 'grant_service_mismatch');
      expect(db.mutations()).toEqual([]);
    }
  });
  it('révoque la référence exacte sans supprimer de budget ni en activer un autre', async () => {
    const f = fixture(); const db = database();
    expect((await customerAccountOperator(request('revoke-budget', f), { apply: true, env: f.env }, db)).outcome).toBe('applied');
    expect(db.mutations()).toHaveLength(1); expect(db.mutations()[0]?.sql).toContain('revoked_at=COALESCE(revoked_at,clock_timestamp())');
    expect(db.mutations()[0]?.values).toEqual([f.scope.parentRef, f.scope.tenantRef, f.budget.authorizationRef]);
  });
  it('n’émet jamais une erreur brute, y compris après perte de l’ACK de COMMIT', async () => {
    const f = fixture(); const db = database(); db.state.failSql = /^COMMIT$/; db.state.failEnd = true;
    const output = await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db);
    expect(output).toMatchObject({ outcome: 'unconfirmed', code: 'operation_unconfirmed' }); expect(customerOperatorExitCode(output)).toBe(1);
    expect(JSON.stringify(output)).not.toMatch(/PRIVATE_|postgres:|private-host|33612345678/);
    expect(db.mutations()).toHaveLength(1); expect(db.pool.end).toHaveBeenCalledOnce();
  });
  it('ne transforme pas une erreur de nettoyage en fausse révocation de l’ACK reçu', async () => {
    const f = fixture(); const db = database(); db.state.failEnd = true;
    expect((await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db)).outcome).toBe('applied');
  });
  it('masque aussi les erreurs de connexion et ne lance aucune mutation', async () => {
    const f = fixture(); const db = database(); db.pool.connect.mockRejectedValueOnce(new Error('PRIVATE_CONNECT_SECRET'));
    const output = await customerAccountOperator(request('authorize-budget', f), { apply: true, env: f.env }, db);
    expect(output.code).toBe('database_checks_failed'); expect(JSON.stringify(output)).not.toContain('PRIVATE_CONNECT_SECRET');
    expect(db.mutations()).toEqual([]); expect(db.pool.end).toHaveBeenCalledOnce();
  });
});

describe('véritable point d’entrée CLI', () => {
  const require = createRequire(new URL('../packages/customer/package.json', import.meta.url));
  const script = fileURLToPath(new URL('./customer-account-operator.ts', import.meta.url));
  function run(input: string, args: string[] = []) {
    return spawnSync(process.execPath, [require.resolve('tsx/cli'), script, ...args], {
      input, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576,
      env: { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_MIGRATION_URL: 'NO_DATABASE_ACCESS_PRIVATE_SECRET' },
    });
  }
  it('est une simulation par défaut et ignore les secrets ambiants sans erreur stderr', () => {
    const result = run(JSON.stringify(request('authorize-budget')));
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'dry-run', outcome: 'planned' });
    expect(result.stdout).not.toMatch(/PRIVATE_SECRET|https:|postgres:/);
  });
  it('résout les dépendances pg/zod et affiche --help sans stdin ni connexion', () => {
    const result = run('', ['--help']); expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Dry-run is the default'); expect(result.stdout).toContain('authorize-admissions');
    expect(result.stdout).not.toMatch(/PRIVATE_SECRET|https:|postgres:/);
  });
  it.each([['--token=PRIVATE_ARGUMENT_SECRET'], ['--apply', '--apply'], ['--apply=true']].map(args => ({ args })))('refuse les arguments non prévus sans les refléter : %#', ({ args }) => {
    const result = run('', args); expect(result.status).toBe(2); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).code).toBe('arguments_invalid'); expect(result.stdout).not.toContain('PRIVATE_ARGUMENT_SECRET');
  });
  it('refuse --apply hors de la cible native sans tenter de connexion', () => {
    const result = run(JSON.stringify(request('activate-budget')), ['--apply']);
    expect(result.status).toBe(2); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'apply', code: 'native_target_mismatch' });
  });
  it('borne et masque le stdin invalide dans le vrai processus', () => {
    const result = run('PRIVATE_INPUT_SECRET'.repeat(20_000)); expect(result.status).toBe(2); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).code).toBe('input_too_large'); expect(result.stdout).not.toContain('PRIVATE_INPUT_SECRET');
  });
});
