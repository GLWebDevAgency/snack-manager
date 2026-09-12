import type { PoolClient } from 'pg';
import type { VerificationFunding, VerificationReservation } from './port';
import { dbTime } from './queries';
import { lockProductionBudget } from './production-budget';

type ParentBudget = { send_limit: string; sms_limit: string; verification_limit: string;
  reserved_sends: string; reserved_sms: string; reserved_verifications: string };
type PaidBudget = { authorization_ref: string; currency: string; authorized_spend_microusd: string;
  reserved_spend_microusd: string; expires_at: Date };

/** Every funding mode takes the same parent lock FIRST. No remote I/O here. */
export async function lockVerificationBudget(client: PoolClient, input: VerificationReservation): Promise<{
  funding: VerificationFunding; canReserve: boolean; planExpiresAt: number;
} | null> {
  const l = input.limits;
  if ('productionBudget' in l) return lockProductionBudget(client, { ...input, limits: l });
  if ((await client.query(`SELECT 1 FROM customer.production_budget_activation WHERE parent_ref=$1
    UNION ALL SELECT 1 FROM customer.production_admission_policies WHERE parent_ref=$1`, [input.parentRef])).rowCount) return null;
  const paid = 'paidBudget' in l ? l.paidBudget : null;
  const sendLimit = 'paidBudget' in l ? l.maxSendReservations : l.trialSendReservations;
  const smsLimit = 'paidBudget' in l ? 0 : l.freeSmsUnitsRemainingAtObservation;
  const verificationLimit = 'paidBudget' in l ? 0 : l.freeVerificationUnitsRemainingAtObservation;
  await client.query(`INSERT INTO customer.parent_budgets(parent_ref,send_limit,sms_limit,verification_limit)
    VALUES($1,$2,$3,$4) ON CONFLICT(parent_ref) DO NOTHING`, [input.parentRef, sendLimit, smsLimit, verificationLimit]);
  const parent = (await client.query<ParentBudget>(
    'SELECT * FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef])).rows[0]!;
  const now = await dbTime(client);
  if (input.planExpiresAt <= now || (paid && paid.expiresAt <= now)) return null;
  const caps = [Math.min(Number(parent.send_limit), sendLimit), Math.min(Number(parent.sms_limit), smsLimit),
    Math.min(Number(parent.verification_limit), verificationLimit)];
  // A paid transition seals BOTH existing free caps. Neither legacy replay,
  // refreshed evidence nor rolling back application code can raise them again.
  const lowerParentCaps = () => client.query(`UPDATE customer.parent_budgets SET send_limit=$2,sms_limit=$3,verification_limit=$4
    WHERE parent_ref=$1`, [input.parentRef, ...caps]);
  const sendsAvailable = BigInt(parent.reserved_sends) + 1n <= BigInt(caps[0]!);
  if (!paid) {
    await lowerParentCaps();
    return { funding: { mode: 'trial' }, planExpiresAt: input.planExpiresAt,
      canReserve: sendsAvailable && BigInt(parent.reserved_sms) + BigInt(l.smsUnitsReservedPerSend) <= BigInt(caps[1]!)
        && BigInt(parent.reserved_verifications) + 1n <= BigInt(caps[2]!) };
  }

  await client.query(`INSERT INTO customer.paid_budgets
    (parent_ref,authorization_ref,currency,authorized_spend_microusd,expires_at)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(parent_ref) DO NOTHING`,
  [input.parentRef, paid.authorizationRef, paid.currency, paid.authorizedSpendMicrousd, new Date(paid.expiresAt)]);
  const budget = (await client.query<PaidBudget>(
    'SELECT * FROM customer.paid_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef])).rows[0]!;
  // Authorization is one-off per parent; a new reference never starts a new pot.
  if (budget.authorization_ref !== paid.authorizationRef || budget.currency !== paid.currency) return null;
  await lowerParentCaps();
  const authorized = Math.min(Number(budget.authorized_spend_microusd), paid.authorizedSpendMicrousd);
  const expiresAt = Math.min(budget.expires_at.getTime(), paid.expiresAt);
  await client.query(`UPDATE customer.paid_budgets SET authorized_spend_microusd=$2,expires_at=$3 WHERE parent_ref=$1`,
    [input.parentRef, authorized, new Date(expiresAt)]);
  const freshNow = await dbTime(client);
  if (expiresAt <= freshNow || input.planExpiresAt <= freshNow) return null;
  return {
    funding: { mode: 'paid', authorizationRef: paid.authorizationRef, currency: 'USD',
      reservedMicrousd: paid.reservePerSendMicrousd, expiresAt },
    planExpiresAt: Math.min(input.planExpiresAt, expiresAt),
    canReserve: sendsAvailable && BigInt(budget.reserved_spend_microusd) + BigInt(paid.reservePerSendMicrousd) <= BigInt(authorized),
  };
}
