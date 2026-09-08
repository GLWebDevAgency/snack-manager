import type { PoolClient } from 'pg';
import type { CustomerBrowserBinding, CustomerIntentBinding, CustomerScope, CustomerVerificationIntent } from './port';
import { validateBrowser } from './browser-preparation';

export type IntentRow = {
  operation_id: string; browser_ref: string; browser_hash: string; proof_hash: string | null;
  browser_generation: string; state: 'open' | 'closed' | 'consumed'; expires_at: Date;
};
/** This independent lock is always BEFORE a possibly-existing parent budget row.
 * It serializes guest closure too, without creating a financial record. */
export async function lockIntentParent(client: PoolClient, scope: CustomerScope) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`customer:intent:${scope.parentRef}`]);
}
export async function intentRow(client: PoolClient, input: CustomerBrowserBinding & { operationId: string }) {
  return (await client.query<IntentRow>(`SELECT * FROM customer.verification_intents
    WHERE parent_ref=$1 AND tenant_ref=$2 AND operation_id=$3 AND browser_ref=$4 AND browser_hash=$5 FOR UPDATE`,
  [input.parentRef, input.tenantRef, input.operationId, input.browserRef, input.browserHash])).rows[0] ?? null;
}
export async function intentGeneration(client: PoolClient, input: CustomerBrowserBinding): Promise<string> {
  return (await client.query<{ generation: string }>(`SELECT generation FROM customer.browser_contexts
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 FOR UPDATE`,
  [input.parentRef, input.tenantRef, input.browserHash])).rows[0]?.generation ?? '0';
}
export async function intentView(client: PoolClient, row: IntentRow): Promise<CustomerVerificationIntent> {
  const now = (await client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now;
  return { operationId: row.operation_id, state: row.state === 'closed' ? 'closed'
    : row.expires_at <= now ? 'expired' : row.state, expiresAt: row.expires_at.getTime() };
}
export async function validOpenIntent(client: PoolClient, input: CustomerIntentBinding) {
  const row = await intentRow(client, input);
  if (!row || row.proof_hash !== input.proofHash || row.state !== 'open'
    || row.browser_generation !== await intentGeneration(client, input) || !await validateBrowser(client, input)) return null;
  return (await intentView(client, row)).state === 'open' ? row : null;
}
