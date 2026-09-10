import { DomainError } from '../shared/errors';
import type { Result } from '../shared/result';

export interface LoyaltySaleTotals {
  readonly subtotalCents: number;
  readonly discountCents: number;
  readonly deliveryFeeCents: number;
  readonly totalCents: number;
}

export interface LoyaltySaleBasis {
  readonly policyVersion: 'merchandise-net-v1';
  readonly eligiblePurchaseCents: number;
  readonly excludedChargeCents: number;
  readonly chargedTotalCents: number;
}

export class InvalidLoyaltySaleBasis extends DomainError {
  readonly code = 'loyalty.sale_basis.invalid';
  constructor() { super('Les montants de la vente fidélité sont incohérents.'); }
}

/** Pure policy for a future sale snapshot, not proof of payment or ownership.
 * The adapter must supply server-validated totals. This policy excludes delivery
 * fees and never guesses which part of a later refund concerns merchandise.
 * It does not change the historical POS calculation or grant any units. */
export function deriveLoyaltySaleBasis(totals: LoyaltySaleTotals): Result<LoyaltySaleBasis, InvalidLoyaltySaleBasis> {
  const invalid = (): Result<never, InvalidLoyaltySaleBasis> =>
    Object.freeze({ ok: false, error: new InvalidLoyaltySaleBasis() });
  if (!totals || typeof totals !== 'object') return invalid();
  const { subtotalCents, discountCents, deliveryFeeCents, totalCents } = totals;
  if (![subtotalCents, discountCents, deliveryFeeCents, totalCents]
    .every(value => Number.isSafeInteger(value) && value >= 0) || discountCents > subtotalCents) return invalid();
  const eligible = BigInt(subtotalCents) - BigInt(discountCents);
  if (eligible + BigInt(deliveryFeeCents) !== BigInt(totalCents)) return invalid();
  return Object.freeze({ ok: true, value: Object.freeze({ policyVersion: 'merchandise-net-v1',
    eligiblePurchaseCents: Number(eligible), excludedChargeCents: deliveryFeeCents, chargedTotalCents: totalCents }) });
}
