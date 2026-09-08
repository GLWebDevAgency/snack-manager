import type { PoolClient } from 'pg';
import type { ReservationResult, VerificationReservation } from './port';
import { dbTime, pendingView, type ChallengeRow } from './queries';

export async function reserveVerification(client: PoolClient, input: VerificationReservation): Promise<ReservationResult> {
  const l = input.limits;
  await client.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
    VALUES($1,$2,$3,$4) ON CONFLICT(parent_ref) DO NOTHING`,
  [input.parentRef, l.trialSendReservations, l.freeSmsUnitsRemainingAtObservation, l.freeVerificationUnitsRemainingAtObservation]);
  const budget = (await client.query<{ send_limit: string; sms_limit: string; verification_limit: string;
    reserved_sends: string; reserved_sms: string; reserved_verifications: string }>(
    'SELECT * FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef])).rows[0]!;
  // Always read wall-clock AFTER the lock; input.now is not an authority.
  const now = await dbTime(client);
  if (input.planExpiresAt <= now) return { kind: 'denied' };
  const caps = [Math.min(Number(budget.send_limit), l.trialSendReservations),
    Math.min(Number(budget.sms_limit), l.freeSmsUnitsRemainingAtObservation),
    Math.min(Number(budget.verification_limit), l.freeVerificationUnitsRemainingAtObservation)];
  // Every live observation lowers the lifetime ceiling, including a replay.
  await client.query(`UPDATE customer.parent_budgets SET send_limit=$2,sms_limit=$3,verification_limit=$4
    WHERE parent_ref=$1`, [input.parentRef, ...caps]);
  const existing = (await client.query<ChallengeRow>(`SELECT * FROM customer.challenges
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3`, [input.parentRef, input.tenantRef, input.operationId])).rows[0];
  if (existing) {
    if (existing.request_hash !== input.requestHash || existing.browser_hash !== input.browserHash) return { kind: 'denied' };
    if (existing.expires_at.getTime() <= now) return { kind: 'denied' };
    if (existing.state === 'pending') return { kind: 'pending', challenge: pendingView(existing) };
    return { kind: ['reserved', 'checking', 'uncertain'].includes(existing.state) ? 'uncertain' : 'denied' };
  }
  if (input.expiresAt <= now) return { kind: 'denied' };
  if (Number(budget.reserved_sends) + 1 > caps[0]!
    || Number(budget.reserved_sms) + l.smsUnitsReservedPerSend > caps[1]!
    || Number(budget.reserved_verifications) + 1 > caps[2]!) return { kind: 'denied' };
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
  // A final SQL time predicate closes an expired plan after any lock/query delay.
  const inserted = await client.query<{ expires_at: Date }>(`WITH stamp AS MATERIALIZED (SELECT clock_timestamp() AS now)
    INSERT INTO customer.challenges
    (id,parent_ref,tenant_ref,operation_id,request_hash,browser_hash,phone_hash,encrypted_phone,service_sid,max_checks,created_at,expires_at)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,stamp.now,LEAST($11::timestamptz,stamp.now+interval '10 minutes') FROM stamp
    WHERE $11::timestamptz>stamp.now AND $12::timestamptz>stamp.now RETURNING expires_at`,
  [input.challengeId, input.parentRef, input.tenantRef, input.operationId, input.requestHash, input.browserHash,
    input.phoneHash, input.encryptedPhone, input.serviceSid, l.challengeCheckAttempts, new Date(input.expiresAt), new Date(input.planExpiresAt)]);
  if (!inserted.rowCount) return { kind: 'denied' };
  await client.query(`INSERT INTO customer.reservations(id,parent_ref,tenant_ref,challenge_id,global_phone_hash,ip_hash,evidence_reference,sms_units)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [input.operationId, input.parentRef, input.tenantRef, input.challengeId,
    input.globalPhoneHash, input.ipHash, input.evidenceReference, l.smsUnitsReservedPerSend]);
  // Provider exclusion is independent of a shorter application/evidence expiry.
  // Pilot prerequisite: provider validity is attested at 10 min; 5 s covers transport.
  await client.query(`INSERT INTO customer.phone_guards(parent_ref,global_phone_hash,active_until)
    VALUES($1,$2,clock_timestamp()+interval '10 minutes 5 seconds')
    ON CONFLICT(parent_ref,global_phone_hash) DO UPDATE SET active_until=GREATEST(customer.phone_guards.active_until,EXCLUDED.active_until)`,
  [input.parentRef, input.globalPhoneHash]);
  await client.query(`UPDATE customer.parent_budgets SET reserved_sends=reserved_sends+1,
    reserved_sms=reserved_sms+$2,reserved_verifications=reserved_verifications+1 WHERE parent_ref=$1`, [input.parentRef, l.smsUnitsReservedPerSend]);
  return { kind: 'reserved', challengeId: input.challengeId };
}
