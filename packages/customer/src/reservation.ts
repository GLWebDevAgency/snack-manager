import type { PoolClient } from 'pg';
import type { ReservationResult, VerificationReservation } from './port';
import { challenge, currentChallenge, currentBrowserGeneration, dbTime, pendingView } from './queries';
import { lockVerificationBudget } from './budgets';
import { validOpenIntent } from './intent-queries';

export async function reserveVerification(client: PoolClient, input: VerificationReservation): Promise<ReservationResult> {
  const l = input.limits;
  if (!await validOpenIntent(client, input)) return { kind: 'denied' };
  const budget = await lockVerificationBudget(client, input);
  if (!budget) return { kind: 'denied' };
  const intent = await validOpenIntent(client, input);
  if (!intent) return { kind: 'denied' };
  // Always read wall-clock AFTER the lock; input.now is not an authority.
  const now = await dbTime(client);
  if (budget.planExpiresAt <= now) return { kind: 'denied' };
  const existingId = (await client.query<{ id: string }>(`SELECT id FROM customer.challenges
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3`, [input.parentRef, input.tenantRef, input.operationId])).rows[0];
  const existing = existingId ? await challenge(client, input, existingId.id) : null;
  if (existing) {
    if (existing.request_hash !== input.requestHash || existing.browser_hash !== input.browserHash
      || existing.browser_ref !== input.browserRef || existing.intent_operation_id !== input.operationId) return { kind: 'denied' };
    if (!await currentChallenge(client, existing)) return { kind: 'denied' };
    if (existing.expires_at.getTime() <= now) return { kind: 'denied' };
    if (existing.state === 'pending') return { kind: 'pending', challenge: pendingView(existing) };
    return { kind: ['reserved', 'checking', 'uncertain'].includes(existing.state) ? 'uncertain' : 'denied' };
  }
  if (input.expiresAt <= now) return { kind: 'denied' };
  if (!budget.canReserve) return { kind: 'denied' };
  const counts = (await client.query<{ total: number; tenant: number; phone: number; ip: number; cooldown: boolean }>(`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE tenant_ref=$2)::int AS tenant,
      count(*) FILTER (WHERE global_phone_hash=$3)::int AS phone,
      count(*) FILTER (WHERE ip_hash=$4)::int AS ip,
      COALESCE(bool_or(global_phone_hash=$3 AND reserved_at>clock_timestamp()-$6::bigint*interval '1 millisecond'),false) AS cooldown
    FROM customer.reservations WHERE parent_ref=$1 AND reserved_at>clock_timestamp()-$5::bigint*interval '1 millisecond'`,
  [input.parentRef, input.tenantRef, input.globalPhoneHash, input.ipHash, l.windowMs, l.cooldownMs])).rows[0]!;
  if (counts.total >= l.globalSendReservations || counts.tenant >= l.tenantSendReservations
    || counts.phone >= l.phoneSendReservations || counts.ip >= l.ipSendReservations || counts.cooldown) return { kind: 'denied' };
  const active = await client.query(`SELECT 1 FROM customer.phone_guards
    WHERE parent_ref=$1 AND global_phone_hash=$2 AND active_until>clock_timestamp()`, [input.parentRef, input.globalPhoneHash]);
  if (active.rowCount) return { kind: 'denied' };
  // A rejected final time predicate must not leave an unreserved context behind.
  await client.query('SAVEPOINT browser_reservation');
  await client.query(`INSERT INTO customer.browser_contexts(parent_ref,tenant_ref,browser_hash)
    VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [input.parentRef, input.tenantRef, input.browserHash]);
  const generation = await currentBrowserGeneration(client, input, input.browserHash);
  // Keep one final generation available for logout after publication.
  if (generation === null || generation !== intent.browser_generation || BigInt(generation) >= BigInt(Number.MAX_SAFE_INTEGER) - 1n) {
    await client.query('ROLLBACK TO SAVEPOINT browser_reservation');
    await client.query('RELEASE SAVEPOINT browser_reservation');
    return { kind: 'denied' };
  }
  // A final SQL time predicate closes an expired plan after any lock/query delay.
  const inserted = await client.query<{ expires_at: Date }>(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO customer.challenges
    (id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,service_sid,max_checks,created_at,expires_at,browser_generation,browser_ref,intent_operation_id)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,stamp.now,LEAST($11::timestamptz,stamp.now+interval '10 minutes',p.expires_at,i.expires_at),$13,$14,$4
    FROM stamp CROSS JOIN customer.browser_preparations p JOIN customer.verification_intents i
      ON (i.parent_ref,i.tenant_ref,i.browser_ref,i.browser_hash)=(p.parent_ref,p.tenant_ref,p.browser_ref,p.browser_hash)
    WHERE $11::timestamptz>stamp.now AND $12::timestamptz>stamp.now
      AND p.parent_ref=$2 AND p.tenant_ref=$3 AND p.browser_ref=$14 AND p.browser_hash=$6
      AND p.confirmed_at IS NOT NULL AND p.expires_at>stamp.now AND i.operation_id=$4
      AND i.proof_hash=$15 AND i.browser_generation=$13 AND i.state='open' AND i.expires_at>stamp.now RETURNING expires_at`,
  [input.challengeId, input.parentRef, input.tenantRef, input.operationId, input.requestHash, input.browserHash,
    input.phoneHash, input.encryptedPhone, input.serviceSid, l.challengeCheckAttempts, new Date(input.expiresAt), new Date(budget.planExpiresAt), generation, input.browserRef, input.proofHash]);
  if (!inserted.rowCount) {
    await client.query('ROLLBACK TO SAVEPOINT browser_reservation');
    await client.query('RELEASE SAVEPOINT browser_reservation');
    return { kind: 'denied' };
  }
  await client.query('RELEASE SAVEPOINT browser_reservation');
  const funding = budget.funding;
  await client.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units,
    funding_kind,authorization_ref,reserved_microusd,funding_expires_at,cost_evidence_reference)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [input.operationId, input.parentRef, input.tenantRef, input.challengeId,
    input.globalPhoneHash, input.ipHash, input.evidenceReference, l.smsUnitsReservedPerSend, funding.mode,
    funding.mode === 'paid' ? funding.authorizationRef : null, funding.mode === 'paid' ? funding.reservedMicrousd : 0,
    funding.mode === 'paid' ? new Date(funding.expiresAt) : null, 'paidBudget' in l ? l.paidBudget.costEvidenceReference : null]);
  // Provider exclusion is independent of a shorter application/evidence expiry.
  // Pilot prerequisite: provider validity is attested at 10 min; 5 s covers transport.
  await client.query(`INSERT INTO customer.phone_guards(parent_ref,global_phone_hash,active_until)
    VALUES($1,$2,clock_timestamp()+interval '10 minutes 5 seconds')
    ON CONFLICT(parent_ref,global_phone_hash) DO UPDATE SET active_until=GREATEST(customer.phone_guards.active_until,EXCLUDED.active_until)`,
  [input.parentRef, input.globalPhoneHash]);
  await client.query(`UPDATE customer.parent_budgets SET reserved_sends=reserved_sends+1,
    reserved_sms=reserved_sms+$2,reserved_verifications=reserved_verifications+$3 WHERE parent_ref=$1`,
  [input.parentRef, funding.mode === 'trial' ? l.smsUnitsReservedPerSend : 0, funding.mode === 'trial' ? 1 : 0]);
  if (funding.mode === 'paid') await client.query(`UPDATE customer.paid_budgets
    SET reserved_spend_microusd=reserved_spend_microusd+$2 WHERE parent_ref=$1`, [input.parentRef, funding.reservedMicrousd]);
  return { kind: 'reserved', challengeId: input.challengeId };
}
