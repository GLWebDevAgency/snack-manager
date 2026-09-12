import type { PoolClient } from 'pg';
import type { CustomerScope, ProductionVerificationReservation, VerificationFunding } from './port';

export type ProductionSendAvailabilityInput = CustomerScope & {
  authorizationRef: string; serviceSid: string; costEvidenceReference: string; reservePerSendMicrousd: number;
};
type AuthorizationRow = {
  authorization_ref: string; expires_at: Date; reserved_sends: string; max_send_reservations: string;
  reserved_spend_microusd: string; authorized_spend_microusd: string; reserve_per_send_microusd: string;
};
async function availableAuthorization(client: PoolClient, input: ProductionSendAvailabilityInput) {
  return (await client.query<AuthorizationRow>(`SELECT a.* FROM customer.production_budget_authorizations a
    JOIN customer.production_budget_activation p ON (p.parent_ref,p.tenant_ref,p.authorization_ref)
      =(a.parent_ref,a.tenant_ref,a.authorization_ref)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.authorization_ref=$3 AND a.service_sid=$4
      AND a.cost_evidence_reference=$5 AND a.reserve_per_send_microusd=$6
      AND a.activated_at IS NOT NULL AND a.revoked_at IS NULL
      AND a.not_before<=clock_timestamp() AND a.expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.authorizationRef, input.serviceSid, input.costEvidenceReference, input.reservePerSendMicrousd])).rows[0] ?? null;
}
const hasCapacity = (row: AuthorizationRow) => BigInt(row.reserved_sends) < BigInt(row.max_send_reservations)
  && BigInt(row.reserved_spend_microusd) + BigInt(row.reserve_per_send_microusd) <= BigInt(row.authorized_spend_microusd);

/** Advisory status only; the reservation INSERT makes the final atomic debit. */
export async function productionSendAvailability(client: PoolClient, input: ProductionSendAvailabilityInput): Promise<boolean> {
  const row = await availableAuthorization(client, input);
  return row !== null && hasCapacity(row);
}
export async function lockProductionBudget(client: PoolClient, input: ProductionVerificationReservation): Promise<{
  funding: VerificationFunding; canReserve: boolean; planExpiresAt: number;
} | null> {
  if (!(await client.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef])).rowCount) return null;
  const row = await availableAuthorization(client, { ...input, ...input.limits.productionBudget });
  if (!row) return null;
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now.getTime();
  if (input.planExpiresAt<=now || row.expires_at.getTime()<=now) return null;
  return { funding: { mode: 'production_paid', authorizationRef: row.authorization_ref, currency: 'USD',
    reservedMicrousd: Number(row.reserve_per_send_microusd), expiresAt: row.expires_at.getTime() },
  canReserve: hasCapacity(row), planExpiresAt: Math.min(input.planExpiresAt, row.expires_at.getTime()) };
}
/** Original reservation A, independent of current B and of A's remaining balance. */
export async function revalidateProductionFunding(client: PoolClient, input: CustomerScope & { challengeId: string }): Promise<boolean> {
  return (await client.query(`SELECT 1 FROM customer.reservations r
    JOIN customer.production_budget_authorizations a ON (a.parent_ref,a.tenant_ref,a.authorization_ref)
      =(r.parent_ref,r.tenant_ref,r.production_authorization_ref)
    JOIN customer.challenges c ON (c.parent_ref,c.tenant_ref,c.id)=(r.parent_ref,r.tenant_ref,r.challenge_id)
    WHERE r.parent_ref=$1 AND r.tenant_ref=$2 AND r.challenge_id=$3 AND r.funding_kind='production_paid'
      AND c.service_sid=a.service_sid AND c.expires_at>clock_timestamp() AND c.state IN ('reserved','pending','checking')
      AND a.activated_at IS NOT NULL AND a.revoked_at IS NULL
      AND a.not_before<=clock_timestamp() AND LEAST(a.expires_at,r.funding_expires_at)>clock_timestamp()
      AND r.reserved_microusd=a.reserve_per_send_microusd AND r.cost_evidence_reference=a.cost_evidence_reference`,
  [input.parentRef, input.tenantRef, input.challengeId])).rowCount === 1;
}
