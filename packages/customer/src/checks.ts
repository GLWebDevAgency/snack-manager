import type { PoolClient } from 'pg';
import type { CheckClaim, CustomerIdentityRepository, CustomerSession } from './port';
import { CustomerRepositoryError } from './client';
import { challenge, currentChallenge, dbTime, fundingAllowsCheck, pendingView, session, type ChallengeRow } from './queries';

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
  if (!row || row.browser_hash !== input.browserHash || row.state !== 'pending'
    || row.checks_used >= row.max_checks || row.expires_at.getTime() <= await dbTime(client)) return null;
  if (!await currentChallenge(client, row)) return null;
  if (!fundingAllowsCheck(row, await dbTime(client))) return null;
  const attempt = await client.query(`INSERT INTO customer.check_attempts(id,parent_ref,tenant_ref,challenge_id)
    VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [input.checkId, input.parentRef, input.tenantRef, row.id]);
  if (!attempt.rowCount) return null;
  const changed = await client.query<ChallengeRow>(`UPDATE customer.challenges
    SET state='checking',check_id=$4,checks_used=checks_used+1
    WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 AND expires_at>clock_timestamp() RETURNING *`,
  [input.parentRef, input.tenantRef, row.id, input.checkId]);
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

export async function recoverVerification(client: PoolClient, input: CheckClaim & { sessionHash: string }): Promise<CustomerSession | null> {
  const row = (await client.query<{ session_id: string }>(`SELECT a.session_id FROM customer.challenges c
    JOIN customer.check_attempts a ON (a.parent_ref,a.tenant_ref,a.challenge_id,a.id)=(c.parent_ref,c.tenant_ref,c.id,c.check_id)
    WHERE c.parent_ref=$1 AND c.tenant_ref=$2 AND c.id=$3 AND c.browser_hash=$4 AND c.check_id=$5
      AND c.state='consumed' AND a.state='approved'`,
  [input.parentRef, input.tenantRef, input.challengeId, input.browserHash, input.checkId])).rows[0];
  if (!row) return null;
  const current = await session(client, input, input.sessionHash, input.browserHash);
  return current?.sessionId === row.session_id ? current : null;
}

export async function completeVerification(client: PoolClient, input: Completion): Promise<CustomerSession | null> {
  const row = await challenge(client, input, input.challengeId);
  if (!row || row.browser_hash !== input.browserHash || row.check_id !== input.checkId) return null;
  if (row.state === 'consumed') return recoverVerification(client, input);
  if (row.state !== 'checking') return null;
  if (!await currentChallenge(client, row)) {
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
    await client.query('SAVEPOINT new_account');
    await client.query('INSERT INTO customer.accounts(id,parent_ref,tenant_ref) VALUES($1,$2,$3)',
      [accountId, input.parentRef, input.tenantRef]);
    const contact = await client.query(`INSERT INTO customer.verified_contacts(parent_ref,tenant_ref,account_id,phone_hash,encrypted_phone)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_ref,phone_hash) DO NOTHING`,
    [input.parentRef, input.tenantRef, accountId, row.phone_hash, row.encrypted_phone]);
    if (!contact.rowCount) {
      // A changed provider parent cannot create a second identity or reveal the old one.
      await client.query('ROLLBACK TO SAVEPOINT new_account');
      await finish(client, input, 'rejected', 'rejected'); return null;
    }
    await client.query('RELEASE SAVEPOINT new_account');
  }
  const created = await client.query(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO customer.sessions(id,parent_ref,tenant_ref,account_id,session_hash,account_version,created_at,expires_at,browser_hash,browser_generation)
    SELECT $1,$2,$3,a.id,$5,a.session_version,stamp.now,LEAST($6::timestamptz,stamp.now+interval '7 days'),$9,$10::bigint+1
    FROM customer.accounts a CROSS JOIN stamp WHERE a.parent_ref=$2 AND a.tenant_ref=$3 AND a.id=$4 AND a.active
      AND $6::timestamptz>stamp.now AND $7::timestamptz>stamp.now
      AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=$2 AND s.tenant_ref=$3
        AND s.account_id=a.id AND s.session_hash=$8 AND s.revoked_at IS NULL AND s.expires_at>stamp.now
        AND s.account_version=a.session_version))`,
  [input.sessionId, input.parentRef, input.tenantRef, accountId, input.sessionHash, new Date(input.sessionExpiresAt),
    row.expires_at, existing ? input.existingSessionHash : null, input.browserHash, row.browser_generation]);
  if (!created.rowCount) throw new CustomerRepositoryError('unavailable');
  const published = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=$5
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND generation=$4`,
  [input.parentRef, input.tenantRef, input.browserHash, row.browser_generation, input.sessionId]);
  if (!published.rowCount) throw new CustomerRepositoryError('unavailable');
  await finish(client, input, 'approved', 'consumed', input.sessionId);
  const result = await session(client, input, input.sessionHash, input.browserHash);
  if (!result) throw new CustomerRepositoryError('unavailable');
  return result;
}
