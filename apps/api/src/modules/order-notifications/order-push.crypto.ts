import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from 'node:crypto';
import { OrderPushSubscriptionSchema, type OrderPushSubscription } from '@sm/contracts';

export type OrderPushConfig = { publicKey: string; privateKey: string; subject: string; encryptionKey: Buffer };
export const ORDER_PUSH_CONFIG = Symbol('ORDER_PUSH_CONFIG');

export function orderPushConfig(env: Record<string, string | undefined>): OrderPushConfig | null {
  try {
    const publicKey = env.ORDER_PUSH_VAPID_PUBLIC_KEY ?? '';
    const privateKey = env.ORDER_PUSH_VAPID_PRIVATE_KEY ?? '';
    const subject = env.ORDER_PUSH_VAPID_SUBJECT ?? '';
    const encryptionKey = Buffer.from(env.ORDER_PUSH_ENCRYPTION_KEY_BASE64 ?? '', 'base64');
    const url = new URL(subject);
    if (url.protocol !== 'https:' || url.username || url.password || encryptionKey.length !== 32) return null;
    const privateBytes = Buffer.from(privateKey, 'base64url');
    if (privateBytes.length < 1 || privateBytes.length > 32 || privateBytes.toString('base64url') !== privateKey) return null;
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privateBytes);
    if (Buffer.from(publicKey, 'base64url').length !== 65 || ecdh.getPublicKey().toString('base64url') !== publicKey) return null;
    // Node may omit leading zeroes from a valid EC scalar; web-push requires
    // its fixed 32-byte VAPID encoding. Padding preserves the validated key pair.
    const normalizedPrivateKey = Buffer.concat([Buffer.alloc(32 - privateBytes.length), privateBytes]).toString('base64url');
    return { publicKey, privateKey: normalizedPrivateKey, subject, encryptionKey };
  } catch { return null; }
}

export function endpointHash(endpoint: string): string { return createHash('sha256').update(endpoint).digest('hex'); }
const aad = (tenant: string, order: string, hash: string) => Buffer.from(`sm.order-ready.v1\0${tenant}\0${order}\0${hash}`);

export function sealSubscription(config: OrderPushConfig, tenant: string, order: string, hash: string, subscription: OrderPushSubscription): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKey, nonce);
  cipher.setAAD(aad(tenant, order, hash));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(subscription), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function openSubscription(config: OrderPushConfig, tenant: string, order: string, hash: string, payload: string): OrderPushSubscription {
  const [version, nonce, tag, encrypted, extra] = payload.split('.');
  if (version !== 'v1' || !nonce || !tag || !encrypted || extra) throw new Error('Abonnement illisible');
  const decipher = createDecipheriv('aes-256-gcm', config.encryptionKey, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(aad(tenant, order, hash));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const clear = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
  const subscription = OrderPushSubscriptionSchema.parse(JSON.parse(clear));
  if (endpointHash(subscription.endpoint) !== hash) throw new Error('Abonnement illisible');
  return subscription;
}
