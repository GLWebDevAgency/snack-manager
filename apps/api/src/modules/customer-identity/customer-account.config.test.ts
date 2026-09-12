import { describe, expect, it } from 'vitest';
import { customerAccessConfiguration, customerObservationConfiguration, customerSendConfiguration } from './customer-account.config';
import { customerProductionFixture } from './customer-production.test-fixture';

import { customerPaidTestEnvironment, customerTestEnvironment } from './customer-account.test-fixture';
const getter = (env: Record<string, string>) => ({ get: (key: string) => env[key] });

describe('closed customer runtime configuration', () => {
  it('is closed by default', () => expect(customerAccessConfiguration(getter({}))).toBeNull());
  it('accepts the separately selected paid pilot only with matching complete authorization and prices', () => {
    const env = customerPaidTestEnvironment(); const access = customerAccessConfiguration(getter(env));
    expect(access).toMatchObject({ mode: 'closed_paid_pilot', environment: 'staging' });
    expect(customerSendConfiguration(getter(env), access!)).not.toBeNull();
  });
  it.each(['closed_trial', 'closed_paid_pilot'])('never substitutes a policy for explicit runtime mode %s', mode => {
    const env = mode === 'closed_trial' ? customerPaidTestEnvironment() : customerTestEnvironment();
    env.SM_CUSTOMER_ACCOUNT_MODE = mode;
    const access = customerAccessConfiguration(getter(env)); expect(access).not.toBeNull();
    expect(customerSendConfiguration(getter(env), access!)).toBeNull();
  });
  it.each([undefined, '', 'active', 'paid', 'public'])('refuses missing or unknown runtime mode %s', mode => {
    const env = customerPaidTestEnvironment();
    if (mode === undefined) delete env.SM_CUSTOMER_ACCOUNT_MODE; else env.SM_CUSTOMER_ACCOUNT_MODE = mode;
    expect(customerAccessConfiguration(getter(env))).toBeNull();
  });
  it('keeps production closed with a paid policy and does not use a balance as authorization', () => {
    const env = customerPaidTestEnvironment(); env.RAILWAY_ENVIRONMENT_NAME = 'production';
    expect(customerAccessConfiguration(getter(env))).toBeNull(); env.RAILWAY_ENVIRONMENT_NAME = 'staging';
    const policy = JSON.parse(env.SM_CUSTOMER_VERIFY_POLICY!) as Record<string, unknown>;
    delete policy.authorization; policy.balance = 20; env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
    expect(customerSendConfiguration(getter(env), customerAccessConfiguration(getter(env))!)).toBeNull();
  });
  it('keeps paid session access independent from missing/expired spending credentials', () => {
    const env = customerPaidTestEnvironment(); env.SM_CUSTOMER_VERIFY_POLICY = '{}'; env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}';
    delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const access = customerAccessConfiguration(getter(env)); expect(access).not.toBeNull();
    expect(customerSendConfiguration(getter(env), access!)).toBeNull();
  });
  it('accepts only the exact pilot deployment and complete keys', () => {
    expect(customerAccessConfiguration(getter(customerTestEnvironment()))?.slug).toBe('fixture');
  });
  it.each(['RAILWAY_ENVIRONMENT_ID', 'RAILWAY_PROJECT_ID', 'SM_CUSTOMER_PILOT_ENVIRONMENT_ID',
    'SM_CUSTOMER_PILOT_PROJECT_ID', 'SM_CUSTOMER_IDENTITY_KEY', 'SM_CUSTOMER_RELAY_SIGNING_KEY',
    'SM_CUSTOMER_PILOT_TENANT_ID', 'SM_CUSTOMER_VERIFY_ACCOUNT_SID'])('closes if %s is missing', key => {
    const env = customerTestEnvironment(); delete env[key];
    expect(customerAccessConfiguration(getter(env))).toBeNull();
  });
  it.each([
    ['RAILWAY_ENVIRONMENT_NAME', 'production'], ['SM_ENV', 'production'], ['SM_ENV', 'local'],
    ['RAILWAY_PROJECT_ID', '33333333-3333-4333-8333-333333333333'],
    ['RAILWAY_ENVIRONMENT_ID', '33333333-3333-4333-8333-333333333333'],
    ['SM_CUSTOMER_PILOT_ORIGINS', '["https://fixture.example/"]'],
    ['SM_CUSTOMER_PILOT_ORIGINS', '["http://fixture.example"]'],
    ['SM_CUSTOMER_PILOT_SLUGS', '["fixture","another"]'],
    ['SM_CUSTOMER_RELAY_SIGNING_KEY', Buffer.alloc(32, 15).toString('base64url')],
  ])('closes conflicting or noncanonical %s', (key, value) => {
    const env = customerTestEnvironment(); env[key] = value;
    expect(customerAccessConfiguration(getter(env))).toBeNull();
  });
  it('does not make profile access depend on fresh credit or provider credentials', () => {
    const env = customerTestEnvironment(); env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}';
    delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const access = customerAccessConfiguration(getter(env)); expect(access).not.toBeNull();
    expect(customerSendConfiguration(getter(env), access!)).toBeNull();
  });
  it('requires complete fresh bounded provider evidence for availability', () => {
    const env = customerTestEnvironment(); const access = customerAccessConfiguration(getter(env))!;
    expect(customerSendConfiguration(getter(env), access)).not.toBeNull();
    expect(customerSendConfiguration(getter(customerTestEnvironment(Date.now() - 900_001)), access)).toBeNull();
    env.SM_CUSTOMER_TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    expect(customerSendConfiguration(getter(env), access)).toBeNull();
  });
});

describe('explicit customer production deployment', () => {
  it.each(['staging', 'production'] as const)('accepts a separately pinned %s target without pilot variables', environment => {
    const f = customerProductionFixture(Date.now(), environment);
    for (const name of Object.keys(f.env)) if (name.startsWith('SM_CUSTOMER_PILOT_')) delete f.env[name];
    const access = customerAccessConfiguration(getter(f.env));
    expect(access).toMatchObject({ mode: 'production_paid', environment, tenantRef: f.target.tenantRef, serviceSid: f.target.serviceSid });
    expect(customerSendConfiguration(getter(f.env), access!, Date.now(), f.observation)?.plan.kind).toBe('reservation_required');
  });
  it.each(['RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID',
    'SM_CUSTOMER_VERIFY_ACCOUNT_SID', 'SM_CUSTOMER_PRODUCTION_TARGET'])('closes a mismatched %s', key => {
    const f = customerProductionFixture(); f.env[key] = 'wrong';
    expect(customerAccessConfiguration(getter(f.env))).toBeNull();
  });
  it('refuses a policy pointing to a different service or deployment', () => {
    const f = customerProductionFixture(); const access = customerAccessConfiguration(getter(f.env))!;
    for (const patch of [{ environment: 'staging' }, { serviceSid: `VA${'e'.repeat(32)}` }]) {
      f.env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify({ ...f.policy, ...patch });
      expect(customerSendConfiguration(getter(f.env), access, Date.now(), f.observation)).toBeNull();
    }
  });
  it('never accepts a provider observation from environment JSON', () => {
    const f = customerProductionFixture(); const access = customerAccessConfiguration(getter(f.env))!;
    expect(customerSendConfiguration(getter(f.env), access)).toBeNull();
    f.env.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(f.evidence);
    expect(customerSendConfiguration(getter(f.env), access, Date.now(), f.observation)).toBeNull();
  });
  it('preserves account access without any provider or budget configuration', () => {
    const f = customerProductionFixture();
    for (const name of Object.keys(f.env)) if (name.startsWith('SM_CUSTOMER_VERIFY_') && name !== 'SM_CUSTOMER_VERIFY_ACCOUNT_SID') delete f.env[name];
    const access = customerAccessConfiguration(getter(f.env));
    expect(access).not.toBeNull();
    expect(customerSendConfiguration(getter(f.env), access!)).toBeNull();
    expect(customerObservationConfiguration(getter(f.env), access!)).toBeNull();
  });
  it('uses the existing Verify key for service observation without account access credentials', () => {
    const f = customerProductionFixture(); const access = customerAccessConfiguration(getter(f.env))!;
    expect(customerObservationConfiguration(getter(f.env), access)).toEqual({
      ...f.target, apiKeySid: f.env.SM_CUSTOMER_VERIFY_API_KEY_SID,
      apiKeySecret: f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET });
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    expect(customerObservationConfiguration(getter(f.env), access)).toBeNull();
    delete f.env.SM_CUSTOMER_VERIFY_API_KEY_SID;
    expect(customerObservationConfiguration(getter(f.env), access)).toBeNull();
  });
});
