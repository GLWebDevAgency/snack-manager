import type { PoolClient } from 'pg';
import type { CustomerScope, CustomerSession, PendingChallenge } from './port';

export type ChallengeRow = {
  id: string; parent_ref: string; tenant_ref: string; operation_id: string; request_hash: string;
  browser_hash: string; phone_hash: string; encrypted_phone: string; service_sid: string;
  verification_sid: string | null; state: string; max_checks: number; checks_used: number;
  check_id: string | null; expires_at: Date;
};
export async function lockParent(client: PoolClient, scope: CustomerScope): Promise<boolean> {
  return (await client.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [scope.parentRef])).rowCount === 1;
}
export async function dbTime(client: PoolClient): Promise<number> {
  const result = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  return result.rows[0]!.now.getTime();
}
export async function challenge(client: PoolClient, scope: CustomerScope, id: string): Promise<ChallengeRow | null> {
  return (await client.query<ChallengeRow>(`SELECT * FROM customer.challenges
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 FOR UPDATE`, [scope.parentRef, scope.tenantRef, id])).rows[0] ?? null;
}
export function pendingView(row: ChallengeRow): PendingChallenge {
  if (!row.verification_sid) throw new Error('Preuve fournisseur absente');
  return { challengeId: row.id, phoneHash: row.phone_hash, expiresAt: row.expires_at.getTime(),
    verificationSid: row.verification_sid, serviceSid: row.service_sid, encryptedPhone: row.encrypted_phone };
}
export async function session(client: PoolClient, scope: CustomerScope, sessionHash: string): Promise<CustomerSession | null> {
  const result = await client.query<{ session_id: string; expires_at: Date; account_id: string;
    encrypted_name: string | null; encrypted_phone: string; phone_hash: string; verified_at: Date; revision: string }>(`
    SELECT s.id AS session_id,s.expires_at,a.id AS account_id,a.encrypted_name,a.revision,
      c.encrypted_phone,c.phone_hash,c.verified_at
    FROM customer.sessions s JOIN customer.accounts a
      ON (a.parent_ref,a.tenant_ref,a.id)=(s.parent_ref,s.tenant_ref,s.account_id)
    JOIN customer.verified_contacts c ON (c.parent_ref,c.tenant_ref,c.account_id)=(a.parent_ref,a.tenant_ref,a.id)
    WHERE s.parent_ref=$1 AND s.tenant_ref=$2 AND s.session_hash=$3 AND s.revoked_at IS NULL
      AND s.expires_at>clock_timestamp() AND a.active AND s.account_version=a.session_version`,
  [scope.parentRef, scope.tenantRef, sessionHash]);
  const row = result.rows[0];
  return row ? { sessionId: row.session_id, expiresAt: row.expires_at.getTime(), profile: {
    accountId: row.account_id, phoneHash: row.phone_hash, encryptedName: row.encrypted_name,
    encryptedPhone: row.encrypted_phone, phoneVerifiedAt: row.verified_at.getTime(), revision: Number(row.revision),
  } } : null;
}
