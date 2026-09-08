import { describe, expect, it } from 'vitest';
import { customerAccessConfiguration, customerSendConfiguration } from './customer-account.config';

import { customerTestEnvironment } from './customer-account.test-fixture';
const getter = (env: Record<string, string>) => ({ get: (key: string) => env[key] });

describe('closed customer runtime configuration', () => {
  it('is closed by default', () => expect(customerAccessConfiguration(getter({}))).toBeNull());
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
