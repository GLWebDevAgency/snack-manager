import { describe, expect, it, vi } from 'vitest';
import { StripePaymentDomainsHttpClient, type StripePaymentDomain, type StripePaymentDomainsSdk } from './stripe-payment-domains.client';

const domain = (extra: Partial<StripePaymentDomain> = {}): StripePaymentDomain => ({ id: 'pmd_fixture', domain_name: 'restaurant.fr', enabled: true,
  livemode: false, apple_pay: { status: 'active' }, google_pay: { status: 'active' }, ...extra });
function fixture(initial: StripePaymentDomain[] = [domain()]) {
  const methods = { list: vi.fn().mockResolvedValue({ data: initial }), create: vi.fn().mockResolvedValue(domain()), validate: vi.fn().mockResolvedValue(domain()) };
  const factory = vi.fn().mockResolvedValue({ paymentMethodDomains: methods } satisfies StripePaymentDomainsSdk);
  const client = new StripePaymentDomainsHttpClient('sk_test_fixture', 'test', factory);
  return { client, methods, factory };
}
const scope = { stripeAccount: 'acct_fixture', timeout: 5000, maxNetworkRetries: 0 };
describe('Stripe payment domain adapter', () => {
  it('loads the real installed SDK without issuing HTTP requests', async () => {
    await expect(new StripePaymentDomainsHttpClient('sk_test_fixture', 'test').available()).resolves.toBe(true);
  });
  it('reads an active domain in the exact Connect scope with bounded SDK and request timeouts', async () => {
    const { client, methods, factory } = fixture();
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).resolves.toBe('active');
    expect(factory).toHaveBeenCalledWith('sk_test_fixture', { timeout: 5000, maxNetworkRetries: 0 });
    expect(methods.list).toHaveBeenCalledWith({ domain_name: 'restaurant.fr', limit: 1 }, scope);
    expect(methods.create).not.toHaveBeenCalled(); expect(methods.validate).not.toHaveBeenCalled();
  });
  it('creates absent domains idempotently for the mode, account and host', async () => {
    const { client, methods } = fixture([]);
    await client.ensure('acct_fixture', 'restaurant.fr', () => true);
    const key = methods.create.mock.calls[0]![1].idempotencyKey;
    expect(methods.create).toHaveBeenCalledWith({ domain_name: 'restaurant.fr' }, { ...scope, idempotencyKey: key });
    await client.ensure('acct_fixture', 'restaurant.fr', () => true);
    expect(methods.create.mock.calls[1]![1].idempotencyKey).toBe(key);
    await client.ensure('acct_other', 'restaurant.fr', () => true);
    expect(methods.create.mock.calls[2]![1].idempotencyKey).not.toBe(key);
  });
  it('validates inactive wallets after DNS readiness and retains the result while inactive', async () => {
    const { client, methods } = fixture([domain({ apple_pay: { status: 'inactive' } })]);
    methods.validate.mockResolvedValue(domain({ google_pay: { status: 'inactive' } }));
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).resolves.toBe('inactive');
    expect(methods.validate).toHaveBeenCalledWith('pmd_fixture', {}, scope);
  });
  it('never enables or validates a manually disabled domain', async () => {
    const { client, methods } = fixture([domain({ enabled: false })]);
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).resolves.toBe('disabled');
    expect(methods.create).not.toHaveBeenCalled(); expect(methods.validate).not.toHaveBeenCalled();
  });
  it('recovers a concurrent create by reading the exact domain again', async () => {
    const { client, methods } = fixture([]);
    methods.create.mockRejectedValue({ statusCode: 409 });
    methods.list.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [domain()] });
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).resolves.toBe('active');
    expect(methods.list).toHaveBeenCalledTimes(2);
  });
  it.each([{ livemode: true }, { domain_name: 'other.fr' }, { id: 'acct_wrong' }])('rejects inconsistent Stripe identity %j', mismatch => {
    const { client } = fixture([domain(mismatch)]);
    return expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).rejects.toThrow('scope');
  });
  it('does not fall back to platform scope or untrusted origins', async () => {
    const { client, methods } = fixture();
    await expect(client.ensure('', 'restaurant.fr', () => true)).rejects.toThrow('scope');
    await expect(client.ensure('acct_fixture', 'https://restaurant.fr', () => true)).rejects.toThrow('scope');
    expect(methods.list).not.toHaveBeenCalled();
  });
  it('propagates network failures without a create fallback', async () => {
    const { client, methods } = fixture(); methods.list.mockRejectedValue(new Error('network'));
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => true)).rejects.toThrow('network');
    expect(methods.create).not.toHaveBeenCalled();
  });
  it('checks lease ownership again between the list and write', async () => {
    const { client, methods } = fixture([]); let alive = true;
    methods.list.mockImplementation(async () => { alive = false; return { data: [] }; });
    await expect(client.ensure('acct_fixture', 'restaurant.fr', () => alive)).rejects.toThrow('lease');
    expect(methods.create).not.toHaveBeenCalled();
  });
});
