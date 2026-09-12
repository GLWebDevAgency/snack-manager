import type { PoolClient } from 'pg';
import type { CustomerAdmissionInput, CustomerBrowserBinding, CustomerIdentityRepository, CustomerIntentBinding, CustomerIntentResult } from './port';
import { validateBrowser } from './browser-preparation';
import { intentGeneration, intentRow, intentView, validOpenIntent, type IntentRow } from './intent-queries';
import { dbTime, session } from './queries';
import { CustomerRepositoryError } from './client';
import { readEnrollment } from './enrollment';

type CloseInput = CustomerBrowserBinding & { operationId: string } & CustomerAdmissionInput;
async function insertIntent(client: PoolClient, input: CloseInput, proofHash: string | null) {
  const counts = (await client.query<{ total: number; live: number }>(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE browser_ref=$3 AND proof_hash IS NOT NULL AND expires_at>clock_timestamp())::int AS live
    FROM customer.verification_intents WHERE parent_ref=$1 AND tenant_ref=$2`,
  [input.parentRef, input.tenantRef, input.browserRef])).rows[0]!;
  if ((!input.admission && counts.total >= 128) || (proofHash !== null && counts.live >= 3)) return null;
  const generation = await intentGeneration(client, input);
  if (proofHash !== null && BigInt(generation) >= BigInt(Number.MAX_SAFE_INTEGER) - 1n) return null;
  return (await client.query<IntentRow>(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO customer.verification_intents(parent_ref,tenant_ref,operation_id,browser_ref,browser_hash,proof_hash,
      browser_generation,state,created_at,expires_at,closed_at,production_admission_policy_ref,admission_source_hash)
    SELECT $1,$2,$3,$4,$5,$6,$7,CASE WHEN $6::text IS NULL THEN 'closed' ELSE 'open' END,
      stamp.now,LEAST(stamp.now+interval '10 minutes',p.expires_at),CASE WHEN $6::text IS NULL THEN stamp.now ELSE NULL END,$8,$9
    FROM customer.browser_preparations p CROSS JOIN stamp WHERE p.parent_ref=$1 AND p.tenant_ref=$2
      AND p.browser_ref=$4 AND p.browser_hash=$5 AND p.confirmed_at IS NOT NULL AND p.expires_at>stamp.now
    ON CONFLICT DO NOTHING RETURNING *`,
  [input.parentRef, input.tenantRef, input.operationId, input.browserRef, input.browserHash, proofHash, generation, null, input.admission?.sourceHash ?? null])).rows[0] ?? null;
}
export async function prepareIntent(client: PoolClient, input: CustomerIntentBinding & CustomerAdmissionInput) {
  if (!await validateBrowser(client, input)) return null;
  const existing = await intentRow(client, input);
  if (existing) return { intent: await intentView(client, existing), emitCookie: false };
  const row = await insertIntent(client, input, input.proofHash);
  if (!row) return null;
  const intent = await intentView(client, row);
  return { intent, emitCookie: intent.state === 'open' };
}
export async function closeIntent(client: PoolClient, input: CloseInput) {
  if (!await validateBrowser(client, input)) return null;
  const existing = await intentRow(client, input);
  if (!existing) {
    const row = await insertIntent(client, input, null);
    return row ? intentView(client, row) : null;
  }
  if (existing.state === 'closed') return intentView(client, existing);
  // Close only this intention's still-current publication, never a later B.
  const detached = await client.query<{ current_session_id: string }>(`WITH target AS MATERIALIZED (
    SELECT b.current_session_id FROM customer.browser_contexts b JOIN customer.session_publications u
      ON (u.parent_ref,u.tenant_ref,u.browser_hash,u.browser_generation,u.session_id)
        =(b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
    WHERE b.parent_ref=$1 AND b.tenant_ref=$2 AND b.browser_hash=$3 AND u.operation_id=$4
      AND u.browser_ref=$5
      AND b.generation=$6::bigint+1)
    UPDATE customer.browser_contexts b SET generation=generation+1,current_session_id=NULL FROM target
      WHERE b.parent_ref=$1 AND b.tenant_ref=$2 AND b.browser_hash=$3
        AND b.current_session_id=target.current_session_id RETURNING target.current_session_id`,
  [input.parentRef, input.tenantRef, input.browserHash, input.operationId, input.browserRef, existing.browser_generation]);
  if (detached.rows[0]) await client.query(`UPDATE customer.sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, detached.rows[0].current_session_id]);
  const row = (await client.query<IntentRow>(`UPDATE customer.verification_intents SET state='closed',closed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 RETURNING *`,
  [input.parentRef, input.tenantRef, input.operationId])).rows[0]!;
  if (!await validateBrowser(client, input)) throw new CustomerRepositoryError('unavailable');
  return intentView(client, row);
}
export async function validateIntent(client: PoolClient, input: CustomerIntentBinding) {
  const row = await validOpenIntent(client, input);
  return row ? { expiresAt: row.expires_at.getTime() } : null;
}
export async function resultIntent(client: PoolClient,
  input: Parameters<CustomerIdentityRepository['resultIntent']>[0]): Promise<CustomerIntentResult | null> {
  if (!await validateBrowser(client, input)) return null;
  const intent = await intentRow(client, input);
  if (!intent || intent.proof_hash !== input.proofHash) return null;
  const view = await intentView(client, intent);
  const base = { operationId: input.operationId, checkId: input.checkId, challengeId: null as string | null, expiresAt: view.expiresAt };
  if (view.state === 'closed' || view.state === 'expired') return { ...base, state: view.state };
  const row = (await client.query<{ id: string; state: string; expires_at: Date; check_id: string | null }>(`SELECT id,state,expires_at,check_id
    FROM customer.challenges WHERE parent_ref=$1 AND tenant_ref=$2 AND intent_operation_id=$3
      AND browser_ref=$4 AND browser_hash=$5`,
  [input.parentRef, input.tenantRef, input.operationId, input.browserRef, input.browserHash])).rows[0];
  if (!row) return { ...base, state: 'unresolved' };
  base.challengeId = row.id;
  base.expiresAt = Math.min(base.expiresAt, row.expires_at.getTime());
  if (base.expiresAt <= await dbTime(client)) return { ...base, state: 'expired' };
  if (intent.state === 'open' && !await validOpenIntent(client, input)) return { ...base, state: 'failed' };
  if (input.checkId === null) return { ...base, state: row.state === 'pending' ? 'code_required'
    : ['reserved', 'checking'].includes(row.state) ? 'unresolved' : row.state === 'expired' ? 'expired' : 'failed' };
  const attempt = (await client.query<{ state: string; session_id: string | null; session_hash: string | null }>(`SELECT a.state,a.session_id,
    CASE WHEN u.method='phone' AND u.operation_id=$5 AND u.check_id=$4 THEN s.session_hash ELSE NULL END AS session_hash
    FROM customer.check_attempts a LEFT JOIN customer.sessions s ON (s.parent_ref,s.tenant_ref,s.id)=(a.parent_ref,a.tenant_ref,a.session_id)
    LEFT JOIN customer.session_publications u ON (u.parent_ref,u.tenant_ref,u.session_id)=(s.parent_ref,s.tenant_ref,s.id)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.challenge_id=$3 AND a.id=$4 AND a.request_hash IS NOT NULL`,
  [input.parentRef, input.tenantRef, row.id, input.checkId, input.operationId])).rows[0];
  if (!attempt || attempt.state === 'checking') return { ...base, state: 'unresolved' };
  if (attempt.state === 'verified') {
    const enrollment = await readEnrollment(client, { ...input, checkId: input.checkId });
    return enrollment ? { ...base, state: 'enrollment', enrollment } : { ...base, state: 'failed' };
  }
  if (attempt.state === 'approved') {
    if (intent.state !== 'consumed' || row.state !== 'consumed' || row.check_id !== input.checkId || !attempt.session_hash) return { ...base, state: 'failed' };
    if (input.sessionHash !== null && input.sessionHash !== attempt.session_hash) return null;
    const current = await session(client, input, attempt.session_hash, input.browserHash);
    if (!current || current.sessionId !== attempt.session_id) return { ...base, state: 'failed' };
    return { ...base, state: 'approved', session: input.sessionHash === null ? null : current };
  }
  if (!await validOpenIntent(client, input)) return { ...base, state: 'failed' };
  return { ...base, state: attempt.state === 'pending' && row.state === 'pending' ? 'incorrect'
    : attempt.state === 'expired' ? 'expired' : 'failed' };
}
