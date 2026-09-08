import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerIdentityCrypto } from './crypto';
import { canonicalRecoveryCode, createRecoveryCode, recoveryCodeHash, CustomerRecoveryCodeError } from './recovery-code';

const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const crypto = new CustomerIdentityCrypto(key.toString('base64'));
const scope = { parentRef: 'parent-fixture', tenantRef: 'tenant-fixture' };
const code = 'SM1-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
const canonical = 'SM10123456789ABCDEF0123456789ABCDEF';

describe('saved recovery code primitives — not an authentication grant', () => {
  it('generates versioned 128-bit codes from the operating-system CSPRNG', () => {
    const values = Array.from({ length: 64 }, () => createRecoveryCode());
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^SM1(?:-[A-F0-9]{4}){8}$/);
      expect(canonicalRecoveryCode(value)).toHaveLength(35);
      expect(Buffer.from(canonicalRecoveryCode(value).slice(3), 'hex')).toHaveLength(16);
    }
  });

  it.each([code, code.toLowerCase(), canonical, `\t${code}\r\n`, code.replaceAll('-', ' ')])(
    'accepts only the documented ASCII presentation aliases', value => {
      expect(canonicalRecoveryCode(value)).toBe(canonical);
      expect(recoveryCodeHash(crypto, scope, value)).toBe(recoveryCodeHash(crypto, scope, code));
    });

  it.each([undefined, null, 1, {}, '', '123456', code.slice(1), code + '0', code.slice(0, -1),
    code.replace('SM1', 'SM2'), code.replace('0', 'O'), code.replace('1-', 'I-'),
    code.replace('-', '\u2011'), code.replace('-', '\u00a0'), '\u202e' + code,
    'x'.repeat(129), ' '.repeat(129) + code, '\ud800' + code])(
    'refuses malformed, ambiguous, unsupported or oversized inputs without echo', raw => {
      expect(() => canonicalRecoveryCode(raw)).toThrow(CustomerRecoveryCodeError);
      try { recoveryCodeHash(crypto, scope, raw); } catch (error) {
        expect(error).toBeInstanceOf(CustomerRecoveryCodeError);
        expect((error as Error).message).toBe('Code de secours invalide.');
        expect('cause' in (error as Error)).toBe(false);
        expect(JSON.stringify(error) + (error as Error).stack).not.toContain(code);
      }
    });

  it('uses its own versioned HKDF purpose and binds both server-owned scopes', () => {
    const hash = recoveryCodeHash(crypto, scope, code);
    const hashKey = hkdfSync('sha256', key, 'sm.customer-identity.v1', JSON.stringify(['hash', 'recovery-code']), 32);
    const value = JSON.stringify(['saved-recovery-code.v1', scope.parentRef, canonical]);
    const expected = createHmac('sha256', Buffer.from(hashKey))
      .update(JSON.stringify(['sm.customer-identity.v1', 'hash', 'recovery-code', scope.tenantRef, value])).digest('hex');
    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(canonical);
    expect(recoveryCodeHash(crypto, { ...scope, parentRef: 'other-parent' }, code)).not.toBe(hash);
    expect(recoveryCodeHash(crypto, { ...scope, tenantRef: 'other-tenant' }, code)).not.toBe(hash);
    expect(recoveryCodeHash(new CustomerIdentityCrypto(Buffer.alloc(32, 9).toString('base64')), scope, code)).not.toBe(hash);
    expect(crypto.hash('request', scope.tenantRef, value)).not.toBe(hash);
  });

  it.each([
    { ...scope, parentRef: '' }, { ...scope, tenantRef: '' }, { ...scope, parentRef: 'a:b' },
    { ...scope, tenantRef: 't'.repeat(161) }, { ...scope, parentRef: undefined }, null,
  ])('does not normalize or accept an invalid server scope', value => {
    expect(() => recoveryCodeHash(crypto, value as typeof scope, code)).toThrow(CustomerRecoveryCodeError);
  });

  it('does not implement consumption, storage, logging, OTP or session issuance', () => {
    const first = recoveryCodeHash(crypto, scope, code);
    expect(recoveryCodeHash(crypto, scope, code)).toBe(first);
    // Repeated digest calls are deliberately inert. A database transaction must
    // later consume one exact code version together with its session receipt.
  });
});
