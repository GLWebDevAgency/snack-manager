import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification: mock.send } }));
import { OrderPushSender } from './order-push.sender';
import { pushFixture } from './order-push.test-fixture';
beforeEach(() => { mock.send.mockReset(); });
describe('frontière fournisseur de notification', () => {
  it('envoie seulement un message générique et une destination publique sans preuve', async () => {
    const { config, subscription } = pushFixture(); mock.send.mockResolvedValue({});
    expect(await new OrderPushSender(config).send(subscription, 'restaurant')).toBe('sent');
    const [sent, payload, options] = mock.send.mock.calls[0]!;
    expect(sent).toEqual(subscription); expect(JSON.parse(payload)).toMatchObject({ path: '/r/restaurant/commandes' });
    expect(payload).not.toContain(subscription.endpoint); expect(payload).not.toContain(subscription.keys.auth);
    expect(options).toMatchObject({ timeout: 10_000, TTL: 900 });
  });
  it.each([301, 307, 308, 404, 410, 429, 500])('traite le code %s sans fuite fournisseur ni redirection', async (statusCode) => {
    const { config, subscription } = pushFixture(); mock.send.mockRejectedValue({ statusCode, endpoint: subscription.endpoint });
    expect(await new OrderPushSender(config).send(subscription, 'restaurant')).toBe(statusCode === 429 || statusCode === 500 ? 'retry' : 'expired');
    expect(mock.send).toHaveBeenCalledTimes(1);
  });
  it('revalide la sortie réseau juste avant transport et échoue fermé sans configuration', async () => {
    const { config, subscription } = pushFixture();
    expect(await new OrderPushSender(config).send({ ...subscription, endpoint: 'https://127.0.0.1/secret' }, 'restaurant')).toBe('expired');
    expect(await new OrderPushSender(null).send(subscription, 'restaurant')).toBe('expired');
    expect(mock.send).not.toHaveBeenCalled();
  });
});
