import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderNotificationChanged, orderNotificationConfig, orderNotificationPreference } from './order-notifications-api';
const transport = vi.fn();
const request = { slug: 'restaurant', orderId: 'order-id', trackingToken: 'tracking-secret', endpoint: 'https://web.push.apple.com/opaque', action: 'subscribe' as const, expectedRevision: 4,
  subscription: { endpoint: 'https://web.push.apple.com/opaque', keys: { p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) } } };
beforeEach(() => { transport.mockReset(); vi.stubGlobal('fetch', transport); });
afterEach(() => vi.unstubAllGlobals());
describe('transport du consentement', () => {
  it('interdit redirections et référent pour les preuves, sans cookie ni cache', async () => {
    transport.mockResolvedValue(Response.json({ state: 'active', expiresAt: null, revision: 5 }));
    expect(await orderNotificationPreference(request)).toMatchObject({ state: 'active', revision: 5 });
    expect(transport).toHaveBeenCalledWith(expect.not.stringContaining('tracking-secret'), expect.objectContaining({
      method: 'POST', redirect: 'error', referrerPolicy: 'no-referrer', credentials: 'omit', cache: 'no-store',
      body: JSON.stringify({ trackingToken: request.trackingToken, subscription: request.subscription, expectedRevision: 4 }),
    }));
  });
  it('ne confond ni erreur de révocation ni ACK malformé avec une confirmation', async () => {
    transport.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(orderNotificationPreference({ ...request, action: 'revoke' })).rejects.toThrow('Désactivation non confirmée');
    transport.mockResolvedValueOnce(Response.json({ state: 'active', expiresAt: null }));
    await expect(orderNotificationPreference(request)).rejects.toThrow('Confirmation illisible');
  });
  it('rend une révision de conflit vérifiable, sans réessai automatique', async () => {
    transport.mockResolvedValue(Response.json({ code: 'ORDER_NOTIFICATION_CHANGED', current: { state: 'off', expiresAt: null, revision: 9 } }, { status: 409 }));
    await expect(orderNotificationPreference(request)).rejects.toMatchObject({ current: { state: 'off', revision: 9 } });
    expect(transport).toHaveBeenCalledTimes(1); expect(OrderNotificationChanged.prototype).toBeInstanceOf(Error);
  });
  it('une configuration indisponible ne devient pas disponible avec une clé absente', async () => {
    transport.mockResolvedValue(Response.json({ available: true, publicKey: null }));
    expect(await orderNotificationConfig('restaurant')).toEqual({ available: false, publicKey: null });
  });
});
