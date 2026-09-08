import type { PoolClient } from 'pg';
import type { CustomerScope, CustomerSession, PendingChallenge } from './port';

export type ChallengeRow = {
  id: string; parent_ref: string; tenant_ref: string; operation_id: string; request_hash: string;
  browser_hash: string; browser_generation: string | null; phone_hash: string; encrypted_phone: string; service_sid: string;
  verification_sid: string | null; state: string; max_checks: number; checks_used: number;
  check_id: string | null; expires_at: Date;
  funding_kind: string | null; authorization_ref: string | null; reserved_microusd: string | null; funding_expires_at: Date | null;
  paid_parent_ref: string | null; paid_authorization_ref: string | null; paid_currency: string | null; paid_expires_at: Date | null;
};
export async function lockParent(client: PoolClient, scope: CustomerScope): Promise<boolean> {
  return (await client.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [scope.parentRef])).rowCount === 1;
}
export async function dbTime(client: PoolClient): Promise<number> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0]!.now.getTime();
}
export async function challenge(client: PoolClient, scope: CustomerScope, id: string): Promise<ChallengeRow | null> {
  return (await client.query<ChallengeRow>(`SELECT c.*,r.funding_kind,r.authorization_ref,r.reserved_microusd,r.funding_expires_at,
    p.parent_ref AS paid_parent_ref,p.authorization_ref AS paid_authorization_ref,p.currency AS paid_currency,p.expires_at AS paid_expires_at
    FROM customer.challenges c LEFT JOIN customer.reservations r
      ON (r.parent_ref,r.tenant_ref,r.challenge_id)=(c.parent_ref,c.tenant_ref,c.id)
    LEFT JOIN customer.paid_budgets p ON p.parent_ref=r.parent_ref
    WHERE c.parent_ref=$1 AND c.tenant_ref=$2 AND c.id=$3 FOR UPDATE OF c`, [scope.parentRef, scope.tenantRef, id])).rows[0] ?? null;
}
export function pendingView(row: ChallengeRow): PendingChallenge {
  if (!row.verification_sid) throw new Error('Preuve fournisseur absente');
  let funding: PendingChallenge['funding'];
  if (row.funding_kind === 'trial' && row.authorization_ref === null && row.reserved_microusd === '0' && row.funding_expires_at === null) {
    funding = { mode: 'trial' };
  } else if (row.funding_kind === 'paid' && row.authorization_ref && /^[a-zA-Z0-9_-]{1,120}$/.test(row.authorization_ref)
    && Number.isSafeInteger(Number(row.reserved_microusd)) && Number(row.reserved_microusd) > 0
    && row.paid_parent_ref === row.parent_ref && row.paid_authorization_ref === row.authorization_ref && row.paid_currency === 'USD'
    && row.funding_expires_at instanceof Date && Number.isFinite(row.funding_expires_at.getTime())
    && row.paid_expires_at instanceof Date && Number.isFinite(row.paid_expires_at.getTime())) {
    funding = { mode: 'paid', authorizationRef: row.authorization_ref, currency: 'USD',
      reservedMicrousd: Number(row.reserved_microusd),
      // Effective authorization can only shorten; the stored receipt is untouched.
      expiresAt: Math.min(row.funding_expires_at.getTime(), row.paid_expires_at.getTime()) };
  } else throw new Error('Preuve de financement absente');
  return { challengeId: row.id, phoneHash: row.phone_hash, expiresAt: row.expires_at.getTime(),
    verificationSid: row.verification_sid, serviceSid: row.service_sid, encryptedPhone: row.encrypted_phone, funding };
}
export function fundingAllowsCheck(row: ChallengeRow, now: number): boolean {
  const funding = pendingView(row).funding;
  return funding.mode === 'paid' ? funding.expiresAt > now : row.paid_parent_ref === null;
}
/** All callers hold the shared parent lock, including publication and logout. */
export async function currentBrowserGeneration(client: PoolClient, scope: CustomerScope, browserHash: string): Promise<string | null> {
  return (await client.query<{ generation: string }>(`SELECT generation FROM customer.browser_contexts
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 FOR UPDATE`,
  [scope.parentRef, scope.tenantRef, browserHash])).rows[0]?.generation ?? null;
}
export async function currentChallenge(client: PoolClient, row: ChallengeRow): Promise<boolean> {
  return row.browser_generation !== null && row.browser_generation === await currentBrowserGeneration(client,
    { parentRef: row.parent_ref, tenantRef: row.tenant_ref }, row.browser_hash);
}
export async function session(client: PoolClient, scope: CustomerScope, sessionHash: string, browserHash: string): Promise<CustomerSession | null> {
  const result = await client.query<{ session_id: string; expires_at: Date; account_id: string;
    encrypted_name: string | null; encrypted_phone: string; phone_hash: string; verified_at: Date; revision: string }>(`
    SELECT s.id AS session_id,s.expires_at,a.id AS account_id,a.encrypted_name,a.revision,
      c.encrypted_phone,c.phone_hash,c.verified_at
    FROM customer.sessions s JOIN customer.accounts a
      ON (a.parent_ref,a.tenant_ref,a.id)=(s.parent_ref,s.tenant_ref,s.account_id)
    JOIN customer.verified_contacts c ON (c.parent_ref,c.tenant_ref,c.account_id)=(a.parent_ref,a.tenant_ref,a.id)
    JOIN customer.browser_contexts b ON (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
      =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)
    WHERE s.parent_ref=$1 AND s.tenant_ref=$2 AND s.session_hash=$3 AND s.revoked_at IS NULL
      AND s.browser_hash=$4
      AND s.expires_at>clock_timestamp() AND a.active AND s.account_version=a.session_version`,
  [scope.parentRef, scope.tenantRef, sessionHash, browserHash]);
  const row = result.rows[0];
  return row ? { sessionId: row.session_id, expiresAt: row.expires_at.getTime(), profile: {
    accountId: row.account_id, phoneHash: row.phone_hash, encryptedName: row.encrypted_name,
    encryptedPhone: row.encrypted_phone, phoneVerifiedAt: row.verified_at.getTime(), revision: Number(row.revision),
  } } : null;
}
