import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withProtectedCustomerSession, type CustomerIdentityCrypto, type CustomerIdentityRepository } from '@sm/customer';
import { CustomerSaleAttributionSchema, type CustomerSaleAttribution } from '@sm/contracts';
import { loyalty } from '@sm/domain';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import { POSTGRES_POOL } from '../../postgres.module';
import { LOYALTY_CRYPTO } from '../../loyalty-db.module';
import { validCustomerOrderOwner, type CustomerOrderOwner } from '../orders/customer-order-owner';
import { CustomerIdentityError } from './customer-identity.service';
import { readCustomerLoyaltySaleAttribution } from './customer-loyalty.store';

export type CustomerSaleAttributionInput = {
  selection: Parameters<CustomerIdentityRepository['authenticateProtected']>[0];
  identity: CustomerIdentityCrypto;
  expected: { owner: CustomerOrderOwner; sessionId: string; expiresAt: number };
  clientId: string;
  totals: loyalty.LoyaltySaleTotals;
  enabled: () => Promise<boolean>;
};

/** Capture préparatoire, pas une autorisation de crédit. La capacité Mongo est
 * lue avant la transaction PG ; son résultat ne représente pas une transaction
 * commune avec Mongo. Le caller fige ensuite cette décision dans son CAS et
 * garde son contrôle d'autorité final. Aucun profil/QR n'est déchiffré ici. */
@Injectable()
export class CustomerSaleAttributionService {
  constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool,
    @Inject(LOYALTY_CRYPTO) private readonly crypto: LoyaltyCryptoAdapter) {}

  async prepare(input: CustomerSaleAttributionInput): Promise<CustomerSaleAttribution> {
    try {
      // Copier avant tout await : le caller ne peut remplacer A par B ou
      // changer l'assiette pendant la lecture commerciale/SQL.
      const selection = { ...input.selection, now: Date.now() };
      const expected = { owner: { ...input.expected.owner }, sessionId: input.expected.sessionId, expiresAt: input.expected.expiresAt };
      const clientId = z.uuid().parse(input.clientId);
      const computed = loyalty.deriveLoyaltySaleBasis({ ...input.totals });
      if (!computed.ok) throw new CustomerIdentityError('unavailable');
      if (!validCustomerOrderOwner(expected.owner) || expected.owner.parentRef !== selection.parentRef
        || expected.owner.tenantRef !== selection.tenantRef || !z.uuid().safeParse(expected.sessionId).success
        || !Number.isSafeInteger(expected.expiresAt) || expected.expiresAt <= Date.now()) throw new CustomerIdentityError('unauthorized');
      const enabled = await input.enabled();
      if (typeof enabled !== 'boolean') throw new CustomerIdentityError('unavailable');
      const result = await withProtectedCustomerSession(this.pool, selection, async context => {
        const current = context.session;
        if (current.profile.accountId !== expected.owner.accountId || current.sessionId !== expected.sessionId
          || current.expiresAt !== expected.expiresAt || current.expiresAt <= Date.now()) return null;
        const decision = enabled ? await readCustomerLoyaltySaleAttribution({ ...context, scope: selection, crypto: this.crypto })
          : { decision: 'none' as const, reason: 'feature_unavailable' as const };
        const instant = (await context.client.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now;
        if (!(instant instanceof Date) || !Number.isSafeInteger(instant.getTime())) throw new CustomerIdentityError('unavailable');
        const capturedAt = instant.getTime();
        if (capturedAt >= expected.expiresAt) return null;
        return CustomerSaleAttributionSchema.parse({ version: 1, tenantRef: selection.tenantRef, clientId, owner: expected.owner,
          capturedAt, basis: computed.value, ...decision });
      });
      if (!result || expected.expiresAt <= Date.now()) throw new CustomerIdentityError('unauthorized');
      Object.freeze(result.owner); Object.freeze(result.basis);
      if (result.decision === 'attributed') Object.freeze(result.rule);
      return Object.freeze(result);
    } catch (error) {
      if (error instanceof CustomerIdentityError) throw error;
      // Corruption, timeout et refus du contrôle SQL final restent fermés.
      // Ni cause, ni paramètres SQL, ni données de profil dans l'erreur publique.
      throw new CustomerIdentityError('unavailable');
    }
  }
}
