import { describe, expect, it } from 'vitest';
import { eligibleTenant, parseDomainCursor, paymentDomainCacheKey, paymentDomainsConfig, publicHostname, tenantPaymentHosts } from './payment-domain-hosts';

const env = { secretKey: 'sk_test_fixture', webUrl: 'https://web.snackmanager.fr/path', rootDomain: 'snackmanager.fr' };
const config = paymentDomainsConfig(env)!;
describe('server-owned payment hosts', () => {
  it('derives Stripe mode and HTTPS host only from server configuration', () => {
    expect(config).toEqual({ mode: 'test', webHostname: 'web.snackmanager.fr', rootDomain: 'snackmanager.fr' });
    expect(paymentDomainsConfig({ ...env, secretKey: 'rk_live_fixture' })?.mode).toBe('live');
    expect(paymentDomainsConfig({ ...env, secretKey: 'pk_live_fixture' })).toBeNull();
    expect(paymentDomainsConfig({ ...env, secretKey: '' })).toBeNull();
  });
  it.each(['http://web.snackmanager.fr', 'https://localhost:3000', 'https://127.0.0.1', 'https://fixture:fixture@web.snackmanager.fr', 'not a URL'])('disables background registration for invalid web config %s', webUrl => {
    expect(paymentDomainsConfig({ ...env, webUrl })).toBeNull();
  });
  it.each(['https://other.fr', 'other.fr/path', 'other.fr:443', '*.other.fr', 'other.fr?x=1', 'other.fr@evil.fr', '127.0.0.1', 'localhost', 'foo.local', 'foo.123', 'foo\\.fr', '-foo.fr'])('rejects non-public hostname %s', host => {
    expect(publicHostname(host)).toBeNull();
  });
  it('normalizes IDN and deduplicates active domains without inventing www or arbitrary embed origins', () => {
    expect(tenantPaymentHosts({ _id: 'id', slug: 'classfood', domains: [
      { hostname: 'CAFÉ.fr', status: 'active' }, { hostname: 'classfood.snackmanager.fr', status: 'active' },
      { hostname: 'waiting.fr', status: 'pending_dns' }, { hostname: 'failed.fr', status: 'failed' },
      { hostname: 'https://foreign.fr', status: 'active' }, { hostname: 'web.snackmanager.fr', status: 'active' },
    ] }, config)).toEqual(['classfood.snackmanager.fr', 'web.snackmanager.fr', 'xn--caf-dma.fr']);
    expect(tenantPaymentHosts({ _id: 'id', slug: 'foreign.fr' }, config)).toEqual(['web.snackmanager.fr']);
  });
  it('preserves existing charges-enabled access policy, including missing account and churned accounts', () => {
    const row = { _id: 'id', encaissement: { accountId: 'acct_fixture', chargesEnabled: true } };
    expect(eligibleTenant(row)).toBe(true);
    expect(eligibleTenant({ ...row, account: { status: 'churned' } })).toBe(true);
    expect(eligibleTenant({ ...row, account: { status: 'suspended' } })).toBe(false);
    expect(eligibleTenant({ ...row, encaissement: { accountId: 'acct_other', chargesEnabled: false } })).toBe(false);
    expect(eligibleTenant({ _id: 'id', encaissement: { accountId: 'platform', chargesEnabled: true } })).toBe(false);
  });
  it('isolates cache entries by environment, mode, connected account and exact host', () => {
    const base = paymentDomainCacheKey(config, 'acct_a', 'a.fr');
    expect(new Set([base, paymentDomainCacheKey({ ...config, mode: 'live' }, 'acct_a', 'a.fr'),
      paymentDomainCacheKey({ ...config, webHostname: 'staging.fr' }, 'acct_a', 'a.fr'),
      paymentDomainCacheKey(config, 'acct_b', 'a.fr'), paymentDomainCacheKey(config, 'acct_a', 'b.fr')]).size).toBe(5);
  });
  it('validates the shared cursor and safely restarts on damaged values', () => {
    const cursor = { tenantId: '507f1f77bcf86cd799439011', host: 'a.fr' };
    expect(parseDomainCursor(JSON.stringify(cursor))).toEqual(cursor);
    expect(parseDomainCursor(JSON.stringify({ ...cursor, host: null }))).toEqual({ ...cursor, host: null });
    for (const value of ['null', 'not json', '{}', JSON.stringify({ ...cursor, host: 'https://a.fr' }), JSON.stringify({ ...cursor, tenantId: '$gt' })]) {
      expect(parseDomainCursor(value)).toBeNull();
    }
  });
});
