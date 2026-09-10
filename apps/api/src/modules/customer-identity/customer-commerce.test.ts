import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { customerCommerce } from './customer-commerce';
import { customerSafeError } from './customer-account.error';
import { CustomerIdentityError } from './customer-identity.service';
import { CustomerOrderAuthorityLost } from '../orders/order-admission.errors';
function fixture() {
  const principal = { parentRef: `AC${'a'.repeat(32)}`, tenantRef: 'a'.repeat(24), accountId: randomUUID(), sessionId: randomUUID(), expiresAt: Date.now() + 60_000 };
  const checkout = { listForCustomer: vi.fn().mockResolvedValue({ orders: [], nextCursor: null }),
    detailForCustomer: vi.fn(), reorderForCustomer: vi.fn(), createForCustomer: vi.fn() };
  const port = { principal, authorize: vi.fn().mockImplementation(async () => ({ ...principal })), checkout,
    slug: 'fixture', client: 'relay-source', now: Date.now };
  return port;
}
const list = { action: 'orders' as const, request: { filter: 'all' as const, limit: 20, cursor: null } };
const reorder = { action: 'order-reorder' as const, request: { orderId: 'a'.repeat(24) } };
const source = { orderId: reorder.request.orderId, number: 42, lines: [{ productId: 'b'.repeat(24), name: 'Private source',
  variantKey: null, variantName: null, qty: 1, unitPrice: 1250, options: [], removed: [] }] };
function failure(promise: Promise<unknown>) {
  return promise.then(() => { throw new Error('Expected a refusal'); }, customerSafeError);
}
describe('customer commerce account fence, no distributed-transaction claim', () => {
  it.each(['unauthorized', 'unavailable'] as const)('distinguishes proven authority loss from %s at commit', async reason => {
    const f = fixture();
    f.checkout.createForCustomer.mockImplementation(async input => {
      f.authorize.mockRejectedValue(new CustomerIdentityError(reason));
      await input.beforeCommit();
      throw new Error('unreachable');
    });
    const request = { clientId: randomUUID(), recoveryProof: 'a'.repeat(64), turnstileToken: 'fixture', lines: [], payment: { method: 'counter' as const },
      pickup: { slot: '2030-09-09T12:00:00.000Z', customerName: 'Fixture', customerPhone: '0600000000' } };
    const pending = customerCommerce(f, { action: 'order-create', request });
    if (reason === 'unauthorized') await expect(pending).rejects.toBeInstanceOf(CustomerOrderAuthorityLost);
    else await expect(pending).rejects.toMatchObject({ reason: 'unavailable' });
  });
  it('classifies a proven owner change through the commerce wrapper as lost authority, not PG I/O', async () => {
    const f = fixture(); f.checkout.createForCustomer.mockImplementation(async input => {
      f.principal.accountId = randomUUID(); await input.beforeCommit(); throw new Error('unreachable');
    });
    const request = { clientId: randomUUID(), recoveryProof: 'a'.repeat(64), turnstileToken: 'fixture', lines: [], payment: { method: 'counter' as const },
      pickup: { slot: '2030-09-09T12:00:00.000Z', customerName: 'Fixture', customerPhone: '0600000000' } };
    await expect(customerCommerce(f, { action: 'order-create', request })).rejects.toBeInstanceOf(CustomerOrderAuthorityLost);
  });
  it('reads a reorder source for the authenticated owner without entering checkout', async () => {
    const f = fixture(); f.checkout.reorderForCustomer.mockResolvedValue(source);
    expect(await customerCommerce(f, reorder)).toEqual({ expiresAt: f.principal.expiresAt, ...source });
    expect(f.checkout.reorderForCustomer).toHaveBeenCalledWith({ parentRef: f.principal.parentRef,
      tenantRef: f.principal.tenantRef, accountId: f.principal.accountId }, reorder.request.orderId);
    expect(f.authorize).toHaveBeenCalledTimes(2); expect(f.checkout.createForCustomer).not.toHaveBeenCalled();
  });
  it('does not read a reorder source after a revoked session', async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error('revoked'));
    await expect(customerCommerce(f, reorder)).rejects.toThrow();
    expect(f.checkout.reorderForCustomer).not.toHaveBeenCalled(); expect(f.checkout.createForCustomer).not.toHaveBeenCalled();
  });
  it.each(['accountId', 'tenantRef', 'parentRef', 'sessionId', 'expiresAt', 'revoked'] as const)('discards late reorder contents after %s changed', async field => {
    const f = fixture(); f.checkout.reorderForCustomer.mockImplementation(async () => {
      if (field === 'revoked') f.authorize.mockRejectedValue(new CustomerIdentityError('unauthorized'));
      else if (field === 'expiresAt') f.principal.expiresAt -= 1;
      else if (field === 'accountId' || field === 'sessionId') f.principal[field] = randomUUID();
      else f.principal[field] = 'changed';
      return source;
    });
    const error = await failure(customerCommerce(f, reorder));
    // A changed principal loses authority just like the expired session; it
    // is not the normal stable-owner missing-order response (404).
    expect(error.getStatus()).toBe(401);
    expect(JSON.stringify(error.getResponse())).not.toContain('Private source');
    expect(f.checkout.createForCustomer).not.toHaveBeenCalled();
  });
  it('uses the same nonexistence refusal for reorder and rechecks a delayed denial', async () => {
    const f = fixture(); f.checkout.reorderForCustomer.mockRejectedValue(new NotFoundException({ code: 'ORDER_RECOVERY_NOT_FOUND' }));
    expect((await failure(customerCommerce(f, reorder))).getStatus()).toBe(404);
    expect(f.authorize).toHaveBeenCalledTimes(2);
    f.checkout.reorderForCustomer.mockImplementation(async () => { f.principal.sessionId = randomUUID(); throw new NotFoundException({ code: 'ORDER_RECOVERY_NOT_FOUND' }); });
    expect((await failure(customerCommerce(f, reorder))).getStatus()).toBe(401);
  });
  it.each(['accountId', 'tenantRef', 'parentRef', 'sessionId', 'expiresAt'] as const)('the final runtime publication fence retains the original %s', async field => {
    const f = fixture(); f.checkout.reorderForCustomer.mockResolvedValue(source);
    let fence: (() => Promise<unknown>) | undefined;
    await customerCommerce({ ...f, publicationFence: check => { fence = check; } }, reorder);
    if (field === 'expiresAt') f.principal.expiresAt -= 1;
    else if (field === 'accountId' || field === 'sessionId') f.principal[field] = randomUUID();
    else f.principal[field] = 'changed';
    if (!fence) throw new Error('Expected the private publication fence');
    await expect(fence()).rejects.toThrow();
    expect(f.checkout.reorderForCustomer).toHaveBeenCalledTimes(1);
  });
  it('resolves ownership only from the private principal, never a browser selector', async () => {
    const f = fixture(); expect(await customerCommerce(f, list)).toEqual({ expiresAt: f.principal.expiresAt, orders: [], nextCursor: null });
    expect(f.checkout.listForCustomer).toHaveBeenCalledWith({ parentRef: f.principal.parentRef, tenantRef: f.principal.tenantRef, accountId: f.principal.accountId }, list.request);
    expect(f.authorize).toHaveBeenCalledTimes(2);
  });
  it('does not query orders when protected authentication fails', async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error('closed'));
    await expect(customerCommerce(f, list)).rejects.toThrow(); expect(f.checkout.listForCustomer).not.toHaveBeenCalled();
  });
  it('projects only the known missing-order refusal and rechecks its selected session', async () => {
    const f = fixture();
    f.checkout.detailForCustomer.mockRejectedValue(new NotFoundException({ code: 'ORDER_RECOVERY_NOT_FOUND', message: 'private detail' }));
    const command = { action: 'order-detail' as const, request: { orderId: 'a'.repeat(24) } };
    const error = await failure(customerCommerce(f, command));
    expect(error.getStatus()).toBe(404); expect(JSON.stringify(error.getResponse())).not.toContain('private detail');
    expect(f.authorize).toHaveBeenCalledTimes(2);
    f.checkout.detailForCustomer.mockImplementation(async () => { f.principal.sessionId = randomUUID(); throw new NotFoundException({ code: 'ORDER_RECOVERY_NOT_FOUND' }); });
    expect((await failure(customerCommerce(f, command))).getStatus()).toBe(401);
  });
  it('does not forward arbitrary adapter 404 bodies', async () => {
    const f = fixture(); f.checkout.detailForCustomer.mockRejectedValue(new NotFoundException('private adapter data'));
    const error = await failure(customerCommerce(f, { action: 'order-detail', request: { orderId: 'a'.repeat(24) } }));
    expect(error.getStatus()).toBe(503); expect(JSON.stringify(error.getResponse())).not.toContain('private adapter data');
  });
  it.each(['accountId', 'tenantRef', 'parentRef', 'sessionId', 'expiresAt'] as const)('discards a response if %s changed while Mongo was reading', async field => {
    const f = fixture(); f.checkout.listForCustomer.mockImplementation(async () => {
      if (field === 'expiresAt') f.principal.expiresAt -= 1;
      else if (field === 'accountId' || field === 'sessionId') f.principal[field] = randomUUID();
      else f.principal[field] = 'changed';
      return { orders: [], nextCursor: null };
    });
    await expect(customerCommerce(f, list)).rejects.toThrow();
  });
  it('rejects a result that expires at the last permission check', async () => {
    const f = fixture(); f.checkout.listForCustomer.mockImplementation(async () => { f.now = () => f.principal.expiresAt; return { orders: [], nextCursor: null }; });
    await expect(customerCommerce(f, list)).rejects.toThrow();
  });
  it('passes a required reauthorization callback to the one common checkout', async () => {
    const f = fixture(); f.checkout.createForCustomer.mockImplementation(async input => {
      f.principal.sessionId = randomUUID(); await input.beforeCommit(); throw new Error('unreachable');
    });
    const request = { clientId: randomUUID(), recoveryProof: 'a'.repeat(64), turnstileToken: 'fixture', lines: [], payment: { method: 'counter' as const },
      pickup: { slot: '2026-09-09T12:00:00.000Z', customerName: 'Fixture', customerPhone: '0600000000' } };
    await expect(customerCommerce(f, { action: 'order-create', request })).rejects.toThrow();
    expect(f.checkout.createForCustomer).toHaveBeenCalledWith(expect.objectContaining({ sourceKey: 'customer:relay-source', beforeCommit: expect.any(Function) }));
  });
  it('only projects an explicit durable rejection, never raw exception text', async () => {
    const f = fixture(); f.checkout.createForCustomer.mockRejectedValue(new ConflictException({ code: 'ORDER_ATTEMPT_REJECTED', reason: 'slot_unavailable', message: 'private internals' }));
    const request = { clientId: randomUUID(), recoveryProof: 'a'.repeat(64), turnstileToken: 'fixture', lines: [], payment: { method: 'counter' as const },
      pickup: { slot: '2026-09-09T12:00:00.000Z', customerName: 'Fixture', customerPhone: '0600000000' } };
    expect(await customerCommerce(f, { action: 'order-create', request })).toEqual({ state: 'rejected', expiresAt: f.principal.expiresAt,
      reason: 'slot_unavailable', message: 'Ce créneau ne peut plus être réservé. Choisissez un autre créneau.' });
    f.checkout.createForCustomer.mockRejectedValue(new Error('ambiguous Mongo commit'));
    await expect(customerCommerce(f, { action: 'order-create', request })).rejects.toThrow('ambiguous Mongo commit');
  });
});
