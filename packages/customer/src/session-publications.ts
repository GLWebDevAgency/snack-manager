import type { PoolClient } from 'pg';
import type { CustomerBrowserBinding } from './port';
import { CustomerRepositoryError } from './client';

/** Internal receipt writer. The caller must validate the method's proof and
 * publish under the shared parent lock, in this SAME SQL transaction. This is
 * neither a public authentication port nor a substitute for a method verifier. */
export type SessionPublication = CustomerBrowserBinding & {
  sessionId: string;
  operationId: string;
  checkId: string;
  method: 'phone' | 'passkey' | 'recovery';
};

export async function recordSessionPublication(client: PoolClient, input: SessionPublication): Promise<void> {
  const inserted = await client.query(`INSERT INTO customer.session_publications(parent_ref,tenant_ref,session_id,
    operation_id,check_id,browser_ref,browser_hash,browser_generation,method)
    SELECT s.parent_ref,s.tenant_ref,s.id,$4,$5,s.browser_ref,s.browser_hash,s.browser_generation,$8
    FROM customer.sessions s JOIN customer.browser_contexts b
      ON (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
        =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)
    WHERE s.parent_ref=$1 AND s.tenant_ref=$2 AND s.id=$3 AND s.browser_ref=$6 AND s.browser_hash=$7`,
  [input.parentRef, input.tenantRef, input.sessionId, input.operationId, input.checkId, input.browserRef, input.browserHash, input.method]);
  if (inserted.rowCount !== 1) throw new CustomerRepositoryError('unavailable');
}
