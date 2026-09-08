import { describe, expect, it } from 'vitest';
import { customerAccessConfiguration, customerSendConfiguration } from './customer-account.config';

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
