import { CustomerSaleAttributionSchema, type CustomerSaleAttribution } from '@sm/contracts';
import { loyalty } from '@sm/domain';
import type { CustomerOrderOwner } from './customer-order-owner';
import { CustomerOrderAuthorityLost, CustomerOrderPreparationUnavailable } from './order-admission.errors';

/** Server-only port: totals have already been resolved from the catalogue.
 * The caller fixes the protected account; no member or rule comes from the DTO. */
export type CustomerSaleAttributionInput = Readonly<{
  tenantRef: string;
  clientId: string;
  owner: CustomerOrderOwner;
  totals: loyalty.LoyaltySaleTotals;
}>;
export type PrepareCustomerSaleAttribution = (input: CustomerSaleAttributionInput) => Promise<CustomerSaleAttribution>;

export async function prepareCustomerSaleAttribution(
  prepare: PrepareCustomerSaleAttribution | undefined,
  input: CustomerSaleAttributionInput,
): Promise<CustomerSaleAttribution> {
  try {
    if (!prepare) throw new CustomerOrderPreparationUnavailable();
    const snapshot = CustomerSaleAttributionSchema.parse(await prepare(input));
    const basis = loyalty.deriveLoyaltySaleBasis(input.totals);
    if (!basis.ok || snapshot.basis.eligiblePurchaseCents !== basis.value.eligiblePurchaseCents
      || snapshot.basis.excludedChargeCents !== basis.value.excludedChargeCents
      || snapshot.basis.chargedTotalCents !== basis.value.chargedTotalCents) throw new CustomerOrderPreparationUnavailable();
    if (snapshot.tenantRef !== input.tenantRef || snapshot.clientId !== input.clientId
      || snapshot.owner.parentRef !== input.owner.parentRef || snapshot.owner.tenantRef !== input.owner.tenantRef
      || snapshot.owner.accountId !== input.owner.accountId) throw new CustomerOrderPreparationUnavailable();
    return snapshot;
  } catch (error) {
    if (error instanceof CustomerOrderAuthorityLost) throw error;
    // The adapter has not issued any Mongo commit. Do not store a "none"
    // decision or permanently reject the attempt on an unavailable PG read.
    throw new CustomerOrderPreparationUnavailable();
  }
}
