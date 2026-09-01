import { createHash, createHmac } from "node:crypto";

const RELAY_PROOF_VERSION = "v2";

type RelayProofOptions = {
  nowMs?: number;
  secret?: Uint8Array | null;
  production?: boolean;
};

/**
 * Atteste au serveur API l'identité réseau déjà vérifiée par l'edge Web.
 *
 * L'identité transmise est un HMAC opaque, jamais l'IP. La preuve est liée au
 * restaurant, à la carte demandée et expire vite : un appel direct à l'API ne
 * peut donc ni choisir son bucket ni réutiliser la preuve avec un autre QR.
 */
export function publicRelayHeaders(
  tenantSlug: string,
  clientIdentity: string | null,
  qrToken: string,
  options: RelayProofOptions = {},
): Record<string, string> {
  if (!clientIdentity) {
    if (options.production ?? process.env.NODE_ENV === "production") {
      throw new Error("Identité edge du relais public absente");
    }
    return {};
  }

  const secret = options.secret === undefined ? relaySecretFromEnv() : options.secret;
  if (!secret || secret.byteLength !== 32) {
    if (options.production ?? process.env.NODE_ENV === "production") {
      throw new Error("Clé de signature du relais public absente ou invalide");
    }
    return {};
  }

  const at = String(Math.floor((options.nowMs ?? Date.now()) / 1_000));
  const client = createHmac("sha256", secret)
    .update(`client\0${clientIdentity}`)
    .digest("base64url");
  const requestBinding = createHash("sha256")
    .update(`POST\0/public/loyalty/card\0${qrToken}`)
    .digest("base64url");
  const proof = createHmac("sha256", secret)
    .update(
      [RELAY_PROOF_VERSION, at, tenantSlug, client, requestBinding].join("\0"),
    )
    .digest("base64url");
  return {
    "X-SM-Relay-Client": client,
    "X-SM-Relay-At": at,
    "X-SM-Relay-Proof": proof,
  };
}

function relaySecretFromEnv(): Buffer | null {
  const raw = process.env.SM_PUBLIC_RELAY_SIGNING_KEY?.trim();
  if (!raw || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) return null;
  const decoded = Buffer.from(raw, "base64");
  return decoded.byteLength === 32 ? decoded : null;
}
