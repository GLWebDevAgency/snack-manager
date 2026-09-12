import { createECDH, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pushFixture } from './order-push.test-fixture';
import { endpointHash, openSubscription, orderPushConfig, sealSubscription } from './order-push.crypto';

function scalarFixture(scalar: Buffer) {
  const pair = createECDH('prime256v1'); pair.setPrivateKey(scalar);
  const publicKey = pair.getPublicKey();
  return { publicKey, env: { ORDER_PUSH_VAPID_PUBLIC_KEY: publicKey.toString('base64url'),
    ORDER_PUSH_VAPID_PRIVATE_KEY: scalar.toString('base64url'),
    ORDER_PUSH_VAPID_SUBJECT: 'https://platform.example.test',
    ORDER_PUSH_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64') } };
}

describe('normalisation des scalaires VAPID', () => {
  it.each([1, 31, 32])('normalise %i octets sur 32 sans changer la clé publique ni la signature vérifiable', length => {
    const scalar = Buffer.alloc(length, 1), { publicKey, env } = scalarFixture(scalar);
    const config = orderPushConfig(env);
    expect(config).not.toBeNull();
    expect(Buffer.from(config!.privateKey, 'base64url')).toHaveLength(32);
    expect(config!.publicKey).toBe(env.ORDER_PUSH_VAPID_PUBLIC_KEY);
    const normalized = createECDH('prime256v1'); normalized.setPrivateKey(Buffer.from(config!.privateKey, 'base64url'));
    expect(normalized.getPublicKey()).toEqual(publicKey);
    const publicJwk = { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'),
      y: publicKey.subarray(33).toString('base64url') };
    const privateKey = createPrivateKey({ key: { ...publicJwk, d: config!.privateKey }, format: 'jwk' });
    const payload = Buffer.from('VAPID fixture identity, no provider request');
    expect(verify('sha256', payload, createPublicKey({ key: publicJwk, format: 'jwk' }), sign('sha256', payload, privateKey))).toBe(true);
    if (length === 32) expect(config!.privateKey).toBe(env.ORDER_PUSH_VAPID_PRIVATE_KEY);
  });

  it.each([
    '', 'AQ=', 'AQ!', 'AQ\n', 'AR',
    Buffer.alloc(1).toString('base64url'), Buffer.alloc(32).toString('base64url'),
    Buffer.concat([Buffer.alloc(32), Buffer.from([1])]).toString('base64url'),
    Buffer.alloc(32, 255).toString('base64url'),
  ])('refuse un scalaire vide, mal encodé, nul, trop large ou hors courbe (%#)', privateKey => {
    const { env } = scalarFixture(Buffer.from([1]));
    expect(orderPushConfig({ ...env, ORDER_PUSH_VAPID_PRIVATE_KEY: privateKey })).toBeNull();
  });

  it('refuse une clé publique étrangère même lorsque le scalaire court est valide', () => {
    const { env } = scalarFixture(Buffer.from([1]));
    const other = scalarFixture(Buffer.from([2]));
    expect(orderPushConfig({ ...env, ORDER_PUSH_VAPID_PUBLIC_KEY: other.env.ORDER_PUSH_VAPID_PUBLIC_KEY })).toBeNull();
  });
});

describe('clés push chiffrées et liées à leur commande', () => {
  it('échoue fermé sans VAPID complet ou avec un sujet non public HTTPS', () => {
    expect(orderPushConfig({})).toBeNull();
    expect(orderPushConfig({ ORDER_PUSH_VAPID_SUBJECT: 'javascript:alert(1)' })).toBeNull();
    expect(pushFixture().config).not.toBeNull();
  });
  it('ne stocke aucune URL ni clé en clair, et refuse transplantation ou altération', () => {
    const { config, subscription } = pushFixture();
    const hash = endpointHash(subscription.endpoint);
    const sealed = sealSubscription(config, 'tenant', 'order', hash, subscription);
    expect(sealed).not.toContain(subscription.endpoint);
    expect(sealed).not.toContain(subscription.keys.auth);
    expect(openSubscription(config, 'tenant', 'order', hash, sealed)).toEqual(subscription);
    expect(() => openSubscription(config, 'other', 'order', hash, sealed)).toThrow();
    expect(() => openSubscription(config, 'tenant', 'other', hash, sealed)).toThrow();
    expect(() => openSubscription(config, 'tenant', 'order', hash, sealed.slice(0, -2) + 'aa')).toThrow();
  });
  it.each(['https://fcm%2Egoogleapis.com/a', 'https:fcm.googleapis.com/a'])('refuse aussi un ancien abonnement chiffré ambigu : %s', (endpoint) => {
    const { config, subscription } = pushFixture();
    const hash = endpointHash(endpoint);
    const sealed = sealSubscription(config, 'tenant', 'order', hash, { ...subscription, endpoint });
    expect(() => openSubscription(config, 'tenant', 'order', hash, sealed)).toThrow();
  });
  it('préserve l’identité chiffrée des jetons opaques et de l’autorité HTTPS autorisée', () => {
    const { config, subscription } = pushFixture();
    const original = { ...subscription, endpoint: 'HTTPS://FCM.GOOGLEAPIS.COM:443/a%2Fb?token=a%2B%3D' };
    const hash = endpointHash(original.endpoint);
    const sealed = sealSubscription(config, 'tenant', 'order', hash, original);
    expect(openSubscription(config, 'tenant', 'order', hash, sealed)).toEqual(original);
  });
});
