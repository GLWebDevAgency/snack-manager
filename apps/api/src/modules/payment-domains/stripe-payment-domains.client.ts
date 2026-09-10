import { createHash } from 'node:crypto';
import { publicHostname, type StripeMode } from './payment-domain-hosts';

export type PaymentDomainResult = 'active' | 'inactive' | 'disabled';
export interface StripePaymentDomainsClient {
  ensure(accountId: string, host: string, current: () => boolean): Promise<PaymentDomainResult>;
}
export interface StripePaymentDomain {
  id: string; domain_name: string; livemode: boolean; enabled: boolean;
  apple_pay?: { status: string }; google_pay?: { status: string };
}
export interface StripePaymentDomainsSdk {
  paymentMethodDomains: {
    list(params: { domain_name: string; limit: number }, options: Record<string, unknown>): Promise<{ data: StripePaymentDomain[] }>;
    create(params: { domain_name: string }, options: Record<string, unknown>): Promise<StripePaymentDomain>;
    validate(id: string, params: Record<string, never>, options: Record<string, unknown>): Promise<StripePaymentDomain>;
  };
}
type SdkFactory = (key: string, options: Record<string, unknown>) => Promise<StripePaymentDomainsSdk>;
const STRIPE_MODULE = 'stripe';
const loadSdk: SdkFactory = async (key, options) => {
  const mod = await import(STRIPE_MODULE);
  const Ctor = mod.default ?? mod;
  return new Ctor(key, options) as StripePaymentDomainsSdk;
};
const BOUNDED_REQUEST = { timeout: 5_000, maxNetworkRetries: 0 };

/** Only PMD methods are exposed: no payment, update, enable or delete operation. */
export class StripePaymentDomainsHttpClient implements StripePaymentDomainsClient {
  private sdk: Promise<StripePaymentDomainsSdk> | null = null;
  constructor(private readonly key: string, private readonly mode: StripeMode, private readonly factory: SdkFactory = loadSdk) {}

  async available(): Promise<boolean> { await this.getSdk(); return true; }
  private getSdk(): Promise<StripePaymentDomainsSdk> {
    this.sdk ??= this.factory(this.key, BOUNDED_REQUEST).catch(error => { this.sdk = null; throw error; });
    return this.sdk;
  }

  async ensure(accountId: string, host: string, current: () => boolean): Promise<PaymentDomainResult> {
    if (!/^acct_[a-zA-Z0-9]+$/.test(accountId) || publicHostname(host) !== host
      || !this.key.trim().startsWith(`sk_${this.mode}_`) && !this.key.trim().startsWith(`rk_${this.mode}_`)) {
      throw new Error('Invalid payment domain scope');
    }
    const sdk = await this.getSdk();
    const options = { ...BOUNDED_REQUEST, stripeAccount: accountId };
    const guard = () => { if (!current()) throw new Error('Payment domain lease lost'); };
    const check = (domain: StripePaymentDomain) => {
      if (domain.domain_name !== host || domain.livemode !== (this.mode === 'live')
        || !/^pmd_[a-zA-Z0-9]+$/.test(domain.id) || typeof domain.enabled !== 'boolean') {
        throw new Error('Unexpected payment domain scope');
      }
      return domain;
    };
    const read = async () => {
      guard();
      const result = await sdk.paymentMethodDomains.list({ domain_name: host, limit: 1 }, options);
      return result.data[0] ? check(result.data[0]) : null;
    };
    let domain = await read();
    if (!domain) {
      guard();
      try {
        const scope = createHash('sha256').update(`${this.mode}\n${accountId}\n${host}`).digest('hex');
        domain = check(await sdk.paymentMethodDomains.create({ domain_name: host }, { ...options, idempotencyKey: `sm-pmd-v1-${scope}` }));
      } catch (error) {
        const stripe = error as { code?: string; statusCode?: number };
        if (stripe.code !== 'resource_already_exists' && stripe.statusCode !== 409) throw error;
        domain = await read();
        if (!domain) throw error;
      }
    }
    if (!domain.enabled) return 'disabled'; // Respect an operator's manual disable.
    const active = (value: StripePaymentDomain) => value.apple_pay?.status === 'active' && value.google_pay?.status === 'active';
    if (active(domain)) return 'active';
    guard();
    domain = check(await sdk.paymentMethodDomains.validate(domain.id, {}, options));
    return !domain.enabled ? 'disabled' : active(domain) ? 'active' : 'inactive';
  }
}
