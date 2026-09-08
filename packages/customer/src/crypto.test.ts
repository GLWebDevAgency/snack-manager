import { createCipheriv, createDecipheriv, createHmac, hkdfSync } from 'node:crypto';
import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  CustomerIdentityCrypto,
  CustomerIdentityCryptoError,
  type CustomerHashPurpose,
} from './crypto';

// Generated fixtures, never a deployment key, customer or provider credential.
const keyBytes = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
const masterKey = keyBytes.toString('base64');
const otherKey = Buffer.from(Array.from({ length: 32 }, (_, i) => 255 - i)).toString('base64');
const tenant = 'tenant-classfood-fixture';
const phone = '+33600000001';
const account = '10000000-0000-4000-8000-000000000001';
const challenge = '20000000-0000-4000-8000-000000000002';
const check = '30000000-0000-4000-8000-000000000003';
const browser = Buffer.from(Array.from({ length: 32 }, (_, i) => i * 3)).toString('base64url');
const adapter = () => new CustomerIdentityCrypto(masterKey);
const purposes: CustomerHashPurpose[] = ['phone', 'global-phone', 'browser', 'ip', 'session', 'request'];

function genericFailure(action: () => unknown) {
  let caught: unknown;
  try { action(); } catch (cause) { caught = cause; }
  expect(caught).toBeInstanceOf(CustomerIdentityCryptoError);
  if (!(caught instanceof CustomerIdentityCryptoError)) return;
  expect(caught.message).toBe('Identité client indisponible.');
  expect('cause' in caught).toBe(false);
  const output = JSON.stringify(caught) + caught.message + caught.stack;
  for (const marker of [masterKey, otherKey, phone, browser, account, tenant]) {
    expect(output.includes(marker)).toBe(false);
  }
}

function changedPart(sealed: string, index: number): string {
  const parts = sealed.split('.');
  const bytes = Buffer.from(parts[index]!, 'base64url');
  bytes[0] = bytes[0]! ^ 1;
  parts[index] = bytes.toString('base64url');
  return parts.join('.');
}

/** Alter only unused final encoding bits: Buffer.from accepts this alias. */
function encodingAlias(value: string, alphabet: string): string {
  const padded = value.endsWith('=');
  const at = value.length - (padded ? 2 : 1);
  const index = alphabet.indexOf(value[at]!);
  return value.slice(0, at) + alphabet[index + 1]! + value.slice(at + 1);
}

const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const b64url = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

describe('CustomerIdentityCrypto: strict dedicated key', () => {
  it.each([
    ['absent', undefined], ['null', null], ['empty', ''], ['not a string', 32],
    ['unpadded', masterKey.slice(0, -1)], ['leading whitespace', ` ${masterKey}`],
    ['newline', `${masterKey}\n`], ['base64url alphabet', Buffer.alloc(32, 255).toString('base64url') + '='],
    ['31 bytes', Buffer.alloc(31, 1).toString('base64')], ['33 bytes', Buffer.alloc(33, 1).toString('base64')],
    ['unused bits', encodingAlias(masterKey, b64)], ['oversized', 'a'.repeat(16_385)],
  ])('refuses %s rather than coercing or choosing a fallback', (_label, value) => {
    genericFailure(() => new CustomerIdentityCrypto(value as string));
  });

  it('does not expose key material through instance serialization or inspection', () => {
    const crypto = adapter();
    expect(Object.keys(crypto)).toEqual([]);
    const serialized = JSON.stringify(crypto) + inspect(crypto, { showHidden: true });
    expect(serialized.includes(masterKey)).toBe(false);
    expect(serialized.includes(keyBytes.toString('hex'))).toBe(false);
  });
});

describe('CustomerIdentityCrypto: purpose and scope separated hashes', () => {
  it.each(purposes)('creates a stable keyed %s digest across instances', purpose => {
    const value = adapter().hash(purpose, tenant, phone);
    expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect(adapter().hash(purpose, tenant, phone)).toBe(value);
    expect(adapter().hash(purpose, tenant + '-other', phone)).not.toBe(value);
    expect(adapter().hash(purpose, tenant, phone + '2')).not.toBe(value);
    expect(new CustomerIdentityCrypto(otherKey).hash(purpose, tenant, phone)).not.toBe(value);
  });

  it.each(purposes)('uses the dedicated HKDF-derived key and versioned tuple for %s', purpose => {
    const key = Buffer.from(hkdfSync('sha256', keyBytes, 'sm.customer-identity.v1', JSON.stringify(['hash', purpose]), 32));
    const expected = createHmac('sha256', key)
      .update(JSON.stringify(['sm.customer-identity.v1', 'hash', purpose, tenant, phone]), 'utf8').digest('hex');
    expect(adapter().hash(purpose, tenant, phone)).toBe(expected);
  });

  it('separates every hash purpose, including the parent-account phone budget', () => {
    expect(new Set(purposes.map(purpose => adapter().hash(purpose, tenant, phone))).size).toBe(purposes.length);
  });

  it('uses a canonical tuple without concatenation collisions or normalization', () => {
    const crypto = adapter();
    expect(crypto.hash('request', 'ab', 'c')).not.toBe(crypto.hash('request', 'a', 'bc'));
    expect(crypto.hash('request', 'a:b', 'c')).not.toBe(crypto.hash('request', 'a', 'b:c'));
    expect(crypto.hash('request', tenant, 'é')).not.toBe(crypto.hash('request', tenant, 'e\u0301'));
  });

  it('accepts the exact UTF-8 byte boundary without treating code units as bytes', () => {
    const crypto = adapter();
    expect(crypto.hash('request', 't'.repeat(160), 'é'.repeat(8192))).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.hash('request', 'é'.repeat(80), 'body')).toMatch(/^[a-f0-9]{64}$/);
    genericFailure(() => crypto.hash('request', 't'.repeat(161), 'body'));
    genericFailure(() => crypto.hash('request', 'é'.repeat(81), 'body'));
    genericFailure(() => crypto.hash('request', tenant, 'é'.repeat(8193)));
  });

  it.each(['', 'qr', 'name', 'toString', '__proto__', undefined, null])('refuses unsupported hash purpose %s', purpose => {
    genericFailure(() => adapter().hash(purpose as CustomerHashPurpose, tenant, phone));
  });

  it.each(['', null, undefined, 1, '\ud800', '\udc00'])('refuses invalid hash input %j', value => {
    genericFailure(() => adapter().hash('request', tenant, value as string));
    genericFailure(() => adapter().hash('request', value as string, phone));
  });
});

describe('CustomerIdentityCrypto: authenticated private fields', () => {
  it.each(['phone', 'name'] as const)('round-trips %s with randomized nonce, exact plaintext and canonical envelope', purpose => {
    const crypto = adapter();
    const subject = purpose === 'phone' ? crypto.hash('phone', tenant, phone) : account;
    const clear = purpose === 'phone' ? phone : 'Éléonore 👩🏽‍🍳';
    const sealed = crypto.seal(purpose, tenant, subject, clear);
    const parts = sealed.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1]!, 'base64url')).toHaveLength(12);
    expect(Buffer.from(parts[2]!, 'base64url')).toHaveLength(Buffer.byteLength(clear, 'utf8'));
    expect(Buffer.from(parts[3]!, 'base64url')).toHaveLength(16);
    for (const part of parts.slice(1)) expect(Buffer.from(part, 'base64url').toString('base64url')).toBe(part);
    expect(sealed.includes(clear)).toBe(false);
    expect(adapter().open(purpose, tenant, subject, sealed)).toBe(clear);
    const nonces = new Set(Array.from({ length: 16 }, () => crypto.seal(purpose, tenant, subject, clear).split('.')[1]));
    expect(nonces.size).toBe(16);
  });

  it('binds the ciphertext to the tenant, subject, purpose and master key', () => {
    const crypto = adapter();
    const sealed = crypto.seal('name', tenant, account, 'Amina');
    genericFailure(() => crypto.open('name', tenant + '-other', account, sealed));
    genericFailure(() => crypto.open('name', tenant, challenge, sealed));
    genericFailure(() => crypto.open('phone', tenant, account, sealed));
    genericFailure(() => new CustomerIdentityCrypto(otherKey).open('name', tenant, account, sealed));
  });

  it.each([1, 2, 3])('rejects an altered envelope part %i with the same generic error', index => {
    const crypto = adapter();
    genericFailure(() => crypto.open('name', tenant, account, changedPart(crypto.seal('name', tenant, account, 'Amina'), index)));
  });

  it.each([
    ['absent', undefined], ['object', {}], ['empty', ''], ['unsupported version', 'v2.a.b.c'],
    ['missing fields', 'v1.a.b'], ['extra fields', 'v1.a.b.c.d'], ['oversized', 'x'.repeat(16_385)],
  ])('rejects a malformed ciphertext: %s', (_label, value) => {
    genericFailure(() => adapter().open('name', tenant, account, value as string));
  });

  it('refuses padding, aliases, whitespace and wrong lengths in every encoded field', () => {
    const crypto = adapter();
    const original = crypto.seal('name', tenant, account, 'A');
    for (const index of [1, 2, 3]) {
      for (const replace of ['', '=', 'AA', ' ', '\n']) {
        const parts = original.split('.');
        parts[index] = replace === '' || replace === 'AA' ? replace : parts[index] + replace;
        genericFailure(() => crypto.open('name', tenant, account, parts.join('.')));
      }
    }
    for (const index of [2, 3]) {
      const parts = original.split('.');
      const alias = encodingAlias(parts[index]!, b64url);
      expect(Buffer.from(alias, 'base64url').equals(Buffer.from(parts[index]!, 'base64url'))).toBe(true);
      parts[index] = alias;
      genericFailure(() => crypto.open('name', tenant, account, parts.join('.')));
    }
  });

  it('bounds plaintext by UTF-8 bytes and never replaces an isolated surrogate', () => {
    const crypto = adapter();
    const clear = 'é'.repeat(512);
    expect(crypto.open('name', tenant, account, crypto.seal('name', tenant, account, clear))).toBe(clear);
    for (const value of ['', 'é'.repeat(513), 'x'.repeat(1025), '\ud800', '\udc00', null, undefined]) {
      genericFailure(() => crypto.seal('name', tenant, account, value as string));
    }
  });

  it('rejects malformed context and seal purpose at runtime', () => {
    const crypto = adapter();
    const sealed = crypto.seal('name', tenant, account, 'Amina');
    for (const purpose of ['session', '__proto__', '', null]) {
      genericFailure(() => crypto.seal(purpose as never, tenant, account, 'Amina'));
      genericFailure(() => crypto.open(purpose as never, tenant, account, sealed));
    }
    for (const value of ['', 'x'.repeat(161), '\ud800', null, undefined]) {
      genericFailure(() => crypto.seal('name', value as string, account, 'Amina'));
      genericFailure(() => crypto.open('name', tenant, value as string, sealed));
    }
  });

  it('does not use ambiguous tenant/subject concatenation in AAD', () => {
    const crypto = adapter();
    genericFailure(() => crypto.open('name', 'a', 'b:c', crypto.seal('name', 'a:b', 'c', 'Amina')));
  });

  it.each(['phone', 'name'] as const)('matches native AES-256-GCM in both directions for %s', purpose => {
    const crypto = adapter();
    const subject = purpose === 'phone' ? crypto.hash('phone', tenant, phone) : account;
    const clear = purpose === 'phone' ? phone : '\ufeffÉléonore\u0000e\u0301';
    const aad = Buffer.from(JSON.stringify(['sm.customer-identity.v1', 'sealed', purpose, tenant, subject]));
    const key = Buffer.from(hkdfSync('sha256', keyBytes, 'sm.customer-identity.v1', JSON.stringify(['seal', purpose]), 32));
    const parts = crypto.seal(purpose, tenant, subject, clear).split('.');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'base64url'), { authTagLength: 16 });
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'));
    expect(Buffer.concat([decipher.update(Buffer.from(parts[2]!, 'base64url')), decipher.final()]).toString('utf8')).toBe(clear);

    // An independent native encoder proves open's format and UTF-8 validation.
    const nonce = Buffer.alloc(12, 7); // Fixed only for this isolated native fixture.
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(clear, 'utf8'), cipher.final()]);
    const sealed = ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
    expect(crypto.open(purpose, tenant, subject, sealed)).toBe(clear);
  });

  it('rejects even authenticated non-UTF-8 or oversized cleartext and a key from another purpose', () => {
    const nonce = Buffer.alloc(12, 5);
    const aad = Buffer.from(JSON.stringify(['sm.customer-identity.v1', 'sealed', 'name', tenant, account]));
    for (const [keyPurpose, clear] of [
      ['name', Buffer.from([0xff, 0xfe])],
      ['name', Buffer.alloc(1025, 65)],
      ['phone', Buffer.from('Amina')],
    ] as const) {
      const key = Buffer.from(hkdfSync('sha256', keyBytes, 'sm.customer-identity.v1', JSON.stringify(['seal', keyPurpose]), 32));
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(clear), cipher.final()]);
      const sealed = ['v1', nonce.toString('base64url'), ciphertext.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
      genericFailure(() => adapter().open('name', tenant, account, sealed));
    }
  });
});

describe('CustomerIdentityCrypto: recoverable check-bound session token', () => {
  it('returns the same opaque token across instances for the same four fields', () => {
    const token = adapter().tokenForCheck(tenant, browser, challenge, check);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url').toString('base64url')).toBe(token);
    expect(adapter().tokenForCheck(tenant, browser, challenge, check)).toBe(token);
    expect(new CustomerIdentityCrypto(otherKey).tokenForCheck(tenant, browser, challenge, check)).not.toBe(token);
  });

  it('binds tenant, browser, challenge and check: every new check has a different token', () => {
    const crypto = adapter();
    const reference = crypto.tokenForCheck(tenant, browser, challenge, check);
    expect(crypto.tokenForCheck(tenant + '-other', browser, challenge, check)).not.toBe(reference);
    expect(crypto.tokenForCheck(tenant, Buffer.alloc(32, 7).toString('base64url'), challenge, check)).not.toBe(reference);
    expect(crypto.tokenForCheck(tenant, browser, account, check)).not.toBe(reference);
    expect(crypto.tokenForCheck(tenant, browser, challenge, account)).not.toBe(reference);
    expect(crypto.tokenForCheck(tenant, browser, check, challenge)).not.toBe(reference);
  });

  it('derives its key separately from the session hash key, even for the exact same canonical message', () => {
    const tuple = JSON.stringify(['sm.customer-identity.v1', 'check-session-token', tenant, browser, challenge, check]);
    const hashKey = Buffer.from(hkdfSync('sha256', keyBytes, 'sm.customer-identity.v1', JSON.stringify(['hash', 'session']), 32));
    const wrongPurpose = createHmac('sha256', hashKey).update(tuple).digest('base64url');
    expect(adapter().tokenForCheck(tenant, browser, challenge, check)).not.toBe(wrongPurpose);
    const dedicatedKey = Buffer.from(hkdfSync('sha256', keyBytes, 'sm.customer-identity.v1', JSON.stringify(['derive', 'check-session-token']), 32));
    expect(adapter().tokenForCheck(tenant, browser, challenge, check)).toBe(createHmac('sha256', dedicatedKey).update(tuple).digest('base64url'));
  });

  it.each(['', 'x'.repeat(43), browser + '=', encodingAlias(browser, b64url), null, undefined])('refuses a malformed browser secret %j', value => {
    genericFailure(() => adapter().tokenForCheck(tenant, value as string, challenge, check));
  });

  it.each(['', 'not-an-id', challenge.toUpperCase().replace('20000000', 'AAAAAAAA'), null, undefined])('refuses malformed check identifiers %j', value => {
    genericFailure(() => adapter().tokenForCheck(tenant, browser, value as string, check));
    genericFailure(() => adapter().tokenForCheck(tenant, browser, challenge, value as string));
  });
});
