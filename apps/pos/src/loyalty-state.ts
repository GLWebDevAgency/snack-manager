import {
  loyaltyCardDeepLink,
  loyaltyTokenFromQrPayload,
  type LoyaltyEnrollmentPrepareResult,
  type LoyaltyRewardView,
} from '@sm/contracts';

/** Version des conditions réellement présentées au comptoir pendant le pilote. */
export const LOYALTY_TERMS_NOTICE_VERSION = 'loyalty-pilot-2026-09';

export type LoyaltyEarnState = 'awaiting_order' | 'queued' | 'credited' | 'failed';

export interface LoyaltyTicketState {
  state: LoyaltyEarnState;
  creditedUnits?: number;
}

export interface LoyaltyTicketMember {
  id: string;
  alias: string;
  balanceUnits: number;
  status: 'active' | 'blocked' | 'anonymized';
  maskedPhone: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LoyaltyEnrollmentRecoveryState {
  operationId: string;
  phase: 'preparing' | 'creating' | 'awaiting_handoff' | 'ack_pending';
}

const ENROLLMENT_PHASES = new Set<LoyaltyEnrollmentRecoveryState['phase']>([
  'preparing',
  'creating',
  'awaiting_handoff',
  'ack_pending',
]);

/**
 * Décode l'automate sans PII ni QR. L'ancien format `{ operationId }` est
 * repris en phase conservatrice : le serveur sera interrogé, jamais supposé
 * absent ni acquitté.
 */
export function parseLoyaltyEnrollmentRecovery(
  raw: string | null,
): LoyaltyEnrollmentRecoveryState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return null;
    const keys = Object.keys(value);
    if (typeof value.operationId !== 'string' || !UUID_V4.test(value.operationId)) {
      return null;
    }
    if (keys.length === 1) {
      return { operationId: value.operationId, phase: 'creating' };
    }
    return keys.length === 2 &&
      typeof value.phase === 'string' &&
      ENROLLMENT_PHASES.has(value.phase as LoyaltyEnrollmentRecoveryState['phase'])
      ? {
          operationId: value.operationId,
          phase: value.phase as LoyaltyEnrollmentRecoveryState['phase'],
        }
      : null;
  } catch {
    return null;
  }
}

export function isTerminalEnrollmentError(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    (cause as { status?: unknown }).status === 410
  );
}

/**
 * Une réponse terminale gagne sur la reprise locale : on tente sa suppression
 * durable, puis on libère toujours l'automate mémoire pour la nouvelle carte.
 */
export async function discardTerminalEnrollmentRecovery(
  removeLocal: () => Promise<void>,
  resetMemory: () => void,
): Promise<void> {
  try {
    await removeLocal();
  } catch {
    // Une nouvelle persistance remplacera la clé ; au prochain démarrage, une
    // éventuelle vieille clé terminale sera de nouveau supprimée.
  } finally {
    resetMemory();
  }
}

/**
 * Rejoue PREPARE au démarrage sans transformer une expiration terminale en
 * panne de transport. Le caller ferme alors la reprise locale et peut proposer
 * immédiatement une nouvelle adhésion.
 */
export async function resumePreparingEnrollment({
  operationId,
  prepare,
  onClosed,
}: {
  operationId: string;
  prepare: (operationId: string) => Promise<LoyaltyEnrollmentPrepareResult>;
  onClosed: () => Promise<void>;
}): Promise<'recover' | 'resume_form' | 'closed'> {
  try {
    const prepared = await prepare(operationId);
    return prepared.status === 'ready' ? 'recover' : 'resume_form';
  } catch (cause) {
    if (!isTerminalEnrollmentError(cause)) throw cause;
    await onClosed();
    return 'closed';
  }
}

/**
 * Accepte la carte historique (secret brut) et la carte PWA. Dans la deep-link
 * le secret vit dans le fragment : le navigateur ne l'envoie pas au serveur,
 * et le POS ne transmet ensuite à l'API que les 43 caractères extraits.
 */
export function extractLoyaltyQrToken(
  input: string,
  expectedTenantSlug?: string,
): string | null {
  return loyaltyTokenFromQrPayload(input, expectedTenantSlug);
}

/**
 * Émet de préférence la deep-link PWA ; une configuration publique absente ou
 * invalide retombe sur le token opaque, qui reste compatible avec les caisses.
 */
export function loyaltyQrPayload(
  token: string,
  publicSiteOrigin: string | null,
  tenantSlug: string,
): string {
  if (!publicSiteOrigin) return token;
  try {
    const configured = new URL(publicSiteOrigin);
    if (configured.username || configured.password) return token;
    const deepLink = loyaltyCardDeepLink(configured.origin, tenantSlug, token);
    return deepLink.length <= 2_048 ? deepLink : token;
  } catch {
    return token;
  }
}

/** Le POS ne propose jamais une récompense inactive ou issue d'une autre version de programme. */
export function activeRewardsFor(
  rewards: readonly LoyaltyRewardView[],
  programId: string,
): LoyaltyRewardView[] {
  return rewards
    .filter((reward) => reward.active && reward.programId === programId)
    .sort((a, b) => a.costUnits - b.costUnits || a.name.localeCompare(b.name, 'fr'));
}

interface QueueLikeEntry {
  path: string;
  body?: unknown;
}

/** Une commande définitivement refusée ferme aussi son gain embarqué. */
export function rejectedOrderIds(entries: readonly QueueLikeEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.path !== '/orders' || !isRecord(entry.body)) continue;
    const clientId = entry.body.clientId;
    if (typeof clientId === 'string' && clientId.length > 0) ids.add(clientId);
  }
  return ids;
}
