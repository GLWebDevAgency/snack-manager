import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { z } from 'zod';
import { CustomerAccountDeploymentTargetSchema } from '../packages/contracts/src/customer-deployment';
import { CustomerProductionBudgetAuthorizationSchema, CustomerProductionAdmissionPolicySchema,
  PostgresCustomerProductionOperator } from '../packages/customer/src/production-operator';
import { withCustomerScope } from '../packages/customer/src/client';
import { migrationDatabaseUrl } from '../packages/customer/src/migration-url';
import { runtimeDatabaseRole, assertCustomerMigrationRoleSafe } from '../packages/customer/src/migration-role';
import { assertCustomerMigrationConnectionEncrypted } from '../packages/customer/src/migration-tls';
import { assertCustomerMigrationsCurrent } from '../packages/customer/src/migration-state';

export const MAX_CUSTOMER_OPERATOR_BYTES = 256 * 1024;
const fields = CustomerProductionBudgetAuthorizationSchema.shape;
const grantReference = z.strictObject({ parentRef: fields.parentRef, tenantRef: fields.tenantRef,
  authorizationRef: fields.authorizationRef });
const envelope = { target: CustomerAccountDeploymentTargetSchema };
export const CustomerAccountOperatorRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...envelope, action: z.literal('authorize-budget'), input: CustomerProductionBudgetAuthorizationSchema }),
  z.strictObject({ ...envelope, action: z.literal('activate-budget'), input: grantReference.extend({
    expectedActiveAuthorizationRef: fields.authorizationRef.nullable(),
  }) }),
  z.strictObject({ ...envelope, action: z.literal('revoke-budget'), input: grantReference }),
  z.strictObject({ ...envelope, action: z.literal('authorize-admissions'), input: CustomerProductionAdmissionPolicySchema }),
]).refine(({ target, input }) => input.tenantRef === target.tenantRef && input.parentRef === target.verifyAccountSid
  && (!('serviceSid' in input) || input.serviceSid === target.verifyServiceSid));

type Request = z.infer<typeof CustomerAccountOperatorRequestSchema>;
type Environment = Record<string, string | undefined>;
type Outcome = 'planned' | 'applied' | 'conflict' | 'not_found' | 'invalid_input' | 'blocked' | 'unconfirmed';
type Code = 'input_invalid' | 'input_too_large' | 'stdin_json_required' | 'arguments_invalid' | 'validated_only'
  | 'native_target_mismatch' | 'migration_configuration_invalid' | 'database_checks_failed' | 'grant_service_mismatch'
  | 'runtime_operator_acl_unsafe' | 'authorization_not_found' | 'active_reference_conflict' | 'operation_applied' | 'operation_unconfirmed';
export type CustomerAccountOperatorReport = {
  schemaVersion: 1; mode: 'dry-run' | 'apply'; outcome: Outcome; code: Code;
  action?: Request['action'];
  target?: Pick<Request['target'], 'environment' | 'slug' | 'tenantRef'>;
  details?: Record<string, string | number | null>;
};
type Dependencies = { createPool?: (config: PoolConfig) => Pool };
const roleName = /^[a-z][a-z0-9_]{2,62}$/;
function report(apply: boolean, outcome: Outcome, code: Code, request?: Request): CustomerAccountOperatorReport {
  if (!request) return { schemaVersion: 1, mode: apply ? 'apply' : 'dry-run', outcome, code };
  const { action, target, input } = request;
  // Deliberate whitelist: never project database URLs, credentials, provider endpoints or raw errors.
  const details: Record<string, string | number | null> = action === 'authorize-budget' ? {
    authorizationRef: request.input.authorizationRef, currency: request.input.currency,
    authorizedSpendMicrousd: request.input.authorizedSpendMicrousd, reservePerSendMicrousd: request.input.reservePerSendMicrousd,
    maxSendReservations: request.input.maxSendReservations, costEvidenceReference: request.input.costEvidenceReference,
    notBefore: request.input.notBefore, expiresAt: request.input.expiresAt,
  } : action === 'activate-budget' ? { authorizationRef: request.input.authorizationRef,
    expectedActiveAuthorizationRef: request.input.expectedActiveAuthorizationRef,
  } : action === 'revoke-budget' ? { authorizationRef: request.input.authorizationRef } : {
    policyRef: request.input.policyRef, windowMs: request.input.windowMs,
    browserSourceLimit: request.input.browserSourceLimit, browserTenantLimit: request.input.browserTenantLimit,
    browserParentLimit: request.input.browserParentLimit, intentBrowserLimit: request.input.intentBrowserLimit,
    intentSourceLimit: request.input.intentSourceLimit, intentTenantLimit: request.input.intentTenantLimit,
    intentParentLimit: request.input.intentParentLimit,
  };
  return { schemaVersion: 1, mode: apply ? 'apply' : 'dry-run', outcome, code, action,
    target: { environment: target.environment, slug: target.slug, tenantRef: input.tenantRef }, details };
}
function matchesNativeTarget(request: Request, env: Environment): boolean {
  const target = request.target;
  return env.RAILWAY_PROJECT_ID === target.railwayProjectId && env.RAILWAY_ENVIRONMENT_ID === target.railwayEnvironmentId
    && env.RAILWAY_ENVIRONMENT_NAME === target.environment && env.SM_ENV === target.environment;
}

const operatorTables = ['production_budget_authorizations', 'production_budget_activation', 'production_admission_policies', 'production_admissions'];
const forbiddenTablePrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
/** Same catalog primitives as postgres-bootstrap, bounded to these four operator tables.
 * Role membership is independently forbidden above. PUBLIC and column ACLs cannot bypass this check. */
async function runtimeOperatorTablesAreReadOnly(client: PoolClient, runtimeRole: string): Promise<boolean> {
  const result = await client.query<Record<string, unknown>>(`WITH operator_tables AS (
    SELECT pg_catalog.unnest($1::pg_catalog.text[]) AS table_name
  )
  SELECT wanted.table_name, relation.oid IS NOT NULL AS relation_exists,
    COALESCE(pg_catalog.has_table_privilege(runtime.oid, relation.oid, 'SELECT'),false) AS runtime_select,
    ${forbiddenTablePrivileges.map(privilege => `COALESCE(pg_catalog.has_table_privilege(runtime.oid, relation.oid, '${privilege}'),false) AS runtime_${privilege.toLowerCase()}`).join(',\n    ')},
    EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) privilege
      WHERE privilege.grantee IN (0,runtime.oid) AND privilege.is_grantable
    ) AS runtime_grantable,
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute attribute
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) privilege
      WHERE attribute.attrelid=relation.oid AND attribute.attnum>0 AND NOT attribute.attisdropped
        AND privilege.grantee IN (0,runtime.oid)
    ) AS runtime_or_public_column_acl,
    EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(relation.relacl,pg_catalog.acldefault('r',relation.relowner))) privilege
      WHERE privilege.grantee=0
    ) AS public_acl
  FROM operator_tables wanted
  JOIN pg_catalog.pg_roles runtime ON runtime.rolname=$2
  LEFT JOIN pg_catalog.pg_namespace namespace ON namespace.nspname='customer'
  LEFT JOIN pg_catalog.pg_class relation ON relation.relnamespace=namespace.oid
    AND relation.relname=wanted.table_name AND relation.relkind IN ('r','p')`, [operatorTables, runtimeRole]);
  return result.rowCount === operatorTables.length && result.rows.length === operatorTables.length
    && operatorTables.every(table => {
      const rows = result.rows.filter(row => row.table_name === table);
      const row = rows[0];
      return rows.length === 1 && row?.relation_exists === true && row.runtime_select === true
        && forbiddenTablePrivileges.every(privilege => row[`runtime_${privilege.toLowerCase()}`] === false)
        && row.runtime_grantable === false && row.runtime_or_public_column_acl === false && row.public_acl === false;
    });
}

/** A simulation validates only the supplied document, with no environment or I/O requirement.
 * Apply pins one physical migration connection for checks and all operator transactions.
 * This command neither creates roles nor runs migrations, and never contacts Twilio. */
export async function customerAccountOperator(raw: unknown, options: { apply?: boolean; env?: Environment } = {},
  dependencies: Dependencies = {}): Promise<CustomerAccountOperatorReport> {
  const apply = options.apply === true;
  const parsed = CustomerAccountOperatorRequestSchema.safeParse(raw);
  if (!parsed.success) return report(apply, 'invalid_input', 'input_invalid');
  const request = parsed.data;
  if (!apply) return report(false, 'planned', 'validated_only', request);
  const env = options.env ?? process.env;
  if (!matchesNativeTarget(request, env)) return report(true, 'blocked', 'native_target_mismatch', request);
  let config: PoolConfig; let migrationRole: string; let runtimeRole: string;
  try {
    migrationRole = env.DATABASE_MIGRATION_ROLE ?? '';
    runtimeRole = runtimeDatabaseRole(env) ?? '';
    if (!roleName.test(migrationRole) || !runtimeRole || migrationRole === runtimeRole || !env.DATABASE_MIGRATION_URL) {
      return report(true, 'blocked', 'migration_configuration_invalid', request);
    }
    config = { connectionString: migrationDatabaseUrl(env), max: 1, connectionTimeoutMillis: 5000,
      query_timeout: 5000, statement_timeout: 5000, idleTimeoutMillis: 1000 };
  } catch { return report(true, 'blocked', 'migration_configuration_invalid', request); }
  let pool: Pool | undefined; let client: PoolClient | undefined; let applying = false;
  try {
    pool = (dependencies.createPool ?? (value => new Pool(value)))(config);
    // A disconnected idle client must not emit a raw provider/connection error on stderr.
    pool.on('error', () => {});
    client = await pool.connect();
    client.on('error', () => {});
    const checkedClient = client;
    // withCustomerScope owns BEGIN/COMMIT but not the physical connection, which remains pinned.
    const scopedClient = { query: checkedClient.query.bind(checkedClient), release: () => {} } as PoolClient;
    const checkedPool = { connect: async () => scopedClient } as Pool;
    await assertCustomerMigrationConnectionEncrypted(checkedClient, env);
    const identity = await checkedClient.query<{ migration_role: unknown }>('SELECT current_user::text AS migration_role');
    if (identity.rowCount !== 1 || identity.rows[0]?.migration_role !== migrationRole) {
      return report(true, 'blocked', 'database_checks_failed', request);
    }
    await assertCustomerMigrationRoleSafe(checkedClient, runtimeRole);
    await assertCustomerMigrationsCurrent(checkedClient);
    if (!await runtimeOperatorTablesAreReadOnly(checkedClient, runtimeRole)) {
      return report(true, 'blocked', 'runtime_operator_acl_unsafe', request);
    }
    if (request.action === 'activate-budget' || request.action === 'revoke-budget') {
      const found = await withCustomerScope(checkedPool, request.input, async connection => connection.query<{ service_sid: unknown }>(
        `SELECT service_sid FROM customer.production_budget_authorizations
         WHERE parent_ref=$1 AND tenant_ref=$2 AND authorization_ref=$3`,
        [request.input.parentRef, request.input.tenantRef, request.input.authorizationRef]));
      if (found.rowCount === 0) return report(true, 'not_found', 'authorization_not_found', request);
      if (found.rowCount !== 1 || found.rows[0]?.service_sid !== request.target.verifyServiceSid) {
        return report(true, 'blocked', 'grant_service_mismatch', request);
      }
    }
    // No stale environment may pass the final mutation boundary after asynchronous checks.
    if (!matchesNativeTarget(request, env) || env.DATABASE_MIGRATION_ROLE !== migrationRole
      || env.DATABASE_RUNTIME_ROLE?.trim() !== runtimeRole || env.DATABASE_MIGRATION_URL?.trim() !== config.connectionString) {
      return report(true, 'blocked', 'native_target_mismatch', request);
    }
    const operator = new PostgresCustomerProductionOperator(checkedPool);
    applying = true;
    switch (request.action) {
      case 'authorize-budget': await operator.authorizeBudget(request.input); break;
      case 'authorize-admissions': await operator.authorizeAdmissions(request.input); break;
      case 'activate-budget':
        if (!await operator.activateBudget(request.input)) return report(true, 'conflict', 'active_reference_conflict', request);
        break;
      case 'revoke-budget':
        if (!await operator.revokeBudget(request.input)) return report(true, 'not_found', 'authorization_not_found', request);
        break;
    }
    return report(true, 'applied', 'operation_applied', request);
  } catch {
    // A lost COMMIT acknowledgement cannot safely be reported as a rejected mutation.
    return report(true, applying ? 'unconfirmed' : 'blocked', applying ? 'operation_unconfirmed' : 'database_checks_failed', request);
  } finally {
    try { client?.release(true); } catch { /* Do not replace a mutation's confirmed outcome with cleanup details. */ }
    try { await pool?.end(); } catch { /* No connection string or raw driver error in the result. */ }
  }
}

export async function customerOperatorFromStdin(input: AsyncIterable<string | Uint8Array>,
  options: { apply?: boolean; env?: Environment } = {}, dependencies: Dependencies = {}): Promise<CustomerAccountOperatorReport> {
  const chunks: Buffer[] = []; let bytes = 0;
  try {
    for await (const chunk of input) {
      bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (bytes > MAX_CUSTOMER_OPERATOR_BYTES) return report(options.apply === true, 'invalid_input', 'input_too_large');
      chunks.push(Buffer.from(chunk));
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    return customerAccountOperator(value, options, dependencies);
  } catch { return report(options.apply === true, 'invalid_input', 'input_invalid'); }
}

export const customerOperatorExitCode = (value: CustomerAccountOperatorReport): number =>
  value.outcome === 'planned' || value.outcome === 'applied' ? 0 : value.outcome === 'unconfirmed' ? 1 : 2;

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: operator-input-producer | pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-operator.ts [--apply]\n'
      + 'JSON stdin: {action, target, input}. Actions: authorize-budget, activate-budget, revoke-budget, authorize-admissions.\n'
      + 'Dry-run is the default: validates the document without any database or network access. Maximum input: 256 KiB.\n'
      + '--apply requires the exact native Railway target, SM_ENV and the existing restricted migration connection with current migrations.\n'
      + 'No secrets in arguments. Exit 0: planned/applied; 2: invalid/blocked/conflict/not found; 1: outcome unconfirmed, inspect before retrying.\n');
  } else {
    const apply = args.length === 1 && args[0] === '--apply';
    const result = args.length > 0 && !apply ? report(false, 'invalid_input', 'arguments_invalid')
      : process.stdin.isTTY ? report(apply, 'invalid_input', 'stdin_json_required') : await customerOperatorFromStdin(process.stdin, { apply });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = customerOperatorExitCode(result);
  }
}
