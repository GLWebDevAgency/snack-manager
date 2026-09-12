import https from 'node:https';
import { Socket } from 'node:net';
import { createECDH } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPushSender } from './order-push.sender';
import { pushFixture } from './order-push.test-fixture';
import { orderPushConfig } from './order-push.crypto';

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
  it.each([1, 31, 32])('envoie avec un scalaire VAPID valide de %i octets sans changer sa clé publique', async width => {
    // Données cryptographiques synthétiques : reproduire les zéros de tête
    // omis par getPrivateKey(), sans attendre une génération aléatoire rare.
    const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.alloc(width, 1));
    const { config, subscription } = pushFixture();
    const publicKey = key.getPublicKey().toString('base64url');
    const normalized = orderPushConfig({
      ORDER_PUSH_VAPID_PUBLIC_KEY: publicKey,
      ORDER_PUSH_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
      ORDER_PUSH_VAPID_SUBJECT: config.subject,
      ORDER_PUSH_ENCRYPTION_KEY_BASE64: config.encryptionKey.toString('base64'),
    });
    expect(normalized?.publicKey).toBe(publicKey);
    expect(await new OrderPushSender(normalized).send(subscription, 'restaurant')).toBe('retry');
    expect(https.request).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      hostname: 'fcm.googleapis.com', path: '/fcm/send/opaque-test', method: 'POST',
    }), expect.any(Function));
  });

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
