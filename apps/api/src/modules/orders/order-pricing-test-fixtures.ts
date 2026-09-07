import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';

/** Pricing-unit port only. Does NOT model seats, CAS, Mongo durability or WS.
 * Those guarantees require the real order-capacity runtime integration suite. */
export function pricingAdmissionPort(write: (candidate: Record<string, unknown>) => Promise<unknown>) {
  return {
    prepareInternal: vi.fn(async () => ({ order: null, binding: { kind: 'legacy', version: 1 } })),
    commitInternal: vi.fn(async (_tenant: string, _client: string, _binding: unknown, candidate: Record<string, unknown>) =>
      ({ order: await write(candidate), created: true })),
    rejectInternal: vi.fn(async () => { throw new ConflictException({ code: 'ORDER_ATTEMPT_REJECTED', reason: 'invalid_order', message: 'Refus confirmé' }); }),
    releaseInternalValidation: vi.fn().mockResolvedValue(undefined),
    candidateLost: vi.fn().mockResolvedValue(true),
    assertLegacyKeyAvailable: vi.fn().mockResolvedValue(undefined),
  };
}
