import { createHmac, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerIdentityCrypto, CustomerIdentityCryptoError } from './crypto';

describe('protected publication token', () => {
  const master = randomBytes(32); const secret = randomBytes(32).toString('base64url');
  const proof = randomBytes(32).toString('base64url'); const operation = randomUUID(); const attempt = randomUUID();
  const crypto = new CustomerIdentityCrypto(master.toString('base64'));
  it('is deterministic, interoperable and purpose separated from phone receipts', () => {
    const token = crypto.tokenForProtectedPublication('tenant', secret, operation, proof, 'passkey', attempt);
    const key = hkdfSync('sha256', master, 'sm.customer-identity.v1', JSON.stringify(['derive', 'protected-publication-token']), 32);
    expect(token).toBe(createHmac('sha256', Buffer.from(key)).update(JSON.stringify([
      'sm.customer-identity.v1', 'protected-publication-token', 'tenant', secret, operation, proof, 'passkey', attempt,
    ])).digest('base64url'));
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toBe(crypto.tokenForIntentCheck('tenant', secret, operation, proof, operation, attempt));
    expect(token).not.toBe(crypto.tokenForProtectedPublication('tenant', secret, operation, proof, 'recovery', attempt));
    for (let index = 0; index < 5; index++) {
      const values = ['tenant', secret, operation, proof, attempt];
      values[index] = index === 0 ? 'other' : index === 1 || index === 3 ? randomBytes(32).toString('base64url') : randomUUID();
      expect(token).not.toBe(crypto.tokenForProtectedPublication(values[0]!, values[1]!, values[2]!, values[3]!, 'passkey', values[4]!));
    }
  });
  it.each(['phone', '', null, 'PASSKEY'])('refuses invalid method without reflecting private inputs', method => {
    let caught: unknown;
    try { crypto.tokenForProtectedPublication('tenant', secret, operation, proof, method as 'passkey', attempt); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(CustomerIdentityCryptoError);
    expect([secret, proof, master.toString('base64')].some(value => JSON.stringify(caught).includes(value))).toBe(false);
  });
  it('rejects malformed UUIDs and noncanonical secrets', () => {
    expect(() => crypto.tokenForProtectedPublication('tenant', secret + '=', operation, proof, 'passkey', attempt)).toThrow(CustomerIdentityCryptoError);
    expect(() => crypto.tokenForProtectedPublication('tenant', secret, operation, proof, 'passkey', 'not-uuid')).toThrow(CustomerIdentityCryptoError);
  });
});
