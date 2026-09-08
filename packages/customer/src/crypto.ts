import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createSecretKey,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { TextDecoder } from 'node:util';

export type CustomerHashPurpose = 'phone' | 'global-phone' | 'browser' | 'ip' | 'session' | 'request' | 'intent-proof' | 'recovery-code';
export type CustomerSealPurpose = 'phone' | 'name';

const namespace = 'sm.customer-identity.v1';
const hashPurposes: readonly CustomerHashPurpose[] = ['phone', 'global-phone', 'browser', 'ip', 'session', 'request', 'intent-proof', 'recovery-code'];
const sealPurposes: readonly CustomerSealPurpose[] = ['phone', 'name'];
const contextBytes = 160;
const hashValueBytes = 16 * 1024;
const cleartextBytes = 1024;
const envelopeBytes = 4096;
const nonceBytes = 12;
const tagBytes = 16;
const canonicalUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** One failure shape: never propagate OpenSSL details, inputs or a nested cause. */
export class CustomerIdentityCryptoError extends Error {
  constructor() {
    super('Identité client indisponible.');
    this.name = 'CustomerIdentityCryptoError';
  }
}

const invalid = () => new CustomerIdentityCryptoError();

/** Reject lossy UTF-16 -> UTF-8 conversion, rather than hashing/encrypting a
 * replacement character under a different apparent identity. No normalization,
 * trimming or phone formatting belongs to this cryptographic boundary.
 */
function text(value: unknown, maxBytes: number): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxBytes) throw invalid();
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid();
    } else if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw invalid();
}

function decode(value: unknown, maxBytes: number, exactBytes?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0
    || value.length > Math.ceil(maxBytes * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > maxBytes || (exactBytes !== undefined && bytes.length !== exactBytes)
    || bytes.toString('base64url') !== value) {
    bytes.fill(0);
    throw invalid();
  }
  return bytes;
}

function context(purpose: CustomerSealPurpose, tenantRef: string, subject: string): Buffer {
  text(tenantRef, contextBytes);
  text(subject, contextBytes);
  return Buffer.from(JSON.stringify([namespace, 'sealed', purpose, tenantRef, subject]), 'utf8');
}

/** Dedicated deployment master key, never a JWT, loyalty or handoff key.
 * HKDF namespaces separate every hash, sealed field and recoverable session
 * token. Real private fields also keep derived keys out of JSON/inspection.
 *
 * `phone` subject is its tenant-scoped phone hash; `name` subject is accountId.
 * Caller authorization, canonical phone formatting, expiry, one-time consumption
 * and durable check receipts are outside this primitive. Deriving a token does
 * NOT authorize its issuance. Key rotation requires an explicit data migration;
 * v1 never guesses a fallback key or tries another purpose/context.
 */
export class CustomerIdentityCrypto {
  readonly #hashKeys: ReadonlyMap<CustomerHashPurpose, KeyObject>;
  readonly #sealKeys: ReadonlyMap<CustomerSealPurpose, KeyObject>;
  readonly #checkTokenKey: KeyObject;
  readonly #intentCheckTokenKey: KeyObject;
  readonly #protectedTokenKey: KeyObject;

  constructor(masterKeyBase64: string) {
    let master: Buffer | undefined;
    try {
      if (typeof masterKeyBase64 !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(masterKeyBase64)) throw invalid();
      master = Buffer.from(masterKeyBase64, 'base64');
      if (master.length !== 32 || master.toString('base64') !== masterKeyBase64) throw invalid();
      const derive = (kind: string, purpose: string): KeyObject => {
        const bytes = Buffer.from(hkdfSync('sha256', master!, namespace, JSON.stringify([kind, purpose]), 32));
        try { return createSecretKey(bytes); } finally { bytes.fill(0); }
      };
      this.#hashKeys = new Map(hashPurposes.map(purpose => [purpose, derive('hash', purpose)]));
      this.#sealKeys = new Map(sealPurposes.map(purpose => [purpose, derive('seal', purpose)]));
      this.#checkTokenKey = derive('derive', 'check-session-token');
      this.#intentCheckTokenKey = derive('derive', 'intent-check-session-token');
      this.#protectedTokenKey = derive('derive', 'protected-publication-token');
    } catch { throw invalid(); }
    finally { master?.fill(0); }
  }

  hash(purpose: CustomerHashPurpose, scope: string, value: string): string {
    try {
      const key = this.#hashKeys.get(purpose);
      if (!key) throw invalid();
      text(scope, contextBytes);
      text(value, hashValueBytes);
      return createHmac('sha256', key)
        .update(JSON.stringify([namespace, 'hash', purpose, scope, value]), 'utf8').digest('hex');
    } catch { throw invalid(); }
  }

  seal(purpose: CustomerSealPurpose, tenantRef: string, subject: string, clear: string): string {
    let plaintext: Buffer | undefined;
    try {
      const key = this.#sealKeys.get(purpose);
      if (!key) throw invalid();
      const aad = context(purpose, tenantRef, subject);
      text(clear, cleartextBytes);
      plaintext = Buffer.from(clear, 'utf8');
      const nonce = randomBytes(nonceBytes);
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: tagBytes });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    } catch { throw invalid(); }
    finally { plaintext?.fill(0); }
  }

  open(purpose: CustomerSealPurpose, tenantRef: string, subject: string, sealed: string): string {
    let partial: Buffer | undefined;
    let tail: Buffer | undefined;
    let plaintext: Buffer | undefined;
    try {
      const key = this.#sealKeys.get(purpose);
      if (!key) throw invalid();
      const aad = context(purpose, tenantRef, subject);
      if (typeof sealed !== 'string' || sealed.length > envelopeBytes) throw invalid();
      const parts = sealed.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') throw invalid();
      const nonce = decode(parts[1], nonceBytes, nonceBytes);
      const ciphertext = decode(parts[2], cleartextBytes);
      const tag = decode(parts[3], tagBytes, tagBytes);
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: tagBytes });
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      partial = decipher.update(ciphertext);
      tail = decipher.final(); // No cleartext is returned before authentication.
      plaintext = Buffer.concat([partial, tail]);
      // Preserve an intentional leading BOM; fatal decoding rejects invalid UTF-8.
      const clear = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext);
      text(clear, cleartextBytes);
      return clear;
    } catch { throw invalid(); }
    finally {
      partial?.fill(0);
      tail?.fill(0);
      plaintext?.fill(0);
    }
  }

  /** Recompute only after the durable check receipt confirms approval. No OTP,
   * provider SID or unverified contact can stand in for these bound inputs.
   */
  tokenForCheck(tenantRef: string, browserSecret: string, challengeId: string, checkId: string): string {
    let browserBytes: Buffer | undefined;
    try {
      text(tenantRef, contextBytes);
      browserBytes = decode(browserSecret, 32, 32);
      if (typeof challengeId !== 'string' || !canonicalUuid.test(challengeId)
        || typeof checkId !== 'string' || !canonicalUuid.test(checkId)) throw invalid();
      return createHmac('sha256', this.#checkTokenKey)
        .update(JSON.stringify([namespace, 'check-session-token', tenantRef, browserSecret, challengeId, checkId]), 'utf8')
        .digest('base64url');
    } catch { throw invalid(); }
    finally { browserBytes?.fill(0); }
  }

  /** The intent's separate private proof is required even with the browser cookie.
   * Only an exact durable approved receipt authorizes returning this token. */
  tokenForIntentCheck(tenantRef: string, browserSecret: string, operationId: string, intentProof: string,
    challengeId: string, checkId: string): string {
    let browserBytes: Buffer | undefined;
    let proofBytes: Buffer | undefined;
    try {
      text(tenantRef, contextBytes);
      browserBytes = decode(browserSecret, 32, 32);
      proofBytes = decode(intentProof, 32, 32);
      if (![operationId, challengeId, checkId].every(value => typeof value === 'string' && canonicalUuid.test(value))) throw invalid();
      return createHmac('sha256', this.#intentCheckTokenKey)
        .update(JSON.stringify([namespace, 'intent-check-session-token', tenantRef, browserSecret, operationId, intentProof, challengeId, checkId]), 'utf8')
        .digest('base64url');
    } catch { throw invalid(); }
    finally { browserBytes?.fill(0); proofBytes?.fill(0); }
  }

  /** Derivation is not admission: only the exact current durable publication
   * authorizes returning this post-authentication token. No synthetic OTP. */
  tokenForProtectedPublication(tenantRef: string, browserSecret: string, operationId: string, intentProof: string,
    method: 'passkey' | 'recovery', attemptId: string): string {
    let browserBytes: Buffer | undefined; let proofBytes: Buffer | undefined;
    try {
      text(tenantRef, contextBytes);
      browserBytes = decode(browserSecret, 32, 32); proofBytes = decode(intentProof, 32, 32);
      if (!['passkey', 'recovery'].includes(method)
        || ![operationId, attemptId].every(value => typeof value === 'string' && canonicalUuid.test(value))) throw invalid();
      return createHmac('sha256', this.#protectedTokenKey).update(JSON.stringify([
        namespace, 'protected-publication-token', tenantRef, browserSecret, operationId, intentProof, method, attemptId,
      ]), 'utf8').digest('base64url');
    } catch { throw invalid(); }
    finally { browserBytes?.fill(0); proofBytes?.fill(0); }
  }
}
