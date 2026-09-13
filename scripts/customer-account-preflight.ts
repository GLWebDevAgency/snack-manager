import { fileURLToPath } from 'node:url';
import { customerAccessConfiguration, customerSendConfiguration, customerObservationConfiguration } from '../apps/api/src/modules/customer-identity/customer-account.config';
import { planCustomerPhoneVerification } from '../apps/api/src/modules/customer-identity/verification-plan';
import { CustomerAccountDeploymentTargetSchema } from '../packages/contracts/src/customer-deployment';
import { ProductionServerObservationSchema, ProductionVerificationPolicySchema, ProductionVerificationEvidenceSchema,
  PRODUCTION_ATTESTATION_MAX_AGE_MS, PRODUCTION_OBSERVATION_MAX_AGE_MS, productionVerificationReserve,
  type ProductionVerificationEvidence } from '../apps/api/src/modules/customer-identity/production-verification-policy';
import type { CustomerProductionAdmissionPolicy } from '../packages/customer/src/production-operator';

export const MAX_CUSTOMER_PREFLIGHT_BYTES = 262_144;
const OBSERVATION_MAX_AGE_MS = 5 * 60_000;
type Values = Record<string, string>;
type Check = { id: string; status: 'pass' | 'blocked' | 'unverified'; source: 'configuration' | 'operator_observation'; code: string };
type Snapshot = {
  version: 1; api: Values; web: Values;
  target: { environment: 'staging' | 'production'; projectId: string; environmentId: string;
    tenantId: string; slug: string; origins: string[]; apiOrigin: string };
  observations?: {
    capturedAt: number;
    tenant?: { id: string; slug: string; status: string };
    postgres?: { migrationsCurrent: boolean; runtimeRoleRestricted: boolean };
    redis?: { reachable: boolean };
    ingress?: { trustedClientIp: boolean };
    passkeys?: { origin: string; rpId: string; registration: boolean; authentication: boolean; recovery: boolean }[];
    production?: {
      provider?: ProductionVerificationEvidence['serverObservation'] | null;
      budget?: { parentRef: string; tenantRef: string; authorizationRef: string; serviceSid: string;
        costEvidenceReference: string; reservePerSendMicrousd: number; available: boolean } | null;
      admissions?: CustomerProductionAdmissionPolicy | null;
    };
  };
};
export type CustomerPreflightReport = {
  schemaVersion: 1; readOnly: true; source: 'provided_snapshot';
  decision: 'invalid_input' | 'blocked' | 'incomplete' | 'configuration_valid';
  access: 'blocked' | 'configuration_valid';
  provisioning: 'blocked' | 'unverified' | 'configuration_valid';
  passkeys: 'blocked' | 'configuration_valid';
  sms: 'blocked' | 'unverified' | 'configuration_valid';
  checks: Check[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const exactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const slug = (value: unknown): value is string => text(value, 63) && slugPattern.test(value);
const tenantId = (value: unknown): value is string => text(value, 24) && /^[0-9a-f]{24}$/.test(value);
const httpsOrigin = (value: unknown): value is string => {
  if (!text(value) || value.includes(',')) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && !url.username && !url.password; }
  catch { return false; }
};
const strings = (value: unknown, valid: (item: unknown) => boolean, max: number): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.length <= max && value.every(valid) && new Set(value).size === value.length;
function values(value: unknown): value is Values {
  return object(value) && Object.keys(value).length <= 256 && Object.entries(value).every(([key, item]) =>
    /^[A-Z][A-Z0-9_]{0,127}$/.test(key) && typeof item === 'string' && Buffer.byteLength(item) <= 32_768);
}
function booleanObject(value: unknown, keys: string[]) {
  return object(value) && exactKeys(value, keys) && keys.every(key => typeof value[key] === 'boolean');
}
const reference = (value: unknown): value is string => text(value, 120) && /^[a-zA-Z0-9_-]+$/.test(value);
const positive = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number => timestamp(value) && value > 0 && value <= max;
function productionObservations(value: unknown) {
  if (!object(value) || !exactKeys(value, [], ['provider', 'budget', 'admissions'])) return false;
  if (value.provider !== undefined && value.provider !== null && !ProductionServerObservationSchema.safeParse(value.provider).success) return false;
  const b = value.budget;
  if (b !== undefined && b !== null && (!object(b)
    || !exactKeys(b, ['parentRef', 'tenantRef', 'authorizationRef', 'serviceSid', 'costEvidenceReference', 'reservePerSendMicrousd', 'available'])
    || !reference(b.parentRef) || !reference(b.tenantRef) || !reference(b.authorizationRef)
    || !text(b.serviceSid) || !/^VA[0-9a-fA-F]{32}$/.test(b.serviceSid)
    || !reference(b.costEvidenceReference) || !positive(b.reservePerSendMicrousd) || typeof b.available !== 'boolean')) return false;
  const a = value.admissions;
  if (a !== undefined && a !== null && (!object(a) || !exactKeys(a, ['parentRef', 'tenantRef', 'policyRef', 'windowMs',
    'browserSourceLimit', 'browserTenantLimit', 'browserParentLimit', 'intentBrowserLimit', 'intentSourceLimit', 'intentTenantLimit', 'intentParentLimit'])
    || !reference(a.parentRef) || !reference(a.tenantRef) || !reference(a.policyRef)
    || !positive(a.windowMs, 86_400_000) || a.windowMs < 60_000
    || !['browserSourceLimit', 'intentBrowserLimit', 'intentSourceLimit'].every(name => positive(a[name], 1000))
    || !['browserTenantLimit', 'browserParentLimit', 'intentTenantLimit', 'intentParentLimit'].every(name => positive(a[name], 100_000)))) return false;
  return true;
}
function isSnapshot(raw: unknown): raw is Snapshot {
  if (!object(raw) || !exactKeys(raw, ['version', 'api', 'web', 'target'], ['observations'])
    || raw.version !== 1 || !values(raw.api) || !values(raw.web) || !object(raw.target)) return false;
  const t = raw.target;
  if (!exactKeys(t, ['environment', 'projectId', 'environmentId', 'tenantId', 'slug', 'origins', 'apiOrigin'])
    || !['staging', 'production'].includes(t.environment as string) || !text(t.projectId) || !uuid.test(t.projectId)
    || !text(t.environmentId) || !uuid.test(t.environmentId) || !tenantId(t.tenantId) || !slug(t.slug)
    || !strings(t.origins, httpsOrigin, 5) || !httpsOrigin(t.apiOrigin)) return false;
  if (raw.observations === undefined) return true;
  const o = raw.observations;
  if (!object(o) || !exactKeys(o, ['capturedAt'], ['tenant', 'postgres', 'redis', 'ingress', 'passkeys', 'production']) || !timestamp(o.capturedAt)) return false;
  if (o.production !== undefined && !productionObservations(o.production)) return false;
  if (o.tenant !== undefined && (!object(o.tenant) || !exactKeys(o.tenant, ['id', 'slug', 'status'])
    || !tenantId(o.tenant.id) || !slug(o.tenant.slug) || !text(o.tenant.status, 64))) return false;
  if (o.postgres !== undefined && !booleanObject(o.postgres, ['migrationsCurrent', 'runtimeRoleRestricted'])) return false;
  if (o.redis !== undefined && !booleanObject(o.redis, ['reachable'])) return false;
  if (o.ingress !== undefined && !booleanObject(o.ingress, ['trustedClientIp'])) return false;
  if (o.passkeys !== undefined && (!Array.isArray(o.passkeys) || o.passkeys.length > 5 || !o.passkeys.every(p =>
    object(p) && exactKeys(p, ['origin', 'rpId', 'registration', 'authentication', 'recovery'])
    && httpsOrigin(p.origin) && text(p.rpId, 200) && typeof p.registration === 'boolean'
    && typeof p.authentication === 'boolean' && typeof p.recovery === 'boolean')
    || new Set(o.passkeys.map(p => p.origin)).size !== o.passkeys.length)) return false;
  return true;
}
function json(env: Values, name: string, max = 8192): unknown {
  const value = env[name];
  if (typeof value !== 'string' || Buffer.byteLength(value) > max) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}
function key(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)
    && Buffer.from(value, 'base64').length === 32 && Buffer.from(value, 'base64').toString('base64') === value;
}
const sameSet = (left: unknown, right: string[]) => Array.isArray(left) && left.length === right.length
  && new Set(left).size === left.length && right.every(value => left.includes(value));
function deploymentTarget(env: Values) {
  const parsed = CustomerAccountDeploymentTargetSchema.safeParse(json(env, 'SM_CUSTOMER_PRODUCTION_TARGET'));
  return parsed.success ? parsed.data : null;
}
function runtimeMatches(env: Values, target: Snapshot['target']) {
  const production = env.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid' ? deploymentTarget(env) : null;
  return env.RAILWAY_ENVIRONMENT_NAME === target.environment && (env.SM_ENV === undefined || env.SM_ENV === target.environment)
    && env.RAILWAY_PROJECT_ID === target.projectId && env.RAILWAY_ENVIRONMENT_ID === target.environmentId
    && (env.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid'
      ? production?.railwayProjectId === target.projectId && production?.railwayEnvironmentId === target.environmentId && production.environment === target.environment
      : env.SM_CUSTOMER_PILOT_PROJECT_ID === target.projectId && env.SM_CUSTOMER_PILOT_ENVIRONMENT_ID === target.environmentId);
}
/** Configuration-only mirror of the private BFF boundary, not a request or an
 * authentication grant. Production target parsing is shared with the real BFF. */
function webConfiguration(env: Values, target: Snapshot['target']) {
  if (env.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid') {
    const p = deploymentTarget(env);
    return !!p && runtimeMatches(env, target) && p.slug === target.slug && p.tenantRef === target.tenantId
      && sameSet(p.origins, target.origins) && p.apiOrigin === target.apiOrigin
      && env.NEXT_PUBLIC_API_URL === p.apiOrigin && key(env.SM_CUSTOMER_RELAY_SIGNING_KEY);
  }
  return env.RAILWAY_ENVIRONMENT_NAME === 'staging' && (env.SM_ENV === undefined || env.SM_ENV === 'staging')
    && ['closed_trial', 'closed_paid_pilot'].includes(env.SM_CUSTOMER_ACCOUNT_MODE ?? '')
    && uuid.test(env.RAILWAY_PROJECT_ID ?? '') && uuid.test(env.RAILWAY_ENVIRONMENT_ID ?? '')
    && env.SM_CUSTOMER_PILOT_PROJECT_ID === env.RAILWAY_PROJECT_ID
    && env.SM_CUSTOMER_PILOT_ENVIRONMENT_ID === env.RAILWAY_ENVIRONMENT_ID
    && strings(json(env, 'SM_CUSTOMER_PILOT_ORIGINS', 4096), httpsOrigin, 32)
    && strings(json(env, 'SM_CUSTOMER_PILOT_SLUGS', 4096), slug, 32)
    && key(env.SM_CUSTOMER_RELAY_SIGNING_KEY) && httpsOrigin(env.NEXT_PUBLIC_API_URL)
    && sameSet(json(env, 'SM_CUSTOMER_PILOT_ORIGINS'), target.origins)
    && sameSet(json(env, 'SM_CUSTOMER_PILOT_SLUGS'), [target.slug]);
}
const empty = (code: string): CustomerPreflightReport => ({ schemaVersion: 1, readOnly: true, source: 'provided_snapshot',
  decision: 'invalid_input', access: 'blocked', provisioning: 'blocked', passkeys: 'blocked', sms: 'blocked',
  checks: [{ id: 'input', status: 'blocked', source: 'configuration', code }] });

/** Pure inspection of caller-supplied data. Does not read process.env, reserve
 * money, contact a provider, open a database or attest a deployed revision. */
export function customerAccountPreflight(raw: unknown, now = Date.now()): CustomerPreflightReport {
  if (!timestamp(now) || !isSnapshot(raw)) return empty('invalid_snapshot');
  const { api, web, target, observations } = raw;
  const fresh = !!observations && observations.capturedAt <= now && observations.capturedAt + OBSERVATION_MAX_AGE_MS > now;
  const production = api.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid';
  const apiTarget = production ? deploymentTarget(api) : null;
  const webTarget = web.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid' ? deploymentTarget(web) : null;
  const checks: Check[] = [];
  const check = (id: string, valid: boolean, failure: string, success = 'configuration_valid') => {
    checks.push({ id, status: valid ? 'pass' : 'blocked', source: 'configuration', code: valid ? success : failure }); return valid;
  };
  const unverified = (id: string, code: string) => checks.push({ id, status: 'unverified', source: 'operator_observation', code });
  const reader = { get: (name: string) => api[name] };
  const access = customerAccessConfiguration(reader);
  check('runtime.api', runtimeMatches(api, target), 'runtime_target_mismatch');
  check('runtime.web', runtimeMatches(web, target), 'runtime_target_mismatch');
  check('runtime.policy', target.environment === 'staging' || (production && web.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid'), 'production_intentionally_closed');
  check('access.api', access !== null, 'access_configuration_closed');
  check('access.web', webConfiguration(web, target), 'web_configuration_closed');
  check('scope.tenant', production ? apiTarget?.tenantRef === target.tenantId && apiTarget?.slug === target.slug
    : api.SM_CUSTOMER_PILOT_TENANT_ID === target.tenantId && sameSet(json(api, 'SM_CUSTOMER_PILOT_SLUGS'), [target.slug]), 'tenant_target_mismatch');
  check('scope.origins', sameSet(production ? apiTarget?.origins : json(api, 'SM_CUSTOMER_PILOT_ORIGINS'), target.origins)
    && sameSet(web.SM_CUSTOMER_ACCOUNT_MODE === 'production_paid' ? webTarget?.origins : json(web, 'SM_CUSTOMER_PILOT_ORIGINS'), target.origins), 'origins_mismatch');
  check('scope.api_origin', web.NEXT_PUBLIC_API_URL === target.apiOrigin
    && (!production || (apiTarget?.apiOrigin === target.apiOrigin && webTarget?.apiOrigin === target.apiOrigin)), 'api_origin_mismatch');
  if (production) check('scope.provider', apiTarget !== null && webTarget !== null
    && apiTarget.verifyAccountSid === webTarget.verifyAccountSid && apiTarget.verifyServiceSid === webTarget.verifyServiceSid, 'provider_target_mismatch');
  check('relay.mode', api.SM_CUSTOMER_ACCOUNT_MODE !== undefined && api.SM_CUSTOMER_ACCOUNT_MODE === web.SM_CUSTOMER_ACCOUNT_MODE, 'mode_mismatch');
  check('relay.key', key(api.SM_CUSTOMER_RELAY_SIGNING_KEY) && key(web.SM_CUSTOMER_RELAY_SIGNING_KEY)
    && api.SM_CUSTOMER_RELAY_SIGNING_KEY === web.SM_CUSTOMER_RELAY_SIGNING_KEY, 'relay_key_mismatch');
  const accessValid = checks.every(item => item.status === 'pass');
  // Each hostname is a separate current RP. No promise of cross-origin key portability.
  check('passkeys.configuration', accessValid, 'access_configuration_required', target.origins.length > 1 ? 'separate_origin_scopes' : 'exact_origin_scope');

  const policy = json(api, 'SM_CUSTOMER_VERIFY_POLICY');
  const configuredEvidence = json(api, 'SM_CUSTOMER_VERIFY_EVIDENCE');
  const suppliedProvider = observations?.production?.provider;
  const provider = fresh ? suppliedProvider : undefined;
  const awaitingProvider = production && provider === undefined;
  const evidence = production && object(configuredEvidence)
    ? { ...configuredEvidence, serverObservation: provider ?? null } : configuredEvidence;
  const candidate = production ? '+33600000000' : object(policy) && Array.isArray(policy.allowedPhones) ? policy.allowedPhones[0] : null;
  const plan = planCustomerPhoneVerification({ mode: api.SM_CUSTOMER_ACCOUNT_MODE, policy, evidence,
    request: { tenantRef: target.tenantId, phone: candidate }, now });
  const authorization = object(policy) && object(policy.authorization) ? policy.authorization : null;
  const expired = (object(policy) && timestamp(policy.expiresAt) && policy.expiresAt <= now)
    || (authorization && timestamp(authorization.expiresAt) && authorization.expiresAt <= now);
  const planValid = plan.kind === 'reservation_required' && plan.accountSid === api.SM_CUSTOMER_VERIFY_ACCOUNT_SID
    && (!production || plan.serviceSid === apiTarget?.verifyServiceSid);
  let productionConfigValid = true;
  if (production) {
    const parsedPolicy = ProductionVerificationPolicySchema.safeParse(policy);
    const policyValid = parsedPolicy.success && parsedPolicy.data.environment === target.environment
      && parsedPolicy.data.expiresAt > now && parsedPolicy.data.evidenceNotBefore <= now
      && parsedPolicy.data.accountSid === apiTarget?.verifyAccountSid && parsedPolicy.data.serviceSid === apiTarget?.verifyServiceSid
      && parsedPolicy.data.tenantRef === target.tenantId;
    check('funding.policy', policyValid, expired ? 'funding_expired' : 'production_policy_invalid');
    const configuredShape = object(configuredEvidence) && exactKeys(configuredEvidence, ['account', 'safeguards', 'costs']);
    const a = ProductionVerificationEvidenceSchema.shape.account.safeParse(configuredShape ? configuredEvidence.account : null);
    const s = ProductionVerificationEvidenceSchema.shape.safeguards.safeParse(configuredShape ? configuredEvidence.safeguards : null);
    const c = ProductionVerificationEvidenceSchema.shape.costs.safeParse(configuredShape ? configuredEvidence.costs : null);
    const current = (v: { accountSid: string; serviceSid: string; tenantRef: string; attestedAt: number; expiresAt: number }) =>
      v.accountSid === apiTarget?.verifyAccountSid && v.serviceSid === apiTarget?.verifyServiceSid && v.tenantRef === target.tenantId
      && v.attestedAt <= now && v.expiresAt > now && v.expiresAt <= v.attestedAt + PRODUCTION_ATTESTATION_MAX_AGE_MS;
    const accountValid = a.success && current(a.data);
    check('provider.account_attestation', accountValid, 'operator_account_attestation_invalid_or_expired', 'operator_attestation_current');
    const reserveValid = s.success && c.success && productionVerificationReserve(c.data, s.data.maxSmsSegmentsPerSend, now) !== null;
    const attestationsValid = accountValid && s.success && c.success && current(s.data) && current(c.data) && reserveValid
      && parsedPolicy.success && c.data.reference === parsedPolicy.data.costEvidenceReference;
    check('funding.attestations', attestationsValid, 'operator_attestations_invalid_or_expired');
    check('funding.cost_basis', reserveValid, 'cost_reservation_invalid', c.success && 'model' in c.data
      ? 'operator_reserve_not_invoice_guarantee' : 'attested_all_fees_upper_bound');
    check('provider.environment', configuredShape, 'provider_observation_forbidden_in_config');
    const observer = access ? customerObservationConfiguration(reader, access) : null;
    const observerValid = observer !== null;
    check('provider.credentials', observerValid, 'verify_service_credentials_missing_or_invalid');
    productionConfigValid = policyValid && attestationsValid && !!configuredShape && observerValid;
  }
  if (awaitingProvider) unverified('funding.plan', 'provider_observation_required');
  else check('funding.plan', planValid, expired ? 'funding_expired'
    : plan.kind === 'denied' ? `funding_${plan.reason}` : 'funding_account_mismatch', 'durable_reservation_still_required');
  const send = access ? customerSendConfiguration(reader, access, now, provider) : null;
  if (awaitingProvider && accessValid && productionConfigValid) unverified('sms.configuration', 'provider_observation_required');
  else check('sms.configuration', send !== null, !access ? 'access_configuration_required'
    : !planValid ? 'funding_required' : 'provider_or_human_configuration_invalid');

  const observed = (id: string, value: boolean | undefined, failure: string) => {
    checks.push({ id, source: 'operator_observation', status: !fresh || value === undefined ? 'unverified' : value ? 'pass' : 'blocked',
      code: !observations || value === undefined ? 'observation_missing' : !fresh ? 'observation_stale'
        : value ? 'operator_reports_verified' : failure });
  };
  observed('tenant.active', observations?.tenant === undefined ? undefined : observations.tenant.id === target.tenantId
    && observations.tenant.slug === target.slug && ['active', 'trial'].includes(observations.tenant.status), 'tenant_unavailable_or_mismatched');
  observed('postgres.migrations', observations?.postgres?.migrationsCurrent, 'migrations_not_current');
  observed('postgres.runtime_role', observations?.postgres?.runtimeRoleRestricted, 'runtime_role_not_restricted');
  observed('redis.availability', observations?.redis?.reachable, 'redis_unavailable');
  observed('ingress.client_ip', observations?.ingress?.trustedClientIp, 'trusted_client_ip_not_verified');
  const passkeyEvidence = observations?.passkeys;
  const passkeyScope = passkeyEvidence === undefined ? undefined : sameSet(passkeyEvidence.map(item => item.origin), target.origins)
    && passkeyEvidence.every(item => item.rpId === new URL(item.origin).hostname);
  observed('passkeys.scope', passkeyScope, 'passkey_origin_or_rp_mismatch');
  for (const operation of ['registration', 'authentication', 'recovery'] as const) {
    observed(`passkeys.${operation}`, passkeyScope === undefined ? undefined
      : passkeyScope && passkeyEvidence!.every(item => item[operation]), 'passkey_scenario_not_verified');
  }
  if (production) {
    const s = ProductionVerificationEvidenceSchema.shape.safeguards.safeParse(object(configuredEvidence) ? configuredEvidence.safeguards : null);
    const providerValid = suppliedProvider !== null && suppliedProvider !== undefined
      && suppliedProvider.accountSid === apiTarget?.verifyAccountSid && suppliedProvider.serviceSid === apiTarget?.verifyServiceSid
      && suppliedProvider.tenantRef === target.tenantId && suppliedProvider.observedAt <= now
      && suppliedProvider.observedAt + PRODUCTION_OBSERVATION_MAX_AGE_MS > now
      && object(policy) && timestamp(policy.evidenceNotBefore) && suppliedProvider.observedAt >= policy.evidenceNotBefore
      && s.success && suppliedProvider.settingsFingerprint === s.data.settingsFingerprint;
    observed('production.provider', suppliedProvider === undefined ? undefined : providerValid, 'provider_observation_unavailable_or_invalid');
    const budget = observations?.production?.budget;
    const b = plan.kind === 'reservation_required' && 'productionBudget' in plan.limits ? plan.limits.productionBudget : null;
    observed('production.budget', budget === null ? false : budget === undefined || !b ? undefined
      : budget.available && budget.parentRef === apiTarget?.verifyAccountSid && budget.tenantRef === target.tenantId
        && budget.serviceSid === apiTarget?.verifyServiceSid && budget.authorizationRef === b.authorizationRef
        && budget.costEvidenceReference === b.costEvidenceReference && budget.reservePerSendMicrousd === b.reservePerSendMicrousd,
    'budget_unavailable_or_mismatched');
    const admissions = observations?.production?.admissions;
    observed('production.admissions', admissions === undefined ? undefined : admissions !== null
      && admissions.parentRef === apiTarget?.verifyAccountSid && admissions.tenantRef === target.tenantId, 'admissions_unavailable_or_mismatched');
  }
  const smsValid = accessValid && productionConfigValid && send !== null && planValid;
  return { schemaVersion: 1, readOnly: true, source: 'provided_snapshot',
    decision: checks.some(item => item.status === 'blocked') ? 'blocked'
      : checks.some(item => item.status === 'unverified') ? 'incomplete' : 'configuration_valid',
    access: accessValid ? 'configuration_valid' : 'blocked',
    provisioning: smsValid ? 'configuration_valid' : awaitingProvider && accessValid && productionConfigValid ? 'unverified' : 'blocked',
    passkeys: accessValid ? 'configuration_valid' : 'blocked',
    sms: smsValid ? 'configuration_valid' : awaitingProvider && accessValid && productionConfigValid ? 'unverified' : 'blocked', checks };
}

export async function customerPreflightFromStdin(input: AsyncIterable<string | Uint8Array>): Promise<CustomerPreflightReport> {
  let bytes = 0; const chunks: Buffer[] = [];
  try {
    for await (const chunk of input) {
      const data = Buffer.from(chunk); bytes += data.length;
      if (bytes > MAX_CUSTOMER_PREFLIGHT_BYTES) return empty('input_too_large');
      chunks.push(data);
    }
    return customerAccountPreflight(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
  } catch { return empty('invalid_snapshot'); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    process.stdout.write('Usage: operator-snapshot-producer | pnpm --filter @sm/customer exec tsx ../../scripts/customer-account-preflight.ts\n'
      + 'Prefer an operator subprocess pipe: JSON stdin only, no secrets in arguments. No network or database calls.\n'
      + 'Exit 0: configuration consistent; 1: blocked/incomplete; 2: invalid input. Never authorizes activation or spending.\n');
  } else {
    const report = process.argv.length !== 2 || process.stdin.isTTY ? empty('stdin_json_required') : await customerPreflightFromStdin(process.stdin);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.decision === 'invalid_input' ? 2 : report.decision === 'configuration_valid' ? 0 : 1;
  }
}
