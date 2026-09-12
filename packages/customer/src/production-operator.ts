import type { Pool } from 'pg';
import { z } from 'zod';
import { CustomerRepositoryError, withCustomerScope } from './client';
import { lockIntentParent } from './intent-queries';
import { validate } from './validation';

const ref = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const scope = z.object({ parentRef: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/), tenantRef: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/) });
const positive = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const time = z.number().int().min(0).max(8_640_000_000_000_000);
export const CustomerProductionBudgetAuthorizationSchema = scope.extend({ authorizationRef: ref, serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/),
  currency: z.literal('USD'), authorizedSpendMicrousd: positive, reservePerSendMicrousd: positive,
  maxSendReservations: positive, costEvidenceReference: ref, notBefore: time, expiresAt: time,
}).strict().refine(value => value.expiresAt>value.notBefore && value.reservePerSendMicrousd<=value.authorizedSpendMicrousd);
export const CustomerProductionAdmissionPolicySchema = scope.extend({ policyRef: ref, windowMs: z.number().int().min(60_000).max(86_400_000),
  browserSourceLimit: z.number().int().min(1).max(1000), browserTenantLimit: z.number().int().min(1).max(100000),
  browserParentLimit: z.number().int().min(1).max(100000), intentBrowserLimit: z.number().int().min(1).max(1000),
  intentSourceLimit: z.number().int().min(1).max(1000), intentTenantLimit: z.number().int().min(1).max(100000),
  intentParentLimit: z.number().int().min(1).max(100000),
}).strict();
export type CustomerProductionBudgetAuthorization = z.infer<typeof CustomerProductionBudgetAuthorizationSchema>;
export type CustomerProductionAdmissionPolicy = z.infer<typeof CustomerProductionAdmissionPolicySchema>;

/** Use the dedicated migration/operator connection, never the runtime pool. No role is created or granted here. */
export class PostgresCustomerProductionOperator {
  constructor(private readonly pool: Pool) {}
  async authorizeBudget(raw: CustomerProductionBudgetAuthorization): Promise<void> {
    const input = validate(CustomerProductionBudgetAuthorizationSchema, raw);
    await withCustomerScope(this.pool, input, async client => {
      await lockIntentParent(client, input);
      const values = [input.parentRef, input.tenantRef, input.authorizationRef, input.serviceSid, input.currency,
        input.authorizedSpendMicrousd, input.reservePerSendMicrousd, input.maxSendReservations,
        input.costEvidenceReference, new Date(input.notBefore), new Date(input.expiresAt)];
      await client.query(`INSERT INTO customer.production_budget_authorizations
        (parent_ref,tenant_ref,authorization_ref,service_sid,currency,authorized_spend_microusd,reserve_per_send_microusd,
         max_send_reservations,cost_evidence_reference,not_before,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`, values);
      const exact = await client.query(`SELECT 1 FROM customer.production_budget_authorizations WHERE
        (parent_ref,tenant_ref,authorization_ref,service_sid,currency,authorized_spend_microusd,reserve_per_send_microusd,
         max_send_reservations,cost_evidence_reference,not_before,expires_at)=($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, values);
      if (!exact.rowCount) throw new CustomerRepositoryError('invalid_input');
    });
  }
  async activateBudget(raw: z.infer<typeof scope> & { authorizationRef: string; expectedActiveAuthorizationRef: string | null }): Promise<boolean> {
    const input = validate(scope.extend({ authorizationRef: ref, expectedActiveAuthorizationRef: ref.nullable() }).strict(), raw);
    return withCustomerScope(this.pool, input, async client => {
      await lockIntentParent(client, input);
      await client.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef]);
      const active = (await client.query<{ authorization_ref: string; tenant_ref: string }>(
        'SELECT authorization_ref,tenant_ref FROM customer.production_budget_activation WHERE parent_ref=$1', [input.parentRef])).rows[0];
      if (active?.authorization_ref===input.authorizationRef && active.tenant_ref===input.tenantRef) return true;
      if ((active?.authorization_ref ?? null)!==input.expectedActiveAuthorizationRef || (active && active.tenant_ref!==input.tenantRef)) return false;
      if (active) await client.query('UPDATE customer.production_budget_activation SET authorization_ref=$3 WHERE parent_ref=$1 AND tenant_ref=$2',
        [input.parentRef, input.tenantRef, input.authorizationRef]);
      else await client.query('INSERT INTO customer.production_budget_activation(parent_ref,tenant_ref,authorization_ref) VALUES($1,$2,$3)',
        [input.parentRef, input.tenantRef, input.authorizationRef]);
      return true;
    });
  }
  async revokeBudget(raw: z.infer<typeof scope> & { authorizationRef: string }): Promise<boolean> {
    const input = validate(scope.extend({ authorizationRef: ref }).strict(), raw);
    return withCustomerScope(this.pool, input, async client => {
      await lockIntentParent(client, input);
      await client.query('SELECT parent_ref FROM customer.parent_budgets WHERE parent_ref=$1 FOR UPDATE', [input.parentRef]);
      return (await client.query(`UPDATE customer.production_budget_authorizations SET revoked_at=COALESCE(revoked_at,clock_timestamp())
        WHERE parent_ref=$1 AND tenant_ref=$2 AND authorization_ref=$3`, [input.parentRef, input.tenantRef, input.authorizationRef])).rowCount===1;
    });
  }
  async authorizeAdmissions(raw: CustomerProductionAdmissionPolicy): Promise<void> {
    const input = validate(CustomerProductionAdmissionPolicySchema, raw);
    await withCustomerScope(this.pool, input, async client => {
      await lockIntentParent(client, input);
      const values = [input.parentRef, input.tenantRef, input.policyRef, input.windowMs, input.browserSourceLimit,
        input.browserTenantLimit, input.browserParentLimit, input.intentBrowserLimit, input.intentSourceLimit,
        input.intentTenantLimit, input.intentParentLimit];
      await client.query(`INSERT INTO customer.production_admission_policies(parent_ref,tenant_ref,policy_ref,window_ms,
        browser_source_limit,browser_tenant_limit,browser_parent_limit,intent_browser_limit,intent_source_limit,intent_tenant_limit,intent_parent_limit)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`, values);
      if (!(await client.query(`SELECT 1 FROM customer.production_admission_policies WHERE
        (parent_ref,tenant_ref,policy_ref,window_ms,browser_source_limit,browser_tenant_limit,browser_parent_limit,
         intent_browser_limit,intent_source_limit,intent_tenant_limit,intent_parent_limit)=($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, values)).rowCount) {
        throw new CustomerRepositoryError('invalid_input');
      }
    });
  }
}
