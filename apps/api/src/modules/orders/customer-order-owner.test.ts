import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertCustomerOrderOwner, customerOrderOwnerFilter } from './customer-order-owner';
import { assertOrderAdmissionBinding } from './order-admission-identity';

const owner = { tenantRef: '507f1f77bcf86cd799439011', parentRef: `AC${'a'.repeat(32)}`, accountId: randomUUID() };
const binding = { version: 1 as const, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) };

describe('immutable customer ownership of one checkout admission', () => {
  it('keeps old absent/null guest ownership equivalent without adopting an account', () => {
    expect(() => assertCustomerOrderOwner(undefined, null)).not.toThrow();
    expect(() => assertCustomerOrderOwner(null, undefined)).not.toThrow();
    expect(() => assertCustomerOrderOwner(null, owner)).toThrow();
    expect(() => assertCustomerOrderOwner(owner, null)).toThrow();
    expect(customerOrderOwnerFilter(undefined)).toEqual({ customerOwner: null });
  });
  it('compares tenant, parent and account, not a phone or the current browser', () => {
    expect(() => assertCustomerOrderOwner({ ...owner }, owner)).not.toThrow();
    for (const changed of [{ accountId: randomUUID() }, { tenantRef: '507f1f77bcf86cd799439012' }, { parentRef: `AC${'b'.repeat(32)}` }]) {
      expect(() => assertCustomerOrderOwner({ ...owner, ...changed }, owner)).toThrow();
    }
    expect(() => assertCustomerOrderOwner({ ...owner, phone: 'synthetic' }, owner)).toThrow();
  });
  it('fences owner mismatches in the common admission binding, including same C01 proof/body', () => {
    expect(() => assertOrderAdmissionBinding({ ...binding, customerOwner: owner }, binding)).toThrow();
    expect(() => assertOrderAdmissionBinding(binding, { ...binding, customerOwner: owner })).toThrow();
    expect(() => assertOrderAdmissionBinding({ ...binding, customerOwner: owner }, { ...binding, customerOwner: { ...owner } })).not.toThrow();
  });
});
