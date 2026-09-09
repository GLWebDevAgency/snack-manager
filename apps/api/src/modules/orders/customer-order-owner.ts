import { recoveryNotFound } from './order-recovery';
import { Document } from 'mongoose';

/** Internal principal projection. Never accepted from a checkout DTO. */
export type CustomerOrderOwner = Readonly<{ tenantRef: string; parentRef: string; accountId: string }>;
export type CustomerOrderCommitAuthority = () => Promise<CustomerOrderOwner>;

export function validCustomerOrderOwner(value: unknown): value is CustomerOrderOwner {
  if (value instanceof Document) value = value.toObject({ transform: false, getters: false, virtuals: false });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 3 && typeof row.tenantRef === 'string' && /^[a-f0-9]{24}$/.test(row.tenantRef)
    && typeof row.parentRef === 'string' && /^AC[0-9a-fA-F]{32}$/.test(row.parentRef)
    && typeof row.accountId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.accountId);
}

export function assertCustomerOrderOwner(stored: unknown, expected: CustomerOrderOwner | null | undefined): void {
  if (stored == null && expected == null) return; // Existing C01/legacy rows stay guests.
  if (!validCustomerOrderOwner(stored) || !validCustomerOrderOwner(expected)
    || stored.tenantRef !== expected.tenantRef || stored.parentRef !== expected.parentRef || stored.accountId !== expected.accountId) throw recoveryNotFound();
}

export function customerOrderOwnerFilter(owner: CustomerOrderOwner | null | undefined) {
  if (owner == null) return { customerOwner: null };
  if (!validCustomerOrderOwner(owner)) throw recoveryNotFound();
  return { 'customerOwner.tenantRef': owner.tenantRef, 'customerOwner.parentRef': owner.parentRef, 'customerOwner.accountId': owner.accountId };
}
