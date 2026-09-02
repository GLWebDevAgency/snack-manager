import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const AES_256_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const QR_TOKEN_BYTES = 32;
const PROFILE_PAYLOAD_VERSION = 1 as const;
const PROFILE_ALGORITHM = 'A256GCM' as const;

export interface LoyaltyProfile {
  firstName: string | null;
  phone: string | null;
}

export interface LoyaltyProfileScope {
  tenantRef: string;
  memberId: string;
}

/**
 * Enveloppe persistable. Elle ne contient aucune donnée personnelle en clair.
 *
 * `version` versionne le format ; `keyVersion` permet une rotation progressive
 * sans devoir deviner avec quelle clé une ligne historique a été chiffrée.
 */
export interface EncryptedLoyaltyProfileV1 {
  version: typeof PROFILE_PAYLOAD_VERSION;
  keyVersion: number;
  algorithm: typeof PROFILE_ALGORITHM;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export type EncryptedLoyaltyProfile = EncryptedLoyaltyProfileV1;

export interface LoyaltyCryptoConfig {
  /** Clé AES brute de 32 octets, encodée en base64 canonique. */
  encryptionKeyBase64: string;
  /** Index exact téléphone — clé dédiée pour limiter l'impact d'une fuite. */
  phoneLookupKeyBase64: string;
  /** Empreintes d'idempotence — clé distincte du téléphone et du chiffrement. */
  operationFingerprintKeyBase64: string;
  /** Dérivation des QR d'adhésion rejouables — secret dédié, jamais envoyé au client. */
  qrTokenDerivationKeyBase64: string;
  /** Version opérationnelle de la clé AES, strictement positive. */
  encryptionKeyVersion?: number;
}

export interface LoyaltyOperationFingerprintInput {
  tenantRef: string;
  kind: string;
  payload: unknown;
}

export interface LoyaltyEnrollmentQrInput {
  tenantRef: string;
  memberId: string;
  operationId: string;
}

/** Le clair doit uniquement être remis au client ; seul `tokenHash` est stocké. */
export interface IssuedLoyaltyQrToken {
  clearToken: string;
  tokenHash: string;
}

export class LoyaltyCryptoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyCryptoConfigurationError';
  }
}

export class LoyaltyCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoyaltyCryptoError';
  }
}

/**
 * JSON déterministe pour les empreintes d'idempotence.
 *
 * Les clés d'objet sont triées à chaque niveau. Les valeurs qui n'existent pas
 * en JSON sont refusées (ou omises pour une propriété `undefined`, comme le
 * ferait `JSON.stringify`) afin qu'une requête non sérialisable ne reçoive
 * jamais une empreinte trompeuse.
 */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  const visit = (current: unknown, inObjectProperty = false): string | undefined => {
    if (current === null) return 'null';

    switch (typeof current) {
      case 'string':
      case 'boolean':
        return JSON.stringify(current);
      case 'number':
        if (!Number.isFinite(current)) {
          throw new LoyaltyCryptoError('Le JSON canonique refuse les nombres non finis.');
        }
        return JSON.stringify(current);
      case 'undefined':
        if (inObjectProperty) return undefined;
        throw new LoyaltyCryptoError('Le JSON canonique refuse une valeur undefined.');
      case 'bigint':
      case 'function':
      case 'symbol':
        throw new LoyaltyCryptoError(`Le JSON canonique refuse le type ${typeof current}.`);
      case 'object':
        break;
      default:
        throw new LoyaltyCryptoError('Valeur JSON canonique invalide.');
    }

    if (ancestors.has(current)) {
      throw new LoyaltyCryptoError('Le JSON canonique refuse les références circulaires.');
    }
    ancestors.add(current);

    try {
      if (Array.isArray(current)) {
        const items = current.map((item) => {
          const encoded = visit(item);
          if (encoded === undefined) {
            throw new LoyaltyCryptoError('Le JSON canonique refuse undefined dans un tableau.');
          }
          return encoded;
        });
        return `[${items.join(',')}]`;
      }

      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new LoyaltyCryptoError('Le JSON canonique accepte uniquement les objets JSON simples.');
      }
      if (Object.getOwnPropertySymbols(current).length > 0) {
        throw new LoyaltyCryptoError('Le JSON canonique refuse les propriétés Symbol.');
      }

      const entries = Object.entries(current as Record<string, unknown>)
        // Ordre binaire des unités UTF-16 : indépendant de la locale/ICU du
        // serveur, contrairement à `localeCompare`.
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .flatMap(([key, entryValue]) => {
          const encoded = visit(entryValue, true);
          return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`];
        });
      return `{${entries.join(',')}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  const encoded = visit(value);
  if (encoded === undefined) {
    throw new LoyaltyCryptoError('Valeur JSON canonique invalide.');
  }
  return encoded;
}

/**
 * Normalise uniquement les numéros français métropolitains vers E.164.
 *
 * Formes admises : `06…`, `+336…`, `00336…` et leur mise en forme usuelle
 * (espaces, points, tirets ou parenthèses). Le préfixe national optionnel de la
 * notation courante `+33 (0)6…` est également retiré. Les extensions et les
 * numéros d'un autre pays sont refusés plutôt que devinés.
 */
export function normalizeFrenchPhoneToE164(rawPhone: string): string {
  if (typeof rawPhone !== 'string' || rawPhone.trim().length === 0) {
    throw new LoyaltyCryptoError('Le numéro de téléphone français est requis.');
  }
  if (!/^[+0-9\s().-]+$/.test(rawPhone)) {
    throw new LoyaltyCryptoError('Le numéro de téléphone français contient un caractère invalide.');
  }

  let compact = rawPhone.trim().replace(/[\s().-]/g, '');
  if (/^00330[1-9]\d{8}$/.test(compact)) compact = `+33${compact.slice(5)}`;
  else if (/^0033[1-9]\d{8}$/.test(compact)) compact = `+${compact.slice(2)}`;
  else if (/^\+330[1-9]\d{8}$/.test(compact)) compact = `+33${compact.slice(4)}`;
  else if (/^0[1-9]\d{8}$/.test(compact)) compact = `+33${compact.slice(1)}`;

  if (!/^\+33[1-9]\d{8}$/.test(compact)) {
    throw new LoyaltyCryptoError(
      'Le numéro doit être un numéro français valide au format 0XXXXXXXXX ou +33XXXXXXXXX.',
    );
  }
  return compact;
}

/**
 * Génère 256 bits par le CSPRNG de Node. Le clair n'est volontairement jamais
 * conservé dans l'adaptateur : l'appelant le remet une fois au client et ne
 * persiste que l'empreinte SHA-256.
 */
export function issueLoyaltyQrToken(): IssuedLoyaltyQrToken {
  const clearToken = randomBytes(QR_TOKEN_BYTES).toString('base64url');
  return { clearToken, tokenHash: hashLoyaltyQrToken(clearToken) };
}

export function hashLoyaltyQrToken(clearToken: string): string {
  decodeCanonicalBase64Url(clearToken, 'jeton QR', QR_TOKEN_BYTES);
  return createHash('sha256').update(clearToken, 'utf8').digest('hex');
}

export class LoyaltyCryptoAdapter {
  private readonly encryptionKey: Buffer;
  private readonly phoneLookupKey: Buffer;
  private readonly operationFingerprintKey: Buffer;
  private readonly qrTokenDerivationKey: Buffer;
  private readonly encryptionKeyVersion: number;

  constructor(config: LoyaltyCryptoConfig) {
    this.encryptionKey = decodeCanonicalBase64Key(
      config.encryptionKeyBase64,
      'clé de chiffrement fidélité',
    );
    this.phoneLookupKey = decodeCanonicalBase64Key(
      config.phoneLookupKeyBase64,
      'clé HMAC de recherche téléphone fidélité',
    );
    this.operationFingerprintKey = decodeCanonicalBase64Key(
      config.operationFingerprintKeyBase64,
      "clé HMAC d'idempotence fidélité",
    );
    this.qrTokenDerivationKey = decodeCanonicalBase64Key(
      config.qrTokenDerivationKeyBase64,
      'clé de dérivation des QR fidélité',
    );

    const keys = [
      this.encryptionKey,
      this.phoneLookupKey,
      this.operationFingerprintKey,
      this.qrTokenDerivationKey,
    ];
    for (let left = 0; left < keys.length; left += 1) {
      for (let right = left + 1; right < keys.length; right += 1) {
        if (timingSafeEqual(keys[left]!, keys[right]!)) {
          throw new LoyaltyCryptoConfigurationError(
            'Les quatre clés fidélité (profil, téléphone, idempotence, QR) doivent être distinctes.',
          );
        }
      }
    }

    const keyVersion = config.encryptionKeyVersion ?? 1;
    if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
      throw new LoyaltyCryptoConfigurationError(
        'La version de clé de chiffrement fidélité doit être un entier strictement positif.',
      );
    }
    this.encryptionKeyVersion = keyVersion;
  }

  encryptProfile(scope: LoyaltyProfileScope, profile: LoyaltyProfile): EncryptedLoyaltyProfile {
    assertScope(scope);
    const normalizedProfile = validateAndNormalizeProfile(profile);
    const plaintext = Buffer.from(canonicalJson(normalizedProfile), 'utf8');
    const iv = randomBytes(AES_GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    cipher.setAAD(profileAad(scope, this.encryptionKeyVersion), {
      plaintextLength: plaintext.length,
    });

    try {
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return {
        version: PROFILE_PAYLOAD_VERSION,
        keyVersion: this.encryptionKeyVersion,
        algorithm: PROFILE_ALGORITHM,
        iv: iv.toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        authTag: authTag.toString('base64url'),
      };
    } finally {
      plaintext.fill(0);
    }
  }

  decryptProfile(scope: LoyaltyProfileScope, payload: EncryptedLoyaltyProfile): LoyaltyProfile {
    assertScope(scope);
    assertEncryptedProfilePayload(payload);
    if (payload.keyVersion !== this.encryptionKeyVersion) {
      throw new LoyaltyCryptoError(
        `Version de clé fidélité indisponible : ${payload.keyVersion}.`,
      );
    }

    const iv = decodeCanonicalBase64Url(payload.iv, 'IV du profil fidélité', AES_GCM_IV_BYTES);
    const ciphertext = decodeCanonicalBase64Url(
      payload.ciphertext,
      'profil fidélité chiffré',
    );
    const authTag = decodeCanonicalBase64Url(
      payload.authTag,
      "tag d'authentification du profil fidélité",
      AES_GCM_TAG_BYTES,
    );
    if (ciphertext.length === 0) {
      throw new LoyaltyCryptoError('Le profil fidélité chiffré est vide.');
    }

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv, {
      authTagLength: AES_GCM_TAG_BYTES,
    });
    decipher.setAAD(profileAad(scope, payload.keyVersion));
    decipher.setAuthTag(authTag);

    let plaintext: Buffer | undefined;
    try {
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const decoded: unknown = JSON.parse(plaintext.toString('utf8'));
      return validateDecryptedProfile(decoded);
    } catch (_error: unknown) {
      throw new LoyaltyCryptoError(
        "Le profil fidélité ne peut pas être authentifié ou déchiffré dans ce contexte.",
      );
    } finally {
      plaintext?.fill(0);
    }
  }

  /** Index exact, non réversible, normalisé et séparé par restaurant. */
  phoneLookupHash(tenantRef: string, phone: string): string {
    assertNonEmpty(tenantRef, 'tenantRef');
    const normalizedPhone = normalizeFrenchPhoneToE164(phone);
    return this.hmacHex(this.phoneLookupKey, {
      purpose: 'loyalty-phone-lookup-v1',
      tenantRef,
      phone: normalizedPhone,
    });
  }

  /**
   * Empreinte du corps canonique, du type d'opération et du tenant. Une même
   * clé d'idempotence accompagnée d'un autre corps produit donc un conflit.
   */
  operationFingerprint(input: LoyaltyOperationFingerprintInput): string {
    assertNonEmpty(input.tenantRef, 'tenantRef');
    assertNonEmpty(input.kind, "type d'opération fidélité");
    return this.hmacHex(this.operationFingerprintKey, {
      purpose: 'loyalty-operation-fingerprint-v1',
      tenantRef: input.tenantRef,
      kind: input.kind,
      payload: input.payload,
    });
  }

  /**
   * Dérive le QR d'une adhésion depuis des identifiants opaques et un secret
   * dédié. Le même operationId rend donc exactement le même jeton sans que son
   * clair apparaisse dans PostgreSQL, les logs ou l'inbox d'idempotence.
   */
  deriveEnrollmentQrToken(input: LoyaltyEnrollmentQrInput): IssuedLoyaltyQrToken {
    assertNonEmpty(input.tenantRef, 'tenantRef');
    assertNonEmpty(input.memberId, 'memberId');
    assertNonEmpty(input.operationId, 'operationId');
    const clearToken = createHmac('sha256', this.qrTokenDerivationKey)
      .update(
        canonicalJson({
          purpose: 'loyalty-enrollment-qr-v1',
          tenantRef: input.tenantRef,
          memberId: input.memberId,
          operationId: input.operationId,
        }),
        'utf8',
      )
      .digest('base64url');
    return { clearToken, tokenHash: hashLoyaltyQrToken(clearToken) };
  }

  private hmacHex(key: Buffer, value: unknown): string {
    return createHmac('sha256', key).update(canonicalJson(value), 'utf8').digest('hex');
  }
}

function validateAndNormalizeProfile(profile: LoyaltyProfile): LoyaltyProfile {
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new LoyaltyCryptoError('Le profil fidélité est invalide.');
  }
  if (profile.firstName !== null && typeof profile.firstName !== 'string') {
    throw new LoyaltyCryptoError('Le prénom fidélité doit être une chaîne ou null.');
  }
  if (profile.phone !== null && typeof profile.phone !== 'string') {
    throw new LoyaltyCryptoError('Le téléphone fidélité doit être une chaîne ou null.');
  }
  return {
    firstName: profile.firstName,
    phone: profile.phone === null ? null : normalizeFrenchPhoneToE164(profile.phone),
  };
}

function validateDecryptedProfile(value: unknown): LoyaltyProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LoyaltyCryptoError('Le profil fidélité déchiffré est invalide.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'firstName' || keys[1] !== 'phone') {
    throw new LoyaltyCryptoError('Le profil fidélité déchiffré a une structure inconnue.');
  }
  if (record.firstName !== null && typeof record.firstName !== 'string') {
    throw new LoyaltyCryptoError('Le prénom fidélité déchiffré est invalide.');
  }
  if (record.phone !== null && typeof record.phone !== 'string') {
    throw new LoyaltyCryptoError('Le téléphone fidélité déchiffré est invalide.');
  }
  if (
    typeof record.phone === 'string' &&
    normalizeFrenchPhoneToE164(record.phone) !== record.phone
  ) {
    throw new LoyaltyCryptoError("Le téléphone fidélité déchiffré n'est pas canonique.");
  }
  return { firstName: record.firstName, phone: record.phone } as LoyaltyProfile;
}

function profileAad(scope: LoyaltyProfileScope, keyVersion: number): Buffer {
  return Buffer.from(
    canonicalJson({
      purpose: 'loyalty-profile-v1',
      version: PROFILE_PAYLOAD_VERSION,
      keyVersion,
      tenantRef: scope.tenantRef,
      memberId: scope.memberId,
    }),
    'utf8',
  );
}

function assertScope(scope: LoyaltyProfileScope): void {
  if (scope === null || typeof scope !== 'object') {
    throw new LoyaltyCryptoError('Le contexte du profil fidélité est invalide.');
  }
  assertNonEmpty(scope.tenantRef, 'tenantRef');
  assertNonEmpty(scope.memberId, 'memberId');
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw new LoyaltyCryptoError(`${label} doit être une chaîne non vide et sans espaces externes.`);
  }
}

function assertEncryptedProfilePayload(
  payload: EncryptedLoyaltyProfile,
): asserts payload is EncryptedLoyaltyProfileV1 {
  if (payload === null || typeof payload !== 'object') {
    throw new LoyaltyCryptoError('Le payload chiffré fidélité est invalide.');
  }
  if (payload.version !== PROFILE_PAYLOAD_VERSION || payload.algorithm !== PROFILE_ALGORITHM) {
    throw new LoyaltyCryptoError('La version du payload chiffré fidélité est incompatible.');
  }
  if (!Number.isSafeInteger(payload.keyVersion) || payload.keyVersion <= 0) {
    throw new LoyaltyCryptoError('La version de clé du profil fidélité est invalide.');
  }
  if (
    typeof payload.iv !== 'string' ||
    typeof payload.ciphertext !== 'string' ||
    typeof payload.authTag !== 'string'
  ) {
    throw new LoyaltyCryptoError('Le payload chiffré fidélité est incomplet.');
  }
}

function decodeCanonicalBase64Key(value: string, label: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) {
    throw new LoyaltyCryptoConfigurationError(
      `${label} doit contenir exactement 32 octets en base64 canonique.`,
    );
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== AES_256_KEY_BYTES || decoded.toString('base64') !== value) {
    throw new LoyaltyCryptoConfigurationError(
      `${label} doit contenir exactement 32 octets en base64 canonique.`,
    );
  }
  return Buffer.from(decoded);
}

function decodeCanonicalBase64Url(value: string, label: string, expectedBytes?: number): Buffer {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new LoyaltyCryptoError(`${label} n'est pas un base64url canonique.`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.toString('base64url') !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    throw new LoyaltyCryptoError(`${label} n'a pas la longueur ou l'encodage attendu.`);
  }
  return decoded;
}
