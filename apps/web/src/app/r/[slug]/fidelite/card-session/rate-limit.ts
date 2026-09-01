import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";

/**
 * L'initialisation fait une recherche à partir d'un secret encore inconnu du
 * navigateur. Elle reste donc nettement plus serrée que les lectures d'une
 * carte déjà enregistrée, sans limiter tout un restaurant à dix scans/minute.
 */
export const LOYALTY_SESSION_INIT_CLIENT_RATE_LIMIT = 30;
export const LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT = 60;
export const LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT = 5;
export const LOYALTY_SESSION_INIT_TENANT_RATE_LIMIT = 300;
export const LOYALTY_SESSION_INIT_GLOBAL_RATE_LIMIT = 300;

/** Une carte connue peut être rafraîchie et afficher son QR sans partager le NAT. */
export const LOYALTY_CARD_READ_RATE_LIMIT = 120;
export const LOYALTY_CARD_READ_SOURCE_RATE_LIMIT = 240;
export const LOYALTY_CARD_READ_TENANT_RATE_LIMIT = 1_200;
export const LOYALTY_CARD_READ_GLOBAL_RATE_LIMIT = 1_200;
export const LOYALTY_CARD_RATE_WINDOW_MS = 60_000;

const MAX_ACTIVE_BUCKETS = 10_000;
const GLOBAL_STORE_KEY = "__smLoyaltyCardRateLimitV2";
const SESSION_INIT_PROCESS_GLOBAL_BUCKET_KEY = "init\0process-global";
const CARD_READ_PROCESS_GLOBAL_BUCKET_KEY = "read\0process-global";

interface Bucket {
  startedAt: number;
  used: number;
}

interface RateLimitStore {
  buckets: Map<string, Bucket>;
  lastSweepAt: number;
}

type RateLimitRuntime = typeof globalThis & {
  [GLOBAL_STORE_KEY]?: RateLimitStore;
};

type Reservation = {
  key: string;
  limit: number;
};

function store(): RateLimitStore {
  const runtime = globalThis as RateLimitRuntime;
  runtime[GLOBAL_STORE_KEY] ??= { buckets: new Map(), lastSweepAt: 0 };
  return runtime[GLOBAL_STORE_KEY];
}

/**
 * Railway reconstruit X-Real-IP depuis la connexion entrante. À l'inverse,
 * X-Forwarded-For peut contenir une valeur fournie par l'appelant : il ne doit
 * donc jamais créer une identité de quota. Sans information edge vérifiée,
 * l'initialisation échoue fermée au lieu de mutualiser tous les visiteurs dans
 * un bucket « unknown » facile à saturer.
 */
export function trustedLoyaltyClientIdentity(
  request: Pick<NextRequest, "headers">,
): string | null {
  const candidate = request.headers.get("x-real-ip")?.trim();
  return candidate && isIP(candidate) ? `edge-ip:${candidate.toLowerCase()}` : null;
}

function secretDigest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function sweepExpired(state: RateLimitStore, now: number): void {
  // Même lorsque la carte est pleine, une rafale ne doit pas déclencher un
  // parcours O(n) à chaque requête. Un balayage au plus par fenêtre suffit :
  // entre-temps, le plafond mémoire échoue fermé en temps constant.
  if (now - state.lastSweepAt < LOYALTY_CARD_RATE_WINDOW_MS) return;
  for (const [key, bucket] of state.buckets) {
    if (now - bucket.startedAt >= LOYALTY_CARD_RATE_WINDOW_MS) {
      state.buckets.delete(key);
    }
  }
  state.lastSweepAt = now;
}

export type LoyaltyCardQuota =
  | { allowed: true }
  | {
      allowed: false;
      reason: "rate-limited" | "unverified-client";
      retryAfterSeconds?: number;
    };

/**
 * Réserve plusieurs budgets sans laisser une réservation partielle : le
 * plafond client, le plafond par secret et le plafond tenant avancent ensemble
 * ou pas du tout. L'exécution est synchrone, donc atomique dans une instance.
 */
function reserveQuota(
  reservations: readonly Reservation[],
  now: number,
): LoyaltyCardQuota {
  const state = store();
  sweepExpired(state, now);

  const missing = reservations.reduce(
    (count, reservation) => count + (state.buckets.has(reservation.key) ? 0 : 1),
    0,
  );
  if (state.buckets.size + missing > MAX_ACTIVE_BUCKETS) {
    return {
      allowed: false,
      reason: "rate-limited",
      retryAfterSeconds: Math.ceil(LOYALTY_CARD_RATE_WINDOW_MS / 1_000),
    };
  }

  let retryAfterSeconds = 0;
  for (const reservation of reservations) {
    const bucket = state.buckets.get(reservation.key);
    if (!bucket || now - bucket.startedAt >= LOYALTY_CARD_RATE_WINDOW_MS) continue;
    if (bucket.used < reservation.limit) continue;
    retryAfterSeconds = Math.max(
      retryAfterSeconds,
      Math.max(
        1,
        Math.ceil(
          (bucket.startedAt + LOYALTY_CARD_RATE_WINDOW_MS - now) / 1_000,
        ),
      ),
    );
  }
  if (retryAfterSeconds > 0) {
    return { allowed: false, reason: "rate-limited", retryAfterSeconds };
  }

  for (const reservation of reservations) {
    const bucket = state.buckets.get(reservation.key);
    if (!bucket || now - bucket.startedAt >= LOYALTY_CARD_RATE_WINDOW_MS) {
      state.buckets.set(reservation.key, { startedAt: now, used: 1 });
    } else {
      bucket.used += 1;
    }
  }
  return { allowed: true };
}

/**
 * Budget de création de session : identité réseau vérifiée, secret haché,
 * plafonds source et tenant, puis borne process globale. Un attaquant ne peut
 * donc recréer un budget en variant X-Forwarded-For, slug ou jeton essayé.
 */
export function takeLoyaltySessionInitQuota(
  request: Pick<NextRequest, "headers">,
  tenantSlug: string,
  qrToken: string,
  now = Date.now(),
): LoyaltyCardQuota {
  const client = trustedLoyaltyClientIdentity(request);
  if (!client) return { allowed: false, reason: "unverified-client" };

  const source = secretDigest(client);
  const token = secretDigest(qrToken);
  return reserveQuota(
    [
      {
        // Cette clé ne dépend volontairement pas du tenant : changer de slug
        // ne doit jamais recréer un budget pour une même source réseau.
        key: `init\0source:${source}`,
        limit: LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT,
      },
      {
        key: `init\0tenant:${tenantSlug}\0client:${source}`,
        limit: LOYALTY_SESSION_INIT_CLIENT_RATE_LIMIT,
      },
      {
        key: `init\0tenant:${tenantSlug}\0token:${token}`,
        limit: LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT,
      },
      {
        key: `init\0tenant:${tenantSlug}`,
        limit: LOYALTY_SESSION_INIT_TENANT_RATE_LIMIT,
      },
      {
        // Clé constante à l'échelle du process : même une rotation combinée
        // des sources, tenants et secrets reste bornée avant MAX_ACTIVE_BUCKETS.
        key: SESSION_INIT_PROCESS_GLOBAL_BUCKET_KEY,
        limit: LOYALTY_SESSION_INIT_GLOBAL_RATE_LIMIT,
      },
    ],
    now,
  );
}

/**
 * Budget des lectures après enregistrement. Les empreintes de la source et de
 * la carte évitent tout secret ou IP en clair dans la mémoire. La source reste
 * bornée à travers les tenants sans imposer le petit plafond d'initialisation.
 */
export function takeLoyaltyCardReadQuota(
  tenantSlug: string,
  qrToken: string,
  clientIdentity: string,
  now = Date.now(),
): LoyaltyCardQuota {
  if (!clientIdentity) return { allowed: false, reason: "unverified-client" };

  const source = secretDigest(clientIdentity);
  const token = secretDigest(qrToken);
  return reserveQuota(
    [
      {
        key: `read\0source:${source}`,
        limit: LOYALTY_CARD_READ_SOURCE_RATE_LIMIT,
      },
      {
        key: `read\0tenant:${tenantSlug}\0token:${token}`,
        limit: LOYALTY_CARD_READ_RATE_LIMIT,
      },
      {
        key: `read\0tenant:${tenantSlug}`,
        limit: LOYALTY_CARD_READ_TENANT_RATE_LIMIT,
      },
      {
        key: CARD_READ_PROCESS_GLOBAL_BUCKET_KEY,
        limit: LOYALTY_CARD_READ_GLOBAL_RATE_LIMIT,
      },
    ],
    now,
  );
}

export function resetLoyaltyCardQuotaForTests(): void {
  const runtime = globalThis as RateLimitRuntime;
  runtime[GLOBAL_STORE_KEY] = { buckets: new Map(), lastSweepAt: 0 };
}

export function loyaltyCardQuotaBucketCountForTests(): number {
  return store().buckets.size;
}
