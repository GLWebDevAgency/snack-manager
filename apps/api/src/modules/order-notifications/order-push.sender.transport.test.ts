import https from 'node:https';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPushSender } from './order-push.sender';
import { pushFixture } from './order-push.test-fixture';

// Garder le vrai web-push : son parseur legacy diffère de new URL().
// Le transport est interrompu AVANT toute connexion, même pour les contrôles valides.
const intercepted = new Error('Transport intercepté par le test');
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => { throw new Error('Connexion réseau interdite'); });
  vi.spyOn(https, 'request').mockImplementation(() => { throw intercepted; });
});
afterEach(() => {
  try { expect(Socket.prototype.connect).not.toHaveBeenCalled(); }
  finally { vi.restoreAllMocks(); }
});

describe('destination effective du vrai transport web-push', () => {
  it.each([
    'https://fcm%2Egoogleapis.com/a', 'https://updates%2epush.services.mozilla.com/a',
    'https://web%2Epush.apple.com/a', 'https://%66cm.googleapis.com/a',
    'https:fcm.googleapis.com/a', 'https:/fcm.googleapis.com/a', 'https:///fcm.googleapis.com/a',
    String.raw`https:\fcm.googleapis.com\a`, String.raw`https://fcm.googleapis.com\a`,
    'https://fcm。googleapis.com/a', 'https://ｆｃｍ.googleapis.com/a',
    'https://fcm.google\tapis.com/a', 'https://fcm.googleapis.com/a\nb',
  ])('expire une URL ambiguë avant le transport : %s', async (endpoint) => {
    const { config, subscription } = pushFixture();
    expect(await new OrderPushSender(config).send({ ...subscription, endpoint }, 'restaurant')).toBe('expired');
    expect(https.request).not.toHaveBeenCalled();
  });

  it.each([
    ['https://fcm.googleapis.com/a%2Fb?token=a%2Bb%3D&x=1', 'fcm.googleapis.com', null],
    ['HTTPS://FCM.GOOGLEAPIS.COM:443/a%2Fb?token=a%2Bb%3D&x=1', 'fcm.googleapis.com', '443'],
    ['https://updates.push.services.mozilla.com/a%2Fb?token=a%2Bb%3D&x=1', 'updates.push.services.mozilla.com', null],
    ['https://web.push.apple.com:443/a%2Fb?token=a%2Bb%3D&x=1', 'web.push.apple.com', '443'],
  ])('prépare le fournisseur autorisé sans réécrire ses jetons : %s', async (endpoint, hostname, port) => {
    const { config, subscription } = pushFixture();
    // L'interception simule une erreur réseau, pas un acquittement fournisseur.
    expect(await new OrderPushSender(config).send({ ...subscription, endpoint: endpoint! }, 'restaurant')).toBe('retry');
    expect(https.request).toHaveBeenCalledTimes(1);
    expect(vi.mocked(https.request).mock.calls[0]![0]).toMatchObject({
      hostname, port, path: '/a%2Fb?token=a%2Bb%3D&x=1', method: 'POST',
    });
  });
});
