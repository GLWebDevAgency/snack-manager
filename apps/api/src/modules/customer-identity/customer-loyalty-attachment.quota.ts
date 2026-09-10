import type { CustomerIdentityCrypto } from '@sm/customer';
import { hashLoyaltyQrToken } from '@sm/loyalty';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { CustomerIdentityError } from './customer-identity.service';

export type LoyaltyAttachmentQuotaInput = {
  sourceClient: string; parentRef: string; tenantRef: string; sessionHash: string; qrToken: string;
  identity: CustomerIdentityCrypto;
};

/** Traffic budget, not an ownership proof. Call before the protected SQL
 * transaction, never from its callback or final publication fence. Retries
 * consume traffic even when their business operation is idempotent; view/card
 * recover a committed attachment without spending this mutation budget. */
export async function reserveLoyaltyAttachmentQuota(quota: SharedPublicQuota, input: LoyaltyAttachmentQuotaInput): Promise<void> {
  const canonicalToken = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
  if (!canonicalToken.test(input.sourceClient) || !canonicalToken.test(input.qrToken)
    || !/^[a-f0-9]{64}$/.test(input.sessionHash)) throw new CustomerIdentityError('unavailable');
  let allowed: boolean;
  try {
    // Source already contains the signed relay's HMAC, not a browser value.
    // It deliberately excludes the restaurant and operation UUID.
    allowed = await quota.reserve({ scope: 'customer-loyalty-attach-source-v1', clientKey: input.sourceClient,
      windowMs: 60_000, clientLimit: 20, globalLimit: 100 });
    if (allowed) allowed = await quota.reserveClient({ scope: 'customer-loyalty-attach-session-v1',
      clientKey: input.identity.hash('request', input.parentRef,
        JSON.stringify(['customer-loyalty-attach-session-v1', input.tenantRef, input.sessionHash])),
      windowMs: 60_000, clientLimit: 6 });
    if (allowed) allowed = await quota.reserveClient({ scope: 'customer-loyalty-attach-qr-v1',
      clientKey: input.identity.hash('request', input.parentRef,
        JSON.stringify(['customer-loyalty-attach-qr-v1', input.tenantRef, hashLoyaltyQrToken(input.qrToken)])),
      windowMs: 60_000, clientLimit: 12 });
  } catch { throw new CustomerIdentityError('unavailable'); }
  if (!allowed) throw new CustomerIdentityError('limited');
}
