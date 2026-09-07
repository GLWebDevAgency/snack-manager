import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DeliveryHandoffProofSchema, parseDeliveryHandoffQr, type DeliveryHandoffProof } from '@sm/contracts';

export type DeliveryProofContext = Readonly<{ tenantId: string; orderId: string; proofId: string; expiresAt: string }>;
export type DeliveryProofSecrets = Readonly<{ pin: string; qrToken: string }>;
const invalid = () => new Error('Delivery handoff proof unavailable');
const B64_32 = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function associatedData(context: DeliveryProofContext): Buffer {
  if (!/^[a-f0-9]{24}$/.test(context.tenantId) || !/^[a-f0-9]{24}$/.test(context.orderId)
    || !UUID.test(context.proofId) || !Number.isFinite(Date.parse(context.expiresAt))
    || new Date(context.expiresAt).toISOString() !== context.expiresAt) throw invalid();
  return Buffer.from(JSON.stringify(['sm.delivery-proof.v1', context.tenantId, context.orderId, context.proofId, context.expiresAt]));
}

function decode(value: string, bytes: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== bytes || decoded.toString('base64url') !== value) throw invalid();
  return decoded;
}

/** A dedicated deployment key, never the JWT secret. Derive distinct encryption and journal keys.
 * No secret is returned by an error. Callers must authorize before decrypting or validating.
 * Expiry, assignment, rate limits and atomic consumption belong to the use case, not this primitive.
 */
export function createDeliveryHandoffCrypto(secret: string) {
  if (typeof secret !== 'string' || !B64_32.test(secret)) throw invalid();
  const master = decode(secret, 32);
  const derive = (purpose: string) => Buffer.from(hkdfSync('sha256', master, 'sm.delivery-handoff.v1', purpose, 32));
  const encryptionKey = derive('encryption');
  const journalKey = derive('operation-fingerprint');
  master.fill(0);

  function seal(context: DeliveryProofContext, secrets: DeliveryProofSecrets): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(context));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf8'), cipher.final()]);
    return ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  function open(context: DeliveryProofContext, sealed: string): DeliveryProofSecrets {
    try {
      if (typeof sealed !== 'string' || sealed.length > 512) throw invalid();
      const parts = sealed.split('.');
      const [version, nonce, encrypted, tag] = parts;
      if (parts.length !== 4 || version !== 'v1' || !nonce || !encrypted || !tag || !/^[A-Za-z0-9_-]+$/.test(encrypted)) throw invalid();
      const ciphertext = Buffer.from(encrypted, 'base64url');
      if (!ciphertext.length || ciphertext.toString('base64url') !== encrypted) throw invalid();
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, decode(nonce, 12), { authTagLength: 16 });
      decipher.setAAD(associatedData(context));
      decipher.setAuthTag(decode(tag, 16));
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      try {
        const value: unknown = JSON.parse(plaintext.toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || Object.keys(value).sort().join() !== 'pin,qrToken') throw invalid();
        const secrets = value as DeliveryProofSecrets;
        if (!/^\d{6}$/.test(secrets.pin) || !B64_32.test(secrets.qrToken)) throw invalid();
        decode(secrets.qrToken, 32);
        return { pin: secrets.pin, qrToken: secrets.qrToken };
      } finally { plaintext.fill(0); }
    } catch { throw invalid(); }
  }

  return {
    create(context: DeliveryProofContext): { sealed: string } {
      const secrets = { pin: String(randomInt(1_000_000)).padStart(6, '0'), qrToken: randomBytes(32).toString('base64url') };
      return { sealed: seal(context, secrets) };
    },
    open,
    matches(context: DeliveryProofContext, sealed: string, raw: DeliveryHandoffProof): boolean {
      const parsed = DeliveryHandoffProofSchema.safeParse(raw);
      if (!parsed.success) return false;
      const secrets = open(context, sealed);
      const proof = parsed.data;
      if (proof.kind === 'pin') return timingSafeEqual(Buffer.from(proof.value), Buffer.from(secrets.pin));
      const qr = parseDeliveryHandoffQr(proof.value);
      return !!qr && qr.orderId === context.orderId && qr.proofId === context.proofId
        && timingSafeEqual(Buffer.from(qr.token), Buffer.from(secrets.qrToken));
    },
    /** HMAC rather than plain SHA256: a leaked receipt cannot enumerate the million possible PINs. */
    fingerprint(value: unknown): string {
      return createHmac('sha256', journalKey).update(JSON.stringify(['sm.delivery-handoff.operation.v1', value])).digest('hex');
    },
  };
}
