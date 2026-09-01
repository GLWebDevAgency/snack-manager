import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeployedRuntime } from './deployed-runtime';

const RELAY_CLIENT_HEADER = 'x-sm-relay-client';
const RELAY_AT_HEADER = 'x-sm-relay-at';
const RELAY_PROOF_HEADER = 'x-sm-relay-proof';
const RELAY_PROOF_VERSION = 'v2';
const MAX_RELAY_CLOCK_SKEW_SECONDS = 90;
const BASE64URL_SHA256 = /^[A-Za-z0-9_-]{43}$/;

type RelayRequest = {
  headers?: Record<string, unknown>;
};

type VerificationOptions = {
  nowMs?: number;
  secret?: Uint8Array | null;
};

/**
 * Identité visiteur attestée par le relais Next.
 *
 * Le navigateur ne peut pas poser cette preuve : elle est signée serveur à
 * serveur avec une clé commune. L'API retrouve ainsi le visiteur réel au lieu
 * de limiter l'adresse de sortie unique de Next. La preuve est aussi liée à
 * la carte demandée : sa capture ne permet pas d'essayer d'autres QR.
 */
export function verifiedPublicRelayClient(
  request: RelayRequest,
  tenantSlug: string,
  qrToken: string,
  options: VerificationOptions = {},
): string | null {
  const client = singleHeader(request.headers?.[RELAY_CLIENT_HEADER]);
  const atRaw = singleHeader(request.headers?.[RELAY_AT_HEADER]);
  const proof = singleHeader(request.headers?.[RELAY_PROOF_HEADER]);
  if (!client || !atRaw || !proof) return null;
  if (!BASE64URL_SHA256.test(client) || !BASE64URL_SHA256.test(proof)) return null;
  if (!/^\d{10}$/.test(atRaw)) return null;

  const at = Number(atRaw);
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1_000);
  if (!Number.isSafeInteger(at) || Math.abs(nowSeconds - at) > MAX_RELAY_CLOCK_SKEW_SECONDS) {
    return null;
  }

  const secret = options.secret === undefined ? relaySecretFromEnv() : options.secret;
  if (!secret || secret.byteLength !== 32) return null;
  const expected = createHmac('sha256', secret)
    .update(relayProofPayload(atRaw, tenantSlug, client, qrToken))
    .digest('base64url');
  const receivedBytes = Buffer.from(proof, 'ascii');
  const expectedBytes = Buffer.from(expected, 'ascii');
  if (
    receivedBytes.byteLength !== expectedBytes.byteLength ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }
  return `relay:${client}`;
}

export function relayProofPayload(
  at: string,
  tenantSlug: string,
  client: string,
  qrToken: string,
): string {
  const requestBinding = createHash('sha256')
    .update(`POST\0/public/loyalty/card\0${qrToken}`)
    .digest('base64url');
  return [RELAY_PROOF_VERSION, at, tenantSlug, client, requestBinding].join('\0');
}

/**
 * Une preuve partielle compte comme une preuve invalide, jamais comme un appel
 * direct. Une dérive de clé ou d'horloge ne retombe donc pas silencieusement
 * sur l'unique IP d'egress du relais Web.
 */
export function publicRelayHeadersPresent(request: RelayRequest): boolean {
  const headers = request.headers;
  if (!headers) return false;
  return [RELAY_CLIENT_HEADER, RELAY_AT_HEADER, RELAY_PROOF_HEADER].some((header) =>
    Object.prototype.hasOwnProperty.call(headers, header),
  );
}

/** Gate de démarrage : sur tout Railway, les deux services partagent cette clé. */
export function validatePublicRelayEnvironment<T extends Record<string, unknown>>(
  config: T,
): T {
  if (!isDeployedRuntime(config)) return config;
  if (!decodeRelaySecret(config.SM_PUBLIC_RELAY_SIGNING_KEY)) {
    throw new Error(
      'SM_PUBLIC_RELAY_SIGNING_KEY doit être une clé base64 de 32 octets en environnement déployé',
    );
  }
  return config;
}

function relaySecretFromEnv(): Buffer | null {
  return decodeRelaySecret(process.env.SM_PUBLIC_RELAY_SIGNING_KEY);
}

function decodeRelaySecret(value: unknown): Buffer | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null;
  const decoded = Buffer.from(raw, 'base64');
  return decoded.byteLength === 32 ? decoded : null;
}

function singleHeader(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return null;
}
