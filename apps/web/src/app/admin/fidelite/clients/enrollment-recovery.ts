export type EnrollmentRecoveryPhase =
  | "preparing"
  | "creating"
  | "awaiting_handoff"
  | "ack_pending";

export interface EnrollmentRecoveryState {
  operationId: string;
  phase: EnrollmentRecoveryPhase;
}

export type EnrollmentRecoveryScope = {
  mode: "live" | "demo";
  tenantId: string;
  userId: string;
};

export const LOYALTY_ENROLLMENT_RECOVERY_KEY_PREFIX =
  "sm.loyalty.enrollment-recovery.v2";
const LEGACY_RECOVERY_KEY = "sm.loyalty.enrollment-recovery.v1";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHASES = new Set<EnrollmentRecoveryPhase>([
  "preparing",
  "creating",
  "awaiting_handoff",
  "ack_pending",
]);

function tokenPayload(token: string): Record<string, unknown> | null {
  const encoded = token.split(".")[1];
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed: unknown = JSON.parse(globalThis.atob(padded));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function enrollmentRecoveryScopeFor(input: {
  demo: boolean;
  token: string | null;
}): EnrollmentRecoveryScope | null {
  if (input.demo) {
    return { mode: "demo", tenantId: "t1", userId: "demo-admin-session" };
  }
  if (!input.token) return null;
  const payload = tokenPayload(input.token);
  const tenantId = payload?.tenantId;
  const userId = payload?.sub;
  return typeof tenantId === "string" && tenantId.length > 0 && tenantId.length <= 256 &&
    typeof userId === "string" && userId.length > 0 && userId.length <= 256
    ? { mode: "live", tenantId, userId }
    : null;
}

export function enrollmentRecoveryKey(scope: EnrollmentRecoveryScope): string {
  return [
    LOYALTY_ENROLLMENT_RECOVERY_KEY_PREFIX,
    scope.mode,
    encodeURIComponent(scope.tenantId),
    encodeURIComponent(scope.userId),
  ].join(":");
}

/**
 * Le navigateur ne garde que l'identifiant idempotent et l'étape du protocole.
 * Prénom, téléphone et secret QR restent exclusivement en mémoire vive.
 */
export function parseEnrollmentRecovery(
  raw: string | null,
): EnrollmentRecoveryState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 2 &&
      typeof record.operationId === "string" &&
      UUID_V4.test(record.operationId) &&
      typeof record.phase === "string" &&
      PHASES.has(record.phase as EnrollmentRecoveryPhase)
      ? {
          operationId: record.operationId,
          phase: record.phase as EnrollmentRecoveryPhase,
        }
      : null;
  } catch {
    return null;
  }
}

export function readEnrollmentRecovery(
  scope: EnrollmentRecoveryScope | null,
): EnrollmentRecoveryState | null {
  if (typeof window === "undefined" || !scope) return null;
  try {
    // La v1 n'était cloisonnée ni par tenant ni par utilisateur. Elle ne peut
    // être attribuée sûrement : on la retire au lieu de la rejouer au hasard.
    window.sessionStorage.removeItem(LEGACY_RECOVERY_KEY);
    const key = enrollmentRecoveryKey(scope);
    const raw = window.sessionStorage.getItem(key);
    const parsed = parseEnrollmentRecovery(raw);
    if (raw && !parsed) window.sessionStorage.removeItem(key);
    return parsed;
  } catch {
    return null;
  }
}

export function writeEnrollmentRecovery(
  scope: EnrollmentRecoveryScope | null,
  state: EnrollmentRecoveryState,
): void {
  if (!scope) throw new Error("Session fidélité non identifiable");
  window.sessionStorage.setItem(
    enrollmentRecoveryKey(scope),
    JSON.stringify(state),
  );
}

export function clearEnrollmentRecovery(scope: EnrollmentRecoveryScope | null): void {
  if (typeof window === "undefined" || !scope) return;
  try {
    window.sessionStorage.removeItem(enrollmentRecoveryKey(scope));
  } catch {
    // Une suppression refusée ne doit jamais faire réafficher un QR après ACK.
    // L'entrée ne contient ni PII ni secret et le serveur rejettera/rejouera
    // l'opération au prochain montage.
  }
}

/** Logout/révocation : aucune intention de l'ancien principal ne doit survivre. */
export function clearAllEnrollmentRecoveries(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (
        key === LEGACY_RECOVERY_KEY ||
        key?.startsWith(`${LOYALTY_ENROLLMENT_RECOVERY_KEY_PREFIX}:`)
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    // L'entrée ne contient ni PII ni secret. Le serveur lie aussi l'opération
    // au principal et refusera toute reprise depuis la prochaine session.
  }
}
