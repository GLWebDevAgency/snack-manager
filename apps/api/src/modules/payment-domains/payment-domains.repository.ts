import type { Model } from 'mongoose';
import type { Tenant } from '@sm/db';
import { type DomainCursor, type DomainTenant } from './payment-domain-hosts';

export interface PaymentDomainsRepository {
  page(cursor: DomainCursor | null, limit: number): Promise<DomainTenant[]>;
  current(tenantId: string, accountId: string): Promise<DomainTenant | null>;
}

const ELIGIBLE = {
  'encaissement.chargesEnabled': true,
  'encaissement.accountId': /^acct_[a-zA-Z0-9]+$/,
  'account.status': { $ne: 'suspended' },
};
const PROJECTION = { _id: 1, slug: 1, 'encaissement.accountId': 1, 'encaissement.chargesEnabled': 1,
  'account.status': 1, 'domains.hostname': 1, 'domains.status': 1 };

/** Read-only source of desired state; no changes to onboarding or checkout. */
export class MongoPaymentDomainsRepository implements PaymentDomainsRepository {
  constructor(private readonly tenants: Model<Tenant>) {}
  async page(cursor: DomainCursor | null, limit: number): Promise<DomainTenant[]> {
    return this.tenants.find({ ...ELIGIBLE,
      ...(cursor ? { _id: { [cursor.host === null ? '$gt' : '$gte']: cursor.tenantId } } : {}),
    }).select(PROJECTION).sort({ _id: 1 }).limit(limit).maxTimeMS(5_000).lean().exec();
  }
  async current(tenantId: string, accountId: string): Promise<DomainTenant | null> {
    return this.tenants.findOne({ ...ELIGIBLE, _id: tenantId, 'encaissement.accountId': accountId })
      .select(PROJECTION).maxTimeMS(5_000).lean().exec();
  }
}
