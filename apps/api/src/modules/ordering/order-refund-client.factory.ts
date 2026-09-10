import type { RefundClientFactory, RefundStripeClient } from './order-refunds.service';

type RefundSdk = Omit<RefundStripeClient, 'environment'>;
async function loadStripe(key: string): Promise<RefundSdk> {
  const moduleName = 'stripe';
  const { default: Stripe } = await import(moduleName);
  return new Stripe(key) as RefundSdk;
}

/** Configuration-only activation after every API instance understands the
 * journal. An older executable cannot be made safe by a new Mongo schema. */
export function createRefundClientFactory(
  read: (key: string) => string | undefined,
  load: (key: string) => Promise<RefundSdk> = loadStripe,
): RefundClientFactory {
  let cached: { key: string; client: RefundStripeClient } | null = null;
  return async () => {
    if (read('ORDER_REFUNDS_DURABLE_ENABLED') !== 'true') return null;
    const key = read('STRIPE_SECRET_KEY');
    if (!key || !/^(sk|rk)_(test|live)_/.test(key)) return null;
    if (cached?.key === key) return cached.client;
    const stripe = await load(key);
    const client: RefundStripeClient = { refunds: stripe.refunds, charges: stripe.charges,
      environment: key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test' : 'live' };
    cached = { key, client };
    return client;
  };
}
