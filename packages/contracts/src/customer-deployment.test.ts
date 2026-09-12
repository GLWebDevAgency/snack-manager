import { describe, expect, it } from 'vitest';
import { CustomerAccountDeploymentTargetSchema } from './customer-deployment';

const target = {
  version: 1, environment: 'production',
  railwayProjectId: '00000000-0000-0000-0000-000000000001',
  railwayEnvironmentId: '00000000-0000-0000-0000-000000000002',
  tenantRef: 'a'.repeat(24), slug: 'restaurant',
  verifyAccountSid: `AC${'a'.repeat(32)}`, verifyServiceSid: `VA${'b'.repeat(32)}`,
  origins: ['https://restaurant.example'], apiOrigin: 'https://api.example',
};
describe('operator customer deployment target', () => {
  it('accepts an explicit target for either actual deployment environment', () => {
    expect(CustomerAccountDeploymentTargetSchema.parse(target)).toEqual(target);
    expect(CustomerAccountDeploymentTargetSchema.parse({ ...target, environment: 'staging' }).environment).toBe('staging');
  });
  it.each(['http://restaurant.example', 'https://restaurant.example/', 'https://user:password@restaurant.example',
    'https://restaurant.example/path', 'https://restaurant.example?tenant=another', 'https://restaurant.example#hash',
    'https://RESTAURANT.example', 'https://restaurant.example:443', '*'])('rejects a noncanonical origin: %s', value => {
    expect(CustomerAccountDeploymentTargetSchema.safeParse({ ...target, origins: [value] }).success).toBe(false);
    expect(CustomerAccountDeploymentTargetSchema.safeParse({ ...target, apiOrigin: value }).success).toBe(false);
  });
  it('rejects duplicate origins, unknown fields and unpinned targets', () => {
    for (const invalid of [{ origins: [] }, { origins: [...target.origins, ...target.origins] },
      { environment: 'development' }, { tenantRef: '*' }, { railwayProjectId: '' },
      { verifyServiceSid: target.verifyAccountSid }, { slug: '../other' }, { slug: 'a'.repeat(64) }, { apiKeySecret: 'secret' }]) {
      expect(CustomerAccountDeploymentTargetSchema.safeParse({ ...target, ...invalid }).success).toBe(false);
    }
  });
});
