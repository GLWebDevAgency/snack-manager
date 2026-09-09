import type { PoolClient } from 'pg';
import type { CustomerIdentityRepository } from './port';
import type { CustomerAccessBinding, CustomerRecoveryGrant, CustomerRecoveryAttemptResult } from './access-port';
import { accessRow, args, canAdmit, reserveAdmission, type StoredKey } from './access-queries';
import { intentRow, validOpenIntent } from './intent-queries';
import { validateBrowser } from './browser-preparation';
import { dbTime } from './queries';
import { CustomerRepositoryError } from './client';
type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];
export type RecoveryRow = {
  operation_id: string; id: string; browser_generation: string; account_id: string; account_version: string;
  source_version: string; source_hash: string; state: 'open' | 'closed' | 'expired' | 'activated'; expires_at: Date;
  registration_id: string | null; origin: string | null; rp_id: string | null; registration_challenge: string | null;
  user_handle: string | null; registration_request_hash: string | null; credential: StoredKey | null; registration_counter: string | null;
  assertion_id: string | null; assertion_challenge: string | null; assertion_request_hash: string | null; asserted_at: Date | null;
  recovery_receipts: { rotationId: string; expectedVersion: number; codeHash: string }[];
  activation_intent_id: string | null; failed_confirmations: number;
  activation_id: string | null; activation_request_hash: string | null; session_id: string | null;
};
export const grantView = (r: RecoveryRow): CustomerRecoveryGrant => ({ operationId: r.operation_id, attemptId: r.id,
  expiresAt: r.expires_at.getTime(), stage: r.asserted_at ? 'recovery_required' : r.credential ? 'assertion_required' : 'registration_required',
  recoveryVersion: r.recovery_receipts.length });
export async function recoveryRow(client: PoolClient, input: CustomerAccessBinding, active = true) {
  const intent = active ? await validOpenIntent(client, input) : await intentRow(client, input);
  if (!intent || intent.proof_hash !== input.proofHash || intent.state === 'closed'
    || !await validateBrowser(client, input) || intent.expires_at.getTime() <= await dbTime(client)) return null;
  const row = (await client.query<RecoveryRow>(`SELECT g.* FROM customer.account_recovery_grants g
    JOIN customer.credential_access_attempts t ON (t.parent_ref,t.tenant_ref,t.operation_id,t.id)=(g.parent_ref,g.tenant_ref,g.operation_id,g.id)
    WHERE g.parent_ref=$1 AND g.tenant_ref=$2 AND g.operation_id=$3 AND g.id=$4 AND g.browser_ref=$5 AND g.browser_hash=$6
      AND t.method='recovery' AND t.state='granted' AND g.expires_at>clock_timestamp() FOR UPDATE OF g`,
  [...args(input), input.browserRef, input.browserHash])).rows[0];
  if (!row || (active && row.state !== 'open')) return null;
  if (active) {
    const target = await client.query(`SELECT 1 FROM customer.accounts a JOIN customer.recovery_codes c
      ON (c.parent_ref,c.tenant_ref,c.account_id)=(a.parent_ref,a.tenant_ref,a.id)
      WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.active AND a.session_version=$4
        AND c.version=$5 AND c.code_hash=$6 AND c.consumed_at IS NULL AND c.revoked_at IS NULL FOR UPDATE OF a,c`,
    [input.parentRef, input.tenantRef, row.account_id, row.account_version, row.source_version, row.source_hash]);
    if (target.rowCount !== 1 || !await validOpenIntent(client, input)) return null;
  }
  return row;
}
export async function freshGrant(client: PoolClient, input: CustomerAccessBinding) {
  const row = await recoveryRow(client, input); if (!row) throw new CustomerRepositoryError('unavailable'); return grantView(row);
}
export async function readAccountRecovery(client: PoolClient, input: Input<'readAccountRecovery'>): Promise<CustomerRecoveryAttemptResult | null> {
  const found = await accessRow(client, input); if (!found || found.row.method !== 'recovery') return null;
  const base = { operationId: input.operationId, attemptId: input.attemptId, expiresAt: found.row.expires_at.getTime() };
  if (found.intent.state === 'closed') return { ...base, state: 'closed' };
  if (base.expiresAt <= await dbTime(client)) return { ...base, state: 'expired' };
  if (found.row.state === 'denied') return { ...base, state: 'denied' };
  const row = await recoveryRow(client, input);
  return row ? { ...base, state: 'granted', grant: grantView(row) } : { ...base, state: 'failed' };
}
export async function beginAccountRecovery(client: PoolClient, input: Input<'beginAccountRecovery'>) {
  const previous = await accessRow(client, input);
  if (previous) return previous.row.method === 'recovery' && previous.row.request_hash === input.requestHash ? readAccountRecovery(client, input) : null;
  const intent = await validOpenIntent(client, input); if (!intent || !await canAdmit(client, input)) return null;
  const target = (await client.query<{ account_id: string; session_version: string; version: string }>(`
    SELECT c.account_id,a.session_version,c.version FROM customer.recovery_codes c JOIN customer.accounts a
      ON (a.parent_ref,a.tenant_ref,a.id)=(c.parent_ref,c.tenant_ref,c.account_id)
    WHERE c.parent_ref=$1 AND c.tenant_ref=$2 AND c.code_hash=$3 AND c.consumed_at IS NULL AND c.revoked_at IS NULL
      AND a.active AND a.session_version<9007199254740991 AND c.version<9007199254740991 FOR UPDATE OF c,a`,
  [input.parentRef, input.tenantRef, input.codeHash])).rows[0];
  let accepted = false;
  if (target) {
    // Time/explicit closure only: no silent takeover of a live grant. These
    // terminal transitions do not consume/revoke a code or change the account.
    await client.query(`UPDATE customer.account_recovery_grants g SET state=CASE WHEN g.expires_at<=clock_timestamp() THEN 'expired' ELSE 'closed' END
      WHERE g.parent_ref=$1 AND g.tenant_ref=$2 AND g.account_id=$3 AND g.state='open'
        AND (g.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM customer.verification_intents i
          WHERE (i.parent_ref,i.tenant_ref,i.operation_id)=(g.parent_ref,g.tenant_ref,g.operation_id) AND i.state='closed'))`,
    [input.parentRef, input.tenantRef, target.account_id]);
    accepted = (await client.query(`SELECT 1 FROM customer.account_recovery_grants WHERE parent_ref=$1 AND tenant_ref=$2 AND account_id=$3 AND state='open'`,
      [input.parentRef, input.tenantRef, target.account_id])).rowCount === 0;
  }
  await client.query(`INSERT INTO customer.credential_access_attempts(parent_ref,tenant_ref,operation_id,id,browser_ref,browser_hash,
    browser_generation,method,expires_at,request_hash,state,account_id,account_version,completed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'recovery',$8,$9,$10,$11,$12,clock_timestamp())`,
  [...args(input), input.browserRef, input.browserHash, intent.browser_generation, intent.expires_at, input.requestHash,
    accepted ? 'granted' : 'denied', accepted ? target!.account_id : null, accepted ? target!.session_version : null]);
  if (accepted) await client.query(`INSERT INTO customer.account_recovery_grants(parent_ref,tenant_ref,operation_id,id,browser_ref,browser_hash,
    browser_generation,account_id,account_version,source_version,source_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
  [...args(input), input.browserRef, input.browserHash, intent.browser_generation, target!.account_id, target!.session_version, target!.version, input.codeHash, intent.expires_at]);
  await reserveAdmission(client, input, 'recovery');
  return readAccountRecovery(client, input);
}
