import { describe, expect, it, vi } from 'vitest';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { customerPaidTestEnvironment } from '../apps/api/src/modules/customer-identity/customer-account.test-fixture';
import { customerAccountPreflight, customerPreflightFromStdin, MAX_CUSTOMER_PREFLIGHT_BYTES } from './customer-account-preflight';

const now = 1_800_000_000_000;
function fixture(at = now) {
  const api = customerPaidTestEnvironment(at);
  const origin = 'https://fixture.example';
  const target = { environment: 'staging' as 'staging' | 'production', projectId: api.RAILWAY_PROJECT_ID!,
    environmentId: api.RAILWAY_ENVIRONMENT_ID!, tenantId: api.SM_CUSTOMER_PILOT_TENANT_ID!,
    slug: 'fixture', origins: [origin], apiOrigin: 'https://api.example' };
  const web: Record<string, string> = { ...api, NEXT_PUBLIC_API_URL: target.apiOrigin };
  return { version: 1 as const, api, web, target, observations: { capturedAt: at,
    tenant: { id: target.tenantId, slug: target.slug, status: 'active' },
    postgres: { migrationsCurrent: true, runtimeRoleRestricted: true }, redis: { reachable: true },
    ingress: { trustedClientIp: true },
    passkeys: [{ origin, rpId: 'fixture.example', registration: true, authentication: true, recovery: true }] } };
}
const check = (report: ReturnType<typeof customerAccountPreflight>, id: string) => report.checks.find(item => item.id === id);
async function* stdin(value: string) { yield value; }
function productionFixture(environment: 'staging' | 'production' = 'production', at = now) {
  const f = fixture(at); f.target.environment = environment;
  const scope = { accountSid: f.api.SM_CUSTOMER_VERIFY_ACCOUNT_SID!, serviceSid: `VA${'b'.repeat(32)}`, tenantRef: f.target.tenantId };
  const target = { version: 1, environment, railwayProjectId: f.target.projectId, railwayEnvironmentId: f.target.environmentId,
    ...scope, verifyAccountSid: scope.accountSid, verifyServiceSid: scope.serviceSid, slug: f.target.slug,
    origins: f.target.origins, apiOrigin: f.target.apiOrigin };
  const { accountSid: _account, serviceSid: _service, ...deployment } = target;
  for (const env of [f.api, f.web]) {
    env.RAILWAY_ENVIRONMENT_NAME = environment; env.SM_CUSTOMER_ACCOUNT_MODE = 'production_paid';
    env.SM_CUSTOMER_PRODUCTION_TARGET = JSON.stringify(deployment);
    for (const name of Object.keys(env)) if (name.startsWith('SM_CUSTOMER_PILOT_')) delete env[name];
  }
  f.api.SM_CUSTOMER_VERIFY_OBSERVER_API_KEY_SID = `SK${'d'.repeat(32)}`;
  f.api.SM_CUSTOMER_VERIFY_OBSERVER_API_KEY_SECRET = 'SYNTHETIC_OBSERVER_SECRET';
  f.api.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify({ mode: 'production_paid', environment, ...scope,
    authorizationRef: 'production-authorization-fixture', costEvidenceReference: 'production-cost-fixture',
    evidenceNotBefore: at - 3_600_000, expiresAt: at + 30 * 86_400_000, globalSendReservations: 1000, tenantSendReservations: 500, ipSendReservations: 50 });
  const settingsFingerprint = 'e'.repeat(64);
  f.api.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify({
    safeguards: { reference: 'safeguards-fixture', ...scope, smsEnabled: true, fraudGuardEnabled: true,
      maxTokenValiditySeconds: 600, maxSmsSegmentsPerSend: 2, settingsFingerprint, attestedAt: at - 86_400_000, expiresAt: at + 86_400_000 },
    costs: { reference: 'production-cost-fixture', ...scope, currency: 'USD', allFeesIncluded: true,
      smsSegmentUpperBoundMicrousd: 31, successfulVerificationUpperBoundMicrousd: 8,
      attestedAt: at - 86_400_000, expiresAt: at + 86_400_000 },
  });
  return { ...f, observations: { ...f.observations, production: {
    provider: { reference: 'server-read-fixture', ...scope, accountType: 'Full', accountStatus: 'active', codeLength: 6, observedAt: at, settingsFingerprint },
    budget: { parentRef: scope.accountSid, tenantRef: scope.tenantRef, authorizationRef: 'production-authorization-fixture',
      serviceSid: scope.serviceSid, costEvidenceReference: 'production-cost-fixture', reservePerSendMicrousd: 70, available: true },
    admissions: { parentRef: scope.accountSid, tenantRef: scope.tenantRef, policyRef: 'admissions-fixture', windowMs: 86_400_000,
      browserSourceLimit: 20, browserTenantLimit: 1000, browserParentLimit: 1000,
      intentBrowserLimit: 20, intentSourceLimit: 20, intentTenantLimit: 1000, intentParentLimit: 1000 },
  } } };
}

describe('production snapshots without auto-attesting provider or SQL funding', () => {
  it.each([undefined, 0, 1001, 1.5, '50'])('blocks a production snapshot without an explicit valid IP ceiling (%s)', ipSendReservations => {
    const input = productionFixture(); input.api.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify({
      ...JSON.parse(input.api.SM_CUSTOMER_VERIFY_POLICY!), ipSendReservations });
    const report = customerAccountPreflight(input, now);
    expect(report).toMatchObject({ decision: 'blocked', access: 'configuration_valid', sms: 'blocked' });
  });
  it.each(['staging', 'production'] as const)('accepts a correctly pinned production_paid %s snapshot without pilot settings', environment => {
    const input = productionFixture(environment); const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('configuration_valid');
    expect(report.access).toBe('configuration_valid');
    expect(check(report, 'production.provider')?.source).toBe('operator_observation');
    expect(check(report, 'production.budget')?.code).toBe('operator_reports_verified');
    expect(JSON.stringify(report)).not.toContain(input.api.SM_CUSTOMER_VERIFY_OBSERVER_API_KEY_SECRET);
  });
  it('keeps missing provider, budget and admission observations incomplete rather than positive', () => {
    const input = productionFixture(); const report = customerAccountPreflight({ ...input,
      observations: { ...input.observations, production: {} } }, now);
    expect(report).toMatchObject({ decision: 'incomplete', access: 'configuration_valid', passkeys: 'configuration_valid', sms: 'unverified' });
    for (const id of ['production.provider', 'production.budget', 'production.admissions']) expect(check(report, id)?.status).toBe('unverified');
  });
  it.each(['budget', 'admissions'] as const)('does not infer missing SQL %s observations from a valid provider read', field => {
    const input = productionFixture(); const report = customerAccountPreflight({ ...input,
      observations: { ...input.observations, production: { ...input.observations.production, [field]: undefined } } }, now);
    expect(report.decision).toBe('incomplete'); expect(check(report, `production.${field}`)?.status).toBe('unverified');
  });
  it.each(['provider', 'budget', 'admissions'] as const)('distinguishes a known failed/missing %s record from an unperformed observation', field => {
    const input = productionFixture(); const report = customerAccountPreflight({ ...input,
      observations: { ...input.observations, production: { ...input.observations.production, [field]: null } } }, now);
    expect(report.decision).toBe('blocked'); expect(check(report, `production.${field}`)?.status).toBe('blocked');
    expect(report.access).toBe('configuration_valid');
  });
  it('refuses a technical observation injected in runtime configuration even if an operator also supplied a genuine-shaped observation', () => {
    const input = productionFixture(); input.api.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify({
      ...JSON.parse(input.api.SM_CUSTOMER_VERIFY_EVIDENCE!), serverObservation: input.observations.production.provider });
    const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('blocked');
    expect(check(report, 'provider.environment')?.code).toBe('provider_observation_forbidden_in_config');
  });
  it('does not disguise expired cost attestation as a provider or passkey failure', () => {
    const input = productionFixture(); const evidence = JSON.parse(input.api.SM_CUSTOMER_VERIFY_EVIDENCE!);
    evidence.costs.expiresAt = now; input.api.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(evidence);
    const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('blocked'); expect(report.passkeys).toBe('configuration_valid');
    expect(check(report, 'funding.attestations')?.status).toBe('blocked');
    expect(check(report, 'production.provider')?.status).toBe('pass');
  });
  it.each(['missing', 'same'])('requires separate observer credentials (%s)', mode => {
    const input = productionFixture();
    if (mode === 'missing') delete input.api.SM_CUSTOMER_VERIFY_OBSERVER_API_KEY_SECRET;
    else input.api.SM_CUSTOMER_VERIFY_OBSERVER_API_KEY_SID = input.api.SM_CUSTOMER_VERIFY_API_KEY_SID!;
    const report = customerAccountPreflight(input, now);
    expect(check(report, 'provider.credentials')?.status).toBe('blocked');
    expect(report.passkeys).toBe('configuration_valid');
  });
  it.each([
    { available: false }, { authorizationRef: 'other-authorization' }, { parentRef: `AC${'f'.repeat(32)}` },
    { tenantRef: 'f'.repeat(24) }, { serviceSid: `VA${'f'.repeat(32)}` },
    { costEvidenceReference: 'other-cost' }, { reservePerSendMicrousd: 69 },
  ])('rejects unavailable or differently scoped SQL availability (%#)', patch => {
    const input = productionFixture(); Object.assign(input.observations.production.budget, patch);
    const report = customerAccountPreflight(input, now);
    expect(check(report, 'production.budget')?.code).toBe('budget_unavailable_or_mismatched');
    expect(report.access).toBe('configuration_valid');
  });
  it('requires target agreement between API and BFF rather than a matching host alone', () => {
    const input = productionFixture(); const webTarget = JSON.parse(input.web.SM_CUSTOMER_PRODUCTION_TARGET!);
    webTarget.verifyServiceSid = `VA${'f'.repeat(32)}`; input.web.SM_CUSTOMER_PRODUCTION_TARGET = JSON.stringify(webTarget);
    expect(check(customerAccountPreflight(input, now), 'scope.provider')?.code).toBe('provider_target_mismatch');
  });
  it('rejects stale snapshots without renewing the provider timestamp or claiming SQL remains available', () => {
    const input = productionFixture(); input.observations.capturedAt = now - 300_000;
    const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('incomplete'); expect(check(report, 'production.budget')?.status).toBe('unverified');
    expect(report.sms).toBe('unverified');
  });
  it.each([
    { budget: { ...productionFixture().observations.production.budget, authorizedSpendMicrousd: 1000 } },
    { admissions: { ...productionFixture().observations.production.admissions, windowMs: 1 } },
    { provider: { ...productionFixture().observations.production.provider, token: 'PRIVATE_TOKEN' } },
    { extra: 'PRIVATE_EXTRA' },
  ])('rejects extra/mistyped production observation data without echoing it (%#)', patch => {
    const input = productionFixture(); const report = customerAccountPreflight({ ...input,
      observations: { ...input.observations, production: { ...input.observations.production, ...patch } } }, now);
    expect(report.decision).toBe('invalid_input'); expect(JSON.stringify(report)).not.toContain('PRIVATE_');
  });
});

describe('customer account local operator preflight', () => {
  it('reuses the paid plan, distinguishes configuration from operator observations, and never grants spending', () => {
    const report = customerAccountPreflight(fixture(), now);
    expect(report).toMatchObject({ readOnly: true, source: 'provided_snapshot', decision: 'configuration_valid',
      access: 'configuration_valid', provisioning: 'configuration_valid', passkeys: 'configuration_valid', sms: 'configuration_valid' });
    expect(check(report, 'funding.plan')).toMatchObject({ code: 'durable_reservation_still_required', source: 'configuration' });
    expect(check(report, 'postgres.migrations')).toMatchObject({ code: 'operator_reports_verified', source: 'operator_observation' });
    expect(JSON.stringify(report)).not.toContain('production_ready');
  });

  it('never claims deployment readiness from configuration alone', () => {
    const { observations: _observations, ...snapshot } = fixture();
    const report = customerAccountPreflight(snapshot, now);
    expect(report.decision).toBe('incomplete');
    expect(report.access).toBe('configuration_valid');
    expect(check(report, 'tenant.active')?.status).toBe('unverified');
    expect(check(report, 'passkeys.registration')?.status).toBe('unverified');
  });

  it('keeps existing sessions and keys configured when paid authorization expires', () => {
    const input = fixture(); const policy = JSON.parse(input.api.SM_CUSTOMER_VERIFY_POLICY!);
    policy.authorization.expiresAt = now; input.api.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
    const report = customerAccountPreflight(input, now);
    expect(report).toMatchObject({ decision: 'blocked', access: 'configuration_valid', passkeys: 'configuration_valid', provisioning: 'blocked', sms: 'blocked' });
    expect(check(report, 'funding.plan')?.code).toBe('funding_expired');
  });

  it('rejects stale supplier evidence without reporting an authentication outage', () => {
    const input = fixture(); const evidence = JSON.parse(input.api.SM_CUSTOMER_VERIFY_EVIDENCE!);
    evidence.observedAt = now - 900_000; input.api.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(evidence);
    const report = customerAccountPreflight(input, now);
    expect(report.access).toBe('configuration_valid');
    expect(check(report, 'funding.plan')?.code).toBe('funding_evidence');
  });

  it('rejects an exhausted theoretical funding allowance using the existing exact arithmetic', () => {
    const input = fixture(); const policy = JSON.parse(input.api.SM_CUSTOMER_VERIFY_POLICY!);
    policy.authorization.authorizedSpendMicrousd = 1; input.api.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
    expect(check(customerAccountPreflight(input, now), 'funding.plan')?.code).toBe('funding_allowance');
  });

  it('reports the intentional production refusal even when all operator observations are positive', () => {
    const input = fixture(); input.target.environment = 'production';
    input.api.RAILWAY_ENVIRONMENT_NAME = 'production'; input.web.RAILWAY_ENVIRONMENT_NAME = 'production';
    const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('blocked');
    expect(check(report, 'runtime.api')?.status).toBe('pass');
    expect(check(report, 'runtime.policy')?.code).toBe('production_intentionally_closed');
    expect(check(report, 'access.api')?.code).toBe('access_configuration_closed');
    expect(report.passkeys).toBe('blocked');
  });

  it('distinguishes the production fence from missing runtime variables', () => {
    const input = fixture(); input.target.environment = 'production'; input.api = {}; input.web = {};
    const report = customerAccountPreflight(input, now);
    expect(check(report, 'runtime.policy')?.code).toBe('production_intentionally_closed');
    expect(check(report, 'runtime.api')?.code).toBe('runtime_target_mismatch');
    expect(check(report, 'access.api')?.code).toBe('access_configuration_closed');
  });

  it.each(['missing', 'closed', 'production'])('fails closed for account mode %s', mode => {
    const input = fixture();
    if (mode === 'missing') delete input.api.SM_CUSTOMER_ACCOUNT_MODE; else input.api.SM_CUSTOMER_ACCOUNT_MODE = mode;
    const report = customerAccountPreflight(input, now);
    expect(report.access).toBe('blocked');
    expect(check(report, 'access.api')?.code).toBe('access_configuration_closed');
  });

  it('refuses a runtime pinned to another project even if its internal API configuration is valid', () => {
    const input = fixture(); input.api.RAILWAY_PROJECT_ID = input.api.SM_CUSTOMER_PILOT_PROJECT_ID = '99999999-9999-4999-8999-999999999999';
    const report = customerAccountPreflight(input, now);
    expect(check(report, 'access.api')?.status).toBe('pass');
    expect(check(report, 'runtime.api')?.code).toBe('runtime_target_mismatch');
    expect(report.access).toBe('blocked');
  });

  it('refuses API/web origin divergence and unreviewed extra origins', () => {
    const input = fixture(); input.web.SM_CUSTOMER_PILOT_ORIGINS = JSON.stringify([...input.target.origins, 'https://other.example']);
    const report = customerAccountPreflight(input, now);
    expect(report.access).toBe('blocked');
    expect(check(report, 'scope.origins')?.code).toBe('origins_mismatch');
  });

  it('refuses a BFF API origin different from the operator target', () => {
    const input = fixture(); input.web.NEXT_PUBLIC_API_URL = 'https://foreign.example';
    expect(check(customerAccountPreflight(input, now), 'scope.api_origin')?.code).toBe('api_origin_mismatch');
  });

  it('detects relay mismatch and malformed identity keys without returning either value', () => {
    const input = fixture(); input.web.SM_CUSTOMER_RELAY_SIGNING_KEY = Buffer.alloc(32, 66).toString('base64');
    input.api.SM_CUSTOMER_IDENTITY_KEY = 'PRIVATE_FIXTURE_VALUE_NOT_A_REAL_KEY';
    const report = customerAccountPreflight(input, now);
    expect(report.access).toBe('blocked');
    expect(check(report, 'relay.key')?.code).toBe('relay_key_mismatch');
    expect(JSON.stringify(report)).not.toContain(input.web.SM_CUSTOMER_RELAY_SIGNING_KEY);
    expect(JSON.stringify(report)).not.toContain(input.api.SM_CUSTOMER_IDENTITY_KEY);
  });

  it('does not turn a positive passkey observation on another RP into a valid recipe', () => {
    const input = fixture(); input.observations.passkeys[0]!.rpId = 'example';
    const report = customerAccountPreflight(input, now);
    expect(report.passkeys).toBe('configuration_valid');
    expect(report.decision).toBe('blocked');
    expect(check(report, 'passkeys.scope')).toMatchObject({ code: 'passkey_origin_or_rp_mismatch', source: 'operator_observation' });
  });

  it.each([-1, -300_000, 1])('does not accept an expired or future observation (%s)', delta => {
    const input = fixture(); input.observations.capturedAt = delta === -1 ? now - 300_001 : now + delta;
    expect(check(customerAccountPreflight(input, now), 'postgres.migrations')?.status).toBe('unverified');
  });

  it('rejects a suspended or mismatched observed tenant without silently changing the configuration result', () => {
    const input = fixture(); input.observations.tenant.status = 'suspended';
    const report = customerAccountPreflight(input, now);
    expect(report.access).toBe('configuration_valid');
    expect(report.decision).toBe('blocked');
    expect(check(report, 'tenant.active')?.code).toBe('tenant_unavailable_or_mismatched');
  });

  it.each([
    null, [], {}, { version: '1' },
    { ...fixture(), extra: 'PRIVATE_EXTRA_FIXTURE' },
    { ...fixture(), target: { ...fixture().target, extra: 'PRIVATE_EXTRA_FIXTURE' } },
    { ...fixture(), observations: { capturedAt: now, extra: true } },
    { ...fixture(), api: { ...fixture().api, SM_CUSTOMER_VERIFY_POLICY: { private: true } } },
    { ...fixture(), observations: { capturedAt: now, redis: { reachable: 'true' } } },
    { ...fixture(), observations: { capturedAt: now, passkeys: [null] } },
    { ...fixture(), target: { ...fixture().target, origins: ['https://fixture.example/'] } },
  ])('rejects an invalid or extended input without exposing its content (%#)', input => {
    const report = customerAccountPreflight(input, now);
    expect(report.decision).toBe('invalid_input');
    expect(report.checks).toEqual([{ id: 'input', status: 'blocked', source: 'configuration', code: 'invalid_snapshot' }]);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_');
  });

  it('does not serialize any identity, phone, secret, provider reference or origin from a valid snapshot', () => {
    const input = fixture(); const output = JSON.stringify(customerAccountPreflight(input, now));
    const privateValues = [input.api.SM_CUSTOMER_IDENTITY_KEY, input.api.SM_CUSTOMER_RELAY_SIGNING_KEY,
      input.api.SM_CUSTOMER_VERIFY_API_KEY_SECRET, input.api.SM_CUSTOMER_VERIFY_ACCOUNT_SID,
      input.api.SM_CUSTOMER_TURNSTILE_SECRET_KEY, input.target.tenantId, input.target.origins[0], '+33612345678'];
    for (const value of privateValues) expect(output).not.toContain(value);
  });

  it('never calls fetch, HTTP or a database socket while inspecting a supplied snapshot', () => {
    const inputs = [fixture(), productionFixture()];
    const network = () => { throw new Error('External I/O forbidden in this local preflight'); };
    const fetch = vi.fn(network); vi.stubGlobal('fetch', fetch);
    const socket = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(network);
    const httpRequest = vi.spyOn(http, 'request').mockImplementation(network);
    const httpsRequest = vi.spyOn(https, 'request').mockImplementation(network);
    try {
      for (const input of inputs) expect(customerAccountPreflight(input, now).decision).toBe('configuration_valid');
      for (const call of [fetch, socket, httpRequest, httpsRequest]) expect(call).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
  });

  it('bounds streamed input by bytes and suppresses parse/stream errors', async () => {
    expect((await customerPreflightFromStdin(stdin('x'.repeat(MAX_CUSTOMER_PREFLIGHT_BYTES + 1)))).checks[0]?.code).toBe('input_too_large');
    expect((await customerPreflightFromStdin(stdin('{"PRIVATE_UNTERMINATED_SECRET":'))).decision).toBe('invalid_input');
    async function* broken() { yield '{'; throw new Error('PRIVATE_STREAM_SECRET'); }
    expect(JSON.stringify(await customerPreflightFromStdin(broken()))).not.toContain('PRIVATE_');
  });
});

describe('customer preflight CLI', () => {
  const require = createRequire(new URL('../packages/customer/package.json', import.meta.url));
  const script = fileURLToPath(new URL('./customer-account-preflight.ts', import.meta.url));
  function run(input: string, args: string[] = []) {
    return spawnSync(process.execPath, [require.resolve('tsx/cli'), script, ...args], {
      input, encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576,
      env: { ...process.env, SM_CUSTOMER_IDENTITY_KEY: 'ENVIRONMENT_SECRET_MUST_NOT_BE_READ', MONGO_URL: 'NO_DATABASE_ACCESS' },
    });
  }
  it('accepts only JSON stdin, returns parse errors safely, and ignores ambient application config', () => {
    const result = run('{"PRIVATE_INPUT_SECRET":');
    expect(result.status).toBe(2); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).decision).toBe('invalid_input');
    expect(result.stdout).not.toMatch(/PRIVATE_INPUT|ENVIRONMENT_SECRET|NO_DATABASE_ACCESS/);
  });
  it('rejects arguments without reflecting them', () => {
    const result = run('', ['--secret=PRIVATE_ARGUMENT_SECRET']);
    expect(result.status).toBe(2); expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('PRIVATE_ARGUMENT_SECRET');
  });
  it('runs the actual pure checks with no external connectivity and emits only its redacted report', () => {
    const input = fixture(Date.now()); const result = run(JSON.stringify(input));
    expect(result.status).toBe(0); expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).decision).toBe('configuration_valid');
    expect(result.stdout).not.toContain(input.api.SM_CUSTOMER_VERIFY_API_KEY_SECRET);
  });
});
