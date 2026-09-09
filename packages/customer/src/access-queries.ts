import type { PoolClient } from 'pg';
import type { CustomerAccessBinding, CustomerSessionCandidate } from './access-port';
import type { EnrollmentPasskey } from './enrollment-port';
import { intentRow, validOpenIntent } from './intent-queries';
import { validateBrowser } from './browser-preparation';
import { CustomerRepositoryError } from './client';
import { recordSessionPublication } from './session-publications';
import { dbTime, session } from './queries';

export type StoredKey = Omit<EnrollmentPasskey, 'publicKey'> & { publicKey: string };
export const storeKey = (key: EnrollmentPasskey): StoredKey => ({ ...key, publicKey: Buffer.from(key.publicKey).toString('base64url') });
export const openKey = (key: StoredKey): EnrollmentPasskey => ({ ...key, publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64url')) });
export type AccessRow = {
  operation_id: string; id: string; browser_generation: string; method: 'passkey' | 'recovery';
  expires_at: Date; origin: string | null; rp_id: string | null; challenge: string | null;
  request_hash: string | null; state: 'prepared' | 'checking' | 'failed' | 'denied' | 'granted' | 'approved';
  account_id: string | null; account_version: string | null; credential: StoredKey | null; user_handle: string | null;
  session_id: string | null;
};
export const args = (i: CustomerAccessBinding) => [i.parentRef, i.tenantRef, i.operationId, i.attemptId];
export async function accessRow(client: PoolClient, input: CustomerAccessBinding) {
  const intent = await intentRow(client, input);
  if (!intent || intent.proof_hash !== input.proofHash || !await validateBrowser(client, input)) return null;
  const row = (await client.query<AccessRow>(`SELECT * FROM customer.credential_access_attempts
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND id=$4 AND browser_ref=$5 AND browser_hash=$6 FOR UPDATE`,
  [...args(input), input.browserRef, input.browserHash])).rows[0];
  return row ? { row, intent } : null;
}
/** Shared parent advisory lock is held. Reservations never reset/refund. */
export async function canAdmit(client: PoolClient, input: CustomerAccessBinding & { sourceHash: string }) {
  const counts = (await client.query<{ intent: number; browser: number; source: number; tenant: number; parent: number }>(`
    WITH stamp AS MATERIALIZED (SELECT clock_timestamp() now)
    SELECT count(*) FILTER(WHERE tenant_ref=$2 AND operation_id=$3)::int intent,
      count(*) FILTER(WHERE browser_hash=$4 AND reserved_at>stamp.now-interval '1 hour')::int browser,
      count(*) FILTER(WHERE source_hash=$5 AND reserved_at>stamp.now-interval '15 minutes')::int source,
      count(*) FILTER(WHERE tenant_ref=$2 AND reserved_at>stamp.now-interval '1 hour')::int tenant,
      count(*) FILTER(WHERE reserved_at>stamp.now-interval '1 hour')::int parent
    FROM customer.credential_auth_reservations CROSS JOIN stamp WHERE parent_ref=$1`,
  [input.parentRef, input.tenantRef, input.operationId, input.browserHash, input.sourceHash])).rows[0]!;
  return counts.intent < 5 && counts.browser < 20 && counts.source < 30 && counts.tenant < 300 && counts.parent < 1000;
}
export async function reserveAdmission(client: PoolClient, input: CustomerAccessBinding & { sourceHash: string }, method: 'passkey' | 'recovery') {
  const reserved = await client.query(`INSERT INTO customer.credential_auth_reservations(parent_ref,tenant_ref,operation_id,attempt_id,browser_hash,source_hash,method)
    SELECT $1,$2,$3,$4,$5,$6,$7 FROM customer.credential_access_attempts a JOIN customer.verification_intents i
      ON (i.parent_ref,i.tenant_ref,i.operation_id)=(a.parent_ref,a.tenant_ref,a.operation_id)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.operation_id=$3 AND a.id=$4
      AND a.expires_at>clock_timestamp() AND i.expires_at>clock_timestamp() AND i.state='open'`,
  [...args(input), input.browserHash, input.sourceHash, method]);
  if (reserved.rowCount !== 1 || !await validOpenIntent(client, input)) throw new CustomerRepositoryError('unavailable');
}
/** One atomic publication shared by login/recovery, never a synthetic OTP. */
export async function publishAccess(client: PoolClient, input: CustomerAccessBinding & CustomerSessionCandidate,
  target: { accountId: string; accountVersion: string; generation: string; publicationId: string; method: 'passkey' | 'recovery' }) {
  if (!await validOpenIntent(client, input) || BigInt(target.generation) >= BigInt(Number.MAX_SAFE_INTEGER) - 1n) throw new CustomerRepositoryError('unavailable');
  await client.query(`INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [input.parentRef, input.tenantRef, input.browserHash]);
  const inserted = await client.query(`WITH stamp AS MATERIALIZED(SELECT clock_timestamp() now)
    INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,created_at,expires_at,browser_ref,browser_hash,browser_generation)
    SELECT $4,$1,$2,a.id,$5,a.session_version,stamp.now,LEAST($6::timestamptz,stamp.now+interval '168 hours',p.expires_at),$7,$8,$9::bigint+1
    FROM customer.accounts a CROSS JOIN stamp JOIN customer.browser_preparations p
      ON p.parent_ref=$1 AND p.tenant_ref=$2 AND p.browser_ref=$7 AND p.browser_hash=$8
    JOIN customer.verification_intents i ON (i.parent_ref,i.tenant_ref,i.browser_ref,i.browser_hash)=(p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.active AND a.session_version=$10
      AND p.confirmed_at IS NOT NULL AND p.expires_at>stamp.now AND $6::timestamptz>stamp.now
      AND i.operation_id=$11 AND i.proof_hash=$12 AND i.state='open' AND i.expires_at>stamp.now AND i.browser_generation=$9`,
  [input.parentRef, input.tenantRef, target.accountId, input.sessionId, input.sessionHash, new Date(input.sessionExpiresAt),
    input.browserRef, input.browserHash, target.generation, target.accountVersion, input.operationId, input.proofHash]);
  if (inserted.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  const moved = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$4
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND generation=$5`,
  [input.parentRef, input.tenantRef, input.browserHash, input.sessionId, target.generation]);
  const consumed = await client.query(`UPDATE customer.verification_intents SET state='consumed',consumed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND state='open' AND expires_at>clock_timestamp()`, args(input).slice(0, 3));
  if (moved.rowCount !== 1 || consumed.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
  await recordSessionPublication(client, { ...input, checkId: target.publicationId, method: target.method });
  const current = await session(client, input, input.sessionHash, input.browserHash,
    { expectedOperationId: input.operationId, expectedCheckId: target.publicationId });
  if (!current || current.expiresAt <= await dbTime(client)) throw new CustomerRepositoryError('unavailable');
  return current;
}
