import { describe, expect, it } from 'vitest';
import { isOrderPushEndpoint, OrderReadySubscribeSchema, orderPushTarget } from './order-notifications';

describe('abonnement transactionnel partagé web/Expo', () => {
  it.each(['https://fcm.googleapis.com/fcm/send/opaque', 'https://updates.push.services.mozilla.com/wpush/v2/opaque', 'https://web.push.apple.com/opaque'])('admet uniquement un fournisseur connu : %s', (endpoint) => {
    expect(isOrderPushEndpoint(endpoint)).toBe(true);
  });
  it.each(['http://fcm.googleapis.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://fcm.googleapis.com.evil.test/a',
    'https://fcm.googleapis.com:444/a', 'https://user:pass@fcm.googleapis.com/a', 'https://fcm.googleapis.com/a#secret', 'https://fcm.googleapis.com/'])('refuse une sortie réseau non autorisée : %s', (endpoint) => {
    expect(isOrderPushEndpoint(endpoint)).toBe(false);
  });
  it.each([
    'https://fcm%2Egoogleapis.com/a', 'https://updates%2epush.services.mozilla.com/a',
    'https://web%2Epush.apple.com/a', 'https://%66cm.googleapis.com/a',
    'https:fcm.googleapis.com/a', 'https:/fcm.googleapis.com/a', 'https:///fcm.googleapis.com/a',
    String.raw`https:\fcm.googleapis.com\a`, String.raw`https://fcm.googleapis.com\a`,
    'https://fcm。googleapis.com/a', 'https://ｆｃｍ.googleapis.com/a',
    'https://fcm.google\tapis.com/a', 'https://fcm.googleapis.com/a\nb',
    'https://fcm.googleapis.com/a\rb', 'https://fcm.googleapis.com/a\u0000b',
    'https://fcm.googleapis.com:/a', 'https://fcm.googleapis.com:0443/a',
    'https://fcm.googleapis.com/a#',
  ])('refuse les formes ambiguës entre parseurs URL : %s', (endpoint) => {
    expect(isOrderPushEndpoint(endpoint)).toBe(false);
  });
  it.each([
    'HTTPS://FCM.GOOGLEAPIS.COM:443/a%2Fb?token=a%2Bb%3D&x=1',
    'https://updates.push.services.mozilla.com:443/wpush/v2/a%2Fb?token=a%3D',
    'https://web.push.apple.com/a%2Fb?token=a%2B%3D',
  ])('conserve les octets des endpoints légitimes : %s', (endpoint) => {
    const result = OrderReadySubscribeSchema.parse({ trackingToken: 'token', expectedRevision: 0,
      subscription: { endpoint, keys: { p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) } } });
    expect(result.subscription.endpoint).toBe(endpoint);
  });
  it('refuse opérateurs Mongo, permission inventée et clés incomplètes', () => {
    expect(OrderReadySubscribeSchema.safeParse({ trackingToken: { $ne: null }, subscription: {} }).success).toBe(false);
    expect(OrderReadySubscribeSchema.safeParse({ trackingToken: 'token', subscription: { endpoint: 'https://web.push.apple.com/a', keys: { p256dh: 'short', auth: 'short' } }, permission: 'granted' }).success).toBe(false);
  });
  it('exige une révision de consentement entière positive ou nulle', () => {
    const valid = { trackingToken: 'token', subscription: { endpoint: 'https://web.push.apple.com/a', keys: { p256dh: 'B' + 'a'.repeat(86), auth: 'a'.repeat(22) } }, expectedRevision: 0 };
    expect(OrderReadySubscribeSchema.safeParse(valid).success).toBe(true);
    for (const expectedRevision of [undefined, -1, 1.2, '0']) expect(OrderReadySubscribeSchema.safeParse({ ...valid, expectedRevision }).success).toBe(false);
  });
  it('ne met ni commande ni jeton dans la destination de notification', () => {
    expect(orderPushTarget('restaurant')).toBe('/r/restaurant/commandes');
    expect(orderPushTarget('a/b')).toBe('/r/a%2Fb/commandes');
  });
});
