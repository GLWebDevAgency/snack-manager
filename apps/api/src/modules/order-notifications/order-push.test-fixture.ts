import { createECDH, randomBytes } from 'node:crypto';
import { orderPushConfig } from './order-push.crypto';

export function pushFixture() {
  const key = createECDH('prime256v1'); key.generateKeys();
  const config = orderPushConfig({ ORDER_PUSH_VAPID_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
    ORDER_PUSH_VAPID_PRIVATE_KEY: key.getPrivateKey().toString('base64url'), ORDER_PUSH_VAPID_SUBJECT: 'https://platform.example.test',
    ORDER_PUSH_ENCRYPTION_KEY_BASE64: randomBytes(32).toString('base64') })!;
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/opaque-test', expirationTime: null,
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
  return { config, subscription };
}
