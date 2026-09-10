import { describe, expect, it } from 'vitest';
import { pushFixture } from './order-push.test-fixture';
import { endpointHash, openSubscription, orderPushConfig, sealSubscription } from './order-push.crypto';

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
