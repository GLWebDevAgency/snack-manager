import type { PoolClient } from 'pg';
import { lockIntentParent } from './intent-queries';
import type { CustomerAdmissionInput, CustomerBrowserBinding, CustomerBrowserPreparation, CustomerScope } from './port';

type PreparationRow = {
  browser_ref: string; browser_hash: string | null; admission_expires_at: Date;
  expires_at: Date; confirmed_at: Date | null; state: CustomerBrowserPreparation['state'];
};
const projection = `*, CASE WHEN expires_at<=clock_timestamp()
  OR (confirmed_at IS NULL AND admission_expires_at<=clock_timestamp()) THEN 'expired'
  WHEN confirmed_at IS NOT NULL THEN 'confirmed' WHEN browser_hash IS NOT NULL THEN 'issued'
  ELSE 'prepared' END AS state`;
const view = (row: PreparationRow): CustomerBrowserPreparation => ({ browserRef: row.browser_ref,
  state: row.state, admissionExpiresAt: row.admission_expires_at.getTime(), expiresAt: row.expires_at.getTime() });
async function read(client: PoolClient, input: CustomerScope & { browserRef: string }) {
  return (await client.query<PreparationRow>(`SELECT ${projection} FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_ref=$3`,
  [input.parentRef, input.tenantRef, input.browserRef])).rows[0];
}
export async function prepareBrowser(client: PoolClient, input: CustomerScope & { browserRef: string } & CustomerAdmissionInput) {
  await lockIntentParent(client, input);
  // Separate namespace and no SMS-budget dependency. A public, non-destructible
  // journal has a lifetime cap; old references remain readable at saturation.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [`customer:browser-preparation:${input.parentRef}:${input.tenantRef}`]);
  const existing = await read(client, input);
  if (existing) return view(existing);
  const count = (await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2`, [input.parentRef, input.tenantRef])).rows[0]!.count;
  if (!input.admission && count >= 128) return null;
  await client.query(`WITH instant AS (SELECT clock_timestamp() AS at)
    INSERT INTO customer.browser_preparations (parent_ref,tenant_ref,browser_ref,created_at,admission_expires_at,expires_at,production_admission_policy_ref,admission_source_hash)
    SELECT $1,$2,$3,at,at+interval '10 minutes',at+interval '168 hours',$4,$5 FROM instant
    ON CONFLICT (parent_ref,tenant_ref,browser_ref) DO NOTHING`, [input.parentRef, input.tenantRef, input.browserRef, null, input.admission?.sourceHash ?? null]);
  const row = await read(client, input);
  return row ? view(row) : null;
}
export async function issueBrowser(client: PoolClient, input: CustomerBrowserBinding & { currentBrowserHash: string | null }) {
  // Deterministic row locking also serializes two attempts replacing each other's cookie.
  const locked = await client.query<PreparationRow>(`SELECT ${projection} FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2 AND (browser_ref=$3 OR browser_hash=$4)
    ORDER BY browser_ref FOR UPDATE`, [input.parentRef, input.tenantRef, input.browserRef, input.currentBrowserHash]);
  const target = locked.rows.find(row => row.browser_ref === input.browserRef);
  if (!target) return null;
  if (input.currentBrowserHash !== null) {
    const current = locked.rows.find(row => row.browser_hash === input.currentBrowserHash);
    if (!current || (current.browser_ref !== input.browserRef && (await read(client, {
      ...input, browserRef: current.browser_ref,
    }))?.state !== 'expired')) return null;
  }
  const changed = await client.query(`UPDATE customer.browser_preparations SET browser_hash=$4,issued_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_ref=$3 AND browser_hash IS NULL
      AND admission_expires_at>clock_timestamp() AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.browserRef, input.browserHash]);
  const row = await read(client, input);
  return row ? { preparation: view(row), emitCookie: changed.rowCount === 1 } : null;
}
export async function confirmBrowser(client: PoolClient, input: CustomerBrowserBinding) {
  await client.query(`SELECT browser_ref FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_ref=$3 FOR UPDATE`,
  [input.parentRef, input.tenantRef, input.browserRef]);
  await client.query(`UPDATE customer.browser_preparations SET confirmed_at=clock_timestamp()
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_ref=$3 AND browser_hash=$4 AND confirmed_at IS NULL
      AND admission_expires_at>clock_timestamp() AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.browserRef, input.browserHash]);
  const row = await read(client, input);
  return row && row.browser_hash === input.browserHash && row.state === 'confirmed' ? view(row) : null;
}
/** Rechecked by mutation SQL as well; this is not a lease beyond the transaction. */
export async function validateBrowser(client: PoolClient, input: CustomerBrowserBinding) {
  const row = (await client.query<{ expires_at: Date }>(`SELECT expires_at FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_ref=$3 AND browser_hash=$4
      AND confirmed_at IS NOT NULL AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.browserRef, input.browserHash])).rows[0];
  return row ? { expiresAt: row.expires_at.getTime() } : null;
}

/** A cookie can restore its own public reference, never confirm a preparation,
 * renew a deadline, select a session or consume a preparation/provider quota. */
export async function restoreBrowser(client: PoolClient, input: CustomerScope & { browserHash: string }): Promise<CustomerBrowserPreparation | null> {
  const row = (await client.query<Pick<PreparationRow, 'browser_ref' | 'admission_expires_at' | 'expires_at'>>(`
    SELECT browser_ref,admission_expires_at,expires_at FROM customer.browser_preparations
    WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3
      AND confirmed_at IS NOT NULL AND expires_at>clock_timestamp()`,
  [input.parentRef, input.tenantRef, input.browserHash])).rows[0];
  return row ? { browserRef: row.browser_ref, state: 'confirmed',
    admissionExpiresAt: row.admission_expires_at.getTime(), expiresAt: row.expires_at.getTime() } : null;
}
