import { describe, expect, it } from 'vitest';
import { LoyaltySaleResolutionRequestSchema, LoyaltySaleSettlementQuerySchema, LoyaltySaleSettlementSchema } from './loyalty-sale-settlement';
const id = '1'.repeat(24), uuid = '11111111-1111-4111-8111-111111111111';
const view = { orderId: id, orderNumber: 42, caseId: uuid, version: 2, state: 'reconciliation', reason: 'insufficient_balance',
  initialUnits: 10, reversedUnits: 0, waivedUnits: 0, retainedUnits: 10, dueUnits: 3, canResolve: true, canAllocate: false, resolutions: [] };
describe('private sale settlement projection', () => {
  it('keeps a closed non-PII projection with explicit owner decisions', () => {
    expect(LoyaltySaleSettlementSchema.parse(view)).toEqual(view);
    for (const patch of [{ phone: 'private' }, { memberId: uuid }, { owner: {} }, { clientId: uuid }, { dueUnits: -1 }, { state: 'recorded' }, { reason: 'unexpected' }, { reason: 'allocation_unknown' }, { version: null }]) {
      expect(LoyaltySaleSettlementSchema.safeParse({ ...view, ...patch }).success).toBe(false);
    }
  });
  it('requires a bounded versioned owner decision and excludes client financial amounts', () => {
    const body = { operationId: uuid, caseId: uuid, expectedVersion: 2, decision: 'waive_current', reason: 'Geste commercial', password: 'fixture-password' };
    expect(LoyaltySaleResolutionRequestSchema.parse(body)).toEqual(body);
    for (const patch of [{ password: '' }, { decision: 'waive_future' }, { amount: 3 }, { expectedVersion: '2' }, { expectedVersion: 0 }, { reason: 'x' }, { actorRef: 'private' }]) {
      expect(LoyaltySaleResolutionRequestSchema.safeParse({ ...body, ...patch }).success).toBe(false);
    }
  });
  it('bounds paginated reads and refuses an identifier in place of a tenant authority', () => {
    expect(LoyaltySaleSettlementQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const query of [{ limit: 31 }, { limit: 0 }, { cursor: 'x' }, { tenantRef: id }]) expect(LoyaltySaleSettlementQuerySchema.safeParse(query).success).toBe(false);
  });
});
