import { describe, expect, it } from 'vitest';
import {
  LoyaltyCryptoAdapter,
  LoyaltyCryptoConfigurationError,
  canonicalJson,
  hashLoyaltyQrToken,
  issueLoyaltyQrToken,
  normalizeFrenchPhoneToE164,
  type EncryptedLoyaltyProfile,
} from './crypto';

const ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
  'base64',
);
const PHONE_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => 255 - index)).toString(
  'base64',
);
const OPERATION_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 7 + 13) % 256),
).toString('base64');
const QR_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, index) => (index * 11 + 29) % 256),
).toString('base64');

function adapter(overrides: Partial<ConstructorParameters<typeof LoyaltyCryptoAdapter>[0]> = {}) {
  return new LoyaltyCryptoAdapter({
    encryptionKeyBase64: ENCRYPTION_KEY,
    phoneLookupKeyBase64: PHONE_KEY,
    operationFingerprintKeyBase64: OPERATION_KEY,
    qrTokenDerivationKeyBase64: QR_KEY,
    ...overrides,
  });
}

const SCOPE = { tenantRef: 'tenant-classfood', memberId: 'member-42' } as const;

function tamperBase64Url(value: string): string {
  const replacement = value[0] === 'A' ? 'B' : 'A';
  return `${replacement}${value.slice(1)}`;
}

describe('LoyaltyCryptoAdapter — profils PII', () => {
  it('chiffre, normalise puis déchiffre un profil sans exposer le clair', () => {
    const crypto = adapter({ encryptionKeyVersion: 3 });
    const encrypted = crypto.encryptProfile(SCOPE, {
      firstName: 'Mina',
      phone: '06 12 34 56 78',
    });

    expect(encrypted).toMatchObject({ version: 1, keyVersion: 3, algorithm: 'A256GCM' });
    expect(JSON.stringify(encrypted)).not.toContain('Mina');
    expect(JSON.stringify(encrypted)).not.toContain('0612345678');
    expect(JSON.stringify(encrypted)).not.toContain('+33612345678');
    expect(crypto.decryptProfile(SCOPE, encrypted)).toEqual({
      firstName: 'Mina',
      phone: '+33612345678',
    });
  });

  it('utilise un IV aléatoire pour deux chiffrements du même profil', () => {
    const crypto = adapter();
    const profile = { firstName: 'Nora', phone: null };

    const first = crypto.encryptProfile(SCOPE, profile);
    const second = crypto.encryptProfile(SCOPE, profile);

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(crypto.decryptProfile(SCOPE, first)).toEqual(profile);
    expect(crypto.decryptProfile(SCOPE, second)).toEqual(profile);
  });

  it('refuse toute altération du chiffré ou du tag', () => {
    const crypto = adapter();
    const encrypted = crypto.encryptProfile(SCOPE, { firstName: 'Ali', phone: null });
    const alteredCiphertext: EncryptedLoyaltyProfile = {
      ...encrypted,
      ciphertext: tamperBase64Url(encrypted.ciphertext),
    };
    const alteredTag: EncryptedLoyaltyProfile = {
      ...encrypted,
      authTag: tamperBase64Url(encrypted.authTag),
    };

    expect(() => crypto.decryptProfile(SCOPE, alteredCiphertext)).toThrow();
    expect(() => crypto.decryptProfile(SCOPE, alteredTag)).toThrow();
  });

  it("lie le chiffré au tenant et au membre grâce à l'AAD", () => {
    const crypto = adapter();
    const encrypted = crypto.encryptProfile(SCOPE, { firstName: null, phone: null });

    expect(() =>
      crypto.decryptProfile({ ...SCOPE, tenantRef: 'tenant-rival' }, encrypted),
    ).toThrow();
    expect(() =>
      crypto.decryptProfile({ ...SCOPE, memberId: 'member-else' }, encrypted),
    ).toThrow();
  });
});

describe('LoyaltyCryptoAdapter — index et idempotence', () => {
  it('normalise explicitement les formats français usuels', () => {
    expect(normalizeFrenchPhoneToE164('06 12 34 56 78')).toBe('+33612345678');
    expect(normalizeFrenchPhoneToE164('+33 (0)6.12.34.56.78')).toBe('+33612345678');
    expect(normalizeFrenchPhoneToE164('0033 6 12 34 56 78')).toBe('+33612345678');
    expect(() => normalizeFrenchPhoneToE164('+32 470 12 34 56')).toThrow();
    expect(() => normalizeFrenchPhoneToE164('06 12 34 56 78 poste 2')).toThrow();
  });

  it('produit un index téléphone exact, déterministe et tenant-scopé', () => {
    const crypto = adapter();
    const first = crypto.phoneLookupHash('tenant-a', '06 12 34 56 78');

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.phoneLookupHash('tenant-a', '+33612345678')).toBe(first);
    expect(crypto.phoneLookupHash('tenant-b', '+33612345678')).not.toBe(first);
    expect(crypto.phoneLookupHash('tenant-a', '+33612345679')).not.toBe(first);
  });

  it("inclut tenant, kind et JSON canonique dans l'empreinte d'opération", () => {
    const crypto = adapter();
    const first = crypto.operationFingerprint({
      tenantRef: 'tenant-a',
      kind: 'earn',
      payload: { purchaseCents: 1_250, nested: { z: true, a: [2, 1] } },
    });
    const reordered = crypto.operationFingerprint({
      tenantRef: 'tenant-a',
      kind: 'earn',
      payload: { nested: { a: [2, 1], z: true }, purchaseCents: 1_250 },
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(
      crypto.operationFingerprint({
        tenantRef: 'tenant-a',
        kind: 'redeem',
        payload: { nested: { a: [2, 1], z: true }, purchaseCents: 1_250 },
      }),
    ).not.toBe(first);
    expect(
      crypto.operationFingerprint({
        tenantRef: 'tenant-b',
        kind: 'earn',
        payload: { nested: { a: [2, 1], z: true }, purchaseCents: 1_250 },
      }),
    ).not.toBe(first);
  });

  it('canonise récursivement les objets sans réordonner les tableaux', () => {
    expect(canonicalJson({ z: 1, nested: { y: true, a: 'x' }, list: [3, 2, 1] })).toBe(
      '{"list":[3,2,1],"nested":{"a":"x","y":true},"z":1}',
    );
    expect(canonicalJson({ defined: true, absent: undefined })).toBe('{"defined":true}');
  });
});

describe('LoyaltyCryptoAdapter — configuration et jetons', () => {
  it('refuse les clés non canoniques, trop courtes ou identiques', () => {
    expect(() =>
      adapter({ encryptionKeyBase64: Buffer.alloc(31).toString('base64') }),
    ).toThrow(LoyaltyCryptoConfigurationError);
    expect(() => adapter({ phoneLookupKeyBase64: `${PHONE_KEY}\n` })).toThrow(
      LoyaltyCryptoConfigurationError,
    );
    expect(() => adapter({ phoneLookupKeyBase64: ENCRYPTION_KEY })).toThrow(
      LoyaltyCryptoConfigurationError,
    );
    expect(() => adapter({ operationFingerprintKeyBase64: PHONE_KEY })).toThrow(
      LoyaltyCryptoConfigurationError,
    );
    expect(() => adapter({ qrTokenDerivationKeyBase64: OPERATION_KEY })).toThrow(
      LoyaltyCryptoConfigurationError,
    );
  });

  it('émet un jeton QR de 256 bits et uniquement son SHA-256 stockable', () => {
    const first = issueLoyaltyQrToken();
    const second = issueLoyaltyQrToken();

    expect(first.clearToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.clearToken).not.toBe(second.clearToken);
    expect(first.tokenHash).not.toBe(second.tokenHash);
    expect(hashLoyaltyQrToken(first.clearToken)).toBe(first.tokenHash);
    expect(first.tokenHash).not.toContain(first.clearToken);
    expect(() => hashLoyaltyQrToken('token-trop-faible')).toThrow();
  });

  it("dérive le même QR d'adhésion au replay, isolé par tenant et opération", () => {
    const crypto = adapter();
    const input = {
      tenantRef: 'tenant-a',
      memberId: '11111111-1111-4111-8111-111111111111',
      operationId: '22222222-2222-4222-8222-222222222222',
    };
    const first = crypto.deriveEnrollmentQrToken(input);
    const replay = crypto.deriveEnrollmentQrToken(input);

    expect(replay).toEqual(first);
    expect(first.clearToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.tokenHash).toBe(hashLoyaltyQrToken(first.clearToken));
    expect(
      crypto.deriveEnrollmentQrToken({ ...input, tenantRef: 'tenant-b' }).clearToken,
    ).not.toBe(first.clearToken);
    expect(
      crypto.deriveEnrollmentQrToken({
        ...input,
        operationId: '33333333-3333-4333-8333-333333333333',
      }).clearToken,
    ).not.toBe(first.clearToken);
  });
});
