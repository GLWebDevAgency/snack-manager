import { describe, expect, it } from 'vitest';
import { createDeliveryHandoffCrypto, type DeliveryProofContext } from './delivery-handoff.crypto';

const secret = Buffer.alloc(32, 7).toString('base64url'); // invented local key, never a provider credential
const context: DeliveryProofContext = { tenantId: 'a'.repeat(24), orderId: 'b'.repeat(24),
  proofId: '11111111-1111-4111-8111-111111111111', expiresAt: '2026-09-08T12:00:00.000Z' };
describe('encrypted customer delivery proof', () => {
  it('can redisplay the same PIN/QR without plaintext at rest', () => {
    const crypto = createDeliveryHandoffCrypto(secret);
    const { sealed } = crypto.create(context);
    const opened = crypto.open(context, sealed);
    expect(opened.pin).toMatch(/^\d{6}$/);
    expect(opened.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sealed).not.toContain(opened.pin);
    expect(sealed).not.toContain(opened.qrToken);
    expect(createDeliveryHandoffCrypto(secret).open(context, sealed)).toEqual(opened);
    expect(crypto.matches(context, sealed, { kind: 'pin', value: opened.pin })).toBe(true);
    expect(crypto.matches(context, sealed, { kind: 'pin', value: String((Number(opened.pin) + 1) % 1_000_000).padStart(6, '0') })).toBe(false);
    expect(crypto.matches(context, sealed, { kind: 'qr', value: `sm-handoff:v1:${context.orderId}:${context.proofId}:${opened.qrToken}` })).toBe(true);
    expect(crypto.matches(context, sealed, { kind: 'qr', value: `sm-handoff:v1:${'c'.repeat(24)}:${context.proofId}:${opened.qrToken}` })).toBe(false);
  });
  it('randomizes independent proofs and encryption nonces', () => {
    const crypto = createDeliveryHandoffCrypto(secret);
    const first = crypto.create(context).sealed;
    const second = crypto.create(context).sealed;
    expect(first).not.toBe(second);
    expect(first.split('.')[1]).not.toBe(second.split('.')[1]);
    expect(crypto.open(context, first).qrToken).not.toBe(crypto.open(context, second).qrToken);
  });
  it.each([
    { tenantId: 'c'.repeat(24) }, { orderId: 'c'.repeat(24) },
    { proofId: '22222222-2222-4222-8222-222222222222' }, { expiresAt: '2026-09-09T12:00:00.000Z' },
  ])('rejects swapping encrypted proof across context %j', patch => {
    const crypto = createDeliveryHandoffCrypto(secret);
    expect(() => crypto.open({ ...context, ...patch }, crypto.create(context).sealed)).toThrow('Delivery handoff proof unavailable');
  });
  it('authenticates ciphertext, nonce and tag before using plaintext', () => {
    const crypto = createDeliveryHandoffCrypto(secret);
    const { sealed } = crypto.create(context);
    for (const index of [1, 2, 3]) {
      const chunks = sealed.split('.');
      const chunk = chunks[index]!;
      chunks[index] = (chunk[0] === 'A' ? 'B' : 'A') + chunk.slice(1);
      expect(() => crypto.open(context, chunks.join('.'))).toThrow('Delivery handoff proof unavailable');
    }
    for (const value of ['v2.' + sealed, sealed + '.', '', 'x'.repeat(513)]) {
      expect(() => crypto.open(context, value)).toThrow('Delivery handoff proof unavailable');
    }
  });
  it('wrong/rotated key fails closed without returning any secret', () => {
    const crypto = createDeliveryHandoffCrypto(secret);
    const sealed = crypto.create(context).sealed;
    expect(() => createDeliveryHandoffCrypto(Buffer.alloc(32, 8).toString('base64url')).open(context, sealed)).toThrow('Delivery handoff proof unavailable');
  });
  it.each(['', 'short', secret + '=', 'a'.repeat(43), 'a'.repeat(44)])('rejects non-canonical or wrong-size dedicated key', value => {
    expect(() => createDeliveryHandoffCrypto(value)).toThrow('Delivery handoff proof unavailable');
  });
  it('binds submission fingerprints to a secret key and full canonical caller envelope', () => {
    const crypto = createDeliveryHandoffCrypto(secret);
    const value = ['order', 'actor', 'op', 'handoff', '000001'];
    expect(crypto.fingerprint(value)).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.fingerprint(value)).toBe(crypto.fingerprint([...value]));
    expect(crypto.fingerprint(value)).not.toBe(crypto.fingerprint([...value.slice(0, 4), '000002']));
    expect(crypto.fingerprint(value)).not.toBe(createDeliveryHandoffCrypto(Buffer.alloc(32, 8).toString('base64url')).fingerprint(value));
  });
});
