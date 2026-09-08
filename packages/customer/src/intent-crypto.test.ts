import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerIdentityCrypto, CustomerIdentityCryptoError } from './crypto';

describe('intent recovery tokens', () => {
  it('binds both private credentials and each public selector without a legacy fallback', () => {
    const crypto = new CustomerIdentityCrypto(randomBytes(32).toString('base64'));
    const values = ['tenant', randomBytes(32).toString('base64url'), randomUUID(),
      randomBytes(32).toString('base64url'), randomUUID(), randomUUID()] as const;
    const token = crypto.tokenForIntentCheck(...values);
    expect(/^[A-Za-z0-9_-]{43}$/.test(token)).toBe(true);
    expect(crypto.tokenForIntentCheck(...values) === token).toBe(true);
    for (let index = 0; index < values.length; index++) {
      const changed = [...values] as [string, string, string, string, string, string];
      changed[index] = index === 0 ? 'another' : [1, 3].includes(index) ? randomBytes(32).toString('base64url') : randomUUID();
      expect(crypto.tokenForIntentCheck(...changed) === token).toBe(false);
    }
    expect(crypto.tokenForCheck(values[0], values[1], values[4], values[5]) === token).toBe(false);
    expect(crypto.hash('intent-proof', 'tenant', values[3]) === crypto.hash('browser', 'tenant', values[3])).toBe(false);
  });
  it('refuses malformed private proof without including it in an error', () => {
    const crypto = new CustomerIdentityCrypto(randomBytes(32).toString('base64'));
    const marker = 'synthetic-invalid-proof';
    try { crypto.tokenForIntentCheck('tenant', randomBytes(32).toString('base64url'), randomUUID(), marker, randomUUID(), randomUUID());
      expect.fail('must refuse');
    } catch (error) { expect(error).toBeInstanceOf(CustomerIdentityCryptoError); expect(String(error).includes(marker)).toBe(false); }
  });
});
