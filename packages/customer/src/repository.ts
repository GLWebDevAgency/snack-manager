import type { Pool, PoolClient } from 'pg';
import type { CustomerIdentityRepository, CustomerScope } from './port';
import { withCustomerScope } from './client';
import { lockParent, session } from './queries';
import { reserveVerification } from './reservation';
import { claimVerification, completeVerification, recoverVerification, settleVerification } from './checks';
import { claimSchema, completionSchema, nameSchema, recoverySchema, reservationSchema, revocationSchema,
  sessionSchema, settlementSchema, validate } from './validation';

type Input<K extends keyof CustomerIdentityRepository> = Parameters<CustomerIdentityRepository[K]>[0];

/** Parent serialization is bounded to local SQL; never held over provider calls. */
export class PostgresCustomerIdentityRepository implements CustomerIdentityRepository {
  constructor(private readonly pool: Pool) {}
  private locked<T>(scope: CustomerScope, work: (client: PoolClient) => Promise<T>): Promise<T | null> {
    return withCustomerScope(this.pool, scope, async client => await lockParent(client, scope) ? work(client) : null);
  }
  reserve(raw: Input<'reserve'>) {
    const input = validate(reservationSchema, raw);
    return withCustomerScope(this.pool, input, client => reserveVerification(client, input));
  }
  settleSend(raw: Input<'settleSend'>) {
    const input = validate(settlementSchema, raw);
    return this.locked(input, client => settleVerification(client, input));
  }
  claimCheck(raw: Input<'claimCheck'>) {
    const input = validate(claimSchema, raw);
    return this.locked(input, client => claimVerification(client, input));
  }
  recoverCheck(raw: Input<'recoverCheck'>) {
    const input = validate(recoverySchema, raw);
    return this.locked(input, client => recoverVerification(client, input));
  }
  completeCheck(raw: Input<'completeCheck'>) {
    const input = validate(completionSchema, raw);
    return this.locked(input, client => completeVerification(client, input));
  }
  authenticate(raw: Input<'authenticate'>) {
    const input = validate(sessionSchema, raw);
    return this.locked(input, client => session(client, input, input.sessionHash, input.browserHash));
  }
  updateName(raw: Input<'updateName'>) {
    const input = validate(nameSchema, raw);
    return this.locked(input, async client => {
      const current = await session(client, input, input.sessionHash, input.browserHash);
      if (!current) return null;
      await client.query('SELECT id FROM customer.accounts WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 FOR UPDATE',
        [input.parentRef, input.tenantRef, current.profile.accountId]);
      if (!await session(client, input, input.sessionHash, input.browserHash)) return null;
      const changed = await client.query(`UPDATE customer.accounts a SET encrypted_name=$4,revision=revision+1
        WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.revision=$5 AND a.active
          AND EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=a.parent_ref AND s.tenant_ref=a.tenant_ref
            AND s.account_id=a.id AND s.session_hash=$6 AND s.revoked_at IS NULL
            AND s.expires_at>clock_timestamp() AND s.account_version=a.session_version AND s.browser_hash=$7
            AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
              (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
              =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)))`,
      [input.parentRef, input.tenantRef, current.profile.accountId, input.encryptedName, input.expectedRevision, input.sessionHash, input.browserHash]);
      return changed.rowCount ? session(client, input, input.sessionHash, input.browserHash) : null;
    });
  }
  async revoke(raw: Input<'revoke'>): Promise<void> {
    const input = validate(revocationSchema, raw);
    await this.locked(input, async client => {
      const current = await session(client, input, input.sessionHash, input.browserHash);
      if (!current) return;
      await client.query('SELECT id FROM customer.accounts WHERE parent_ref=$1 AND tenant_ref=$2 AND id=$3 FOR UPDATE',
        [input.parentRef, input.tenantRef, current.profile.accountId]);
      if (!await session(client, input, input.sessionHash, input.browserHash)) return;
      // The final SQL mutation checks expiry before changing either identity or
      // context. Parent serialization keeps the current pointer stable throughout.
      const changed = input.all ? await client.query(`UPDATE customer.accounts a SET session_version=session_version+1
        WHERE a.parent_ref=$1 AND a.tenant_ref=$2 AND a.id=$3 AND a.active
          AND EXISTS (SELECT 1 FROM customer.sessions s WHERE s.parent_ref=a.parent_ref AND s.tenant_ref=a.tenant_ref
            AND s.account_id=a.id AND s.session_hash=$4 AND s.revoked_at IS NULL
            AND s.expires_at>clock_timestamp() AND s.account_version=a.session_version AND s.browser_hash=$5
            AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
              (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
              =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id)))`,
      [input.parentRef, input.tenantRef, current.profile.accountId, input.sessionHash, input.browserHash])
        : await client.query(`UPDATE customer.sessions s SET revoked_at=clock_timestamp()
        WHERE parent_ref=$1 AND tenant_ref=$2 AND session_hash=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()
          AND browser_hash=$4 AND EXISTS (SELECT 1 FROM customer.browser_contexts b WHERE
            (b.parent_ref,b.tenant_ref,b.browser_hash,b.generation,b.current_session_id)
            =(s.parent_ref,s.tenant_ref,s.browser_hash,s.browser_generation,s.id))`,
      [input.parentRef, input.tenantRef, input.sessionHash, input.browserHash]);
      if (!changed.rowCount) return;
      const detached = await client.query(`UPDATE customer.browser_contexts SET generation=generation+1,current_session_id=NULL
        WHERE parent_ref=$1 AND tenant_ref=$2 AND browser_hash=$3 AND current_session_id=$4`,
      [input.parentRef, input.tenantRef, input.browserHash, current.sessionId]);
      if (detached.rowCount !== 1) throw new Error('Continuité navigateur indisponible');
    });
  }
}
