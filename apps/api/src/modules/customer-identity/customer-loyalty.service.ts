import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { CustomerIdentityCrypto, withProtectedCustomerSession, type CustomerIdentityRepository,
  type ProtectedCustomerSession } from '@sm/customer';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import { CustomerLoyaltyRequestSchema, CustomerLoyaltyResponseSchema, type CustomerLoyaltyResponse } from '@sm/contracts';
import { POSTGRES_POOL } from '../../postgres.module';
import { LOYALTY_CRYPTO } from '../../loyalty-db.module';
import { CustomerIdentityError } from './customer-identity.service';
import { CustomerLoyaltyStoreError, runCustomerLoyalty, type CustomerLoyaltyStoreResult } from './customer-loyalty.store';

type Selection = Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
type Principal = { accountId: string; sessionId: string; expiresAt: number };
const principalOf = (session: ProtectedCustomerSession): Principal => ({ accountId: session.profile.accountId,
  sessionId: session.sessionId, expiresAt: session.expiresAt });
function samePrincipal(expected: Principal, current: ProtectedCustomerSession): boolean {
  return expected.accountId === current.profile.accountId && expected.sessionId === current.sessionId
    && expected.expiresAt === current.expiresAt && current.expiresAt > Date.now();
}
function collision(error: unknown): CustomerLoyaltyStoreResult | null {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505' || !('constraint' in error)) return null;
  return error.constraint === 'member_profiles_tenant_phone_uq' ? { state: 'existing_card' }
    : error.constraint === 'operations_tenant_ref_operation_id_pk' ? { state: 'conflict' } : null;
}

/** Only local SQL is executed under the identity locks. Mongo subscription
 * checks are sampled outside; they do not form a distributed transaction.
 * A committed enrollment survives a lost response. Publication still requires
 * the exact original account, session and selection, never just its phone. */
@Injectable()
export class CustomerLoyaltyService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(LOYALTY_CRYPTO) private readonly crypto: LoyaltyCryptoAdapter) {}

  async execute(input: { selection: Selection; identity: CustomerIdentityCrypto; request: unknown;
    enabled: () => Promise<boolean>; publicationFence: (fence: () => Promise<void>) => void }): Promise<CustomerLoyaltyResponse> {
    const parsed = CustomerLoyaltyRequestSchema.safeParse(input.request);
    if (!parsed.success) throw new CustomerIdentityError('invalid_request');
    const request = parsed.data;
    const enabled = await input.enabled();
    const captured: { principal: Principal | null; refusal: CustomerLoyaltyStoreResult | null } = { principal: null, refusal: null };
    let result: CustomerLoyaltyStoreResult | null;
    try {
      result = await withProtectedCustomerSession(this.pool, input.selection, async context => {
        captured.principal = principalOf(context.session);
        if (!enabled) return { state: 'unavailable' };
        try {
          return await runCustomerLoyalty({ ...context, scope: input.selection, identity: input.identity, crypto: this.crypto }, request);
        } catch (error) {
          // Capture only the safe outcome, then let the wrapper ROLLBACK. Never
          // keep querying/return success inside an aborted PostgreSQL transaction.
          captured.refusal = error instanceof CustomerLoyaltyStoreError ? error.result : collision(error);
          throw error;
        }
      });
    } catch {
      if (!captured.principal || !captured.refusal) throw new CustomerIdentityError('unavailable');
      result = captured.refusal;
    }
    const principal = captured.principal;
    if (!principal || !result) throw new CustomerIdentityError('unauthorized');
    const response = CustomerLoyaltyResponseSchema.parse({ ...result, expiresAt: principal.expiresAt });

    const recheck = async () => {
      const stillEnabled = await input.enabled();
      if (enabled && !stillEnabled) throw new CustomerIdentityError('unavailable');
      const valid = await withProtectedCustomerSession(this.pool, { ...input.selection, now: Date.now() }, async context => {
        if (!samePrincipal(principal, context.session)) return false;
        if (response.state === 'card') {
          // A POS rotation/block can occur while the runtime awaits Mongo or
          // browser checks. Do not publish the captured, now revoked QR.
          const current = await runCustomerLoyalty({ ...context, scope: input.selection, identity: input.identity, crypto: this.crypto }, { step: 'card' });
          if (current.state !== 'card' || current.member.id !== response.member.id
            || current.member.qrGeneration !== response.member.qrGeneration || current.qrToken !== response.qrToken) {
            throw new CustomerIdentityError('unavailable');
          }
        }
        return true;
      });
      if (!valid) throw new CustomerIdentityError('unauthorized');
    };
    input.publicationFence(recheck);
    await recheck();
    return response;
  }
}
