import { describe, expect, it } from 'vitest';
import { LoyaltySaleResolutionRequestSchema, LoyaltySaleSettlementQuerySchema, LoyaltySaleSettlementReadQuerySchema, LoyaltySaleSettlementSchema, LoyaltySaleSettlementV2Schema } from './loyalty-sale-settlement';
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
  it('opts into no-gain presentation without changing the strict v1 response or decision contracts', () => {
    const cancelled = { ...view, state: 'not_earned', reason: 'cancelled_before_handoff', initialUnits: null,
      retainedUnits: 0, dueUnits: 0, canResolve: false };
    expect(LoyaltySaleSettlementSchema.safeParse(cancelled).success).toBe(false);
    expect(LoyaltySaleSettlementV2Schema.parse(cancelled)).toEqual(cancelled);
    expect(LoyaltySaleSettlementV2Schema.parse(view)).toEqual(view);
    for (const patch of [{ initialUnits: 0 }, { initialUnits: 1 }, { reversedUnits: 1 }, { waivedUnits: 1 }, { retainedUnits: 1 },
      { dueUnits: 1 }, { canResolve: true }, { canAllocate: true }, { caseId: null }, { version: null }, { reason: 'payment_or_handoff_pending' }]) {
      expect(LoyaltySaleSettlementV2Schema.safeParse({ ...cancelled, ...patch }).success).toBe(false);
    }
    expect(LoyaltySaleSettlementQuerySchema.parse({ presentationVersion: '2' })).toEqual({ limit: 20, presentationVersion: '2' });
    expect(LoyaltySaleSettlementReadQuerySchema.parse({ presentationVersion: '2' })).toEqual({ presentationVersion: '2' });
    for (const presentationVersion of ['1', '3', '', 2, true, ['2']]) {
      expect(LoyaltySaleSettlementQuerySchema.safeParse({ presentationVersion }).success).toBe(false);
      expect(LoyaltySaleSettlementReadQuerySchema.safeParse({ presentationVersion }).success).toBe(false);
    }
  });
});
