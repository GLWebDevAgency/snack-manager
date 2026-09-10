import { describe, expect, it, vi } from 'vitest';
import { createRefundClientFactory } from './order-refund-client.factory';
import type { RefundStripeClient } from './order-refunds.service';

const sdk = { refunds: { list: vi.fn(), create: vi.fn() }, charges: { retrieve: vi.fn() } } satisfies Omit<RefundStripeClient, 'environment'>;

describe('activation explicite du protocole remboursement après convergence des API', () => {
  it.each([undefined, '', 'false', '1', 'TRUE', ' true'])('reste fermé sans activation exacte : %s', async enabled => {
    const loader = vi.fn(async () => sdk);
    const factory = createRefundClientFactory(key => key === 'ORDER_REFUNDS_DURABLE_ENABLED' ? enabled : 'sk_test_fixture', loader);
    expect(await factory()).toBeNull(); expect(loader).not.toHaveBeenCalled();
  });
  it.each(['sk_test_fixture', 'rk_test_fixture', 'sk_live_fixture', 'rk_live_fixture'])('lie le client au mode réel de %s', async secret => {
    const loader = vi.fn(async () => sdk);
    const factory = createRefundClientFactory(key => key === 'ORDER_REFUNDS_DURABLE_ENABLED' ? 'true' : secret, loader);
    const client = await factory();
    expect(client?.environment).toBe(secret.includes('_test_') ? 'test' : 'live');
    expect(client?.refunds).toBe(sdk.refunds);
    expect(await factory()).toBe(client); expect(loader).toHaveBeenCalledOnce();
  });
  it.each([undefined, '', 'pk_test_fixture', 'sk_unknown_fixture'])('refuse une clé non serveur/mode inconnu : %s', async secret => {
    const loader = vi.fn(async () => sdk);
    const factory = createRefundClientFactory(key => key === 'ORDER_REFUNDS_DURABLE_ENABLED' ? 'true' : secret, loader);
    expect(await factory()).toBeNull(); expect(loader).not.toHaveBeenCalled();
  });
  it('respecte une fermeture même après cache puis un changement de clé/mode', async () => {
    const values = { ORDER_REFUNDS_DURABLE_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture' } as Record<string, string>;
    const loader = vi.fn(async () => sdk); const factory = createRefundClientFactory(key => values[key], loader);
    expect((await factory())?.environment).toBe('test');
    values.ORDER_REFUNDS_DURABLE_ENABLED = 'false'; expect(await factory()).toBeNull();
    values.ORDER_REFUNDS_DURABLE_ENABLED = 'true'; values.STRIPE_SECRET_KEY = 'sk_live_fixture';
    expect((await factory())?.environment).toBe('live'); expect(loader).toHaveBeenCalledTimes(2);
  });
});
