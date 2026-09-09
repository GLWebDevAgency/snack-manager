import type { Pool, PoolClient } from 'pg';
import type { CustomerIdentityRepository, CustomerSession } from './port';
import { CustomerRepositoryError, withCustomerScope } from './client';
import { lockIntentParent } from './intent-queries';
import { lockParent, session } from './queries';
import { sessionSchema, validate } from './validation';

type ProtectedSessionInput = Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
export type ProtectedCustomerSession = Readonly<Omit<CustomerSession, 'profile'>> & {
  readonly profile: Readonly<CustomerSession['profile']>;
};

/** Internal SQL proof. The caller must hold the intent-parent and budget locks,
 * in that order, inside its scoped transaction. Phone and loyalty QR are never
 * credentials; the selected, published session needs active account protection. */
export async function readProtectedCustomerSession(client: PoolClient, input: ProtectedSessionInput): Promise<CustomerSession | null> {
  const current = await session(client, input, input.sessionHash, input.browserHash, input);
  if (!current) return null;
  const proof = await client.query(`SELECT 1 FROM customer.accounts a JOIN customer.registration_enrollments e
    ON (e.parent_ref,e.tenant_ref,e.id)=(a.parent_ref,a.tenant_ref,a.enrollment_id)
    WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.active AND e.activated_at IS NOT NULL
      AND EXISTS (SELECT 1 FROM customer.passkey_credentials k WHERE (k.parent_ref,k.tenant_ref,k.account_id)
        =(a.parent_ref,a.tenant_ref,a.id) AND k.revoked_at IS NULL)
      AND EXISTS (SELECT 1 FROM customer.recovery_codes c WHERE (c.parent_ref,c.tenant_ref,c.account_id)
        =(a.parent_ref,a.tenant_ref,a.id) AND c.consumed_at IS NULL AND c.revoked_at IS NULL)`,
  [input.parentRef, input.tenantRef, current.profile.accountId]);
  if (proof.rowCount !== 1) return null;
  // The database clock is authoritative, including time spent waiting on SQL.
  const final = await session(client, input, input.sessionHash, input.browserHash, input);
  return final?.sessionId === current.sessionId && final.profile.accountId === current.profile.accountId ? final : null;
}

/** Server-only unit of work for trusted, bounded LOCAL SQL adapters.
 *
 * This is not a tenant-wide authorization grant: the adapter must constrain
 * every business query to the proven account. It must use ONLY this client,
 * never another transaction, COMMIT/ROLLBACK, provider/network call or external
 * side effect. Do not retain the client or publish the encrypted profile to a
 * browser. The result becomes publishable only after this promise resolves.
 *
 * Revoke/publication/recovery use the same parent locks, so operations serialize
 * at lock acquisition. A waiting revoke runs after this unit of work commits;
 * a revoke that acquired the lock first makes admission fail without a callback.
 * Initial refusal returns null. Loss of the complete proof after admission
 * throws, rolling back every SQL write instead of publishing a partial result.
 */
export async function withProtectedCustomerSession<T>(pool: Pick<Pool, 'connect'>, raw: ProtectedSessionInput,
  work: (context: { readonly client: PoolClient; readonly session: ProtectedCustomerSession }) => Promise<T>): Promise<T | null> {
  const input = validate(sessionSchema.strict(), raw);
  return withCustomerScope(pool, input, async client => {
    await lockIntentParent(client, input);
    await lockParent(client, input);
    const current = await readProtectedCustomerSession(client, input);
    if (!current) return null;
    const accountId = current.profile.accountId;
    const sessionId = current.sessionId;
    const view = Object.freeze({ ...current, profile: Object.freeze({ ...current.profile }) });
    const result = await work({ client, session: view });
    const final = await readProtectedCustomerSession(client, input);
    if (!final || final.sessionId !== sessionId || final.profile.accountId !== accountId) {
      throw new CustomerRepositoryError('unavailable');
    }
    return result;
  });
}
