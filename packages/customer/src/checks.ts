import type { PoolClient } from 'pg';
import { recordSessionPublication } from './session-publications';
import type { CheckClaim, CustomerIdentityRepository } from './port';
import type { CustomerCheckCompletion } from './enrollment-port';
import { readEnrollment } from './enrollment';
import { CustomerRepositoryError } from './client';
import { challenge, currentChallenge, dbTime, fundingAllowsCheck, pendingView, session, type ChallengeRow } from './queries';
import { intentRow, validOpenIntent } from './intent-queries';
import { resultIntent } from './verification-intents';

type Completion = Parameters<CustomerIdentityRepository['completeCheck']>[0];

export async function settleVerification(client: PoolClient, input: Parameters<CustomerIdentityRepository['settleSend']>[0]) {
  const row = await challenge(client, input, input.challengeId);
  if (!row) return null;
  if (row.state === 'pending') return row.verification_sid === input.verificationSid
    && row.expires_at.getTime() > await dbTime(client) && await currentChallenge(client, row) ? pendingView(row) : null;
  if (row.state !== 'reserved') return null;
  if (input.verificationSid) {
    await client.query(`UPDATE customer.phone_guards g SET active_until=GREATEST(g.active_until,clock_timestamp()+interval '10 minutes')
      FROM customer.reservations r WHERE r.parent_ref=$1 AND r.tenant_ref=$2 AND r.challenge_id=$3
        AND g.parent_ref=r.parent_ref AND g.global_phone_hash=r.global_phone_hash`,
    [input.parentRef, input.tenantRef, row.id]);
    await client.query(`INSERT INTO customer.provider_verifications(parent_ref,tenant_ref,challenge_id,service_sid,verification_sid)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [input.parentRef, input.tenantRef, row.id, row.service_sid, input.verificationSid]);
    const owner = (await client.query<{ challenge_id: string; tenant_ref: string }>(`SELECT challenge_id,tenant_ref
      FROM customer.provider_verifications WHERE parent_ref=$1 AND service_sid=$2 AND verification_sid=$3`,
    [input.parentRef, row.service_sid, input.verificationSid])).rows[0];
    if (owner?.challenge_id === row.id && owner.tenant_ref === input.tenantRef) {
      const updated = await client.query<ChallengeRow>(`UPDATE customer.challenges
        SET state=CASE WHEN expires_at>clock_timestamp() THEN 'pending' ELSE 'expired' END,verification_sid=$4
        WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 RETURNING *`,
      [input.parentRef, input.tenantRef, row.id, input.verificationSid]);
      return updated.rows[0]?.state === 'pending' && await currentChallenge(client, row)
        ? pendingView((await challenge(client, input, row.id))!) : null;
    }
  }
  await client.query(`UPDATE customer.challenges SET state='uncertain' WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`,
  [input.parentRef, input.tenantRef, row.id]);
  return null;
}

export async function claimVerification(client: PoolClient, input: CheckClaim) {
  const row = await challenge(client, input, input.challengeId);
  if (!row || row.intent_operation_id !== input.operationId || row.browser_ref !== input.browserRef || row.browser_hash !== input.browserHash || row.state !== 'pending'
    || row.checks_used >= row.max_checks || row.expires_at.getTime() <= await dbTime(client)) return null;
  if (!await validOpenIntent(client, input) || !await currentChallenge(client, row)) return null;
  if (!fundingAllowsCheck(row, await dbTime(client))) return null;
  const attempt = await client.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id,request_hash)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [input.checkId, input.parentRef, input.tenantRef, row.id, input.requestHash]);
  if (!attempt.rowCount) return null;
  const changed = await client.query<ChallengeRow>(`UPDATE customer.challenges
    SET state='checking',check_id=$4,checks_used=checks_used+1
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 AND expires_at>clock_timestamp()
      AND EXISTS (SELECT 1 FROM customer.browser_preparations p WHERE p.parent_ref=$1 AND p.tenant_ref=$2
        AND p.browser_ref=$5 AND p.browser_hash=$6 AND p.confirmed_at IS NOT NULL AND p.expires_at>clock_timestamp())
      AND EXISTS (SELECT 1 FROM customer.verification_intents i WHERE i.parent_ref=$1 AND i.tenant_ref=$2
        AND i.operation_id=$7 AND i.proof_hash=$8 AND i.state='open' AND i.expires_at>clock_timestamp()) RETURNING *`,
  [input.parentRef, input.tenantRef, row.id, input.checkId, input.browserRef, input.browserHash, input.operationId, input.proofHash]);
  if (!changed.rows[0]) {
    await finish(client, input, 'expired', 'expired'); return null;
  }
  return pendingView((await challenge(client, input, row.id))!);
}

async function finish(client: PoolClient, input: CheckClaim, result: string, state: string, sessionId: string | null = null) {
  await client.query(`UPDATE customer.check_attempts SET state=$5,completed_at=clock_timestamp(),session_id=$6
    WHERE parent_ref=$1 AND tenant_ref=$2 AND challenge_id=$3 AND id=$4 AND state='checking'`,
  [input.parentRef, input.tenantRef, input.challengeId, input.checkId, result, sessionId]);
  await client.query(`UPDATE customer.challenges SET state=$4,check_id=CASE WHEN $4='pending' THEN NULL ELSE check_id END
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`, [input.parentRef, input.tenantRef, input.challengeId, state]);
}

export async function recoverVerification(client: PoolClient, input: CheckClaim & { sessionHash: string }): Promise<CustomerCheckCompletion | null> {
  const exact = await client.query<{ state: string }>(`SELECT state FROM customer.check_attempts WHERE parent_ref=$1 AND tenant_ref=$2
    AND challenge_id=$3 AND id=$4 AND request_hash=$5 AND state IN ('approved','verified')`,
  [input.parentRef, input.tenantRef, input.challengeId, input.checkId, input.requestHash]);
  if (!exact.rowCount) return null;
  if (exact.rows[0]?.state === 'verified') {
    const enrollment = await readEnrollment(client, input);
    return enrollment ? { kind: 'enrollment', enrollment } : null;
  }
  const result = await resultIntent(client, input);
  return result?.state === 'approved' && result.challengeId === input.challengeId && result.session ? { kind: 'session', session: result.session } : null;
}

export async function completeVerification(client: PoolClient, input: Completion): Promise<CustomerCheckCompletion | null> {
  const row = await challenge(client, input, input.challengeId);
  if (!row || row.intent_operation_id !== input.operationId || row.browser_ref !== input.browserRef || row.browser_hash !== input.browserHash || row.check_id !== input.checkId) return null;
  if ((await intentRow(client, input))?.proof_hash !== input.proofHash) return null;
  if (row.state === 'consumed') return recoverVerification(client, input);
  if (row.state !== 'checking') return null;
  const exact = await client.query(`SELECT 1 FROM customer.check_attempts WHERE parent_ref=$1 AND tenant_ref=$2
    AND challenge_id=$3 AND id=$4 AND request_hash=$5`,
  [input.parentRef, input.tenantRef, row.id, input.checkId, input.requestHash]);
  if (!exact.rowCount) return null;
  if (!await validOpenIntent(client, input) || !await currentChallenge(client, row)) {
    await finish(client, input, 'rejected', 'rejected'); return null;
  }
  const attempt = await client.query(`SELECT id FROM customer.check_attempts
    WHERE parent_ref=$1 AND tenant_ref=$2 AND challenge_id=$3 AND id=$4 AND state='checking' FOR UPDATE`,
  [input.parentRef, input.tenantRef, row.id, input.checkId]);
  if (!attempt.rowCount) return null;
  if (row.expires_at.getTime() <= await dbTime(client)) {
    await finish(client, input, 'expired', 'expired'); return null;
  }
  if (input.result !== 'approved') {
    await finish(client, input, input.result,
      input.result === 'pending' && row.checks_used >= row.max_checks ? 'locked' : input.result);
    return null;
  }
  const existing = (await client.query<{ id: string; session_version: string; active: boolean }>(`SELECT a.id,a.session_version,a.active
    FROM customer.accounts a JOIN customer.verified_contacts c
      ON (c.parent_ref,c.tenant_ref,c.account_id)=(a.parent_ref,a.tenant_ref,a.id)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND c.phone_hash=$3 FOR UPDATE OF a`,
  [input.parentRef, input.tenantRef, row.phone_hash])).rows[0];
  const continuity = existing && input.existingSessionHash ? await session(client, input, input.existingSessionHash, input.browserHash) : null;
  if (existing && (!existing.active || continuity?.profile.accountId !== existing.id)) {
    await finish(client, input, 'rejected', 'rejected'); return null;
  }
  const now = await dbTime(client);
  if (row.expires_at.getTime() <= now || input.sessionExpiresAt <= now) {
    await finish(client, input, 'expired', 'expired'); return null;
  }
  const accountId = existing?.id ?? input.accountId;
  if (!existing) {
    const created = await client.query(`INSERT INTO customer.registration_enrollments(parent_ref,tenant_ref,id,operation_id,challenge_id,
      browser_ref,browser_hash,browser_generation,phone_hash,encrypted_phone,verified_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,i.browser_generation,$8,$9,clock_timestamp(),i.expires_at
      FROM customer.verification_intents i WHERE i.parent_ref=$1 AND i.tenant_ref=$2 AND i.operation_id=$4
        AND i.proof_hash=$10 AND i.state='open' AND i.expires_at>clock_timestamp()`,
    [input.parentRef, input.tenantRef, input.checkId, input.operationId, input.challengeId,
      input.browserRef, input.browserHash, row.phone_hash, row.encrypted_phone, input.proofHash]);
    if (created.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
    await client.query(`UPDATE customer.check_attempts SET state='verified',enrollment_id=id,completed_at=clock_timestamp()
      WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 AND state='checking'`, [input.parentRef, input.tenantRef, input.checkId]);
    await client.query(`UPDATE customer.challenges SET state='consumed' WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3`,
      [input.parentRef, input.tenantRef, input.challengeId]);
    const enrollment = await readEnrollment(client, input);
    if (!enrollment) throw new CustomerRepositoryError('unavailable');
    return { kind: 'enrollment', enrollment };
  }
  const created = await client.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,created_at,expires_at,browser_hash,browser_generation,browser_ref)
    SELECT $1,$2,$3,a.id,$5,a.session_version,stamp.now,LEAST($6::timestamptz,stamp.now+interval '168 hours',p.expires_at),$9,$10::bigint+1,$11
    FROM customer.accounts a CROSS JOIN stamp JOIN customer.browser_preparations p
      ON p.parent_ref=$2 AND p.tenant_ref=$3 AND p.browser_ref=$11 AND p.browser_hash=$9
      AND p.confirmed_at IS NOT NULL AND p.expires_at>stamp.now
    JOIN customer.verification_intents i ON (i.parent_ref,i.tenant_ref,i.browser_ref,i.browser_hash)
      =(p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash) AND i.operation_id=$12 AND i.proof_hash=$13
      AND i.state='open' AND i.expires_at>stamp.now AND i.browser_generation=$10
    WHERE a.parent_ref=$2 AND a.tenant_ref=$3 AND a.id=$4 AND a.active
      AND $6::timestamptz>stamp.now AND $7::timestamptz>stamp.now
      AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=$2 AND s.tenant_ref=$3
        AND s.account_id=a.id AND s.session_hash=$8 AND s.revoked_at IS NULL AND s.expires_at>stamp.now
        AND s.account_version=a.session_version))`,
  [input.sessionId, input.parentRef, input.tenantRef, accountId, input.sessionHash, new Date(input.sessionExpiresAt),
    row.expires_at, existing ? input.existingSessionHash : null, input.browserHash, row.browser_generation, input.browserRef, input.operationId, input.proofHash]);
  if (!created.rowCount) throw new CustomerRepositoryError('unavailable');
  const published = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$5
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND generation=$4`,
  [input.parentRef, input.tenantRef, input.browserHash, row.browser_generation, input.sessionId]);
  if (!published.rowCount) throw new CustomerRepositoryError('unavailable');
  const consumed = await client.query(`UPDATE customer.verification_intents SET state='consumed',consumed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND state='open' AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.operationId]);
  if (!consumed.rowCount) throw new CustomerRepositoryError('unavailable');
  await finish(client, input, 'approved', 'consumed', input.sessionId);
  await recordSessionPublication(client, { ...input, method: 'phone' });
  const result = await session(client, input, input.sessionHash, input.browserHash);
  if (!result) throw new CustomerRepositoryError('unavailable');
  return { kind: 'session', session: result };
}
